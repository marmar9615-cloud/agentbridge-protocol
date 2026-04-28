# Changelog

All notable changes to AgentBridge are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- [`docs/adopter-quickstart.md`](docs/adopter-quickstart.md) - an
  existing-app onboarding guide for adding AgentBridge manifests,
  action endpoints, CLI validation, scanner checks, MCP client setup,
  and production safety review.
- [`docs/manifest-patterns.md`](docs/manifest-patterns.md) - reusable
  manifest/action patterns for read actions, draft actions,
  confirmation-required mutations, idempotent calls, resources, and
  auth/contact metadata.
- [`examples/adopter-quickstart/`](examples/adopter-quickstart/) -
  static valid manifest examples for adopter onboarding, including a
  minimal order manifest and a production-shaped safe fixture.
- OpenAPI converter regression fixtures and tests covering action-name
  normalization, method-risk inference, request/response schema
  conversion, skipped methods, metadata inheritance, and current
  unsupported security/example mapping behavior.

## [0.3.0] — 2026-04-28 — Production Foundations

### Added

- **Stricter remote-target allowlist.** New
  `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` env var on the MCP server
  enforces an exact-`URL.origin` allowlist (comma-separated). Loopback
  remains allowed by default. The strict allowlist takes precedence
  when both `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` and the broader
  `AGENTBRIDGE_ALLOW_REMOTE=true` are set. Prefix attacks
  (`https://example.com.evil.test`) are rejected. Non-http(s) schemes
  (`javascript:`, `file:`, `data:`, `ftp:`) are rejected even with the
  broad escape hatch on. See
  [`apps/mcp-server/src/safety.ts`](apps/mcp-server/src/safety.ts) and
  [docs/security-configuration.md](docs/security-configuration.md).
- **Configurable bounds with safe ranges.** New env vars on the MCP
  server, parsed once per process and clamped to safe ranges with a
  stderr warning on out-of-range / non-integer input:
  - `AGENTBRIDGE_ACTION_TIMEOUT_MS` — default `10000`, range `1000`–`120000`.
  - `AGENTBRIDGE_MAX_RESPONSE_BYTES` — default `1000000`, range `1024`–`10485760`.
  - `AGENTBRIDGE_CONFIRMATION_TTL_SECONDS` — default `300`, range `30`–`3600`.
  See [`apps/mcp-server/src/config.ts`](apps/mcp-server/src/config.ts).
- **Stdout hygiene test.** New
  [`apps/mcp-server/src/tests/stdio-hygiene.test.ts`](apps/mcp-server/src/tests/stdio-hygiene.test.ts)
  spawns the built MCP server as a subprocess and asserts that
  every stdout line is parseable JSON-RPC and that the broad-remote
  warning is routed to stderr only.
- **AGENTBRIDGE_ALLOW_REMOTE warning.** When the broad escape hatch
  is active, the server emits a one-time stderr warning per process
  pointing the operator at `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` for
  production.
- **New documentation:**
  - [docs/v1-readiness.md](docs/v1-readiness.md) — defines what
    "production-ready v1.0.0" means, with a 17-item release-criterion
    checklist and a 15-section breakdown.
  - [docs/production-readiness.md](docs/production-readiness.md) —
    practical "what is AgentBridge safe for today?" assessment plus
    a pre-flight checklist for using AgentBridge with real customer /
    admin / financial actions.
  - [docs/threat-model.md](docs/threat-model.md) — full catalogue of
    15 threats, with current mitigations, remaining gaps, v1.0
    targets, and test coverage pointers per threat.
  - [docs/security-configuration.md](docs/security-configuration.md) —
    every env var the MCP server honors, with defaults, ranges, and
    recipes for local / staging / production-like.
  - [docs/trusted-publishing.md](docs/trusted-publishing.md) — the
    npm Trusted Publishing plan, what manual setup is required per
    package, and how to use the new draft workflow.
- **Draft `release-publish.yml` workflow.** New
  [`.github/workflows/release-publish.yml`](.github/workflows/release-publish.yml)
  is `workflow_dispatch`-only, defaults to `dry_run=true`, and uses
  npm Trusted Publishing OIDC (no `NPM_TOKEN`). Each package needs a
  Trusted Publisher record in the npm UI before the
  `dry_run=false` path will succeed (see docs).

### Changed

- **`agentbridge mcp-config` CLI output** now mentions
  `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` and points at
  `docs/security-configuration.md`. Test in
  [`packages/cli/src/tests/cli.test.ts`](packages/cli/src/tests/cli.test.ts)
  asserts the new strings.
- **Workspace dep ranges bumped to `^0.3.0`.** The seven workspace
  consumers (`sdk`, `scanner`, `openapi`, `cli`, `mcp-server`,
  `demo-app`, `studio`) now request `@marmarlabs/agentbridge-*@^0.3.0`
  so a future v0.3.0 publish actually flows through.
- **Existing docs updated** to reference the new doc set:
  [README.md](README.md), [SECURITY.md](SECURITY.md),
  [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md),
  [docs/roadmap.md](docs/roadmap.md),
  [docs/release-checklist.md](docs/release-checklist.md),
  [docs/npm-publishing.md](docs/npm-publishing.md),
  [docs/codex-setup.md](docs/codex-setup.md),
  [docs/mcp-client-setup.md](docs/mcp-client-setup.md), and
  [`apps/mcp-server/README.md`](apps/mcp-server/README.md).
- **MCP server identity string** in
  [`apps/mcp-server/src/index.ts`](apps/mcp-server/src/index.ts)
  bumped from a stale `0.2.0` to `0.3.0`.
- **Roadmap reorganized** as a version-by-version path to v1.0
  (`v0.4.0` HTTP transport, `v0.5.0` signed manifests, …,
  `v1.0.0` stable production release).
- All 9 workspace `package.json` files bumped 0.2.2 → 0.3.0.

### Compatibility

- **No safety invariant was changed.** Confirmation gate, origin
  pinning, audit redaction, and the simulated-destructive-actions
  posture in the demo app all behave exactly as in v0.2.2.
- **The default behavior is identical** to v0.2.2. With no new env
  vars set, the MCP server is loopback-only, has the same 10s timeout,
  the same 1MB cap, and the same 5-minute confirmation TTL.
- The new `AGENTBRIDGE_ALLOW_REMOTE=true` warning is on stderr only;
  stdout (the MCP protocol stream) is unchanged and remains pure
  JSON-RPC.
- `CONFIRMATION_TTL_MS` is still exported from
  `apps/mcp-server/src/confirmations.ts` for any external import; the
  runtime now also has `resolveConfirmationTtlMs()` which honors the
  env var.
- Workspace dep ranges moved from `^0.2.0` to `^0.3.0`. This is a
  consumer-visible change for any *future* publish: `npm install
  @marmarlabs/agentbridge-cli@0.3.0` will pull in `^0.3.0` of `core`
  / `scanner` / `openapi`. v0.2.0 / v0.2.1 / v0.2.2 on npm are
  unaffected.
- All existing tests still pass; new tests cover the allowlist, the
  config bounds, and the stdio hygiene contract.

### Not in this release (deliberately)

- **No npm publish.** v0.3.0 is not on npm yet. The only published
  versions of `@marmarlabs/agentbridge-*` remain 0.2.0 / 0.2.1 /
  0.2.2.
- **No GitHub release** for v0.3.0 yet.
- **No git tag** for v0.3.0 yet.
- **No Trusted Publisher records** on npm yet — that's the manual
  setup step blocking the new workflow's `dry_run=false` path. See
  [docs/trusted-publishing.md](docs/trusted-publishing.md).
- **HTTP MCP transport, signed manifests, OAuth scopes, pluggable
  storage, policy engine** are all still on the roadmap and are
  *not* delivered in v0.3.0. v0.3.0 documents and prepares for them.

## [0.2.2] — 2026-04-27 — OpenAI Codex onboarding

### Added

- [`docs/codex-setup.md`](docs/codex-setup.md) — full Codex onboarding
  walkthrough covering the `codex mcp add` CLI, global
  `~/.codex/config.toml`, project-scoped `.codex/config.toml`, demo
  app pairing, troubleshooting, and the safety flow.
- [`examples/codex-config/`](examples/codex-config/) — copy-pasteable
  `config.global.toml` and `config.project.toml` plus a README that
  explains when to use which.
- [`AGENTS.md`](AGENTS.md) — short, model-neutral working notes for
  any AI coding agent operating on this repo (OpenAI Codex, Claude
  Code, Cursor, custom). Sibling to the deeper Claude-Code-focused
  [`CLAUDE.md`](CLAUDE.md).
- [`examples/codex-plugin/`](examples/codex-plugin/) — **experimental**
  local Codex plugin skeleton with `.codex-plugin/plugin.json`,
  `.mcp.json`, and a `skills/agentbridge/SKILL.md` operating guide.
  Not a published plugin, not a stable distribution path — the
  supported flow is the one in `docs/codex-setup.md`.

### Changed

- **`agentbridge mcp-config` CLI output** now prints copy-pasteable
  snippets for OpenAI Codex (CLI one-liner + `config.toml`), Claude
  Desktop, Cursor / generic MCP JSON, raw stdio command, and the
  local-checkout option. New CLI test asserts each snippet is present
  in the output.
- [`docs/mcp-client-setup.md`](docs/mcp-client-setup.md) restructured
  to be client-neutral with sections for OpenAI Codex, Claude
  Desktop, Cursor, and custom MCP clients. New "Safety expectations
  for all clients" section spells out the confirmation gate, origin
  pinning, loopback-only default, audit redaction, and simulated
  destructive demo actions.
- Root [`README.md`](README.md) gained a "Works with MCP clients"
  subsection in the wiring section, a Codex one-liner
  (`codex mcp add agentbridge -- npx -y @marmarlabs/agentbridge-mcp-server`),
  and a Cursor JSON snippet. Architecture diagram and conversation
  example reframed to be client-neutral.
- Per-package READMEs (`@marmarlabs/agentbridge-{core,sdk,scanner,
  openapi,cli,mcp-server}`) now describe v0.2.2 as the OpenAI Codex
  onboarding release. The `mcp-server` and `cli` READMEs got new
  Codex setup sections; the others updated their Status block for
  consistency.
- Existing JSON examples (Claude Desktop, Cursor) standardized on
  `npx -y @marmarlabs/agentbridge-mcp-server` (was bare `npx
  @marmarlabs/agentbridge-mcp-server`) so first-run installs don't
  prompt.
- All 9 workspace `package.json` files bumped 0.2.1 → 0.2.2 (six
  publishable packages plus root and the two private apps for
  workspace-coherence). `package-lock.json` refreshed.

### Compatibility

- **No code, schema, or protocol behavior changes.** The MCP server
  exposes the same five tools, four resources, four prompts, and the
  same confirmation token / idempotency / origin-pinning / audit
  redaction guarantees as v0.2.1.
- All 86 existing tests still pass; the new mcp-config test brings
  the count up.
- Workspace dependency ranges remain `^0.2.0` — `0.2.2` satisfies
  them, no consumer migration required.
- `@marmarlabs` scope unchanged. v0.2.0 and v0.2.1 remain functional
  on npm and on GitHub.

## [0.2.1] — 2026-04-27 — README cleanup patch

### Changed

- Per-package READMEs (`@marmarlabs/agentbridge-core`,
  `@marmarlabs/agentbridge-sdk`, `@marmarlabs/agentbridge-scanner`,
  `@marmarlabs/agentbridge-openapi`, `@marmarlabs/agentbridge-cli`,
  `@marmarlabs/agentbridge-mcp-server`) now describe AgentBridge as a
  public npm release rather than a "Public beta (v0.2.0)". The Status
  blocks make the v0.x stability boundary explicit and call out that
  v0.2.x is suitable for local development, manifest authoring, scanner
  workflows, OpenAPI import, and MCP experiments — but not yet
  production security infrastructure.
- `examples/nextjs-basic/README.md` no longer carries the
  "not yet published to npm" / "source-only" callout. The walkthrough
  installs the published `@marmarlabs/*` packages directly.
- `docs/roadmap.md` Phase 3A heading reframed from "Public beta release
  hardening (shipped 0.2.0-beta)" to "npm release hardening (shipped
  0.2.0 / 0.2.1)" with an extra bullet recording the stable release.
- `docs/npm-publishing.md` updated to use `@marmarlabs` everywhere
  (login scope, registry config, recovery commands), document the
  `--userconfig` token flow used for non-interactive 2FA-bypass
  publishes, and use a non-prerelease `gh release create` example.

### Added

- `docs/releases/v0.2.1.md` release notes.

### Compatibility

- **Docs-only patch.** No code, behavior, schema, or build-output
  changes. All 86 tests still pass on Node 20.x and 22.x.
- All safety invariants preserved (confirmation gate, origin pinning,
  URL allowlist, audit redaction, simulated destructive demo actions).
- Workspace dependency ranges remain `^0.2.0` — `0.2.1` satisfies them,
  no consumer migration required.

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
