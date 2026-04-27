#!/usr/bin/env node
/**
 * Validate that each publishable package produces a sensible npm tarball.
 *
 * Runs `npm pack --dry-run --json` per workspace and asserts:
 *   - dist/index.js, dist/index.d.ts, package.json, README.md, LICENSE present
 *   - src/, *.test.ts, tsconfig.json, *.tsbuildinfo NOT present
 *
 * Exits non-zero on any violation. Prints a per-package summary table.
 */
import { execSync } from "node:child_process";

const PACKAGES = [
  "packages/core",
  "packages/sdk",
  "packages/scanner",
  "packages/openapi",
  "packages/cli",
  "apps/mcp-server",
];

const REQUIRED_SUFFIXES = [
  "dist/index.js",
  "dist/index.d.ts",
  "package.json",
  "README.md",
  "LICENSE",
];

const FORBIDDEN_PATTERNS = [
  /\.test\.ts$/,
  /^src\//,
  /\/src\//,
  /tsconfig.*\.json$/,
  /\.tsbuildinfo$/,
];

let failed = 0;
const rows = [];

for (const pkg of PACKAGES) {
  let json;
  try {
    const out = execSync(`npm pack --dry-run --json -w ${pkg}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    json = JSON.parse(out);
  } catch (err) {
    console.error(`FAIL ${pkg}: npm pack --dry-run failed`);
    console.error(err.stderr?.toString() ?? err.message);
    failed++;
    continue;
  }

  const entry = Array.isArray(json) ? json[0] : json;
  if (!entry || !Array.isArray(entry.files)) {
    console.error(`FAIL ${pkg}: unexpected npm pack JSON shape`);
    failed++;
    continue;
  }

  const fileNames = entry.files.map((f) => f.path);
  const violations = [];

  for (const suffix of REQUIRED_SUFFIXES) {
    if (!fileNames.some((f) => f === suffix || f.endsWith("/" + suffix))) {
      violations.push(`missing required: ${suffix}`);
    }
  }

  for (const f of fileNames) {
    for (const pat of FORBIDDEN_PATTERNS) {
      if (pat.test(f)) {
        violations.push(`forbidden file: ${f}`);
        break;
      }
    }
  }

  // CLI/MCP server: bin file should exist
  if (pkg === "packages/cli" && !fileNames.some((f) => f.endsWith("dist/bin.js"))) {
    violations.push("missing bin: dist/bin.js");
  }

  rows.push({
    pkg: entry.name ?? pkg,
    version: entry.version ?? "?",
    files: entry.files.length,
    sizeKB: entry.size ? (entry.size / 1024).toFixed(1) : "?",
    unpackedKB: entry.unpackedSize ? (entry.unpackedSize / 1024).toFixed(1) : "?",
    status: violations.length === 0 ? "OK" : "FAIL",
  });

  if (violations.length > 0) {
    console.error(`\nFAIL ${entry.name ?? pkg}`);
    for (const v of violations) console.error(`  - ${v}`);
    failed++;
  }
}

console.log("\nPackage tarball summary");
console.log("=======================");
const w = (s, n) => String(s).padEnd(n);
console.log(
  `${w("name", 48)} ${w("version", 10)} ${w("files", 6)} ${w("packed", 10)} ${w("unpacked", 10)} status`,
);
console.log(`${"-".repeat(48)} ${"-".repeat(10)} ${"-".repeat(6)} ${"-".repeat(10)} ${"-".repeat(10)} ------`);
for (const r of rows) {
  console.log(
    `${w(r.pkg, 48)} ${w(r.version, 10)} ${w(r.files, 6)} ${w(r.sizeKB + "KB", 10)} ${w(r.unpackedKB + "KB", 10)} ${r.status}`,
  );
}

if (failed > 0) {
  console.error(`\n${failed} package(s) failed pack-check.`);
  process.exit(1);
}

console.log("\nAll packages OK.");
