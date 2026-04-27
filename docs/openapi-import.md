# Importing an OpenAPI document

If you already have an OpenAPI 3.x document for your API, the AgentBridge
CLI can generate a draft manifest in one command.

## Generate

```bash
npx @marmar9615-cloud/agentbridge-cli generate openapi ./your-api.openapi.json \
  --base-url https://api.acme.com \
  --out ./public/.well-known/agentbridge.json
```

URL inputs work too:

```bash
npx @marmar9615-cloud/agentbridge-cli generate openapi https://api.acme.com/openapi.json
```

The generator:

- Walks every operation under `paths.{path}.{method}`.
- Uses `operationId` (snake-cased) as the action name; falls back to
  `<method>_<path>` when missing.
- Merges path params, query params, and JSON `requestBody` into the
  action's `inputSchema.properties`.
- Picks the first 2xx (or `default`) JSON response as `outputSchema`.
- Resolves `#/components/schemas/X` `$ref`s.
- Inherits `info.title`, `info.version`, and `info.contact.email`.

## Risk inference

| OpenAPI method | Risk | requiresConfirmation |
|---|---|---|
| `GET` / `HEAD` | low | false |
| `POST` / `PUT` / `PATCH` | medium | true |
| `DELETE` | high | true |

This is a default — review every action and adjust where the heuristic is
wrong. A `POST /search` is conceptually a `low`-risk read; a `GET /export-all`
might be expensive and worth marking `medium`.

## What you get

```bash
$ npx @marmar9615-cloud/agentbridge-cli generate openapi packages/openapi/fixtures/simple-store.openapi.json
✓ generated manifest with 4 actions
  → agentbridge.generated.json

Next: review the generated manifest, then `agentbridge validate agentbridge.generated.json`
```

Open the file. You'll see something like:

```json
{
  "name": "Simple Store API",
  "version": "1.0.0",
  "baseUrl": "https://api.simple-store.example",
  "actions": [
    { "name": "list_products", "risk": "low", "requiresConfirmation": false, ... },
    { "name": "create_product", "risk": "medium", "requiresConfirmation": true, ... },
    { "name": "delete_product", "risk": "high", "requiresConfirmation": true, ... }
  ]
}
```

## Recommended post-generation polish

1. **Tighten descriptions.** Agent quality scales with description quality.
   Replace generic OpenAPI summaries with action-oriented prose: "Refund a
   customer order" rather than "POST /orders/{id}/refunds".
2. **Add `humanReadableSummaryTemplate`s.** The generator writes a
   placeholder; hand-written ones read much better in confirmation prompts.
3. **Add `examples[]`.** Examples dramatically improve invocation accuracy.
4. **Add `permissions[]`.** Document required scopes for each action.
5. **Validate.** `npx @marmar9615-cloud/agentbridge-cli validate ./your.agentbridge.json`
6. **Scan the live app.** Once you serve the manifest, `npx @marmar9615-cloud/agentbridge-cli scan
   https://your-app.com` to see the readiness score.

## Limitations

- Only JSON request/response bodies are mapped. `multipart/form-data`,
  `application/x-www-form-urlencoded`, and binary endpoints aren't
  generated as actions.
- `OPTIONS`, `HEAD`, `TRACE` are skipped (reported in `skipped[]`).
- Cyclic `$ref`s are flagged with a `description` placeholder rather than
  resolved infinitely.
- OpenAPI 2.0 (Swagger) isn't supported — convert it to 3.0 first.
