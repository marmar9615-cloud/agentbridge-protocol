# OpenAPI regression fixtures

These fixtures exercise the OpenAPI to AgentBridge converter across
edge cases that matter for API stability on the road to v1.0.

| File | What it covers |
|---|---|
| [`catalog-regression.openapi.json`](./catalog-regression.openapi.json) | OperationId normalization, fallback names, query/path parameters, JSON request bodies, nested object/array/enum schemas, response schema selection, skipped `HEAD`, and currently advisory security metadata. |

Generate a draft manifest from the fixture:

```bash
node packages/cli/dist/bin.js generate openapi \
  examples/openapi-regression/catalog-regression.openapi.json \
  --out /tmp/agentbridge.openapi-regression.generated.json
```

Then validate the generated manifest:

```bash
node packages/cli/dist/bin.js validate /tmp/agentbridge.openapi-regression.generated.json
```

The fixture intentionally includes OpenAPI `security`, `tags`, and
`examples` metadata. The current converter does not turn those into
AgentBridge `auth`, `permissions`, or action `examples`; the tests lock
that behavior so future support can be added intentionally.
