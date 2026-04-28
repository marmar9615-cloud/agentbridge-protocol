# HTTP MCP Transport + Auth Design

> **Status.** Proposed (v0.4.0 design phase). No runtime change in
> this document or the PR that lands it. The implementation will
> follow in subsequent PRs against the same `v0.4.0` line.
>
> **Tracking issue.** [`docs/issues/v0.4.0-http-transport-auth.md`](../issues/v0.4.0-http-transport-auth.md)
> (mirrors GitHub issue
> [#22](https://github.com/marmar9615-cloud/agentbridge-protocol/issues/22)).
>
> **ADR.** [`docs/adr/0001-http-mcp-transport.md`](../adr/0001-http-mcp-transport.md).

## 1. Summary

AgentBridge currently ships a stdio MCP server
([`apps/mcp-server/src/index.ts`](../../apps/mcp-server/src/index.ts))
exposing five tools, four resources, and four prompts to AI agents
through a `StdioServerTransport`. v0.4.0 will add an **opt-in
Streamable HTTP transport** for hosted and remote MCP clients while
keeping stdio as the default path for local desktop clients.

The HTTP transport will share **all** business logic with stdio —
the tool dispatcher, every safety check, confirmation tokens,
idempotency, and audit redaction. Only the wire transport changes.
Auth, Origin validation, and host binding are the new code paths,
and they sit *in front of* the shared dispatcher rather than
inside it.

## 2. Goals

- Add an opt-in Streamable HTTP MCP transport.
- Preserve stdio behavior bit-for-bit. No regression in the stdio
  path is acceptable.
- Reuse existing tools, resources, prompts.
- Reuse existing confirmation gate
  ([`callAction`](../../apps/mcp-server/src/tools.ts) +
  [`confirmations.ts`](../../apps/mcp-server/src/confirmations.ts)).
- Reuse existing origin pinning
  ([`assertSameOrigin`](../../apps/mcp-server/src/safety.ts)).
- Reuse existing target-origin allowlist
  ([`assertAllowedUrl`](../../apps/mcp-server/src/safety.ts) +
  `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`).
- Reuse existing audit redaction
  ([`redact`](../../packages/core/src/audit.ts)).
- Add HTTP authentication (bearer token).
- Add HTTP `Origin` header validation.
- Add transport + caller metadata to audit events so we can tell
  HTTP calls apart from stdio calls and attribute them.
- Keep local development simple — defaults that "just work" on a
  developer laptop.
- Keep production defaults conservative — fail closed when an
  operator forgets to set auth or to pin origins.

## 3. Non-goals

- **No full OAuth 2.1 authorization server in v0.4.0.** Phase 1 is
  a static bearer token sourced from `AGENTBRIDGE_HTTP_AUTH_TOKEN`.
  The design accommodates a later OAuth resource-server mode.
- **No removal of stdio.** stdio remains the default. Existing
  MCP clients keep working unchanged.
- **No production-hosting claim.** Shipping HTTP transport does not
  graduate AgentBridge to v1.0; v1 readiness is the
  [v1-readiness](../v1-readiness.md) checklist.
- **No real destructive demo actions.** The demo continues to
  simulate refunds and other risky operations.
- **No support for unauthenticated remote HTTP.** A loopback-only
  developer mode without auth is allowed *only* when the bind
  address is loopback and auth is explicitly disabled with a
  warning. Public bind without auth fails hard at startup.
- **No support for query-string tokens.** Tokens go in the
  `Authorization` header.
- **No hosted AgentBridge service.** AgentBridge stays a self-hosted
  set of packages.

## 4. Proposed transport modes

### stdio mode (default, unchanged)

```bash
npx -y @marmarlabs/agentbridge-mcp-server
```

- Spawned by the MCP client as a subprocess.
- JSON-RPC over stdin/stdout.
- All diagnostics on stderr.
- No listening socket. No auth. Credentials come from environment
  variables (e.g. `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`).
- Same `Server` instance, same handlers as today.

### http mode (opt-in)

```bash
# Minimal local-dev form
AGENTBRIDGE_HTTP_AUTH_TOKEN=$(openssl rand -hex 32) \
  npx -y @marmarlabs/agentbridge-mcp-server --transport http

# Equivalent env-var-only form
AGENTBRIDGE_TRANSPORT=http \
  AGENTBRIDGE_HTTP_AUTH_TOKEN=$(openssl rand -hex 32) \
  npx -y @marmarlabs/agentbridge-mcp-server
```

- Default endpoint path: `/mcp` (configurable; see open question
  [§14.1](#141-exact-endpoint-path)).
- Methods:
  - `POST /mcp` — every JSON-RPC client → server message.
  - `GET /mcp` — only if `AGENTBRIDGE_HTTP_ENABLE_SSE=true`. Used
    for Streamable HTTP / SSE session resumption.
  - `DELETE /mcp` — session termination, per the Streamable HTTP
    spec.
- Default bind host: `127.0.0.1`.
- Default port: `3333` (chosen because Next.js dev defaults to
  `3000`/`3001` in this repo and Studio already owns those).
- Public bind (`0.0.0.0` or a public interface) requires explicit
  opt-in via `AGENTBRIDGE_HTTP_HOST` *and* a valid bearer token.

### Why Streamable HTTP, not custom JSON-RPC over HTTP

The MCP specification defines two transports — **stdio** and
**Streamable HTTP**. The TypeScript MCP SDK we already depend on
(`@modelcontextprotocol/sdk` v1.29.x in this repo) ships a
`StreamableHTTPServerTransport` that implements the spec:
session IDs, optional SSE responses, message resumability via an
event store. Wrapping that transport gets us spec-compliance for
free; rolling our own JSON-RPC HTTP handler would diverge from the
spec immediately.

## 5. Proposed env vars and flags

> Names below are **proposed**. They may be adjusted during
> implementation, but the security defaults — fail-closed, loopback
> default, mandatory auth for non-loopback — must not weaken.

### Transport selection

| Env var / flag | Default | Notes |
|---|---|---|
| `AGENTBRIDGE_TRANSPORT` | `stdio` | One of `stdio` / `http`. |
| `--transport stdio\|http` | matches env | CLI flag; overrides env. |

### HTTP server config

| Env var / flag | Default | Notes |
|---|---|---|
| `AGENTBRIDGE_HTTP_HOST` | `127.0.0.1` | Bind interface. Anything other than loopback is "public bind" and triggers extra checks (see §8). |
| `--host <addr>` | matches env | Override env var. |
| `AGENTBRIDGE_HTTP_PORT` | `3333` | TCP port. Range `1024`–`65535`. |
| `--port <n>` | matches env | Override env var. |
| `AGENTBRIDGE_HTTP_PATH` | `/mcp` | Endpoint path the MCP transport mounts at. |

### HTTP auth

| Env var / flag | Default | Notes |
|---|---|---|
| `AGENTBRIDGE_HTTP_AUTH_TOKEN` | unset | Static bearer token. Required when transport is `http` and `AGENTBRIDGE_HTTP_REQUIRE_AUTH` is not `false`. Token must be ≥ 32 chars (advisory; document `openssl rand -hex 32`). |
| `AGENTBRIDGE_HTTP_REQUIRE_AUTH` | `true` | Set to `false` only for loopback dev mode. Setting it to `false` while bound to a non-loopback host **fails hard at startup**. When false, emits a one-time stderr warning. |
| `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS` | unset | Comma-separated list of allowed inbound `Origin` headers. Required when `--host` is non-loopback. Exact-origin match (scheme + host + port). |
| `AGENTBRIDGE_HTTP_PUBLIC_URL` | derived from host/port | Canonical MCP server URL exposed in audit metadata and a future OAuth protected-resource document. |
| `AGENTBRIDGE_HTTP_ENABLE_SSE` | `false` | Allow `GET /mcp` for SSE session resumption. Default off until the implementation needs it. |

### Important distinctions

- **Inbound vs outbound origins.** `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS`
  controls **inbound** browser/agent origins that may call the MCP
  server's HTTP endpoint. `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`
  (existing, v0.3.0) controls **outbound** target-app origins the
  MCP server is willing to fetch manifests from and call actions
  against. These are independent concerns and use independent env
  vars on purpose. **Do not confuse them.**
- **Existing v0.3.0 env vars unchanged.** `AGENTBRIDGE_ACTION_TIMEOUT_MS`,
  `AGENTBRIDGE_MAX_RESPONSE_BYTES`, `AGENTBRIDGE_CONFIRMATION_TTL_SECONDS`,
  `AGENTBRIDGE_DATA_DIR`, `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`,
  `AGENTBRIDGE_ALLOW_REMOTE` apply to both transports identically.

## 6. Auth model

### Phase 1 — static bearer (v0.4.0)

- Operator generates a token (e.g. `openssl rand -hex 32`) and sets
  `AGENTBRIDGE_HTTP_AUTH_TOKEN`.
- Every HTTP request must carry:

  ```http
  Authorization: Bearer <token>
  ```
- **Missing `Authorization`** → respond `401 Unauthorized` with a
  `WWW-Authenticate: Bearer` header.
- **Header present but token does not match** → respond `401`. Do
  not leak whether the token was almost right.
- **Token presented in the URL query string** (e.g. `?token=…`,
  `?access_token=…`) → respond `400 Bad Request` with an explicit
  message. Reject before invoking any tool.
- **Insufficient scope** (when scopes ship in a later release) →
  respond `403 Forbidden`. Phase 1 has no scopes; reserve `403`
  for the Origin check.
- **Constant-time comparison** (`crypto.timingSafeEqual` after
  byte-padding) for the bearer-token equality check.
- **The token value is never logged.** Not on stderr, not in audit
  events, not in HTTP error responses. The audit log records
  `caller.type = "http-bearer"` and a non-secret `caller.id`
  (e.g. a SHA-256 hash of the token, or a label assigned to the
  token; the design defers the exact identifier shape to the
  implementation PR — see [§14.5](#145-caller-identity-shape)).

### Phase 2 — OAuth 2.1 resource-server (later release)

The design must not foreclose this. Concretely:

- Token-validation pluggable: a `TokenVerifier` interface with a
  static-bearer implementation in v0.4.0 and a JWT/OAuth
  implementation later.
- Reserve `403` for scope failures; the verifier returns scopes,
  the dispatcher checks them.
- Reserve a future `/.well-known/oauth-protected-resource`
  metadata endpoint for OAuth resource-server discovery.
- Token audience validation will live in the JWT verifier.
- Dynamic client registration, if ever needed, lives outside the
  AgentBridge MCP server (it is a property of the OAuth issuer,
  not the resource server).

### Why not OAuth in v0.4.0

A full OAuth 2.1 server is its own project — issuer setup,
discovery, dynamic registration, refresh tokens, key rotation. A
static bearer token captures the actual security property we need
("the caller proved possession of a secret you handed them") without
the operational surface area. Phase 2 lifts the verifier to JWT
once the rest of the v1 work has caught up.

## 7. Origin and CORS model

### Validation rules

- On every HTTP request:
  1. If the request supplies `Origin`:
     - Parse with `URL.origin`.
     - If the parsed origin is in `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS`,
       allow.
     - Else respond `403 Forbidden`.
     - **No prefix matching, no wildcard, no `*`.** Exact-origin
       match by `URL.origin` only (mirroring the v0.3.0 fix to
       `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`).
  2. If the request does not supply `Origin` (typical for non-
     browser clients), allow if and only if auth succeeds. Bearer
     token alone is sufficient for CLI-style and server-side
     clients that do not set `Origin`.

### CORS responses

- For an allowed `Origin`, respond with:

  ```http
  Access-Control-Allow-Origin: <the request Origin>
  Access-Control-Allow-Credentials: true
  Access-Control-Allow-Methods: POST, GET, DELETE, OPTIONS
  Access-Control-Allow-Headers: authorization, content-type, mcp-session-id
  Access-Control-Max-Age: 600
  Vary: Origin
  ```
- For a missing `Origin`, do not set `Access-Control-Allow-Origin`.
- **Never use `*`** when credentials/auth are involved. Per the
  CORS spec this is invalid with `Access-Control-Allow-Credentials:
  true`, and we never want to hand a wildcard to a browser anyway.
- `OPTIONS` preflight is handled before auth, but only mirrors the
  Origin check — preflights without an allowed Origin still
  respond `403`.

### Browser vs non-browser clients

- A browser-resident MCP client (rare today, common later) will
  send `Origin` automatically; the allowlist is the gate.
- A CLI MCP client or a server-side agent typically does not send
  `Origin`; bearer auth is the gate.
- Local-dev docs explain how to add `https://localhost:5173` (or
  similar) to `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS` for local
  browser-based testing.

## 8. Host binding model

| Bind | Auth required | Origin allowlist required | Behavior |
|---|---|---|---|
| `127.0.0.1` (loopback) | recommended | optional | Default. Local dev. |
| `127.0.0.1` (loopback) with `AGENTBRIDGE_HTTP_REQUIRE_AUTH=false` | no | optional | Allowed *only* on loopback. Emits a one-time stderr warning at startup. |
| `0.0.0.0` (all interfaces) | **required** | **required** | Without both, fail hard at startup. |
| Specific public IP / hostname | **required** | **required** | Same as above. |

- Public bind without auth → **fail hard** before opening the
  socket. Print a clear stderr message instructing the operator to
  set `AGENTBRIDGE_HTTP_AUTH_TOKEN` or move to loopback.
- Public bind with auth but without `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS`
  → **fail hard** for the same reason. (Browser clients without an
  allowlist would be silently broken; non-browser clients would
  fail at first request anyway. Better to fail at startup with a
  clear error.)
- "Public bind" is detected by parsing the host string and treating
  anything outside `{127.0.0.1, ::1, localhost, 0.0.0.0}` as
  potentially public. `0.0.0.0` is conservatively treated as
  public because it accepts connections on every interface.
- Loopback bind is the only mode in which `AGENTBRIDGE_HTTP_REQUIRE_AUTH=false`
  is permitted. Setting it to `false` outside loopback fails at
  startup.

## 9. Tool dispatch architecture

The current stdio entry point in
[`apps/mcp-server/src/index.ts`](../../apps/mcp-server/src/index.ts)
inlines everything: the `Server` construction, the `TOOLS` array,
`dispatchTool`, the prompts, the resources, and the
`StdioServerTransport`. To support two transports without forking
business logic, extract the configuration into a factory:

```ts
// apps/mcp-server/src/server.ts (proposed)
export interface CreateMcpServerOptions {
  // Optional caller-identity hook; stdio passes undefined,
  // HTTP passes a function that resolves caller info from the
  // current request's auth result.
  getCallerInfo?: () => CallerInfo | undefined;
}
export function createMcpServer(opts: CreateMcpServerOptions = {}): Server;
```

The stdio entry becomes:

```ts
const server = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
```

The HTTP entry becomes (sketch — implementation in a follow-up
PR):

```ts
const server = createMcpServer({ getCallerInfo: currentRequestCaller });
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
await server.connect(transport);

// httpServer.on('request', authThenOriginThenHand) calls into
// transport.handleRequest(req, res, body).
```

Goals enforced by this factoring:

- Both transports use the **exact same** `Server` instance shape:
  same `TOOLS`, same `STATIC_RESOURCES`, same `PROMPTS`, same
  `dispatchTool` switch.
- Both transports use the **exact same** `callAction` path,
  meaning the same:
  - confirmation gate
  - origin pinning
  - target-origin allowlist (`AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`)
  - audit write + redaction
  - idempotency
  - timeout / size caps
- The HTTP entry adds — but never replaces — the auth and
  Origin checks. They sit in the request handler **before**
  `transport.handleRequest`, not inside the dispatcher.
- No new conditional branch inside `tools.ts`. The dispatcher
  remains transport-agnostic.

## 10. JSON-RPC / MCP handling

### stdio

- Newline-delimited JSON-RPC over stdin/stdout — current behavior.
- **Stdout carries protocol bytes only.** All diagnostics go to
  stderr. Verified by
  [`stdio-hygiene.test.ts`](../../apps/mcp-server/src/tests/stdio-hygiene.test.ts).
- HTTP-mode startup must not write to stdout either, but stdio is
  the canonical case.

### HTTP

- Accepts JSON-RPC request bodies on `POST /mcp`.
- Response shapes are whatever `StreamableHTTPServerTransport`
  produces — either a JSON body (single response) or an SSE stream
  (when the SDK chooses to stream).
- Server writes structured logs to stderr or to whatever logger
  the operator wires; **never** to the response body and never
  inline with the JSON-RPC stream.
- HTTP error mapping:
  | Condition | HTTP status |
  |---|---|
  | Malformed JSON body | `400 Bad Request` |
  | Token in query string | `400 Bad Request` (with explicit message) |
  | Missing / invalid bearer token | `401 Unauthorized` |
  | Forbidden Origin | `403 Forbidden` |
  | Future: insufficient scope | `403 Forbidden` |
  | MCP method-level error | JSON-RPC error inside a `200 OK` response (per the spec) |
  | Internal exception | `500 Internal Server Error` |

### Stdout-hygiene parity for HTTP

The stdio invariant ("stdout carries protocol bytes only") does
not apply to HTTP because HTTP doesn't multiplex over stdio. But
we need the parallel guarantee that **HTTP error responses never
contain the bearer token**, never echo `Authorization` headers
back, and never leak audit secrets. The test plan ([§12](#12-testing-plan))
covers this with subprocess-style HTTP tests.

## 11. Audit model

Audit events today
([`packages/core/src/audit.ts`](../../packages/core/src/audit.ts))
have a `source` field with the literal union `"demo" | "studio"
| "mcp"`. The HTTP transport needs to be distinguishable from the
stdio transport without losing the existing `source` value.

Proposed extension (to land in the implementation PR, not this
docs PR):

- Add `transport: "stdio" | "http"` alongside `source`. Stdio
  emissions get `transport: "stdio"`; HTTP emissions get
  `transport: "http"`.
- Add an optional `caller` block:

  ```ts
  caller?: {
    type: "stdio" | "http-bearer";  // discriminator
    id?: string;                     // non-secret label or hash
  }
  ```
- Add an optional `requestId: string` (UUID), populated for HTTP
  events to correlate audit entries with HTTP access logs.
- IP and User-Agent **may** be recorded on HTTP events but only
  behind an explicit `AGENTBRIDGE_HTTP_AUDIT_REQUEST_METADATA=true`
  toggle, since they are PII and should be opt-in. Default off.

Hard rules that **must not change**:

- Bearer token values never appear in audit events, ever.
- The full `Authorization` header is never written to disk.
- Existing `redact()` keys (`authorization`, `cookie`, `password`,
  `token`, `secret`, `api_key`, `apikey`) continue to apply
  recursively.

## 12. Testing plan

Every requirement above gets a test. Categories below map directly
to the implementation PRs that will follow this design.

### Stdio parity (must pass before HTTP code lands)

- All existing tests in
  [`apps/mcp-server/src/tests/`](../../apps/mcp-server/src/tests/)
  remain green.
- `stdio-hygiene.test.ts` continues to pass — no regressions in
  stdio's stdout discipline.

### HTTP — auth

| Test | Assertion |
|---|---|
| `http rejects request with no Authorization header` | 401 |
| `http rejects request with malformed Authorization header` | 401 |
| `http rejects request with wrong bearer token` | 401, constant-time compare |
| `http rejects token in query string` | 400 with explicit message |
| `http accepts request with valid bearer in Authorization header` | 200 + JSON-RPC response |
| `http does not echo Authorization header in error body` | regex-asserts absence |
| `http does not log bearer token to stderr` | spawn subprocess, assert |

### HTTP — Origin

| Test | Assertion |
|---|---|
| `http rejects unknown Origin` | 403 |
| `http accepts allowed Origin` | 200 + correct CORS headers |
| `http accepts request with no Origin if auth is valid` | 200 |
| `http does not allow prefix attacks` (`https://example.com.evil.test` against `https://example.com`) | 403 |
| `http does not allow port mismatch` (`https://example.com` against `https://example.com:8443`) | 403 |
| `http never sets wildcard Access-Control-Allow-Origin with credentials` | regex-asserts absence |

### HTTP — bind / startup

| Test | Assertion |
|---|---|
| `http startup fails on public bind without auth` | non-zero exit, clear stderr message |
| `http startup fails on public bind without Origin allowlist` | non-zero exit |
| `http startup warns when REQUIRE_AUTH=false on loopback` | one-time stderr line |
| `http startup fails when REQUIRE_AUTH=false on non-loopback` | non-zero exit |

### Cross-transport behavior parity

| Test | Assertion |
|---|---|
| `confirmation gate fires identically over HTTP` | first call → `confirmationRequired` + token; second call requires `confirmationApproved: true` and matching token |
| `confirmation token is single-use over HTTP` | second consume rejected |
| `confirmation token is input-bound over HTTP` | re-issued for different input |
| `idempotency replay works over HTTP` | same key + same input → cached result |
| `idempotency conflict surfaced over HTTP` | same key + different input → conflict |
| `target-origin allowlist applies over HTTP` | outbound call to non-allowlisted host rejected |
| `audit redaction applies over HTTP` | secret-shaped fields stripped |
| `audit event includes transport: "http"` | recorded |
| `audit event records caller.type "http-bearer"` | recorded |
| `audit event never contains the bearer token` | regex-asserts absence |

### Backwards-compatibility

| Test | Assertion |
|---|---|
| `stdio default unchanged when no flags set` | `--transport stdio` is the implicit default |
| `existing stdio MCP clients still receive the same TOOLS list` | golden output |

## 13. Migration plan

Releases land in this order:

1. **v0.4.0 design PR (this).** Docs only. No runtime change.
2. **v0.4.0 implementation PR 1 — transport abstraction.** Extract
   `createMcpServer()` factory; refactor stdio entry to call it.
   Zero behavior change. Adds the factory's tests if any.
3. **v0.4.0 implementation PR 2 — HTTP transport + bearer auth.**
   Adds the HTTP entry path, env vars, host/auth/origin checks,
   and the Streamable HTTP wiring. All HTTP tests above land
   here. stdio path untouched.
4. **v0.4.0 implementation PR 3 — docs / examples / smoke
   tests.** Updates `docs/security-configuration.md` (add the
   `AGENTBRIDGE_HTTP_*` table), `docs/mcp-client-setup.md` (HTTP
   client recipes), `docs/codex-setup.md` if relevant, an
   `examples/http-client-config/` directory, and an external
   smoke test that exercises HTTP end-to-end.
5. **v0.4.0 release.** All six packages bump in lockstep to
   `0.4.0`, published via the existing Trusted Publishing
   workflow with provenance.
6. **v0.5.0 — signed manifests.**
7. **v0.6.0 — policy / scopes / rate limits.** Naturally consumes
   the `caller` block introduced here; scopes promote `403` from
   "reserved for Origin" to also gating individual tool calls.

## 14. Open questions

These are questions the implementation PRs will answer. They are
not blockers for shipping the design.

### 14.1 Exact endpoint path

Default `/mcp` is the convention used by every MCP HTTP example
shipping today. But making it configurable lets operators reverse-
proxy at `/api/mcp/agentbridge` or wherever fits their topology.
**Tentative answer:** ship configurable via `AGENTBRIDGE_HTTP_PATH`
defaulting to `/mcp`. Document the trade-off.

### 14.2 SSE on day one or deferred

Streamable HTTP supports both single-response and SSE-streamed
responses. The SDK can decide per request whether to stream. SSE
adds connection-lifecycle complexity (event store, resumption
tokens). **Tentative answer:** ship with `AGENTBRIDGE_HTTP_ENABLE_SSE=false`
default in v0.4.0; turn on after the SDK transport is exercised in
production-like scenarios. Document how to flip it.

### 14.3 Use the SDK transport vs. roll our own

The SDK's `StreamableHTTPServerTransport` already implements the
spec. Rolling our own would duplicate work and risk diverging from
spec updates. **Tentative answer:** wrap the SDK transport.
Auth, Origin, and binding live in the request handler we mount in
front of `transport.handleRequest()`.

### 14.4 OAuth metadata before full OAuth

Should v0.4.0 expose a partial `/.well-known/oauth-protected-resource`
document to declare the audience and supported algorithms even
before JWT verification ships? **Tentative answer:** no — defer
to whenever OAuth verification actually lands. Shipping a metadata
document that describes capabilities we don't yet implement is
worse than not shipping it.

### 14.5 Caller-identity shape

Options for `caller.id` when the caller authenticated with a
static bearer:

- a SHA-256 hash of the token (deterministic, reveals whether the
  same token was reused, leaks nothing about token content)
- a label assigned to the token via a future
  `AGENTBRIDGE_HTTP_TOKEN_LABEL` env var (operator-friendly,
  multi-token in one process)
- the token's first 8 hex chars (debuggable but slightly leaky)

**Tentative answer:** SHA-256 hash by default; add the
operator-facing label as a v0.4.x follow-up. Implementation PR
chooses the exact field.

### 14.6 Codex / Claude Desktop / Cursor docs

stdio is the right default for those clients today; HTTP is for
hosted / centralized agent platforms. We will add an "if you're
running a hosted MCP client, here is how to wire HTTP" section to
[`docs/mcp-client-setup.md`](../mcp-client-setup.md) once the
implementation lands, and leave the existing stdio recipes
unchanged.

### 14.7 Package layout

Should HTTP transport live in `apps/mcp-server` or move to a new
`packages/mcp-transport-http`? **Tentative answer:** keep it in
`apps/mcp-server` for v0.4.0 — it ships in the same binary and
shares the dispatcher. Re-evaluate if and when other consumers
want to embed AgentBridge transports independently.

## 15. Decision log (initial)

These decisions are taken now and will only be revisited if the
implementation discovers a hard blocker.

| # | Decision |
|---|---|
| D1 | stdio remains the default transport. No regression in stdio behavior is acceptable. |
| D2 | HTTP transport is opt-in via `AGENTBRIDGE_TRANSPORT=http` or `--transport http`. |
| D3 | Phase 1 auth is a static bearer token in the `Authorization` header. |
| D4 | OAuth 2.1 resource-server mode is out of scope for v0.4.0 but designed for. |
| D5 | No unauthenticated remote HTTP is ever supported. Public bind without auth fails hard at startup. |
| D6 | Bearer tokens never appear in URL query strings; reject with `400`. |
| D7 | Origin validation is exact-origin (`URL.origin`) with no prefix matching, no wildcard. |
| D8 | Loopback bind is the default. Public bind requires both auth and an Origin allowlist. |
| D9 | Tool dispatcher is shared across transports via a `createMcpServer()` factory. No business logic forks per transport. |
| D10 | Outbound target-origin allowlist (`AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`) and inbound HTTP Origin allowlist (`AGENTBRIDGE_HTTP_ALLOWED_ORIGINS`) are independent and not interchangeable. |
| D11 | Audit events extend with `transport` and optional `caller` blocks. Token values never enter audit. |
| D12 | Wrap the SDK's `StreamableHTTPServerTransport` rather than reimplement Streamable HTTP. |

## 16. References

- MCP specification — Streamable HTTP transport.
- `@modelcontextprotocol/sdk` v1.29.x —
  `StreamableHTTPServerTransport` in `dist/esm/server/streamableHttp.js`.
- [`apps/mcp-server/src/index.ts`](../../apps/mcp-server/src/index.ts)
  — current stdio wiring.
- [`apps/mcp-server/src/tools.ts`](../../apps/mcp-server/src/tools.ts)
  — `callAction` and the shared dispatcher logic.
- [`apps/mcp-server/src/safety.ts`](../../apps/mcp-server/src/safety.ts)
  — outbound URL allowlist and origin pinning.
- [`apps/mcp-server/src/confirmations.ts`](../../apps/mcp-server/src/confirmations.ts)
  — confirmation token store.
- [`packages/core/src/audit.ts`](../../packages/core/src/audit.ts)
  — audit event redaction.
- [`docs/threat-model.md`](../threat-model.md) — threat T14
  ("Future HTTP transport risks") becomes the v0.4.0 work.
- [`docs/v1-readiness.md`](../v1-readiness.md) — v1.0 criterion
  #8 (HTTP MCP transport).
- [`docs/production-readiness.md`](../production-readiness.md) —
  "MCP HTTP mode (planned)" becomes "designed".
- [`docs/security-configuration.md`](../security-configuration.md)
  — will gain the `AGENTBRIDGE_HTTP_*` table once the
  implementation lands.
- [`docs/roadmap.md`](../roadmap.md) — v0.4.0 line.
- [`docs/adr/0001-http-mcp-transport.md`](../adr/0001-http-mcp-transport.md)
  — companion ADR for this decision.
