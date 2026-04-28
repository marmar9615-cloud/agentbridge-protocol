# Next.js basic — AgentBridge integration

This is a documentation-style example. The full runnable demo lives at
[`apps/demo-app/`](../../apps/demo-app); the snippets here are the minimum
you need to expose AgentBridge from any existing Next.js (App Router) app.

> **Note:** `@marmarlabs/agentbridge-*` is **not yet published to
> npm** at v0.2.0-beta — the packages are publish-ready but distribution
> is source-only at this stage (see
> [docs/public-beta.md](../../docs/public-beta.md)). To run this
> walkthrough today, copy the relevant files from
> [`apps/demo-app/`](../../apps/demo-app) of your local clone and use
> workspace deps. The `npm install` line below works once the packages
> are on npm.

## 1. Install the SDK

```bash
npm install @marmarlabs/agentbridge-sdk @marmarlabs/agentbridge-core zod
```

## 2. Define your actions

Create `lib/agentbridge.ts`:

```ts
// lib/agentbridge.ts
import { defineAgentAction, createAgentBridgeManifest, z } from "@marmarlabs/agentbridge-sdk";

export const listUsers = defineAgentAction({
  name: "list_users",
  title: "List users",
  description: "Returns the list of users, optionally filtered by role.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/list_users",
  risk: "low",
  requiresConfirmation: false,
  inputSchema: z.object({
    role: z.enum(["admin", "member"]).optional(),
  }),
  outputSchema: z.object({ users: z.array(z.unknown()) }),
  examples: [{ input: {} }],
  humanReadableSummaryTemplate: "List users (role: {{role}})",
});

export const inviteUser = defineAgentAction({
  name: "invite_user",
  title: "Invite a user",
  description: "Sends an invite email to a new user. Mid-risk because it sends external email.",
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

export const ALL = { listUsers, inviteUser };

export function getManifest(baseUrl: string) {
  return createAgentBridgeManifest({
    name: "Acme App",
    description: "Internal admin surface for Acme.",
    version: "1.0.0",
    baseUrl,
    contact: "platform@acme.com",
    actions: Object.values(ALL),
  });
}
```

## 3. Serve the manifest at `/.well-known/agentbridge.json`

Next.js folders starting with `.` confuse the file watcher, so use a rewrite.

`next.config.mjs`:
```js
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

`app/api/well-known/agentbridge/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getManifest } from "../../../../lib/agentbridge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return NextResponse.json(getManifest(baseUrl));
}
```

## 4. Implement the action endpoints

`app/api/agentbridge/actions/[actionName]/route.ts`:
```ts
import { NextRequest } from "next/server";
import { createActionHandler } from "@marmarlabs/agentbridge-sdk";
import { ALL } from "../../../../lib/agentbridge";

const handlers = {
  list_users: async ({ role }: { role?: "admin" | "member" }) => {
    return { users: await db.users.findAll(role ? { where: { role } } : undefined) };
  },
  invite_user: async ({ email, role }: { email: string; role: "admin" | "member" }) => {
    const invite = await db.invites.create({ email, role });
    await sendEmail(email, "You've been invited", inviteLink(invite));
    return { inviteId: invite.id };
  },
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ actionName: string }> },
) {
  const { actionName } = await ctx.params;
  const action = (ALL as any)[camelCase(actionName)] as
    | (typeof ALL)["listUsers"]
    | undefined;
  if (!action) {
    return new Response(JSON.stringify({ ok: false, error: "unknown action" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  const handler = (handlers as any)[actionName];
  return createActionHandler(action, handler)(req);
}

function camelCase(s: string) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
```

## 5. Verify

```bash
npm run dev
curl -s http://localhost:3000/.well-known/agentbridge.json | jq .
npx @marmarlabs/agentbridge-cli scan http://localhost:3000
```

You should see your two actions, with `invite_user` flagged as medium-risk
requiring confirmation. Hook the MCP server up to your favorite agent and
the rest of the safety machinery comes along for the ride.
