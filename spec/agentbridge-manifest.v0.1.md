# AgentBridge Manifest Specification

**Version:** 0.1
**Status:** Draft
**Discovery path:** `/.well-known/agentbridge.json`

## Purpose

The AgentBridge manifest is a machine-readable description of structured actions a web app exposes to AI agents. It exists so agents don't have to drive a UI built for human eyes — the app declares what it actually *does*, semantically, with types, risk metadata, and confirmation requirements.

## Discovery

A compliant app SHOULD serve its manifest at:

```
https://<host>/.well-known/agentbridge.json
```

The response MUST be `application/json`. Agents and tooling locate the manifest by appending `/.well-known/agentbridge.json` to the app's origin.

## Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Human-readable name of the surface. |
| `description` | string | no | One-paragraph summary of what agents can do here. |
| `version` | string | yes | Semver version. Bump on action additions, removals, or schema changes. |
| `baseUrl` | URL | yes | Canonical origin agents should call. **All action endpoints must share this origin.** |
| `contact` | string | no | Email or URL for the publisher. |
| `auth` | object | no | How agents authenticate (see below). |
| `resources` | array | no | Conceptual data resources. Documentation, not enforcement. |
| `actions` | array | no | The structured operations agents can invoke. |
| `generatedAt` | ISO timestamp | no | When the manifest was last generated. |

## Action fields

Each entry in `actions[]` describes one callable operation.

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string (snake_case) | yes | Stable machine identifier. Treat as part of your public API. |
| `title` | string | yes | Short human-readable title. |
| `description` | string | yes | Agent-friendly description — WHEN should an agent call this? |
| `inputSchema` | JSON Schema | yes | Should be `type: "object"` with explicit `properties`. |
| `outputSchema` | JSON Schema | no | Strongly encouraged so agents know what to expect. |
| `method` | enum | yes | HTTP method: `GET` / `POST` / `PUT` / `PATCH` / `DELETE`. |
| `endpoint` | string | yes | Path under `baseUrl` where the action is invoked. |
| `risk` | enum | yes | `low` / `medium` / `high`. |
| `requiresConfirmation` | boolean | yes | If true, the MCP layer requires explicit human approval. |
| `permissions` | PermissionPolicy[] | no | Scopes the agent must hold. |
| `examples` | ActionExample[] | no | Sample invocations agents can learn from. |
| `humanReadableSummaryTemplate` | string | no | Template with `{{key}}` placeholders for natural-language confirmation prompts. |

### Risk levels

| Level | When to use | Confirmation expected? |
|---|---|---|
| `low` | Read-only, safe, idempotent. `GET` operations. Listing, reading, searching. | No. |
| `medium` | Mutates app state but reversible or auditable. Creating drafts, adding notes, tagging. | Yes — `requiresConfirmation: true`. |
| `high` | Irreversible, financially significant, or affects other users. Executing payments, deleting data, sending external messages. | Yes — `requiresConfirmation: true` is mandatory. |

The scanner deducts points and the MCP server refuses to execute high-risk actions without `requiresConfirmation: true`.

### Confirmation rules

An action with `requiresConfirmation: true` MUST be invoked by the MCP server in two steps:

1. **First call** — agent invokes the action without `confirmationApproved`. The server responds with `{ status: "confirmationRequired", summary, confirmationToken }` and does NOT call the upstream endpoint.
2. **Second call** — agent presents the summary to a human, then re-invokes with `confirmationApproved: true` AND `confirmationToken: "<token-from-first-call>"`.

Tokens are bound to `(url, actionName, hash(input))` and expire (default 5 minutes). A token cannot be reused with different input, and an expired token fails.

### Permission policies

`permissions` is an array of `{ scope: string, description?: string }`. Scope strings are free-form but should follow `<resource>:<verb>` convention (e.g. `orders:write`, `tickets:resolve`). They are documentation today; production deployments enforce them in the MCP transport.

### Human-readable summaries

`humanReadableSummaryTemplate` accepts `{{key}}` placeholders that are filled from the action's input at confirmation time. Dotted lookups are supported (`{{order.id}}`).

Examples:

| Template | Input | Renders as |
|---|---|---|
| `"List orders (status: {{status}})"` | `{ status: "shipped" }` | `"List orders (status: shipped)"` |
| `"Refund ${{amount}} on order {{orderId}}"` | `{ amount: 24, orderId: "ORD-1001" }` | `"Refund $24 on order ORD-1001"` |
| `"Delete ticket {{id}}"` | `{}` | `"Delete ticket <unknown>"` |

Missing keys render as `<unknown>`. Object values render as JSON.

### Input/output schemas

Both `inputSchema` and `outputSchema` are JSON Schema documents (any draft compatible with [Ajv](https://ajv.js.org/) `strict: false`). The MVP validator ([`@marmarlabs/agentbridge-sdk`](../packages/sdk)) accepts a Zod schema and converts it via [`zod-to-json-schema`](https://github.com/StefanTerdell/zod-to-json-schema), but raw JSON Schema is equally valid.

### Examples

```json
"examples": [
  { "description": "List shipped orders", "input": { "status": "shipped" } },
  { "input": {}, "output": { "orders": [] } }
]
```

Agents use examples to learn correct call shapes, especially when an action has many optional fields.

## Resource fields

Resources are documentation. They tell an agent "this app has orders, customers, tickets" so the agent can build a mental model.

```json
"resources": [
  { "name": "orders", "description": "Customer orders.", "url": "/orders" }
]
```

## Auth field

```json
"auth": {
  "type": "none" | "bearer" | "oauth2" | "api_key",
  "description": "free-form note for agent operators"
}
```

The MVP serves manifests as `auth: { type: "none" }`. Production deployments should declare the real auth surface so agents and operators can configure credentials.

## Signature field (optional, v0.5.0+)

A manifest MAY carry an inline `signature` block proving the publisher
authored the bytes. The signed payload is the canonical-JSON
([RFC 8785, JCS](https://www.rfc-editor.org/rfc/rfc8785)) of the
manifest **with the `signature` field stripped**. Adding the field is
non-breaking — readers that don't understand `signature` still validate
the rest of the manifest against this v0.1 spec, and unsigned manifests
remain valid.

```json
"signature": {
  "alg": "EdDSA",
  "kid": "acme-orders-2026-04",
  "iss": "https://orders.acme.example",
  "signedAt": "2026-04-28T12:00:00Z",
  "expiresAt": "2026-04-29T12:00:00Z",
  "value": "BASE64URL(...)"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `alg` | enum | yes | `EdDSA` (Ed25519, default) or `ES256` (ECDSA on P-256). |
| `kid` | string | yes | Key id matching an entry in the publisher's key set. |
| `iss` | URL | yes | Canonical publisher origin (`scheme://host[:port]`, no path/query/fragment). MUST equal the manifest's `baseUrl` origin. |
| `signedAt` | ISO datetime | yes | When the signature was produced. UTC recommended. |
| `expiresAt` | ISO datetime | yes | When the signature becomes stale. MUST be > `signedAt`. |
| `value` | base64url | yes | Signature bytes per `alg`, base64url-encoded ([RFC 4648 §5](https://www.rfc-editor.org/rfc/rfc4648#section-5)). |

**Optional in v0.5.0.** Sign / verify runtime APIs ship in subsequent
v0.5.0 PRs. Until then, the manifest schema simply accepts the field
when present. Unsigned manifests continue to validate exactly as in
v0.4.x.

**Verification is additive.** Even when a manifest is verified, it is
still subject to the existing AgentBridge controls — confirmation gate
for risky actions, origin pinning to `baseUrl`, the outbound
target-origin allowlist (`AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`), audit
redaction, stdio stdout hygiene, and the HTTP transport's auth /
Origin allowlist. A signature confirms publisher; it never authorizes
an action on its own.

The publisher hosts a key set at `/.well-known/agentbridge-keys.json`
(canonical schema lives in
[`packages/core/src/signing/schemas.ts`](../packages/core/src/signing/schemas.ts)
and the full design is in
[`docs/designs/signed-manifests.md`](../docs/designs/signed-manifests.md)).
A formal JSON Schema for the key set will land alongside the verifier.

## Security considerations

| Threat | Mitigation declared by manifest | Enforcement |
|---|---|---|
| Agent invokes destructive action without intent | `risk: "high"` + `requiresConfirmation: true` | MCP server's confirmation gate. |
| Manifest is poisoned and redirects calls elsewhere | Action `endpoint` paths are relative to `baseUrl` | MCP server's origin pinning. |
| Agent operator misunderstands an action | `humanReadableSummaryTemplate` + `description` + `examples` | Surfaced in confirmation prompts. |
| Agent floods the upstream | `permissions[]` declares scopes for rate-limit policy | Upstream policy / future spec. |

The manifest is **declarative**. The MCP server (and the publisher's own infrastructure) is responsible for enforcement. A manifest that declares `requiresConfirmation: true` does not by itself prevent direct HTTP calls — it tells AgentBridge-aware tooling to gate the action.

## Versioning

- The manifest's `version` field is the **app's** semver. Bump on:
  - Adding an action (minor)
  - Removing an action (major)
  - Changing input/output schema in a non-additive way (major)
  - Changing risk level or `requiresConfirmation` (minor)
- The **manifest spec** itself is versioned separately. This document describes spec v0.1.
- Manifests SHOULD include `generatedAt` so downstream caches can prefer fresh copies.

## Compatibility

- The JSON Schema for this spec is [`agentbridge-manifest.schema.json`](./agentbridge-manifest.schema.json).
- A reference TypeScript implementation lives in [`packages/core`](../packages/core).
- Examples: [`examples/`](./examples/).

## Future direction

- **Signed manifests** so agents can verify the publisher offline.
- **Richer risk taxonomy** beyond `low | medium | high` (e.g. `read`, `write-self`, `write-others`, `financial`, `irreversible`).
- **Policy primitives** in the manifest itself: cost caps, rate limits, business-hours gating, N-of-M approver workflows.
- **Cross-app workflow declarations** so agents can compose actions across surfaces.
