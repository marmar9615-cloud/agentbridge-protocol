import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentBridgeKeySet, AgentBridgeManifest } from "@marmarlabs/agentbridge-core";
import {
  scoreManifest,
  type ScannerCheck,
  type ScoringResult,
} from "@marmarlabs/agentbridge-scanner";
import {
  createSignedExampleManifest,
  createUnsignedExampleManifest,
} from "../signed-manifest-basic/manifest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const keySetPath = resolve(repoRoot, "examples/signed-manifest-basic/agentbridge-keys.json");

const expectedIssuer = "https://projects.example.com";
const nowInsideSignatureWindow = "2026-04-28T18:00:00.000Z";
const nowAfterSignatureWindow = "2026-04-30T12:00:00.000Z";

export interface SignatureReportingScenario {
  name: string;
  description: string;
  score: number;
  signatureCheckIds: string[];
  failedSignatureCheckIds: string[];
  passedSignatureCheckIds: string[];
  signatureChecks: Array<{
    id: string;
    severity: ScannerCheck["severity"];
    path: string;
    deduction: number;
    message: string;
  }>;
}

export interface SignatureReportingExample {
  example: "scanner-signature-reporting";
  generatedAt: string;
  note: string;
  scenarios: SignatureReportingScenario[];
}

function loadKeySet(): AgentBridgeKeySet {
  return JSON.parse(readFileSync(keySetPath, "utf8")) as AgentBridgeKeySet;
}

function cloneManifest(manifest: AgentBridgeManifest): AgentBridgeManifest {
  return JSON.parse(JSON.stringify(manifest)) as AgentBridgeManifest;
}

function signatureChecksFrom(result: ScoringResult): {
  failed: ScannerCheck[];
  passed: ScannerCheck[];
} {
  return {
    failed: result.checks.filter((check) => check.id.startsWith("manifest.signature.")),
    passed: result.passed.filter((check) => check.id.startsWith("manifest.signature.")),
  };
}

function scenario(
  name: string,
  description: string,
  result: ScoringResult,
): SignatureReportingScenario {
  const signatureChecks = signatureChecksFrom(result);
  const all = [...signatureChecks.failed, ...signatureChecks.passed];

  return {
    name,
    description,
    score: result.score,
    signatureCheckIds: all.map((check) => check.id),
    failedSignatureCheckIds: signatureChecks.failed.map((check) => check.id),
    passedSignatureCheckIds: signatureChecks.passed.map((check) => check.id),
    signatureChecks: all.map((check) => ({
      id: check.id,
      severity: check.severity,
      path: check.path,
      deduction: check.deduction,
      message: check.message,
    })),
  };
}

export function buildSignatureReportingExample(): SignatureReportingExample {
  const keySet = loadKeySet();
  const unsigned = createUnsignedExampleManifest();
  const signed = createSignedExampleManifest();
  const tampered = cloneManifest(signed);
  tampered.description = `${tampered.description} Tampered after signing.`;

  return {
    example: "scanner-signature-reporting",
    generatedAt: nowInsideSignatureWindow,
    note:
      "Scanner signature checks are reporting-only. Verification does not authorize actions or replace confirmation, origin pinning, allowlists, audit redaction, or transport auth.",
    scenarios: [
      scenario(
        "unsigned-default",
        "Default scanner behavior without signature options preserves v0.4.x output and emits no signature check IDs.",
        scoreManifest(unsigned),
      ),
      scenario(
        "unsigned-require-signature",
        "Operators can opt into require-signature reporting; unsigned manifests emit manifest.signature.missing.",
        scoreManifest(unsigned, { signature: { requireSignature: true } }),
      ),
      scenario(
        "signed-valid-key-set",
        "A signed manifest plus the matching public key set reports manifest.signature.verified.",
        scoreManifest(signed, {
          signature: {
            keySet,
            expectedIssuer,
            now: nowInsideSignatureWindow,
          },
        }),
      ),
      scenario(
        "signed-tampered-key-set",
        "A manifest changed after signing reports manifest.signature.invalid.",
        scoreManifest(tampered, {
          signature: {
            keySet,
            expectedIssuer,
            now: nowInsideSignatureWindow,
          },
        }),
      ),
      scenario(
        "signed-expired-key-set",
        "A valid signature checked after expiresAt reports manifest.signature.expired.",
        scoreManifest(signed, {
          signature: {
            keySet,
            expectedIssuer,
            now: nowAfterSignatureWindow,
            clockSkewSeconds: 0,
          },
        }),
      ),
    ],
  };
}

if (process.argv[1]?.endsWith("reporting.ts")) {
  console.log(JSON.stringify(buildSignatureReportingExample(), null, 2));
}
