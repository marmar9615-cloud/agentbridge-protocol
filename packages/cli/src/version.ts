import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// CLI version is sourced from this package's package.json so a single bump
// updates all surfaces.
export function getCliVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
