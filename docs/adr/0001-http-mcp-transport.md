# ADR 0001 — Add an opt-in HTTP MCP transport

- **Status.** Proposed (v0.4.0 design phase).
- **Date.** 2026-04-28.
- **Deciders.** AgentBridge maintainers; tracked in
  [issue #22](https://github.com/marmar9615-cloud/agentbridge-protocol/issues/22)
  and [`docs/issues/v0.4.0-http-transport-auth.md`](../issues/v0.4.0-http-transport-auth.md).
- **Companion design doc.** [`docs/designs/http-mcp-transport-auth.md`](../designs/http-mcp-transport-auth.md).

## Context

AgentBridge currently exposes its MCP server only over stdio
([`apps/mcp-server/src/index.ts`](../../apps/mcp-server/src/index.ts)).
stdio is the right default for local desktop MCP clients (Codex,
Claude Desktop, Cursor, custom): no listening socket, no TLS, no
auth dance, credentials sourced from env vars handed to the
subprocess.

The MCP specification, however, defines two transports — **stdio**
and **Streamable HTTP** — and hosted/centralized agent platforms
cannot launch a local subprocess. Without an HTTP transport, those
platforms can only reach AgentBridge through ad-hoc bridges, which
defeats the safety guarantees we're building.

Three constraints frame the decision:

1. **Stdio must keep working unchanged.** Existing local installs
   are the active user base.
2. **HTTP must be safe by default.** The threat surface of an HTTP
   transport is materially larger than stdio (network reachability,
   browser CORS, credential exposure, multi-tenant collisions). v0.3.0
   established the safety story (loopback default, exact-origin
   allowlist, stdout hygiene, threat model); HTTP transport must
   inherit that posture, not weaken it.
3. **No production-readiness regression.** Shipping HTTP transport
   does not by itself satisfy the v1.0 criteria in
   [`docs/v1-readiness.md`](../v1-readiness.md), but it must not
   set those criteria back either.

## Decision

AgentBridge will add an **opt-in Streamable HTTP MCP transport** in
the v0.4.0 release line, alongside the existing stdio transport,
with the following non-negotiable properties:

1. **stdio remains the default.** No flag or env var change is
   required for existing users. `AGENTBRIDGE_TRANSPORT=stdio` is
   the implicit default; the same `npx -y
   @marmarlabs/agentbridge-mcp-server` invocation continues to
   work.
2. **HTTP mode is opt-in.** Operators turn it on explicitly with
   `--transport http` or `AGENTBRIDGE_TRANSPORT=http`.
3. **HTTP requires authentication.** Phase 1 is a static bearer
   token sourced from `AGENTBRIDGE_HTTP_AUTH_TOKEN`, presented in
   the `Authorization: Bearer <token>` header. Tokens in URL query
   strings are rejected with `400`.
4. **HTTP validates the `Origin` header.** When `Origin` is
   present, exact-origin match against
   `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS` (no prefix matching, no
   wildcard). Unknown origins respond `403`.
5. **HTTP binds to `127.0.0.1` by default.** Public bind requires
   both auth and an Origin allowlist; the server fails hard at
   startup if either is missing.
6. **Tool dispatch is shared.** Both transports use the exact same
   tool implementations, confirmation gate, origin pinning,
   target-origin allowlist, idempotency, and audit redaction. No
   parallel safety paths.
7. **Audit events distinguish transports.** Events gain a
   `transport` field and an optional `caller` block. Bearer token
   values never appear in audit, ever.
8. **OAuth 2.1 is designed-for, not implemented.** v0.4.0 ships
   the static-bearer mode; the design leaves room for a JWT/OAuth
   resource-server mode in a later release without breaking the
   v0.4 surface.

## Consequences

### Positive

- Hosted and centralized agent platforms can integrate without an
  ad-hoc bridge.
- The safety story we established in v0.3.0 (loopback default,
  exact-origin allowlist, stdout hygiene, threat model) extends
  cleanly to HTTP — we add new checks in front of the existing
  dispatcher, not new branches inside it.
- The `createMcpServer()` factory clarifies the shape of the
  server and unblocks future consumers (custom transports,
  embedded usage).
- v1.0 criterion #8 (HTTP MCP transport) becomes satisfiable.
- Threat model T14 ("Future HTTP transport risks") gains concrete
  mitigations.

### Neutral

- New env vars (`AGENTBRIDGE_HTTP_*`). They are additive and live
  on a documented namespace separate from
  `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` so the inbound/outbound
  distinction is unambiguous.
- The audit event shape grows by two optional fields. Backwards-
  compatible for readers; documented in `core`'s schemas when the
  implementation lands.

### Negative

- Increased surface area for the MCP server: a listening socket,
  an HTTP request handler, CORS, session lifecycle. Each is a
  potential vulnerability.
- More configuration knobs operators must understand. We mitigate
  with conservative defaults (loopback, auth required) and a
  table in [`docs/security-configuration.md`](../security-configuration.md)
  when the implementation lands.
- Bearer-token rotation operationally falls on the operator. We
  document `openssl rand -hex 32` and a "rotate by restart"
  recipe; first-class rotation is a v0.4.x follow-up.
- A class of mistakes (forgetting to set
  `AGENTBRIDGE_HTTP_AUTH_TOKEN` while binding publicly) gets
  caught at startup, not at request time. The fail-hard behavior
  is explicit.

## Alternatives considered

### A. stdio only

Defer HTTP indefinitely; tell operators to run a separate proxy
or fork a custom transport.

- **Rejected** because it pushes integration cost onto every
  hosted-MCP user and forces ad-hoc bridges that won't share our
  safety code path.

### B. HTTP without authentication

Ship HTTP with no auth, document loud warnings, rely on
network-layer controls (firewalls, VPNs).

- **Rejected** because it inverts the v0.3.0 safety posture. An
  unauthenticated HTTP MCP endpoint is equivalent to remote shell
  access for any agent that can reach it. Network controls are a
  defense in depth, not a substitute for app-level auth.

### C. Full OAuth 2.1 in v0.4.0

Stand up an OAuth 2.1 authorization server (or require an
external one), implement JWT verification, audience validation,
scope enforcement, dynamic client registration up front.

- **Rejected for v0.4.0** because OAuth is its own multi-PR
  project and would significantly delay the basic HTTP path. The
  static-bearer design captures the actual security property
  ("caller proved possession of a secret") with far less
  operational surface area. The verifier abstraction in the
  design preserves the OAuth path for a later release.

### D. Separate HTTP code path

Implement HTTP as a standalone server with its own
tool-dispatch logic and parallel safety code, leaving stdio
untouched.

- **Rejected** because two safety code paths is two places to
  miss a fix. The whole point of the `createMcpServer()`
  factoring is one dispatcher, one set of safety checks, two
  thin transport adapters.

### E. Hosted AgentBridge service

Run AgentBridge as a hosted multi-tenant service so HTTP
transport is "just an internal detail."

- **Rejected** because it conflicts with v1.0 non-goal #1 in
  [`docs/v1-readiness.md`](../v1-readiness.md): AgentBridge
  stays a self-hosted set of packages. A hosted offering, if
  ever, is a separate project.

## Links

- Tracking issue: [#22](https://github.com/marmar9615-cloud/agentbridge-protocol/issues/22)
  / [`docs/issues/v0.4.0-http-transport-auth.md`](../issues/v0.4.0-http-transport-auth.md).
- Design doc: [`docs/designs/http-mcp-transport-auth.md`](../designs/http-mcp-transport-auth.md).
- Roadmap: [`docs/roadmap.md`](../roadmap.md) (v0.4.0 line).
- v1 readiness: [`docs/v1-readiness.md`](../v1-readiness.md)
  criterion #8.
- Threat model: [`docs/threat-model.md`](../threat-model.md) T14
  (Future HTTP transport risks).
- Production readiness: [`docs/production-readiness.md`](../production-readiness.md)
  — the "MCP HTTP mode (planned)" section.
- Security configuration: [`docs/security-configuration.md`](../security-configuration.md)
  — the `AGENTBRIDGE_HTTP_*` table arrives with the
  implementation PR.
