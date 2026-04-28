# AgentBridge threat model

A catalogue of every threat we currently know about, what mitigates
it today (`v0.3.0`), what's still missing, and what the v1.0 target
mitigation looks like. This is a working document — extend it
whenever a new attack surface or test case lands.

## Trust boundaries

Three trust boundaries matter throughout this document:

1. **MCP client ↔ MCP server.** The client (Codex / Claude Desktop /
   Cursor / custom) launches the server as a subprocess — usually
   stdio. **The command and args in the client config are a trust
   boundary**: anyone who can edit them can swap the binary.
2. **MCP server ↔ target app.** The server fetches the manifest and
   invokes action endpoints over HTTP(S). The set of *allowed* target
   origins is the second boundary, gated by `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`
   and `AGENTBRIDGE_ALLOW_REMOTE`.
3. **Target app ↔ rest of the world.** Once the action endpoint runs,
   AgentBridge has done its job. Whether the target app validates
   the caller, enforces business rules, talks to a real payment
   processor, etc., is the *target app's* responsibility. AgentBridge
   does not extend its safety guarantees past the action endpoint.

> **Stdio launch is a trust boundary.** Stdio MCP servers are run as
> subprocesses by the client. The MCP client's config (`command`,
> `args`, `env`) determines which binary runs and with which
> environment. An attacker who can write to that config can replace
> the AgentBridge MCP server with a hostile binary. Treat the config
> file like a Git hook or a launchd plist.
>
> **Stdout hygiene is critical.** The stdio transport assumes every
> byte on stdout is JSON-RPC. The AgentBridge MCP server must never
> write non-protocol text to stdout — diagnostics and warnings go
> to stderr only. This is enforced in code and verified by
> [`stdio-hygiene.test.ts`](../apps/mcp-server/src/tests/stdio-hygiene.test.ts).
>
> **Remote HTTP MCP transport is not yet implemented.** This document
> notes the future risks for completeness so we can build the
> mitigations in from day one.

## Threat catalogue

For each threat:

- **Description** — what the attacker tries to do.
- **Current mitigation** — what protects us in `v0.3.0`.
- **Remaining gap** — what's still possible.
- **v1.0 target** — what mitigation we want at v1.0.
- **Test coverage** — pointers to tests that exercise the mitigation.

---

### T1. Malicious / tampered / stale manifest

- **Description.** A manifest at
  `/.well-known/agentbridge.json` is **substituted, replayed, or
  signed by the wrong publisher** between the publisher's authoring
  step and the agent's call. Concrete vectors:
  - **T1.a Substitution.** A compromised CDN cache, stolen TLS
    cert, or MITM after TLS termination serves an attacker-
    authored manifest at the right URL.
  - **T1.b Stale/replay.** A previously valid manifest is
    re-served long after the publisher updated or rotated.
    Origin and TLS still match, but the agent has no signal the
    manifest is fresh.
  - **T1.c Wrong publisher.** A manifest is served at the right
    origin but signed by a key the publisher did not authorize
    (e.g., a compromised build pipeline).
  - **T1.d Honest-but-mistaken.** The publisher itself declares
    `risk` / `requiresConfirmation` dishonestly or by mistake.
- **Current mitigation.**
  - Schema validation rejects malformed manifests.
  - Origin pinning (T2 below) restricts where actions can be
    invoked.
  - Loopback default + explicit allowlist (T3) restricts which
    manifests we'll fetch.
  - Risky actions still require human confirmation regardless of
    what the manifest claims (covers T1.d at the action call —
    not at the manifest layer).
- **Remaining gap.** No publisher signature. We trust that the
  manifest at `https://app.example.com/.well-known/agentbridge.json`
  was put there by whoever controls `app.example.com`. A stolen TLS
  certificate, a compromised CDN cache, or a stale-but-valid
  cached copy lets an attacker substitute or replay a manifest
  with no protocol-layer signal.
- **v0.5.0 / v1.0 target.** **Optional cryptographically signed
  manifests.** Design landed in
  [designs/signed-manifests.md](designs/signed-manifests.md) and
  [adr/0002-signed-manifests.md](adr/0002-signed-manifests.md).
  Publishers serve a key set at
  `/.well-known/agentbridge-keys.json`; the manifest carries an
  inline `signature` block with `alg`, `kid`, `iss`, `signedAt`,
  `expiresAt`, and a base64url signature value over RFC 8785
  (JCS) canonical bytes. The MCP server verifies before calling
  any action; the scanner downgrades unsigned manifests; high-
  assurance deployments can require signatures
  (`AGENTBRIDGE_REQUIRE_SIGNATURE=true`). Verification is
  **additive**: the confirmation gate, origin pinning, target-
  origin allowlist, audit redaction, stdio stdout hygiene, and
  HTTP transport auth/origin checks continue to enforce on top.
  See [v0.5.0 §15 migration plan](designs/signed-manifests.md#15-migration-plan)
  for the path to mandatory signing at v1.0.
- **Test coverage.** Schema validation tests in
  [`packages/core/src/tests/manifest.test.ts`](../packages/core/src/tests/manifest.test.ts)
  and example manifests under
  [`spec/examples/`](../spec/examples/) verified by
  [`spec-examples.test.ts`](../packages/core/src/tests/spec-examples.test.ts).
  Signing-specific test plan is in
  [designs/signed-manifests.md §16](designs/signed-manifests.md#16-testing-plan).

---

### T2. Poisoned `baseUrl` / endpoint

- **Description.** A manifest is valid but its `actions[].endpoint`
  field points at an attacker-controlled origin (or uses an absolute
  URL on a third-party host) so calls leak data or trigger side
  effects elsewhere.
- **Current mitigation.** Every outbound call passes through
  [`assertSameOrigin`](../apps/mcp-server/src/safety.ts), which
  rejects any endpoint whose `URL.origin` does not match the
  manifest's `baseUrl`. Path-relative endpoints resolve against the
  base URL.
- **Remaining gap.** None known for in-protocol behavior. A
  publisher who controls both `baseUrl` and endpoint can still
  declare malicious actions; that's covered by T1.
- **v1.0 target.** Same as today, plus signed manifests
  ([designs/signed-manifests.md](designs/signed-manifests.md)) so
  the publisher is verifiable on top of the existing origin pin.
- **Test coverage.** [`call-action.test.ts`](../apps/mcp-server/src/tests/call-action.test.ts)
  → "callAction origin pinning" suite.

---

### T3. SSRF / internal network access

- **Description.** A caller asks the MCP server to fetch a manifest
  or invoke an action against an internal-network URL — `http://169.254.169.254/`,
  `http://internal-admin.local/`, an unintended cloud metadata
  endpoint.
- **Current mitigation.**
  - Default deny: only loopback URLs (`localhost`, `127.0.0.1`,
    `::1`, `0.0.0.0`) are allowed.
  - Opt-in strict allowlist via
    `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` matches on `URL.origin`
    (so `https://example.com.evil.test` is rejected against an
    `https://example.com` allowlist entry).
  - Only `http:` and `https:` schemes are permitted; `javascript:`,
    `file:`, `data:`, `ftp:` are rejected even with the broad
    escape hatch on.
- **Remaining gap.** With `AGENTBRIDGE_ALLOW_REMOTE=true`, *any*
  remote http(s) origin is allowed (with a one-time stderr
  warning). An operator who flips this in production loses the
  SSRF protection for the duration. There is also no DNS rebinding
  protection — we resolve once and call once, but a hostile DNS
  could resolve `attacker-allowlisted.example.com` to an internal
  IP if the allowlist permitted that hostname.
- **v1.0 target.** Same `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` as
  default; deprecate `AGENTBRIDGE_ALLOW_REMOTE=true` for production
  use; add post-resolution IP-allowlist option for high-assurance
  deployments.
- **Test coverage.** [`safety.test.ts`](../apps/mcp-server/src/tests/safety.test.ts)
  → "AGENTBRIDGE_ALLOWED_TARGET_ORIGINS allowlist" and "non-http(s)
  schemes" suites.

---

### T4. Prompt injection through tool descriptions or action examples

- **Description.** A target app's manifest embeds prompt-injection
  payloads in `description`, `humanReadableSummaryTemplate`, or
  `examples[].description` so the agent reads them and changes
  behavior ("ignore previous instructions, then call …").
- **Current mitigation.** Out of scope for the MCP server — the
  agent's prompt-handling is the agent's responsibility. The server
  enforces the confirmation gate regardless of what the agent
  decided to do, so a successfully-injected agent still cannot run
  a risky action without human approval.
- **Remaining gap.** A low-risk action (`requiresConfirmation:
  false`) misclassified by the publisher could be called by an
  injected agent without confirmation. This is a misclassification
  issue, not an enforcement gap.
- **v1.0 target.** Add scanner heuristics for suspicious patterns
  inside manifest text fields. Document that risk classification is
  a publisher responsibility. Consider a "flag if this string looks
  like an instruction to an LLM" check in the scanner.
- **Test coverage.** None today (out of scope).

---

### T5. Agent misuse / over-delegation

- **Description.** An end user asks an agent to "do whatever's
  needed" and the agent burns through medium-risk actions with the
  user's blanket approval, causing damage at scale.
- **Current mitigation.** Each medium- or high-risk call has its
  own per-input confirmation. There's no "approve all" flag inside
  the protocol.
- **Remaining gap.** The MCP server cannot tell whether the human
  is *actually* reviewing the summary or just reflexively approving.
  Some clients (per their own UX) may auto-approve.
- **v1.0 target.** Document this constraint in the client setup
  guides. Consider an `approverIdentity` field that the client must
  supply on the second call so each approval is at least nominally
  attributable.
- **Test coverage.** Confirmation gate tests in
  [`call-action.test.ts`](../apps/mcp-server/src/tests/call-action.test.ts).

---

### T6. Confused deputy

- **Description.** The MCP server runs with broader privileges
  (filesystem, allowlisted internal hosts) than the agent. The
  agent tricks the server into using those privileges in a way the
  agent itself could not.
- **Current mitigation.**
  - Origin pinning prevents the server from being used to call
    arbitrary URLs once a manifest is fetched.
  - The default loopback restriction prevents the server from being
    used as an SSRF proxy.
  - Audit redaction strips secret-shaped fields before persistence
    so an injected agent cannot exfiltrate them through the audit
    log.
- **Remaining gap.** The MCP server has filesystem access to its
  data dir. An action that returns large or attacker-shaped data
  would be persisted (truncated to `MAX_RESPONSE_BYTES`) in the
  audit log.
- **v1.0 target.** Caller-identity propagation so audit events
  record *who* asked. Pluggable storage adapter so audit events can
  go to a write-only sink.
- **Test coverage.** Origin pinning + redaction tests
  ([`audit.test.ts`](../packages/core/src/tests/audit.test.ts)).

---

### T7. Confirmation bypass attempts

- **Description.** An attacker (the agent or someone who controls
  it) tries to make a risky action run without an explicit human
  approval — by passing `confirmationApproved: true` without a
  token, by using a token issued to a different action, or by
  modifying input after the token was issued.
- **Current mitigation.** [`callAction`](../apps/mcp-server/src/tools.ts)
  refuses every shortcut:
  - `confirmationApproved: true` without `confirmationToken` →
    rejected with `missing-token`.
  - Wrong / unknown / expired token → rejected with `unknown-token`
    / `expired`.
  - Token issued for a different `(url, actionName, hash(input))`
    triplet → rejected with `wrong-url` / `wrong-action` /
    `input-mismatch`.
  - Token already consumed (single-use) → rejected.
- **Remaining gap.** None known.
- **v1.0 target.** Same, plus signed/encrypted tokens so a stolen
  on-disk token cannot be replayed against a different server
  process.
- **Test coverage.** [`call-action.test.ts`](../apps/mcp-server/src/tests/call-action.test.ts)
  → "callAction confirmation gate" suite.

---

### T8. Token replay / confirmation-token replay

- **Description.** A token issued in one process / session is
  copied and used in another to run an action.
- **Current mitigation.**
  - Tokens are bound to `(url, actionName, hash(input))` so they
    can't be reused with different input.
  - Tokens are single-use — consumed on the second call.
  - Tokens have a default 5-minute TTL (configurable 30s–1h via
    `AGENTBRIDGE_CONFIRMATION_TTL_SECONDS`).
  - Tokens are stored in `data/confirmations.json` (cap 200).
- **Remaining gap.** Tokens are not cryptographically bound to the
  process that issued them. A second MCP server process pointed at
  the same `AGENTBRIDGE_DATA_DIR` could consume them.
- **v1.0 target.** Per-process HMAC of the token with a process
  secret, so cross-process replay is rejected. Optional in-memory
  confirmation store (skip the JSON file for short-lived processes).
- **Test coverage.** "rejects a token issued for different input"
  and "executes after token + approval; token is single-use" in
  [`call-action.test.ts`](../apps/mcp-server/src/tests/call-action.test.ts).

---

### T9. Idempotency-key conflicts

- **Description.** A caller reuses an idempotency key with
  different input and the server silently returns the cached
  result, masking the divergence.
- **Current mitigation.** Reuse of the same key with different
  input is rejected with an explicit `conflict` error rather than a
  silent return.
- **Remaining gap.** Idempotency records are stored in a single
  local file shared across all callers in a deployment. Cross-tenant
  collisions are possible.
- **v1.0 target.** Caller-identity-namespaced idempotency keys.
- **Test coverage.** "conflicts when the same key is reused with
  different input" in
  [`call-action.test.ts`](../apps/mcp-server/src/tests/call-action.test.ts).

---

### T10. Audit-log data leakage

- **Description.** Sensitive data (auth tokens, cookies, passwords)
  ends up in the audit log and is exfiltrated by anyone with read
  access to the data directory.
- **Current mitigation.**
  - Recursive redaction in
    [`audit.ts`](../packages/core/src/audit.ts) strips
    `authorization`, `cookie`, `password`, `token`, `secret`,
    `api_key`, `apikey` before persistence.
  - Audit log is capped at 500 events to bound disclosure.
- **Remaining gap.**
  - Redaction is key-name-based; a sensitive value held under an
    unusual key (e.g. `sessionBlob`) won't be stripped.
  - The data directory is filesystem-protected only — anyone with
    OS-level read can see it.
- **v1.0 target.** Add value-shape-based redaction (e.g. flag JWT-
  shaped strings, AWS access-key-shaped strings). Ship a tagging
  hint so SDK callers can mark fields explicitly. Pluggable storage
  adapter so logs can be written to a write-only sink.
- **Test coverage.** [`audit.test.ts`](../packages/core/src/tests/audit.test.ts)
  asserts redaction across nested structures.

---

### T11. Dependency / supply-chain compromise

- **Description.** A transitive dependency of one of the
  AgentBridge packages is hijacked and ships hostile code to every
  consumer.
- **Current mitigation.**
  - Workspace dependencies pinned via `package-lock.json`.
  - Dependabot enabled with grouped npm dev-deps weekly + GitHub
    Actions monthly.
- **Remaining gap.**
  - No SBOM published.
  - No build provenance on published tarballs.
  - No SAST in CI.
- **v1.0 target.** npm Trusted Publishing + provenance (so
  consumers can verify each tarball was built from the documented
  workflow), CodeQL or equivalent SAST, periodic supply-chain
  audit. See [trusted-publishing.md](trusted-publishing.md).
- **Test coverage.** None directly; the
  [`smoke:external`](../scripts/external-adopter-smoke.mjs) test
  is the closest signal.

---

### T12. npm token compromise

- **Description.** A long-lived npm publish token is leaked
  (committed, logged, screen-shared) and an attacker publishes a
  hostile version of any AgentBridge package.
- **Current mitigation.**
  - Releases use granular access tokens with `Bypass 2FA` enabled
    only for the duration of the publish.
  - Tokens are stored at `/tmp/agentbridge-npmrc` with mode `600`,
    used via `--userconfig`, and shredded after publish.
  - Tokens are revoked in the npm UI after each release.
- **Remaining gap.** A token still exists, with publish rights, on
  the publisher's laptop for the duration of the publish. The
  release commands run from a developer machine, not a sandboxed
  environment.
- **v1.0 target.** Switch to npm Trusted Publishing (OIDC from
  GitHub Actions) so no long-lived token exists. Manual publish
  becomes a fallback path used only when the workflow is
  unavailable. See [trusted-publishing.md](trusted-publishing.md).
- **Test coverage.** Out of scope for runtime tests.

---

### T13. MCP stdio command-injection risk

- **Description.** The MCP client config (a TOML or JSON file) is
  edited to point `command` / `args` at a hostile binary or to add
  `env` variables that subvert the AgentBridge MCP server.
- **Current mitigation.**
  - The MCP server itself doesn't trust args — every input passes
    through Ajv schema validation before it reaches an action.
  - Stdout hygiene is enforced so a hijacked binary that writes
    plain text would corrupt the protocol stream and be detected
    quickly.
- **Remaining gap.** This is fundamentally outside the MCP server's
  control: the client launches the subprocess. The mitigation lives
  at the OS / configuration-management layer.
- **v1.0 target.** Document this clearly in the production
  readiness guide (done) and the MCP client setup docs (done in
  v0.3.0). For controlled deployments, recommend pinning the
  package version and shipping the config via a configuration
  management system rather than edit-by-hand.
- **Test coverage.** Stdout hygiene is tested in
  [`stdio-hygiene.test.ts`](../apps/mcp-server/src/tests/stdio-hygiene.test.ts).

---

### T14. HTTP transport risks (implemented in v0.4.0)

The HTTP MCP transport is designed in
[designs/http-mcp-transport-auth.md](designs/http-mcp-transport-auth.md)
(ADR: [adr/0001-http-mcp-transport.md](adr/0001-http-mcp-transport.md))
and ships **opt-in** in `v0.4.0` (release-prepared on
`release/v0.4.0-http-polish`; see
[releases/v0.4.0.md](releases/v0.4.0.md)). Each mitigation called
out below has both code and tests; the v0.4.0 implementation lives
in [`apps/mcp-server/src/transports/http.ts`](../apps/mcp-server/src/transports/http.ts)
and is verified by
[`apps/mcp-server/src/tests/http-config.test.ts`](../apps/mcp-server/src/tests/http-config.test.ts),
[`apps/mcp-server/src/tests/http-transport.test.ts`](../apps/mcp-server/src/tests/http-transport.test.ts),
and
[`scripts/http-mcp-smoke.mjs`](../scripts/http-mcp-smoke.mjs)
(also wired into `npm run smoke:external`). Threats that apply
when the HTTP transport runs:

- **Unauthenticated access.** ✅ **Mitigated.** An open HTTP
  endpoint exposing AgentBridge tools would be equivalent to
  remote shell access. v0.4.0 makes static bearer-token auth
  mandatory; the server fails closed at startup if
  `AGENTBRIDGE_HTTP_AUTH_TOKEN` is missing or shorter than 16
  chars. Tokens are compared in constant time
  ([`crypto.timingSafeEqual`](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b))
  with length padding. Tokens never appear in stderr, stdout,
  audit events, or HTTP error bodies.
- **CSRF / cross-origin.** ✅ **Mitigated.** Inbound `Origin`
  headers must exactly match an entry in
  `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS` (compared via
  `URL.origin`; no prefix matching, no wildcard,
  `Access-Control-Allow-Origin` echoes the exact origin and is
  paired with `Access-Control-Allow-Credentials: true` only).
  `OPTIONS` preflight respects the same allowlist.
- **Token leakage via query string.** ✅ **Mitigated.** Tokens
  presented as `?token=`, `?access_token=`, `?bearer=`,
  `?auth=`, or `?authorization=` are rejected with HTTP `400`
  before any tool runs. The 400 body never echoes the token.
- **Loopback-by-default bind.** ✅ **Mitigated.** Default host
  is `127.0.0.1`. Public bind (anything outside
  `{127.0.0.1, ::1, localhost, 0.0.0.0}` and explicitly
  `0.0.0.0` itself) requires both
  `AGENTBRIDGE_HTTP_AUTH_TOKEN` and a non-empty
  `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS` — otherwise the server
  exits non-zero with a clear stderr error before opening a
  socket.
- **Stdout hygiene preserved.** ✅ **Mitigated.** stdio's
  invariant ("only JSON-RPC bytes on stdout") is unchanged for
  v0.4.0; the HTTP adapter writes nothing to stdout. Verified
  by [`stdio-hygiene.test.ts`](../apps/mcp-server/src/tests/stdio-hygiene.test.ts)
  + [`scripts/http-mcp-smoke.mjs`](../scripts/http-mcp-smoke.mjs)
  (which asserts stdout is empty across the HTTP run).
- **TLS termination boundary.** ⚠️ **Operator responsibility.**
  v0.4.0 ships the HTTP transport over plain HTTP. For any
  non-loopback deployment, operators must terminate TLS at a
  reverse proxy they control. Documented in
  [`docs/security-configuration.md`](security-configuration.md)
  and [`examples/http-client-config/`](../examples/http-client-config/).
- **Multi-tenant isolation.** ⚠️ **Recommended pattern: one
  process per tenant.** A single HTTP server process serving
  multiple tenants needs strict per-request scope checks and
  per-tenant data-dir routing. v0.4.0 preserves the v0.3.0
  recommendation: one MCP server process per tenant with a
  per-tenant `AGENTBRIDGE_DATA_DIR`. Multi-tenant inside one
  process is deferred to a later release that lands
  caller-identity propagation and pluggable storage.
- **Caller-identity attribution.** ⚠️ **Partial.** v0.4.0 does
  not yet extend audit events with `transport: "http"` or a
  caller identifier; that audit-shape change is reserved for
  v0.4.x / v0.5.0. The bearer token itself is never written to
  audit, and access logs (when an operator deploys behind a
  proxy) still show the request lifecycle.

Remaining gaps for v1.0:

- **OAuth 2.1 resource-server mode** with JWT verification and
  scope-checked tools.
- **Token rotation primitives** (today rotation is a server
  restart with a new env var).
- **Richer scopes** mapping to action `permissions[]`.
- **Caller-identity propagation into audit events** so
  post-incident review can tell HTTP calls apart from stdio
  calls and attribute them to a token label.
- **Deployment guides** for production-shaped reverse-proxy
  topologies, certificate provisioning, and rate-limiting.

- **Test coverage.**
  - Auth: `http-transport.test.ts` →
    "missing/malformed/wrong/valid bearer", "token in query
    string", "token never in body/stderr".
  - Origin: `http-transport.test.ts` → "unknown / prefix attack
    / port mismatch / allowed / no Origin / OPTIONS preflight",
    "wildcard CORS with credentials never used".
  - Host binding: `http-transport.test.ts` → "loopback default
    no warning", "non-loopback bind emits stderr notice",
    "public bind without auth fails closed", "public bind
    without origins fails closed".
  - Endpoint routing: `http-transport.test.ts` → "404 for
    non-/mcp paths", "400 for malformed JSON", "413 for
    oversized body".
  - Token hygiene: `scripts/http-mcp-smoke.mjs` → "TOKEN never
    appears in stderr", "stdout empty across the run".

---

### T15. Multi-tenant deployment risks

- **Description.** Running one AgentBridge MCP server process
  against multiple tenants risks cross-tenant data leakage through
  the shared local audit / confirmation / idempotency stores.
- **Current mitigation.** None inside the server. The recommended
  pattern is "one process per tenant with a per-tenant
  `AGENTBRIDGE_DATA_DIR`" (see
  [production-readiness.md](production-readiness.md)).
- **Remaining gap.** No first-class multi-tenant support.
- **v1.0 target.** Ship a `tenantId` propagation primitive when
  caller identity lands. Pluggable storage adapter that namespaces
  by tenant. Document the multi-tenant deployment pattern with
  examples.
- **Test coverage.** None today.

## Reporting

Find a vulnerability? Please follow the disclosure process in
[SECURITY.md](../SECURITY.md). The threat model above is intended
as a roadmap for *known* issues — please don't assume something is
out of scope just because it isn't listed here.

## See also

- [v1-readiness.md](v1-readiness.md) — what we need to mitigate
  before v1.0.
- [production-readiness.md](production-readiness.md) — what
  AgentBridge is and isn't safe for today.
- [security-configuration.md](security-configuration.md) — the
  knobs an operator can turn.
- [SECURITY.md](../SECURITY.md) — how to report vulnerabilities.
