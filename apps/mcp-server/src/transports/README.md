# `apps/mcp-server/src/transports/`

Transport adapters for the AgentBridge MCP server. Each adapter is
a thin wrapper that builds the shared MCP server via
[`createMcpServer()`](../server.ts) and connects it to a wire
transport. **Auth, Origin validation, and host binding (when HTTP
lands) live in the adapter, not in the dispatcher.**

## Current adapters

| File | Status | Notes |
|---|---|---|
| [`stdio.ts`](stdio.ts) | shipping | Default. Wraps `StdioServerTransport`. Stdout = JSON-RPC; stderr = diagnostics. Verified by [`stdio-hygiene.test.ts`](../tests/stdio-hygiene.test.ts). |
| `http.ts` | not yet | Lands in v0.4.0 implementation PR 2. Will wrap `StreamableHTTPServerTransport` behind bearer auth + Origin allowlist + loopback-by-default bind. |

## Migration plan

Per [`docs/designs/http-mcp-transport-auth.md §13`](../../../../docs/designs/http-mcp-transport-auth.md#13-migration-plan):

1. **PR 1 — transport abstraction.** ✅ landed. `createMcpServer()`
   factory in `../server.ts`; this directory holds the stdio
   adapter; `index.ts` is now a thin entry that calls
   `runStdioServer()`. Zero behavior change.
2. **PR 2 — HTTP transport + bearer auth.** Adds `http.ts` here,
   wires `StreamableHTTPServerTransport` from
   `@modelcontextprotocol/sdk` behind an auth + Origin + bind
   check. New env vars (`AGENTBRIDGE_HTTP_*`) parsed in
   `../config.ts`.
3. **PR 3 — docs / examples / smoke tests.** Updates
   [`docs/security-configuration.md`](../../../../docs/security-configuration.md),
   [`docs/mcp-client-setup.md`](../../../../docs/mcp-client-setup.md),
   and adds an `examples/http-client-config/` directory.

## Hard rules for the implementation

These are restated from the design doc and the ADR
([`docs/adr/0001-http-mcp-transport.md`](../../../../docs/adr/0001-http-mcp-transport.md)):

- stdio remains the default. No regression in the stdio path is
  acceptable.
- HTTP requires authentication. No unauthenticated remote HTTP.
  Public bind without auth fails hard at startup.
- Tokens go in the `Authorization: Bearer <token>` header. Tokens
  in URL query strings are rejected with `400`.
- `Origin` header validation is exact-origin match against
  `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS`. No prefix match, no
  wildcard.
- Default bind is `127.0.0.1`. Public bind requires both auth and
  an Origin allowlist.
- The dispatcher is shared. The same `callAction` /
  `confirmations` / `safety` / `audit` / `idempotency` code paths
  serve both transports. Auth and Origin live **in front of**
  `transport.handleRequest()`, not inside the dispatcher.
- Bearer token values never appear in audit, in stderr, or in
  HTTP error bodies.

If a change here weakens any of those, stop and reread the design
doc and the ADR before continuing.
