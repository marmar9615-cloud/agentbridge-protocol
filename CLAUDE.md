# CLAUDE.md

> Working notes for Claude Code (and other AI agents) operating on this
> repository. Keep this file under 200 lines so the entire thing fits in
> any session's startup context.

## What this project is

AgentBridge is an **AI-native action layer for web apps**. Web apps publish a
machine-readable manifest at `/.well-known/agentbridge.json` describing
their structured actions (with input schemas, risk levels, confirmation
rules). AI agents discover and invoke those actions through an MCP server
that enforces safety guarantees.

## Architecture

```
agentbridge/
├── packages/
│   ├── core/       Zod schemas, types, manifest validation, audit log
│   ├── sdk/        defineAgentAction, manifest builder, route handler wrapper
│   ├── scanner/    0–100 readiness scoring, structured checks, Playwright probe
│   ├── openapi/    OpenAPI 3.x → AgentBridge manifest converter
│   └── cli/        @marmarlabs/agentbridge-cli — scan, validate, init, generate, mcp-config
├── apps/
│   ├── demo-app/   Next.js fake order app (port 3000) — manifest + actions
│   ├── studio/     Next.js dashboard (port 3001) — scan, exercise, audit
│   └── mcp-server/ stdio MCP server — tools, resources, prompts, confirmation tokens
├── spec/           JSON Schema + markdown manifest spec + example manifests
├── examples/       Integration examples (nextjs-basic, openapi-store, mcp-client-config)
├── docs/           Quickstart, MCP setup, OpenAPI import, roadmap
└── data/           Local audit/confirmation/idempotency JSON (gitignored)
```

## Package responsibilities

Publishable packages are scoped `@marmarlabs/agentbridge-*`; apps
keep an unscoped name and stay private. The `@agentbridge` scope is
unowned on npm and is intentionally not used.

| Package | Owns |
|---|---|
| `@marmarlabs/agentbridge-core` | The contract. All schemas, validation, audit log. |
| `@marmarlabs/agentbridge-sdk` | App author DX. Zod-first action definitions, route handler glue. |
| `@marmarlabs/agentbridge-scanner` | Audit/score any URL. Structured `checks[]` + grouped recommendations. |
| `@marmarlabs/agentbridge-openapi` | OpenAPI-to-manifest conversion logic. CLI uses it. |
| `@marmarlabs/agentbridge-cli` | `agentbridge` CLI. Wraps scanner/openapi/core. |

cli, openapi, scanner, and sdk all depend on core. Don't introduce
circular deps.

## Commands

```bash
npm install                # install workspace deps
npm test                   # all Vitest suites
npm run typecheck          # per-package tsc --noEmit
npm run build              # tsup build for publishable packages → dist/
npm run pack:dry-run       # validate published-tarball contents
npm run smoke:external     # full external-clone simulation
npm run dev                # demo + studio in parallel
npm run dev:demo           # demo on :3000
npm run dev:studio         # studio on :3001
npm run dev:mcp            # MCP server (stdio)
npm run dev:cli -- scan http://localhost:3000   # run CLI
```

CI: `.github/workflows/ci.yml` runs install, typecheck (all 6
packages), tests, build, pack-check, and Next.js builds on Node 20.x
and 22.x. `.github/workflows/release-check.yml` is a manual workflow
that additionally runs `npm run smoke:external` and prints every
tarball's contents — run it before tagging a release.

## Coding style

- TypeScript strict mode, ESM, `moduleResolution: Bundler`.
- **No `.js` extensions on relative imports** in source. Bundler/tsx/vitest
  all handle bare imports; Next.js webpack rejects `.js→.ts` resolution.
- Comments only when the *why* is non-obvious. No multi-paragraph docstrings.
- Plain CSS, no Tailwind.
- Tests live in `src/tests/*.test.ts` next to the code.
- `// PROD:` markers flag where production hardening would plug in.

## Testing expectations

Every new feature ships with a test. Categories of tests we currently maintain:

- **Schema** — does the manifest validate? Do example manifests stay valid?
- **Scanner** — does each new check produce the right severity/path?
- **OpenAPI** — round-trip from a fixture; risk inference correctness.
- **CLI** — captures stdout/stderr; verifies exit codes and side effects.
- **MCP server** — confirmation gate, token binding, idempotency, origin pinning.

## Security invariants — never break these

1. **Confirmation gate**: `mcp-server/src/tools.ts:callAction` MUST refuse to
   call risky actions without `confirmationApproved === true` AND a valid
   `confirmationToken`.
2. **Origin pinning**: `mcp-server/src/safety.ts:assertSameOrigin` MUST run
   before every outbound action call. Action endpoints must share origin
   with `manifest.baseUrl`.
3. **URL allowlist**: loopback only by default. Two opt-in escapes:
   `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=<comma-separated origins>` (strict
   exact-origin allowlist, production-recommended) and
   `AGENTBRIDGE_ALLOW_REMOTE=true` (broad, emits a one-time stderr
   warning). The strict allowlist always wins. See
   [`apps/mcp-server/src/safety.ts`](apps/mcp-server/src/safety.ts) and
   [docs/security-configuration.md](docs/security-configuration.md).
4. **Audit redaction**: never log secrets. `core/src/audit.ts:redact` is the
   chokepoint — extend the redact set, don't bypass it.
5. **Simulated destructive actions**: the demo app never touches real
   payment processors / external services. `execute_refund_order` returns
   `{ simulated: true, ... }`.

## How to add a new AgentBridge action (in the demo app)

1. Edit [`apps/demo-app/lib/manifest.ts`](apps/demo-app/lib/manifest.ts):
   `defineAgentAction` with name, title, description, Zod input/output,
   risk, confirmation, summary template.
2. Add it to the `ALL_ACTIONS` map.
3. Implement the handler in [`apps/demo-app/lib/actions.ts`](apps/demo-app/lib/actions.ts).
4. If destructive, **simulate** — never call real services.
5. Add a test in `packages/core/src/tests/` if the action exercises new
   schema territory.

## How to add a new scanner check

1. Edit [`packages/scanner/src/score.ts`](packages/scanner/src/score.ts).
2. Use `pushOrPass(failed, passed, condition, check, passedMessage)` so the
   check shows up either as a failure (with deduction) or in the passed
   list (for the dashboard).
3. Pick the right category: `safety`, `schema`, `docs`, or `developerExperience`.
4. Pick severity intentionally:
   - `error` — broken or unsafe (deduction 10–20)
   - `warning` — should fix (deduction 3–7)
   - `info` — nice to have (deduction 0–2)
5. Add a test in [`packages/scanner/src/tests/scanner.test.ts`](packages/scanner/src/tests/scanner.test.ts)
   that confirms the check fires.

## How to add a new MCP tool

1. Add the implementation function to [`apps/mcp-server/src/tools.ts`](apps/mcp-server/src/tools.ts).
2. Register the tool descriptor in [`apps/mcp-server/src/index.ts`](apps/mcp-server/src/index.ts) (`TOOLS` array).
3. Add a `case` in `dispatchTool`.
4. If it touches risky actions, route through the existing confirmation +
   origin-pin code paths — don't reimplement.
5. Test in [`apps/mcp-server/src/tests/`](apps/mcp-server/src/tests/).

## How to update the README / spec

- README is at the repo root. Keep it scannable; move detail into `docs/`.
- Spec lives at [`spec/agentbridge-manifest.v0.1.md`](spec/agentbridge-manifest.v0.1.md)
  and [`spec/agentbridge-manifest.schema.json`](spec/agentbridge-manifest.schema.json).
  Bump the version segment when shipping a breaking change to the manifest format.
- Example manifests in `spec/examples/` are validated by tests. Adding new
  examples adds test coverage automatically (see `packages/core/src/tests/spec-examples.test.ts`).

## Pull request expectations

- Run `npm test`, `npm run typecheck`, and the relevant `next build` before
  pushing. CI catches the rest.
- Don't force-push to `main`.
- Reference the issue or roadmap item this addresses.
- Update `CHANGELOG.md` for user-facing changes.

## Production / v1.0 references

- [docs/v1-readiness.md](docs/v1-readiness.md) — what the v1.0 bar is.
- [docs/production-readiness.md](docs/production-readiness.md) — what
  AgentBridge is/isn't safe for today.
- [docs/threat-model.md](docs/threat-model.md) — full threat catalogue.
- [docs/security-configuration.md](docs/security-configuration.md) —
  every MCP server env var.
- [docs/trusted-publishing.md](docs/trusted-publishing.md) — the npm
  publishing path toward v1.0 (Trusted Publishing + provenance).
