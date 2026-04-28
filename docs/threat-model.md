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

### T1. Malicious manifest

- **Description.** A manifest published by an attacker (or a
  legitimate publisher whose key was stolen) declares actions that
  look benign but do something harmful, or describe permissions /
  risk levels dishonestly.
- **Current mitigation.**
  - Schema validation rejects malformed manifests.
  - Origin pinning (T2 below) restricts where actions can be
    invoked.
  - Loopback default + explicit allowlist (T3) restricts which
    manifests we'll fetch.
  - Risky actions still require human confirmation regardless of
    what the manifest claims.
- **Remaining gap.** No publisher signature. We trust that the
  manifest at `https://app.example.com/.well-known/agentbridge.json`
  was put there by whoever controls `app.example.com`. A stolen TLS
  certificate or a compromised CDN cache lets an attacker substitute
  a manifest.
- **v1.0 target.** Signed manifests with offline-verifiable
  publisher keys (Phase 5 / `v0.5.0`). The agent fetches
  `.well-known/agentbridge-keys.json` once, pins the publisher, and
  verifies the manifest signature before trusting any action.
- **Test coverage.** Schema validation tests in
  [`packages/core/src/tests/manifest.test.ts`](../packages/core/src/tests/manifest.test.ts)
  and example manifests under
  [`spec/examples/`](../spec/examples/) verified by
  [`spec-examples.test.ts`](../packages/core/src/tests/spec-examples.test.ts).

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
- **v1.0 target.** Same as today, plus signed manifests so the
  publisher is verifiable.
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

### T14. Future HTTP transport risks

The HTTP MCP transport is designed in
[designs/http-mcp-transport-auth.md](designs/http-mcp-transport-auth.md)
(ADR: [adr/0001-http-mcp-transport.md](adr/0001-http-mcp-transport.md))
and will ship in `v0.4.0`. The mitigations called out below are the
ones the design commits to up front; the implementation PRs will
ship the tests that prove each one. Additional threats that apply
when the HTTP transport ships:

- **Unauthenticated access.** An open HTTP endpoint exposing
  AgentBridge tools is equivalent to remote shell access for any
  agent. Requires bearer-token auth from day one. The design
  ([§6](designs/http-mcp-transport-auth.md#6-auth-model)) makes
  auth mandatory and fails public bind without auth at startup.
- **CSRF / cross-origin.** HTTP endpoints must reject requests from
  unintended origins. The design
  ([§7](designs/http-mcp-transport-auth.md#7-origin-and-cors-model))
  requires exact-origin match against
  `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS`, no wildcard, no prefix match.
- **TLS termination boundary.** A reverse proxy that terminates TLS
  becomes a credential boundary. The design defaults to loopback
  bind and requires operators to opt into public bind explicitly
  ([§8](designs/http-mcp-transport-auth.md#8-host-binding-model)).
- **Multi-tenant isolation.** A single HTTP server process serving
  multiple tenants needs strict per-request scope checks and
  per-tenant data-dir routing. The design preserves the v0.3.0
  recommendation of one process per tenant; multi-tenant inside one
  process is deferred to a later release.
- **Token leakage via query string.** Tokens in URLs end up in
  proxy logs, browser histories, and server access logs. The design
  rejects query-string tokens with a `400` before any tool runs.
- **Caller-identity attribution.** Audit events for HTTP calls
  must record `transport: "http"` and a non-secret caller
  identifier so post-incident review can tell HTTP from stdio
  ([§11](designs/http-mcp-transport-auth.md#11-audit-model)). The
  bearer token itself is never written to audit.

We documented these in v0.3.0 so the HTTP transport ships with
mitigations rather than retrofitting them; v0.4.0's design now
turns each into a concrete commitment.

- **v1.0 target (when HTTP ships).** Mandatory bearer-token auth,
  scope-checked tools, per-tenant audit/confirmation/idempotency
  segregation, signed-manifest verification.
- **Test coverage.** Implementation PRs will deliver the tests
  enumerated in
  [designs/http-mcp-transport-auth.md §12](designs/http-mcp-transport-auth.md#12-testing-plan).

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
