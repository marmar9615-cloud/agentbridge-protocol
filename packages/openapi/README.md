# @marmarlabs/agentbridge-openapi

Convert OpenAPI 3.x documents into [AgentBridge](https://github.com/marmar9615-cloud/agentbridge-protocol)
manifests. Risk levels are inferred from HTTP method, path patterns, and
operation IDs — and you can override them.

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

- `convertOpenApiToManifest(doc, options?)` — full OpenAPI 3.x → AgentBridge
  manifest conversion.
- `inferRisk(method, path, operationId?)` — heuristic risk classifier
  used internally; exported for callers that want to influence the
  classification.

## Quick example

```ts
import { readFileSync } from "node:fs";
import { convertOpenApiToManifest } from "@marmarlabs/agentbridge-openapi";

const doc = JSON.parse(readFileSync("store.openapi.json", "utf8"));
const manifest = convertOpenApiToManifest(doc, {
  baseUrl: "https://api.example.com",
});

writeFileSync("agentbridge.json", JSON.stringify(manifest, null, 2));
```

## Risk inference

| Pattern | Risk |
|---|---|
| `GET /*`, `HEAD /*` | low |
| `POST /*search*`, `POST /*query*` | low |
| `POST /*`, `PUT /*`, `PATCH /*` | medium |
| `DELETE /*` | high |
| `*/refund*`, `*/cancel*`, `*/transfer*` | high (override) |

Risk levels can be overridden per-operation via
`x-agentbridge-risk` extension on the OpenAPI operation object.

## Status

Public release. v0.2.2 is a docs-only release that adds OpenAI Codex
onboarding alongside the existing Claude Desktop / Cursor / custom
client setup paths — no code or behavior changes since v0.2.0.
AgentBridge is suitable for local development, manifest authoring,
scanner workflows, OpenAPI import, and MCP experiments. It is not yet
production security infrastructure.

Risk heuristics may evolve between v0.x releases; always review
generated manifests before publishing.

## License

Apache-2.0
