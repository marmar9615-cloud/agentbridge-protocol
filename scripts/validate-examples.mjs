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

const testPrivateKeyMarkers = [
  "BEGIN PRIVATE KEY",
  "END PRIVATE KEY",
  "MC4CAQAwBQYDK2VwBCIEIKSXsEXyAP3O1L5RImgZcGDzbiKurlmgrrmR6AojVA7U",
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

function runTsxExample(label, source, outName) {
  const res = spawnSync(process.execPath, ["--import", "tsx", source], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    throw new Error(`generate ${label} manifest failed with exit ${res.status}`);
  }
  const out = join(tmp, outName);
  writeFileSync(out, res.stdout, "utf8");
  return { out, raw: res.stdout, manifest: JSON.parse(res.stdout) };
}

function assertNoPrivateKeyMaterial(label, raw) {
  for (const marker of testPrivateKeyMarkers) {
    if (raw.includes(marker)) {
      throw new Error(`${label} output leaked private key material`);
    }
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

  const sdk = runTsxExample(
    "sdk-basic",
    "examples/sdk-basic/manifest.ts",
    "sdk-basic.agentbridge.json",
  );
  printResult("validate sdk-basic generated manifest", run(["validate", sdk.out]));

  const signed = runTsxExample(
    "signed-manifest-basic",
    "examples/signed-manifest-basic/manifest.ts",
    "signed-basic.agentbridge.json",
  );
  printResult("validate signed-manifest-basic generated manifest", run(["validate", signed.out]));
  assertNoPrivateKeyMaterial("signed-manifest-basic", signed.raw);
  if (!signed.manifest.signature || typeof signed.manifest.signature !== "object") {
    throw new Error("signed-manifest-basic output did not include a signature block");
  }
  if (signed.manifest.signature.alg !== "EdDSA") {
    throw new Error("signed-manifest-basic signature.alg was not EdDSA");
  }
  if (!signed.manifest.signature.kid) {
    throw new Error("signed-manifest-basic signature.kid was missing");
  }
  if (!signed.manifest.signature.value) {
    throw new Error("signed-manifest-basic signature.value was missing");
  }

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
