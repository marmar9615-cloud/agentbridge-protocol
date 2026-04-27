import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { getAuditFilePath } from "@marmar9615-cloud/agentbridge-core";

export const dynamic = "force-dynamic";

// Local-only audit clear. Refuses to do anything if AGENTBRIDGE_ALLOW_CLEAR
// is set to "false" — gives operators a kill-switch in shared environments.
// Does not touch the schema or other AgentBridge state, just the audit file.
export async function POST() {
  if (process.env.AGENTBRIDGE_ALLOW_CLEAR === "false") {
    return NextResponse.json(
      { ok: false, error: "audit clear disabled by AGENTBRIDGE_ALLOW_CLEAR=false" },
      { status: 403 },
    );
  }
  const file = getAuditFilePath();
  try {
    await fs.unlink(file);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return NextResponse.json(
        { ok: false, error: (err as Error).message },
        { status: 500 },
      );
    }
  }
  return NextResponse.json({ ok: true, cleared: file });
}
