# `apps/mcp-server/src/transports/`

Reserved landing pad for the v0.4.0 HTTP MCP transport
implementation. Empty on purpose.

## Why this directory exists now

The v0.4.0 design PR (docs-only) creates this directory so the
follow-up implementation PRs have an obvious home and reviewers
have a concrete file path to look for. **Nothing in here is
imported from `index.ts`. There is no runtime effect.**

## What lands here

Per [`docs/designs/http-mcp-transport-auth.md`](../../../../docs/designs/http-mcp-transport-auth.md):

1. **PR 1 — transport abstraction.** A `createMcpServer()` factory
   in `../server.ts` (or similar). The two transport entry points
   (`stdio.ts` and `http.ts`) live here. stdio is refactored to
   call the factory; behavior unchanged.
2. **PR 2 — HTTP transport + bearer auth.** `http.ts` wires
   `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`
   behind an auth + Origin + bind check. New env vars
   (`AGENTBRIDGE_HTTP_*`) parsed in `../config.ts`.
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
