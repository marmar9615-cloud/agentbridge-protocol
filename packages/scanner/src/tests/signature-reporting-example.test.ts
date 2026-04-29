import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const examplePath = path.join(repoRoot, "examples/scanner-signature-reporting/reporting.ts");
const readmePath = path.join(repoRoot, "examples/scanner-signature-reporting/README.md");
const coreDist = path.join(repoRoot, "packages/core/dist/index.js");
const sdkDist = path.join(repoRoot, "packages/sdk/dist/index.js");
const scannerDist = path.join(repoRoot, "packages/scanner/dist/index.js");

const privateKeyMarkers = [
  "BEGIN PRIVATE KEY",
  "END PRIVATE KEY",
  "MC4CAQAwBQYDK2VwBCIEIKSXsEXyAP3O1L5RImgZcGDzbiKurlrmR6AojVA7U",
  "MC4CAQAwBQYDK2VwBCIEIKSXsEXyAP3O1L5RImgZcGDzbiKurlmgrrmR6AojVA7U",
  "\"d\":",
];

interface ReportingScenario {
  name: string;
  score: number;
  signatureCheckIds: string[];
  failedSignatureCheckIds: string[];
  passedSignatureCheckIds: string[];
  signatureChecks: Array<{
    id: string;
    severity: "info" | "warning" | "error";
    deduction: number;
    message: string;
  }>;
}

interface ReportingExample {
  example: "scanner-signature-reporting";
  scenarios: ReportingScenario[];
}

function distIsCurrent(): boolean {
  return (
    existsSync(coreDist) &&
    existsSync(sdkDist) &&
    existsSync(scannerDist) &&
    readFileSync(coreDist, "utf8").includes("verifyManifestSignature") &&
    readFileSync(sdkDist, "utf8").includes("signManifest") &&
    readFileSync(scannerDist, "utf8").includes("manifest.signature.verified")
  );
}

function runReportingExample(): { raw: string; report: ReportingExample } {
  const result = spawnSync(process.execPath, ["--import", "tsx", examplePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `scanner-signature-reporting failed with exit ${result.status}\n${result.stdout}${result.stderr}`,
    );
  }
  return { raw: result.stdout, report: JSON.parse(result.stdout) as ReportingExample };
}

function assertNoPrivateKeyMaterial(output: string): void {
  for (const marker of privateKeyMarkers) {
    expect(output).not.toContain(marker);
  }
}

function byName(report: ReportingExample, name: string): ReportingScenario {
  const scenario = report.scenarios.find((item) => item.name === name);
  if (!scenario) throw new Error(`Missing scenario ${name}`);
  return scenario;
}

describe("scanner signature reporting example", () => {
  beforeAll(() => {
    // The example intentionally imports public workspace package names.
    // Tests may run after typecheck:clean removes dist, so build just
    // the packages needed by the example when required.
    if (distIsCurrent()) return;

    const result = spawnSync(
      "npm",
      ["run", "build", "-w", "packages/core", "-w", "packages/sdk", "-w", "packages/scanner"],
      {
        cwd: repoRoot,
        stdio: "ignore",
      },
    );
    if (result.status !== 0 || !distIsCurrent()) {
      throw new Error("Failed to build dist directories needed for scanner signature example");
    }
  }, 90000);

  it("runs and reports the expected signed-manifest check IDs", () => {
    const { raw, report } = runReportingExample();
    assertNoPrivateKeyMaterial(raw);

    expect(report.example).toBe("scanner-signature-reporting");

    expect(byName(report, "unsigned-default")).toMatchObject({
      signatureCheckIds: [],
      failedSignatureCheckIds: [],
      passedSignatureCheckIds: [],
    });

    expect(byName(report, "unsigned-require-signature")).toMatchObject({
      signatureCheckIds: ["manifest.signature.missing"],
      failedSignatureCheckIds: ["manifest.signature.missing"],
      passedSignatureCheckIds: [],
    });
    expect(byName(report, "unsigned-require-signature").signatureChecks[0]).toMatchObject({
      severity: "error",
      deduction: 15,
    });

    expect(byName(report, "signed-valid-key-set")).toMatchObject({
      signatureCheckIds: ["manifest.signature.verified"],
      failedSignatureCheckIds: [],
      passedSignatureCheckIds: ["manifest.signature.verified"],
    });

    expect(byName(report, "signed-tampered-key-set")).toMatchObject({
      signatureCheckIds: ["manifest.signature.invalid"],
      failedSignatureCheckIds: ["manifest.signature.invalid"],
      passedSignatureCheckIds: [],
    });

    expect(byName(report, "signed-expired-key-set")).toMatchObject({
      signatureCheckIds: ["manifest.signature.expired"],
      failedSignatureCheckIds: ["manifest.signature.expired"],
      passedSignatureCheckIds: [],
    });
  });

  it("keeps the README aligned with actual scanner output", () => {
    const { raw, report } = runReportingExample();
    const readme = readFileSync(readmePath, "utf8");
    const oldScope = ["@marmar", "9615-cloud"].join("");

    assertNoPrivateKeyMaterial(raw);
    assertNoPrivateKeyMaterial(readme);
    expect(readme).not.toContain(oldScope);

    const ids = new Set(report.scenarios.flatMap((scenario) => scenario.signatureCheckIds));
    ids.delete("");
    for (const id of ids) {
      expect(readme).toContain(id);
    }
  });
});
