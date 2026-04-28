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
