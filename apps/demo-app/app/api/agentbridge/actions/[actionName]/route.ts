import { NextRequest } from "next/server";
import { getActionHandlerByName } from "../../../../../lib/actions";

// PROD: this endpoint would enforce auth (bearer/OAuth), rate limit, and
// require the caller to present a per-action permission scope. The demo
// trusts the caller — confirmation enforcement happens upstream in the
// MCP server and the studio's Try flow.

export async function POST(req: NextRequest, ctx: { params: Promise<{ actionName: string }> }) {
  const { actionName } = await ctx.params;
  const handler = getActionHandlerByName(actionName);
  if (!handler) {
    return new Response(
      JSON.stringify({ ok: false, error: `Unknown action: ${actionName}` }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }
  return handler(req);
}

// list_orders & get_order are conceptually GET-able but the manifest declares
// them as POST so a single endpoint shape works for all actions. Allow GET
// here too for convenience when poking with curl.
export async function GET(req: NextRequest, ctx: { params: Promise<{ actionName: string }> }) {
  return POST(req, ctx);
}
