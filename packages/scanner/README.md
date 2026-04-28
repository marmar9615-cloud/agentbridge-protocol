# @marmarlabs/agentbridge-scanner

Score how agent-ready a URL is. Returns a 0–100 readiness score,
structured `checks[]`, and grouped recommendations.

Used by the [AgentBridge CLI](https://www.npmjs.com/package/@marmarlabs/agentbridge-cli),
[AgentBridge Studio](https://github.com/marmar9615-cloud/agentbridge-protocol/tree/main/apps/studio),
and the [MCP server](https://www.npmjs.com/package/@marmarlabs/agentbridge-mcp-server).

## Install

```bash
npm install @marmarlabs/agentbridge-scanner
```

`playwright` is an optional dependency — install it separately if you
want browser-based interactivity probes:

```bash
npm install playwright
```

## What's inside

- `scanUrl(url, options?)` — fetch the manifest at `${url}/.well-known/agentbridge.json`
  (with fallbacks), validate it, and run a battery of structured checks.
- `ScanResult` type — `{ score, checks[], passed[], summary }`.
- `Check` type — `{ severity, category, path, message, recommendation }`.

## Quick example

```ts
import { scanUrl } from "@marmarlabs/agentbridge-scanner";

const result = await scanUrl("http://localhost:3000");
console.log(`score: ${result.score}/100`);
for (const check of result.checks) {
  console.log(`[${check.severity}] ${check.path}: ${check.message}`);
}
```

## Categories

Checks are grouped into:
- `safety` — confirmation gates, risk classification, idempotency
- `schema` — manifest shape, JSON Schema validity, examples
- `docs` — descriptions, summaries, contact info
- `developerExperience` — discoverability, latency, error responses

## Scanner regression fixtures

The repo includes scanner fixtures in
[`examples/scanner-regression`](https://github.com/marmar9615-cloud/agentbridge-protocol/tree/main/examples/scanner-regression)
that pin public scanner behavior:

- `manifest.good.json` demonstrates a high-readiness manifest with
  contact, auth, resources, schemas, examples, summary templates,
  permissions, and confirmation on risky actions.
- `manifest.minimal-valid.json` is valid but intentionally low
  readiness, so the scanner recommends contact, auth, resources,
  output schema, examples, and summary templates.
- `manifest.missing-confirmation.json` keeps schema validation green
  while triggering the risky-action confirmation check.
- `manifest.origin-mismatch.json` shows the `baseUrl` / scanned-origin
  warning used to protect origin-pinned action calls.
- `manifest.invalid.json` verifies invalid manifests fail safely with
  validation errors.

Run the fixture coverage from the repo root:

```bash
npx vitest run packages/scanner/src/tests
```

After building the CLI, validate the fixture manifests with:

```bash
node packages/cli/dist/bin.js validate examples/scanner-regression/manifest.good.json
node packages/cli/dist/bin.js validate examples/scanner-regression/manifest.minimal-valid.json
```

## Status

Public release. v0.2.2 is a docs-only release that adds OpenAI Codex
onboarding alongside the existing Claude Desktop / Cursor / custom
client setup paths — no code or behavior changes since v0.2.0.
AgentBridge is suitable for local development, manifest authoring,
scanner workflows, OpenAPI import, and MCP experiments. It is not yet
production security infrastructure.

The structured [`checks[]`](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/CHANGELOG.md)
shape is stable for the v0.x line. Check coverage will grow over time
and severity deductions may be retuned.

## License

Apache-2.0
