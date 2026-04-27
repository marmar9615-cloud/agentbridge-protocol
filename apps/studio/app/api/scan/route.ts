import { NextRequest, NextResponse } from "next/server";
import { scanUrl } from "@marmar9615-cloud/agentbridge-scanner";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ ok: false, error: "missing url query param" }, { status: 400 });
  }
  try {
    const result = await scanUrl(url);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}
