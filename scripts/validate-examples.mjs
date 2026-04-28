#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const cli = join(root, "packages/cli/dist/bin.js");
const tmp = mkdtempSync(join(tmpdir(), "agentbridge-validate-examples-"));

const validManifests = [
  "examples/adopter-quickstart/manifest.basic.json",
  "examples/adopter-quickstart/manifest.production-shaped.json",
  "examples/openapi-store/store.agentbridge.json",
  "examples/scanner-regression/manifest.good.json",
  "examples/scanner-regression/manifest.minimal-valid.json",
  "examples/scanner-regression/manifest.missing-confirmation.json",
  "examples/scanner-regression/manifest.origin-mismatch.json",
];

const openApiFixtures = [
  "examples/openapi-store/store.openapi.json",
  "examples/openapi-regression/catalog-regression.openapi.json",
];

function run(args, opts = {}) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    ...opts,
  });
  return res;
}

function printResult(label, res) {
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0) {
    throw new Error(`${label} failed with exit ${res.status}`);
  }
}

try {
  for (const manifest of validManifests) {
    printResult(`validate ${manifest}`, run(["validate", manifest]));
  }

  const invalid = run(["validate", "examples/scanner-regression/manifest.invalid.json"]);
  if (invalid.status === 0) {
    throw new Error("invalid scanner fixture unexpectedly passed validation");
  }
  process.stdout.write("ok invalid scanner fixture failed validation as expected\n");

  const sdk = spawnSync(
    process.execPath,
    ["--import", "tsx", "examples/sdk-basic/manifest.ts"],
    { cwd: root, encoding: "utf8" },
  );
  if (sdk.status !== 0) {
    if (sdk.stdout) process.stdout.write(sdk.stdout);
    if (sdk.stderr) process.stderr.write(sdk.stderr);
    throw new Error(`generate sdk-basic manifest failed with exit ${sdk.status}`);
  }
  const sdkOut = join(tmp, "sdk-basic.agentbridge.json");
  writeFileSync(sdkOut, sdk.stdout, "utf8");
  printResult("validate sdk-basic generated manifest", run(["validate", sdkOut]));

  for (const source of openApiFixtures) {
    const out = join(tmp, `${source.split("/").pop()}.agentbridge.json`);
    printResult(`generate openapi ${source}`, run(["generate", "openapi", source, "--out", out]));
    printResult(`validate generated ${source}`, run(["validate", out]));
  }

  const regressionOut = join(tmp, "catalog-regression.openapi.json.agentbridge.json");
  const generated = JSON.parse(readFileSync(regressionOut, "utf8"));
  if (!Array.isArray(generated.actions) || generated.actions.length === 0) {
    throw new Error("generated OpenAPI regression manifest did not include actions");
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
