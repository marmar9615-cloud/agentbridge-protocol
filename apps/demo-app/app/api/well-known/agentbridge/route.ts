import { NextRequest, NextResponse } from "next/server";
import { getDemoManifest } from "../../../../lib/manifest";

// Served at /.well-known/agentbridge.json via the rewrite in next.config.mjs.
// This is the discovery endpoint AI agents look for.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const manifest = getDemoManifest(baseUrl);
  return NextResponse.json(manifest, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
    },
  });
}
