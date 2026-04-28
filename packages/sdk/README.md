# @marmarlabs/agentbridge-sdk

SDK for declaring [AgentBridge](https://github.com/marmar9615-cloud/agentbridge-protocol)
actions and emitting AgentBridge manifests in any JavaScript/TypeScript
app.

Use this if you have a Next.js / Express / Hono / Fastify app and want
AI agents to call its actions safely.

## Install

```bash
npm install @marmarlabs/agentbridge-sdk @marmarlabs/agentbridge-core zod
```

## What's inside

- `defineAgentAction(spec)` — Zod-first action definition. Compiles your
  Zod input/output schemas into JSON Schema for the manifest while
  keeping full type inference at the call site.
- `createAgentBridgeManifest(spec)` — assemble a full manifest from a
  list of actions.
- `createActionHandler(action, handler)` — wraps a Next.js / Express
  handler with input validation against the declared schema.
- `validateActionInput(action, input)` — validate unknown input against
  an action's runtime validator.
- `z` — re-export of zod for convenience.
- **Signed-manifest helpers (v0.5.0, additive).**
  - `signManifest(manifest, options)` — return a NEW manifest with an
    inline `signature` block. The input is never mutated.
  - `createSignedManifest(config, options)` — convenience: build a
    manifest with `createAgentBridgeManifest`, then sign it.
  - **Sign / verify enforcement is not in this package yet.** The
    verifier and the MCP server / scanner / CLI signature checks ship
    in subsequent v0.5.0 PRs. Until then, unsigned manifests continue
    to validate exactly as in v0.4.x.

## Quick example

```ts
import {
  defineAgentAction,
  createAgentBridgeManifest,
  z,
} from "@marmarlabs/agentbridge-sdk";

export const inviteUser = defineAgentAction({
  name: "invite_user",
  title: "Invite a user",
  description: "Sends an invite email to a new user.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/invite_user",
  risk: "medium",
  requiresConfirmation: true,
  inputSchema: z.object({
    email: z.string().email(),
    role: z.enum(["admin", "member"]),
  }),
  outputSchema: z.object({ inviteId: z.string() }),
  permissions: [{ scope: "users:invite" }],
  examples: [{ input: { email: "alice@example.com", role: "member" } }],
  humanReadableSummaryTemplate: "Invite {{email}} as {{role}}",
});

export const manifest = createAgentBridgeManifest({
  name: "Acme",
  version: "1.0.0",
  baseUrl: "https://acme.example",
  contact: "platform@acme.example",
  actions: [inviteUser],
});
```

See [`examples/nextjs-basic`](https://github.com/marmar9615-cloud/agentbridge-protocol/tree/main/examples/nextjs-basic)
for a complete Next.js integration walkthrough.

## Signing manifests (v0.5.0)

`signManifest()` attaches an inline signature block to a manifest so
agents can later verify it came from the publisher. The signed payload
is the manifest with the `signature` field stripped, run through the
[RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785) canonicalizer
shipped in `@marmarlabs/agentbridge-core`.

```ts
import { generateKeyPairSync } from "node:crypto";
import { createSignedManifest, defineAgentAction, z } from "@marmarlabs/agentbridge-sdk";

const { privateKey } = generateKeyPairSync("ed25519");

const signed = createSignedManifest(
  {
    name: "Acme Orders",
    version: "1.4.2",
    baseUrl: "https://orders.acme.example",
    actions: [/* ...defineAgentAction calls */],
  },
  {
    kid: "acme-orders-2026-04",
    privateKey,             // KeyObject, PEM string, or PEM Buffer
    // alg defaults to "EdDSA"; pass "ES256" for ECDSA P-256.
    // issuer defaults to new URL(manifest.baseUrl).origin.
    // signedAt defaults to new Date().
    // expiresAt defaults to signedAt + 24h. expiresInSeconds is also accepted.
  },
);
// signed.signature now carries { alg, kid, iss, signedAt, expiresAt, value }.
```

Algorithms:

- **`EdDSA`** (Ed25519) — default. Built into Node `crypto`,
  deterministic, 64-byte signature. Recommended.
- **`ES256`** (ECDSA P-256, SHA-256) — accepted for HSM/KMS-bound
  publishers. Output is the raw `r||s` form (matching JWS ES256), not
  DER-encoded.

Private key inputs:

- A Node [`KeyObject`](https://nodejs.org/api/crypto.html#class-keyobject)
  (recommended in production — created from your KMS / HSM out of band).
- A PEM-encoded string.
- A `Buffer` containing PEM bytes.

Raw 32-byte Ed25519 seeds are not supported in this PR — the PKCS#8
conversion path is non-trivial. Wrap a seed with your own adapter and
pass the resulting `KeyObject`.

> ⚠️ **Private keys never belong inside a manifest.** Keep the
> manifest at `/.well-known/agentbridge.json` public; keep the signing
> key in your KMS / HSM / sealed secrets store. The signature block
> only carries the **public-key id (`kid`)** and the **signature
> bytes**.

> 🔭 **Verifier and runtime enforcement are planned follow-ups.** This
> PR ships the publisher-side signer only. The verifier
> (`verifyManifestSignature`) lands in a later v0.5.0 PR, followed by
> scanner signature checks, MCP server enforcement, and a CLI
> `--require-signature` flag. Until then, **unsigned manifests
> continue to validate exactly as in v0.4.x** — adopters can roll out
> signing at their own pace.

## Public API contract

The v0.x SDK public surface is intentionally small:

- `defineAgentAction`
- `createAgentBridgeManifest`
- `createActionHandler`
- `validateActionInput`
- `z`

The contract tests in
[`packages/sdk/src/tests/public-api-contract.test.ts`](https://github.com/marmar9615-cloud/agentbridge-protocol/tree/main/packages/sdk/src/tests/public-api-contract.test.ts)
pin the runtime behavior adopters rely on: action metadata preservation,
Zod-to-JSON-Schema manifest output, manifest validation through
`@marmarlabs/agentbridge-core`, handler input validation, structured
JSON success/error responses, and the `z` re-export.

For a small module-style example, see
[`examples/sdk-basic`](https://github.com/marmar9615-cloud/agentbridge-protocol/tree/main/examples/sdk-basic).

## Status

Public release. v0.2.2 is a docs-only release that adds OpenAI Codex
onboarding alongside the existing Claude Desktop / Cursor / custom
client setup paths — no code or behavior changes since v0.2.0.
AgentBridge is suitable for local development, manifest authoring,
scanner workflows, OpenAPI import, and MCP experiments. It is not yet
production security infrastructure.

The SDK surface is intentionally small and stable for the v0.x line.

## License

Apache-2.0
