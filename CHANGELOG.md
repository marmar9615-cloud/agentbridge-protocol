# Changelog

All notable changes to AgentBridge are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
