# Public beta status (v0.2.0-beta)

AgentBridge is in public beta. This document is the honest answer to
"what can I count on?"

## What you can do today

- **Author actions** — declare typed actions in TypeScript with
  `@marmar9615-cloud/agentbridge-sdk`, get a JSON Schema-backed manifest
  for free.
- **Score a URL** — `npx @marmar9615-cloud/agentbridge-cli scan <url>`
  returns a 0–100 readiness score with grouped recommendations.
- **Validate a manifest** — `agentbridge validate <path-or-url>`.
- **Convert OpenAPI** — `agentbridge generate openapi <doc>` produces a
  draft AgentBridge manifest with risk inferred per HTTP method.
- **Run an MCP server** — `npx @marmar9615-cloud/agentbridge-mcp-server`
  speaks stdio MCP, exposes tools/resources/prompts to AI clients,
  enforces a confirmation gate, origin pinning, URL allowlist, and an
  audit log with redaction.
- **Try Studio locally** — `npm run dev:studio` for a developer
  dashboard at `:3001`.
- **Run the demo locally** — `npm run dev:demo` for the simulated
  order-management surface at `:3000`.

## What's NOT in 0.2.0-beta

These are explicitly **out of scope** for the beta and on the roadmap
for production readiness:

- **Signed manifests.** A consumer cannot cryptographically verify a
  manifest's publisher. Treat manifests as untrusted input from any
  origin you don't already trust.
- **OAuth scope enforcement.** `permissions[]` on actions is
  documentary; the MCP server does not check the agent's bearer token
  scopes.
- **HTTP MCP transport.** The bundled MCP server speaks stdio only.
  Production agents needing HTTP must wrap with an HTTP transport.
- **Distributed audit storage.** The audit log is a local JSON file.
  No retention, replication, or integrity guarantees beyond
  best-effort atomic writes.
- **Policy engine.** No OPA / Cedar / custom-policy hook for action
  allow/deny. The only enforcement is the confirmation gate plus
  origin pinning.
- **Rate limiting / cost accounting.** None.
- **Multi-tenant isolation.** No tenant model.
- **Real auth on action endpoints.** The demo-app has no auth; the SDK
  doesn't impose any. You are responsible for protecting your own
  action endpoints.

See [docs/roadmap.md](roadmap.md) for the full picture of what's
shipped and what's planned.

## Safety guarantees that ARE in 0.2.0-beta

These are enforced by the bundled MCP server today, with tests:

| Invariant | Where | Test |
|---|---|---|
| Risky actions require explicit `confirmationApproved: true` AND a single-use, input-bound `confirmationToken` | `apps/mcp-server/src/tools.ts:callAction`, `apps/mcp-server/src/confirmations.ts` | `apps/mcp-server/src/tests/call-action.test.ts` |
| Action endpoints must share origin with `manifest.baseUrl` | `apps/mcp-server/src/safety.ts:assertSameOrigin` | same |
| Only loopback URLs by default; `AGENTBRIDGE_ALLOW_REMOTE=true` is the only escape | `apps/mcp-server/src/safety.ts:assertAllowedUrl` | same |
| Audit redaction strips `authorization`, `cookie`, `password`, `token`, `secret`, `api_key` recursively | `packages/core/src/audit.ts:redact` | `packages/core/src/tests/audit.test.ts` |
| Demo-app destructive actions are simulated (`{ simulated: true, ... }`) — no real payment processor or external service is touched | `apps/demo-app/lib/actions.ts` | (manifest-level test) |
| Inputs are validated against the action's JSON Schema before any outbound call | `apps/mcp-server/src/tools.ts` (Ajv) | `apps/mcp-server/src/tests/call-action.test.ts` |

## What "beta" means

- **Manifest schema** is stable for all 0.x releases. Field additions
  are non-breaking; field removals or shape changes will bump to 1.0.
- **Public APIs** of the published packages may shift between 0.x
  releases — not casually, but not promised. Pin to `~0.2.0` if you
  need a stable surface; pin to `^0.2.0` if you want patches.
- **Bug reports are welcome.** Open an issue with a minimal repro.

## How to report problems

- Public bugs / feature requests:
  https://github.com/marmar9615-cloud/agentbridge-protocol/issues
- Security issues: see [SECURITY.md](../SECURITY.md). Do NOT open a
  public issue.
