# Changelog

All notable changes to AgentBridge are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-04-27 — First public release

### Added

- All six publishable packages are now on npm under the `@marmarlabs`
  scope:
  - [`@marmarlabs/agentbridge-core`](https://www.npmjs.com/package/@marmarlabs/agentbridge-core)
  - [`@marmarlabs/agentbridge-sdk`](https://www.npmjs.com/package/@marmarlabs/agentbridge-sdk)
  - [`@marmarlabs/agentbridge-scanner`](https://www.npmjs.com/package/@marmarlabs/agentbridge-scanner)
  - [`@marmarlabs/agentbridge-openapi`](https://www.npmjs.com/package/@marmarlabs/agentbridge-openapi)
  - [`@marmarlabs/agentbridge-cli`](https://www.npmjs.com/package/@marmarlabs/agentbridge-cli)
  - [`@marmarlabs/agentbridge-mcp-server`](https://www.npmjs.com/package/@marmarlabs/agentbridge-mcp-server)
- [`docs/releases/v0.2.0.md`](docs/releases/v0.2.0.md) release notes.

### Changed

- Renamed publishable packages from `@marmar9615-cloud/agentbridge-*`
  to `@marmarlabs/agentbridge-*`. Rationale: the `@marmar9615-cloud`
  npm scope was never created on npm; `@marmarlabs` is the actual
  owned scope of the publisher. See
  [docs/npm-scope.md](docs/npm-scope.md).
- README, docs, and per-package READMEs updated to use the
  `@marmarlabs` scope and the now-published install commands.
- The 0.2.0-beta GitHub prerelease is superseded by this release.

### Compatibility

- No code or behavior changes from 0.2.0-beta. The packages are the
  same shape, the same APIs, the same safety invariants. Only the npm
  scope changed.
- All 86 tests pass on Node 20.x and 22.x.

## [0.2.0-beta] — 2026-04-26 — Phase 3A: Public Beta Release Hardening

### Changed (potentially breaking for any pre-existing imports)

- All publishable packages renamed from `@agentbridge/*` to
  `@marmar9615-cloud/agentbridge-*`. The `@agentbridge` npm scope is
  unowned/unverifiable; the prefixed scope is owned and publishable. See
  [docs/npm-scope.md](docs/npm-scope.md).
- Apps `demo-app` and `studio` dropped the `@agentbridge/` scope (they
  remain `private`); root remains `agentbridge` (sentinel for repo-root walks).
- All publishable packages bumped to `0.2.0` for synchronized release.
- Workspace dependency ranges changed from `"*"` to `"^0.2.0"` (npm
  rejects `"*"` in published manifests).

### Added

- **Real build pipeline (tsup)** for all publishable packages — outputs
  `dist/index.js` + `dist/index.d.ts` + sourcemaps. CLI also emits
  `dist/bin.js` with `#!/usr/bin/env node` shebang via tsup banner.
  `package.json` `main`/`types`/`exports`/`bin`/`files` now point at
  `dist/`. Packages flipped from `private: true` to publishable.
- `scripts/external-adopter-smoke.mjs` — `git archive HEAD` into a
  tmpdir, `npm ci`/test/build/pack-check, then boot demo-app and run
  the compiled CLI scan against it. Validates the external-clone
  experience.
- `scripts/pack-check.mjs` — runs `npm pack --dry-run --json` per
  workspace, asserts each tarball contains the expected files (dist,
  README, LICENSE) and excludes src/test/tsconfig artifacts.
- Per-package READMEs for core, sdk, scanner, openapi, cli, mcp-server.
  Included in npm pack so they show on the npm package page.
- New CI workflow `.github/workflows/release-check.yml`
  (`workflow_dispatch` only) that runs the full release validation:
  test, build, pack-check, smoke, plus printing every tarball's
  contents. Does not publish.
- `ci.yml` extended: typechecks `cli` + `openapi` (previously missing),
  runs `npm run build`, runs `npm run pack:dry-run`.
- Issue templates (bug report, feature request, manifest help, config),
  pull request template, and Dependabot config (`npm` weekly grouped
  dev-deps + GitHub Actions monthly).
- New documentation:
  - [docs/npm-scope.md](docs/npm-scope.md) — naming decision, fallback,
    how to verify scope availability.
  - [docs/release-checklist.md](docs/release-checklist.md) — pre/post
    publish steps in dependency order.
  - [docs/npm-publishing.md](docs/npm-publishing.md) — exact publish
    commands, recovery from partial publishes.
  - [docs/external-adopter-test.md](docs/external-adopter-test.md) —
    what `npm run smoke:external` does and how to run it manually.
  - [docs/public-beta.md](docs/public-beta.md) — what is and isn't in
    v0.2.0-beta; safety notes; roadmap pointers.
  - [docs/releases/v0.2.0-beta.md](docs/releases/v0.2.0-beta.md) —
    full release notes draft.
- Root `package.json` scripts: `pack:dry-run`, `smoke:external`. Updated
  `build` to target only publishable packages and `typecheck` to cover
  all six.

### Fixed

- README test count was outdated ("28 tests" → suite is 86). Removed
  hardcoded counts; README now just says `npm test`.
- README MCP config example pointed at a local `tsx` invocation; now
  shows `npx @marmar9615-cloud/agentbridge-mcp-server` for users who
  install from npm. Local-checkout path documented in
  [docs/mcp-client-setup.md](docs/mcp-client-setup.md) for development.
- README badge changed from "Status: MVP" to "Status: Public Beta".

### Compatibility

- All 86 tests still pass at every commit on this branch.
- All safety invariants preserved (confirmation gate, origin pinning,
  URL allowlist, audit redaction, simulated destructive demo actions).
- No runtime behavior modified; this is a pure packaging/release-prep
  change.

## [0.2.0] — Phase 2: Developer Tooling

### Added

- **`@agentbridge/cli`** — new `agentbridge` CLI with five commands:
  - `agentbridge scan <url>` — readable terminal report; `--json` for machine output.
  - `agentbridge validate <file-or-url>` — validates a manifest against the spec.
  - `agentbridge init` — scaffolds `agentbridge.config.ts` and a starter `/.well-known/agentbridge.json`. Supports `--force`, `--format json`.
  - `agentbridge generate openapi <src>` — converts an OpenAPI 3.x doc into a draft AgentBridge manifest. Supports `--out`, `--base-url`, `--json`.
  - `agentbridge mcp-config` — prints copy-pasteable MCP client config snippets.
  - `agentbridge version` — prints CLI version.
- **`@agentbridge/openapi`** — standalone package for OpenAPI → manifest conversion.
  - Exposes `parseOpenApiDocument`, `generateManifestFromOpenApi`, `operationToAgentAction`, `inferRiskFromMethod`, `inferConfirmationFromRisk`, `normalizeActionName`, `convertOpenApiSchemaToJsonSchema`.
  - Resolves `#/components/schemas/X` $refs.
  - Inherits OpenAPI `info.title`, `info.version`, and `info.contact`.
  - Risk inference: `GET → low`, `POST/PATCH/PUT → medium`, `DELETE → high`.
- **Manifest spec artifacts** at `spec/`:
  - `agentbridge-manifest.schema.json` — JSON Schema (Draft 2020-12) for the manifest.
  - `agentbridge-manifest.v0.1.md` — human-readable spec.
  - `examples/minimal-manifest.json`, `ecommerce-manifest.json`, `support-ticket-manifest.json` — three example manifests, validated by tests.
- **MCP server upgrades**:
  - Confirmation tokens — first call to a risky action issues a short-lived (5 min default) token bound to `(url, actionName, hash(input))`. Second call must include `confirmationApproved: true` AND the same token. Tokens are single-use and can't be reused with different input.
  - Idempotency keys — optional `idempotencyKey` on `call_action` replays prior results for the same key+input within 24h. Conflicts are surfaced explicitly.
  - Outbound action timeout (10s) and max response size guard (1MB).
  - Structured tool output — `structuredContent` returned alongside human-readable text.
  - **Resources** — `agentbridge://manifest`, `agentbridge://readiness`, `agentbridge://audit-log`, `agentbridge://spec/manifest-v0.1`.
  - **Prompts** — `scan_app_for_agent_readiness`, `generate_manifest_from_api`, `explain_action_confirmation`, `review_manifest_for_security`.
- **Studio dashboard upgrades**:
  - Headline rewritten to "Make your app agent-ready."
  - Scan results page renders structured checks grouped by severity, recommendations grouped by category, copy-JSON button.
  - Manifest viewer shows summary card + raw JSON with copy button.
  - Actions list supports search and risk filtering, displays permission counts.
  - Action detail page now has Form / Raw JSON tabs with live summary preview, structured + raw result view, and inline audit entry display.
  - Audit log page supports search/filter by source/status/confirmation and a local-only "Clear log" button.
  - New Spec page renders the bundled markdown spec; `/spec/schema.json` serves the JSON Schema.
- **Scanner upgrades** — structured checks with `id`, `severity`, `path`, `recommendation`, `category`. Recommendations grouped by `safety` / `schema` / `docs` / `developerExperience`. New checks: cross-origin baseUrl, non-object inputSchema, destructive method without high risk, missing version, missing auth declaration, missing permissions on risky actions, missing resources.
- **Docs**:
  - [`docs/quickstart.md`](docs/quickstart.md), [`docs/mcp-client-setup.md`](docs/mcp-client-setup.md), [`docs/openapi-import.md`](docs/openapi-import.md), [`docs/roadmap.md`](docs/roadmap.md).
  - [`CLAUDE.md`](CLAUDE.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- **Examples** at `examples/`:
  - `nextjs-basic/` — minimal SDK integration walkthrough.
  - `openapi-store/` — sample OpenAPI doc + generated manifest.
  - `mcp-client-config/` — Claude Desktop / Cursor wiring.

### Changed

- Scanner `ScanResult` now includes `checks[]`, `passed[]`, `recommendationGroups`, and `scannedAt` alongside the legacy `issues[]` / `recommendations[]` (kept for backward compat).
- Workspace version bumped to `0.2.0`.
- All package `package.json`s now declare `description`, `license`, `repository`, `homepage`, `keywords` for future publishing.

### Compatibility

- Existing manifests from v0.1.0 remain valid against the v0.1 spec.
- All 28 v0.1 tests still pass; suite expanded to 86+ tests.

## [0.1.0] — MVP

Initial release.

- Manifest schema, types, validation in `@agentbridge/core`.
- `defineAgentAction`, `createAgentBridgeManifest`, `createActionHandler` in `@agentbridge/sdk`.
- 0–100 readiness scoring with optional Playwright probe in `@agentbridge/scanner`.
- Demo app with 5 actions (list_orders, get_order, draft_refund_order, execute_refund_order, add_internal_note).
- Studio dashboard for scan / manifest viewer / actions / audit log.
- stdio MCP server with 5 tools (`discover_manifest`, `scan_agent_readiness`, `list_actions`, `call_action`, `get_audit_log`).
- Confirmation gate, origin pinning, URL allowlist, audit log redaction.
- 28 Vitest specs across core, scanner, and mcp-server suites.
