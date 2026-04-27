import { NextRequest, NextResponse } from "next/server";
import { readAuditEvents } from "@marmar9615-cloud/agentbridge-core";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? undefined;
  const events = await readAuditEvents({ url, limit: 100 });
  return NextResponse.json({ ok: true, events });
}
