import { beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runCli } from "../index";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const coreDist = path.join(repoRoot, "packages/core/dist/index.js");
const sdkDist = path.join(repoRoot, "packages/sdk/dist/index.js");
const examplePath = path.join(repoRoot, "examples/signed-manifest-basic/manifest.ts");
const privateKeyMarkers = [
  "BEGIN PRIVATE KEY",
  "END PRIVATE KEY",
  "MC4CAQAwBQYDK2VwBCIEIKSXsEXyAP3O1L5RImgZcGDzbiKurlmgrrmR6AojVA7U",
];

function captureStdio(): {
  out: string[];
  err: string[];
  restore: () => void;
} {
  const out: string[] = [];
  const err: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    out,
    err,
    restore: () => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    },
  };
}

function runSignedExample(): string {
  const result = spawnSync(process.execPath, ["--import", "tsx", examplePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `signed-manifest-basic failed with exit ${result.status}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

function assertNoPrivateKeyMaterial(output: string): void {
  for (const marker of privateKeyMarkers) {
    expect(output).not.toContain(marker);
  }
}

describe("signed manifest example regressions", () => {
  beforeAll(() => {
    // The example imports the public workspace package names. CI runs
    // tests after typecheck:clean removes dist and before the top-level
    // build, so build just the packages needed by this example if absent.
    const currentDist =
      existsSync(coreDist) &&
      existsSync(sdkDist) &&
      readFileSync(coreDist, "utf8").includes("ManifestSignatureSchema") &&
      readFileSync(sdkDist, "utf8").includes("signManifest");
    if (currentDist) return;

    const result = spawnSync(
      "npm",
      ["run", "build", "-w", "packages/core", "-w", "packages/sdk"],
      {
        cwd: repoRoot,
        stdio: "ignore",
      },
    );
    if (result.status !== 0 || !existsSync(coreDist) || !existsSync(sdkDist)) {
      throw new Error("Failed to build dist directories needed for signed example test");
    }
  }, 90000);

  it("generates a schema-valid signed manifest without leaking private key material", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentbridge-signed-example-"));
    try {
      const raw = runSignedExample();
      assertNoPrivateKeyMaterial(raw);

      const manifest = JSON.parse(raw);
      expect(manifest.signature).toBeDefined();
      expect(manifest.signature.alg).toBe("EdDSA");
      expect(manifest.signature.kid).toBe("test-ed25519-2026-04");
      expect(manifest.signature.iss).toBe("https://projects.example.com");
      expect(manifest.signature.value).toEqual(expect.any(String));
      expect(manifest.signature.value.length).toBeGreaterThan(20);

      const outPath = path.join(tmpDir, "signed-basic.agentbridge.json");
      await fs.writeFile(outPath, raw, "utf8");

      const cap = captureStdio();
      const code = await runCli({ argv: ["validate", outPath] });
      cap.restore();

      const output = cap.out.join("") + cap.err.join("");
      expect(code).toBe(0);
      expect(output).toContain("valid manifest");
      assertNoPrivateKeyMaterial(output);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
