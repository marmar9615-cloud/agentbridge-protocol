import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      );
      if (pkg.name === "agentbridge") return dir;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export async function GET() {
  const repo = findRepoRoot();
  const file = path.join(repo, "spec", "agentbridge-manifest.schema.json");
  const raw = readFileSync(file, "utf8");
  return new Response(raw, {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
