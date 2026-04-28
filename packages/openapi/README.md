# @marmarlabs/agentbridge-openapi

Convert OpenAPI 3.x documents into [AgentBridge](https://github.com/marmar9615-cloud/agentbridge-protocol)
manifests. The converter is intentionally conservative: it emits a
draft manifest that you should review before publishing.

## Install

```bash
npm install @marmarlabs/agentbridge-openapi
```

For most users, the [CLI wrapper](https://www.npmjs.com/package/@marmarlabs/agentbridge-cli)
is more ergonomic:

```bash
npx @marmarlabs/agentbridge-cli generate openapi store.openapi.json --out agentbridge.json
```

## What's inside

- `parseOpenApiDocument(input)` - parse a JSON string or already-parsed
  object with minimal OpenAPI shape checks.
- `generateManifestFromOpenApi(doc, options?)` - full OpenAPI 3.x to
  AgentBridge manifest generation.
- `operationToAgentAction(operation, method, path, doc, options?)` -
  convert one OpenAPI operation into an AgentBridge action.
- `inferRiskFromMethod(method)` - method-based risk classifier used by
  the generator.

## Quick example

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { generateManifestFromOpenApi } from "@marmarlabs/agentbridge-openapi";

const doc = JSON.parse(readFileSync("store.openapi.json", "utf8"));
const { manifest, warnings, skipped } = generateManifestFromOpenApi(doc, {
  baseUrl: "https://api.example.com",
});

for (const warning of warnings) console.warn(warning);
for (const operation of skipped) console.warn("skipped", operation);
writeFileSync("agentbridge.json", JSON.stringify(manifest, null, 2));
```

## Current mapping rules

The converter maps the current OpenAPI input into manifest v0.1 fields
as follows:

- `operationId` becomes the action name after snake_case
  normalization. If it is missing, the fallback is derived from
  `<method>_<path>`.
- `summary` becomes the action title.
- `description` becomes the action description; if it is missing,
  `summary` is used.
- Path and query parameters become top-level `inputSchema.properties`.
  Path parameters are always required.
- JSON object request body properties are merged into the top-level
  input schema. Non-object JSON bodies are placed under a `body` field.
- The first `200`, then any other `2xx`, then `default` JSON response
  schema becomes `outputSchema`.
- `#/components/schemas/*` refs are resolved best-effort. Cycles and
  unresolved refs become descriptive placeholder schemas.
- `info.title`, `info.version`, `info.description`, `info.contact`, and
  `servers[0].url` become top-level manifest metadata unless options
  override them.
- `security`, `securitySchemes`, `tags`, and OpenAPI `examples` are not
  converted into AgentBridge `auth`, `permissions`, resources, or action
  examples yet.

## Risk inference

| OpenAPI method | Action emitted? | Risk | requiresConfirmation |
|---|---:|---|---:|
| `GET` | yes | low | false |
| `POST` | yes | medium | true |
| `PUT` | yes | medium | true |
| `PATCH` | yes | medium | true |
| `DELETE` | yes | high | true |
| `HEAD` | no | low from `inferRiskFromMethod`, skipped by generator | n/a |
| `OPTIONS` / `TRACE` | no | skipped by generator | n/a |

Risk inference is method-based in v0.4.0. Path-based overrides,
`x-agentbridge-*` extensions, and security-scope mapping are future
stabilization work, not current behavior.

## Regression examples

The [`examples/openapi-regression`](../../examples/openapi-regression)
fixtures cover mapping behavior that should stay intentional as the
package moves toward v1.0. Generate one locally with:

```bash
node packages/cli/dist/bin.js generate openapi \
  examples/openapi-regression/catalog-regression.openapi.json \
  --out /tmp/agentbridge.openapi-regression.generated.json
```

## Status

Public release. v0.2.2 is a docs-only release that adds OpenAI Codex
onboarding alongside the existing Claude Desktop / Cursor / custom
client setup paths — no code or behavior changes since v0.2.0.
AgentBridge is suitable for local development, manifest authoring,
scanner workflows, OpenAPI import, and MCP experiments. It is not yet
production security infrastructure.

Risk heuristics may evolve between v0.x releases; always review
generated manifests before publishing. When changing converter behavior,
add or update a regression fixture so adopters can audit the new
mapping.

## License

Apache-2.0
