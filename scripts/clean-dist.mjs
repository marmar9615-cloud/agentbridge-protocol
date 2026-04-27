#!/usr/bin/env node
/**
 * Remove every publishable package's dist/ and tsconfig.tsbuildinfo so a
 * subsequent typecheck runs the way CI sees the repo on a fresh clone.
 *
 * This exists as a regression guard: the typecheck script must not depend
 * on dist/ artifacts. If `npm run typecheck:clean` ever fails, that's the
 * signal that a workspace package's `types`/`exports` field is being
 * resolved at typecheck time instead of via the `paths` alias in
 * tsconfig.base.json.
 */
import { rmSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");

const TARGETS = [
  "packages/core/dist",
  "packages/sdk/dist",
  "packages/scanner/dist",
  "packages/openapi/dist",
  "packages/cli/dist",
  "apps/mcp-server/dist",
  "packages/core/tsconfig.tsbuildinfo",
  "packages/sdk/tsconfig.tsbuildinfo",
  "packages/scanner/tsconfig.tsbuildinfo",
  "packages/openapi/tsconfig.tsbuildinfo",
  "packages/cli/tsconfig.tsbuildinfo",
  "apps/mcp-server/tsconfig.tsbuildinfo",
];

for (const t of TARGETS) {
  rmSync(path.join(ROOT, t), { recursive: true, force: true });
}

console.log(`[clean-dist] removed ${TARGETS.length} build artifacts`);
