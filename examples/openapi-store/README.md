# OpenAPI → AgentBridge

Take an existing OpenAPI 3.x document and turn it into a draft AgentBridge
manifest.

## Files in this directory

- [`store.openapi.json`](./store.openapi.json) — sample OpenAPI document for a
  small store API.
- [`store.agentbridge.json`](./store.agentbridge.json) — the manifest the CLI
  generates from it. Checked in so you can diff against your own output.

## Generate it yourself

From the repo root:

```bash
npx @marmarlabs/agentbridge-cli generate openapi examples/openapi-store/store.openapi.json \
  --base-url https://api.acme-store.example \
  --out examples/openapi-store/store.agentbridge.json
```

The CLI applies the standard heuristics:

| OpenAPI method | Risk inferred | requiresConfirmation |
|---|---|---|
| `GET` | low | false |
| `POST` / `PUT` / `PATCH` | medium | true |
| `DELETE` | high | true |

Operation names come from `operationId` when present; otherwise they're
derived from `<method>_<path>`. Path params become required input fields.
Request body schemas are merged into the action's `inputSchema.properties`.

## After generation

1. **Review every action.** The CLI's heuristics are a starting point, not
   the final word. If a `POST` is actually idempotent and safe, downgrade it
   to `low` and drop the confirmation requirement.
2. **Add `humanReadableSummaryTemplate`s.** The CLI writes a default but
   it's rarely as good as a hand-written one.
3. **Add `examples`.** Examples dramatically improve agent invocation
   accuracy.
4. **Add `permissions[]`.** Document what scopes each action needs.
5. **Validate.** `npx @marmarlabs/agentbridge-cli validate examples/openapi-store/store.agentbridge.json`
6. **Scan the live app.** Once you serve the manifest, `npx @marmarlabs/agentbridge-cli scan
   https://your-app.com` to see the readiness score.
