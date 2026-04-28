# AGENTS.md

> Working notes for any AI coding agent operating on this repository
> (OpenAI Codex, Claude Code, Cursor, custom). Model-neutral. Keep
> this file short. For deeper, Claude-specific notes see
> [CLAUDE.md](CLAUDE.md).

## Project summary

**AgentBridge is an AI-native action layer for web apps.** Web apps
publish a manifest at `/.well-known/agentbridge.json`. MCP clients
discover the manifest, validate inputs, enforce confirmation on risky
actions, call action endpoints, and audit the results.

The repo ships:

- Five publishable npm packages plus an MCP server, scoped under
  **`@marmarlabs`**.
- A demo Next.js app and a Studio dashboard.
- A Vitest test suite (86 tests as of v0.2.1).

## Current state

- npm scope: **`@marmarlabs`** (do not change).
- Latest published release: **v0.3.0** on npm and on GitHub
  (Latest, stable; published via npm Trusted Publishing with SLSA
  build provenance). The v0.2.x line shipped first public release,
  docs cleanup, and Codex onboarding; v0.3.0 added production
  foundations (stricter remote allowlist, configurable bounds,
  Trusted Publishing workflow, threat model, v1.0 readiness
  checklist, stdout-hygiene test).
- Currently in flight: **v0.4.0** — opt-in HTTP MCP transport with
  authentication and Origin validation. stdio remains the default.
  Design in [docs/designs/http-mcp-transport-auth.md](docs/designs/http-mcp-transport-auth.md);
  ADR in [docs/adr/0001-http-mcp-transport.md](docs/adr/0001-http-mcp-transport.md).
- Manifest schema: v0.1, stable for the v0.x line. Will be frozen
  for v1.x per [docs/v1-readiness.md](docs/v1-readiness.md).

## Layout

```
packages/
  core/      Zod schemas, types, manifest validation, audit log
  sdk/       defineAgentAction, manifest builder, route handler glue
  scanner/   0-100 readiness scoring, structured checks
  openapi/   OpenAPI 3.x → AgentBridge manifest converter
  cli/       @marmarlabs/agentbridge-cli (scan / validate / init / generate / mcp-config)
apps/
  demo-app/    Next.js fake order app (port 3000)
  studio/      Next.js dashboard (port 3001)
  mcp-server/  stdio MCP server (tools, resources, prompts, confirmation tokens)
spec/        JSON Schema + markdown manifest spec + example manifests
examples/    Integration examples (nextjs-basic, openapi-store, mcp-client-config, codex-config, codex-plugin)
docs/        Quickstart, MCP client setup, Codex setup, OpenAPI import, roadmap, releases
data/        Local audit/confirmation/idempotency JSON (gitignored)
```

## Core commands

```bash
npm install                # install workspace deps
npm run typecheck:clean    # delete dist/ and tsc --noEmit each package
npm test                   # vitest run
npm run build              # tsup build for publishable packages → dist/
npm run pack:dry-run       # validate published-tarball contents
npm run smoke:external     # full external-clone simulation
npm run dev                # demo + studio in parallel
npm run dev:mcp            # MCP server (stdio)
npm run dev:cli -- scan http://localhost:3000   # local CLI
```

CI (`.github/workflows/ci.yml`) runs install, typecheck, tests, build,
pack-check, and Next.js builds on Node 20.x and 22.x.

## Safety invariants — never break these

1. **Confirmation gate.** `apps/mcp-server/src/tools.ts:callAction`
   refuses to invoke medium/high-risk actions without
   `confirmationApproved === true` AND a valid `confirmationToken`.
2. **Origin pinning.** `apps/mcp-server/src/safety.ts:assertSameOrigin`
   runs before every outbound call. Action endpoints must share
   origin with `manifest.baseUrl`.
3. **Loopback-only by default.** Two opt-in escapes:
   `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=<comma-separated origins>`
   (strict, exact-origin allowlist; production-recommended) and
   `AGENTBRIDGE_ALLOW_REMOTE=true` (broad, emits a one-time stderr
   warning). The strict allowlist always wins. See
   [docs/security-configuration.md](docs/security-configuration.md).
4. **Audit redaction.** `packages/core/src/audit.ts:redact` is the
   chokepoint for stripping `authorization`, `cookie`, `password`,
   `token`, `secret`, `api_key`. Extend the redact set, do not
   bypass it.
5. **Simulated destructive demo actions.** The demo app's
   `execute_refund_order`, etc., return `{ simulated: true, ... }`
   and never touch real services.

If a change weakens any of these, stop and ask before continuing.

## Release rules — non-negotiable

- **Do not `npm publish` without explicit user approval** on the
  current task.
- **Do not create git tags or GitHub releases without explicit user
  approval.**
- **Do not merge Dependabot PRs during release work** unless the user
  explicitly says to.
- **Do not delete or deprecate existing releases** (`v0.2.0`, `v0.2.1`)
  without explicit user approval.
- **Do not change the npm scope** (`@marmarlabs`) or rename the
  project.

## How to add a new MCP client example

1. Add a setup doc under `docs/` (e.g. `docs/codex-setup.md` is the
   pattern).
2. Update `docs/mcp-client-setup.md` with a section for the new
   client.
3. Add config-file examples under `examples/<client>-config/` if the
   client has its own config format.
4. Update `packages/cli/src/commands/mcp-config.ts` to print a
   copy-pasteable snippet for that client.
5. Update the test in `packages/cli/src/tests/cli.test.ts` so it
   asserts the new client's snippet appears in the output.

## How to update package README/docs

- Per-package READMEs are bundled into npm tarballs and become the
  package's npmjs.com page. **A README change inside a publishable
  package requires a version bump and a publish to be visible on
  npm.**
- The publishable package READMEs are in `packages/{core,sdk,scanner,
  openapi,cli}/README.md` and `apps/mcp-server/README.md`.
- The root `README.md`, `docs/`, and `examples/` are repo-only — they
  do not need a version bump to refresh.

## How to add or change CLI output

1. Edit the relevant module under `packages/cli/src/commands/`.
2. Update or add a test in `packages/cli/src/tests/cli.test.ts` that
   captures stdout via the `captureStdio()` helper.
3. Run `npm test`, `npm run build`, then
   `node packages/cli/dist/bin.js <command>` to sanity-check the
   compiled bin.
4. If the change is user-visible, mention it in `CHANGELOG.md`.

## Pull request expectations

- Run `npm test`, `npm run typecheck:clean`, `npm run build`, and the
  relevant Next.js builds before pushing.
- Keep commits scoped (one logical change per commit).
- Update `CHANGELOG.md` for user-facing changes.
- Reference the issue or roadmap item the change addresses.
- Do not force-push to `main`.

## Where to look next

- [CLAUDE.md](CLAUDE.md) — deeper repo-specific notes (history of
  decisions, every code path's location, Claude-Code-specific
  conventions).
- [docs/codex-setup.md](docs/codex-setup.md) — Codex onboarding.
- [docs/mcp-client-setup.md](docs/mcp-client-setup.md) — every other
  MCP client.
- [docs/v1-readiness.md](docs/v1-readiness.md) — what
  "production-ready v1.0" means for this project.
- [docs/production-readiness.md](docs/production-readiness.md) —
  practical "what is AgentBridge safe for today?" guidance.
- [docs/threat-model.md](docs/threat-model.md) — known threats,
  current mitigations, v1.0 targets.
- [docs/security-configuration.md](docs/security-configuration.md)
  — every env var the MCP server honors.
- [docs/trusted-publishing.md](docs/trusted-publishing.md) — npm
  Trusted Publishing plan and draft workflow.
- [docs/designs/http-mcp-transport-auth.md](docs/designs/http-mcp-transport-auth.md)
  — v0.4.0 HTTP MCP transport + auth design.
- [docs/adr/0001-http-mcp-transport.md](docs/adr/0001-http-mcp-transport.md)
  — ADR for the HTTP transport decision.
- [docs/roadmap.md](docs/roadmap.md) — what's planned beyond v0.3.x
  (HTTP MCP transport, signed manifests, OAuth scope enforcement,
  distributed audit storage, …).
- [SECURITY.md](SECURITY.md) — how to report security issues.
