# Adopter quickstart

This guide is for developers adding AgentBridge to an existing web
app. It focuses on the shipped v0.3.0 path: publish a manifest at
`/.well-known/agentbridge.json`, expose action endpoints under your
own app origin, validate with the CLI, and connect the stdio MCP
server to your agent client.

AgentBridge is useful today for local development, staging experiments,
manifest authoring, scanner workflows, and controlled internal
prototypes. It is not a v1.0 production security boundary yet; see
[production-readiness.md](production-readiness.md) and
[v1-readiness.md](v1-readiness.md) before putting it in front of real
customer, financial, or administrative actions.

## 1. What you are adding

An AgentBridge integration has three pieces:

- A machine-readable manifest at `/.well-known/agentbridge.json`.
- One HTTP endpoint per action, under the same origin as the
  manifest's `baseUrl`.
- Optional MCP client wiring so an agent can discover, validate, and
  call the actions through the AgentBridge MCP server.

The manifest is declarative. It tells agents what actions exist, what
input/output shape each action expects, how risky the action is, and
whether a human confirmation is required. The MCP server enforces the
confirmation gate for medium/high-risk actions, pins outbound action
calls to the manifest origin, records audit events, and redacts common
secret fields before writing logs.

## 2. Install packages

Install the SDK and core contract package in your app:

```bash
npm install @marmarlabs/agentbridge-sdk @marmarlabs/agentbridge-core
```

The SDK re-exports `z` from Zod, so the examples below do not require a
separate import.

## 3. Create your first manifest

Create a small AgentBridge module near your app's server code:

```ts
// lib/agentbridge.ts
import {
  defineAgentAction,
  createAgentBridgeManifest,
  z,
} from "@marmarlabs/agentbridge-sdk";

export const listOrders = defineAgentAction({
  name: "list_orders",
  title: "List orders",
  description: "Returns recent orders, optionally filtered by status.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/list_orders",
  risk: "low",
  requiresConfirmation: false,
  inputSchema: z.object({
    status: z.enum(["pending", "shipped", "delivered", "refunded"]).optional(),
  }),
  outputSchema: z.object({ orders: z.array(z.unknown()) }),
  examples: [{ description: "All orders", input: {} }],
  humanReadableSummaryTemplate: "List orders (status: {{status}})",
});

export const draftRefundOrder = defineAgentAction({
  name: "draft_refund_order",
  title: "Draft a refund",
  description:
    "Creates a refund draft for review. It does not execute money movement.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/draft_refund_order",
  risk: "medium",
  requiresConfirmation: true,
  inputSchema: z.object({
    orderId: z.string().min(1),
    amount: z.number().positive(),
    reason: z.string().min(3),
  }),
  outputSchema: z.object({
    draftId: z.string(),
    summary: z.string(),
  }),
  permissions: [{ scope: "refunds:draft" }],
  examples: [
    {
      description: "Damaged item",
      input: { orderId: "ORD-1001", amount: 24, reason: "Damaged on arrival" },
    },
  ],
  humanReadableSummaryTemplate:
    "Draft a ${{amount}} refund on order {{orderId}} (reason: {{reason}})",
});

export const actions = {
  list_orders: listOrders,
  draft_refund_order: draftRefundOrder,
};

export function getAgentBridgeManifest(baseUrl: string) {
  return createAgentBridgeManifest({
    name: "Acme Admin",
    description: "Structured actions for Acme's internal order tools.",
    version: "1.0.0",
    baseUrl,
    contact: "platform@example.com",
    auth: {
      type: "bearer",
      description: "Use the same app authentication as the operator session.",
    },
    resources: [
      {
        name: "orders",
        description: "Customer orders, fulfillment status, notes, and refunds.",
        url: "/orders",
      },
    ],
    actions: Object.values(actions),
  });
}
```

Keep action names stable and snake_case. Treat them like a public API
for agents.

## 4. Add a .well-known route

Serve the manifest at exactly `/.well-known/agentbridge.json`.

For Next.js App Router, a common pattern is to route through an API
handler:

```ts
// app/api/well-known/agentbridge/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAgentBridgeManifest } from "../../../../lib/agentbridge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return NextResponse.json(getAgentBridgeManifest(baseUrl));
}
```

Then add a rewrite if your framework has trouble watching directories
whose names start with a dot:

```js
// next.config.mjs
export default {
  async rewrites() {
    return [
      {
        source: "/.well-known/agentbridge.json",
        destination: "/api/well-known/agentbridge",
      },
    ];
  },
};
```

The manifest's `baseUrl` should match the app origin that serves the
manifest. Action endpoints should be paths under that same origin.

## 5. Define safe actions

Design each action as a small, typed operation:

- Read actions should be `risk: "low"` and
  `requiresConfirmation: false`.
- Reversible mutations, drafts, notes, and tags should usually be
  `risk: "medium"` and `requiresConfirmation: true`.
- Irreversible, externally visible, destructive, privileged, or
  financial actions should be `risk: "high"` and
  `requiresConfirmation: true`.
- Destructive actions should be idempotent. If the action is called
  twice with the same intent, it should not double-charge, double-send,
  or double-delete. When calling through MCP, pass an `idempotencyKey`
  to `call_action` for retried risky operations.
- Every action should declare clear `inputSchema`, `outputSchema`,
  `description`, `examples`, and a
  `humanReadableSummaryTemplate`.

Never expose secrets in action output. Do not return access tokens,
session cookies, private API keys, password reset links, or raw
authorization headers.

## 6. Confirmation policy examples

Read-only list action:

```json
{
  "name": "list_orders",
  "risk": "low",
  "requiresConfirmation": false
}
```

Medium-risk draft action:

```json
{
  "name": "draft_refund_order",
  "risk": "medium",
  "requiresConfirmation": true,
  "humanReadableSummaryTemplate": "Draft a ${{amount}} refund on order {{orderId}}"
}
```

High-risk destructive action:

```json
{
  "name": "delete_project",
  "risk": "high",
  "requiresConfirmation": true,
  "humanReadableSummaryTemplate": "DELETE project {{projectId}}"
}
```

When an MCP client first calls a confirmation-required action, the MCP
server returns `confirmationRequired` with a single-use,
input-bound `confirmationToken`. The action endpoint is not called
until the client re-calls with `confirmationApproved: true` and that
same token.

Low-risk read actions may run directly. Medium/high-risk actions should
require confirmation. High-risk actions without confirmation are a
scanner finding and should be treated as a bug.

## 7. Local validation with CLI

If you are writing a static manifest into `public/.well-known`, validate
the file directly:

```bash
npx @marmarlabs/agentbridge-cli validate ./public/.well-known/agentbridge.json
```

If your framework generates the manifest dynamically, start the app and
validate the URL:

```bash
npm run dev
npx @marmarlabs/agentbridge-cli validate http://localhost:3000
```

Fix validation errors before connecting an MCP client. The CLI uses the
same core manifest contract as the SDK and MCP server.

## 8. Agent-readiness scan

Run the scanner against the app origin:

```bash
npx @marmarlabs/agentbridge-cli scan http://localhost:3000
```

The scan reports a 0-100 readiness score, structured checks, and
recommendations. Common findings include missing confirmation on risky
actions, weak descriptions, missing examples, no contact field, or
cross-origin action endpoints.

## 9. MCP client setup

The shipped MCP package currently speaks stdio:

```bash
npx -y @marmarlabs/agentbridge-mcp-server
```

Add that command to OpenAI Codex, Claude Desktop, Cursor, or another
stdio-capable MCP client. The helper command prints copy-pasteable
snippets:

```bash
npx @marmarlabs/agentbridge-cli mcp-config
```

For a remote or production-like target, pin the exact target origin:

```bash
AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://app.example.com \
  npx -y @marmarlabs/agentbridge-mcp-server
```

The v0.4.0 HTTP MCP transport is designed, but it is not implemented in
the current shipped package. Do not configure clients as if
AgentBridge already exposes an HTTP MCP endpoint unless you are working
on a future implementation branch.

## 10. Production safety checklist

Before using AgentBridge outside local development:

- Set `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` to exact app origins. Avoid
  `AGENTBRIDGE_ALLOW_REMOTE=true` except for ad-hoc testing.
- Keep the MCP server loopback-only unless you are deliberately working
  on the future HTTP transport line.
- Ensure `baseUrl` matches your app origin and every action endpoint is
  same-origin.
- Require confirmation for every medium/high-risk action.
- Make destructive actions idempotent and audit-friendly.
- Keep secrets out of action inputs, outputs, descriptions, examples,
  and audit-visible fields.
- Do not use query-string tokens. Use headers or your app's normal
  authentication model.
- Declare `auth`, `contact`, `permissions`, and resources so operators
  understand the trust boundary.
- Test the confirmation flow end to end before allowing risky actions.
- Read [production-readiness.md](production-readiness.md) before
  handling real customer, admin, or financial workflows.

## 11. Common mistakes

- Publishing the manifest at the wrong path. Tooling expects
  `/.well-known/agentbridge.json`.
- Setting `baseUrl` to one origin and action endpoints to another.
  Origin pinning rejects that.
- Marking a mutation as `low` risk because it is convenient for demos.
- Forgetting `requiresConfirmation: true` on medium/high-risk actions.
- Returning raw secrets, signed URLs, cookies, or access tokens from an
  action.
- Putting credentials in query strings.
- Omitting examples and summary templates. Agents perform better with
  concrete call shapes and human-readable confirmation text.
- Treating `permissions[]` as enforced by v0.3.0. They are advisory
  metadata today; enforce authorization in your app endpoints.
- Assuming HTTP MCP transport has shipped. The current npm MCP server is
  stdio; HTTP transport is the v0.4.0 track.

## 12. Next steps

- Use [manifest-patterns.md](manifest-patterns.md) for reusable action
  design patterns.
- Compare against
  [examples/adopter-quickstart](../examples/adopter-quickstart).
- Walk through [examples/nextjs-basic](../examples/nextjs-basic) for a
  framework-specific integration.
- If you already have OpenAPI, generate a draft with
  [openapi-import.md](openapi-import.md), then manually review risk,
  confirmation, examples, and summaries.
- Connect an MCP client with
  [mcp-client-setup.md](mcp-client-setup.md) or
  [codex-setup.md](codex-setup.md).
