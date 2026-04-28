import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest, type AgentBridgeManifest } from "@marmarlabs/agentbridge-core";
import * as scanner from "../index";
import { scanUrl } from "../scanner";
import { scoreManifest, type RecommendationCategory } from "../score";
import type { PageProbeResult, ScanResult, ScannerCheck } from "../index";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const fixtureDir = resolve(repoRoot, "examples/scanner-regression");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), "utf8"));
}

function loadValidFixture(name: string): AgentBridgeManifest {
  const validation = validateManifest(loadFixture(name));
  if (!validation.ok) {
    throw new Error(`Fixture ${name} failed validation: ${validation.errors.join("; ")}`);
  }
  return validation.manifest;
}

function makeManifestFetch(manifest: unknown, seenUrls: string[] = []): typeof fetch {
  return ((url: RequestInfo | URL) => {
    const href = typeof url === "string" ? url : url.toString();
    seenUrls.push(href);
    return Promise.resolve(
      new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

async function scanFixture(
  scanOrigin: string,
  fixtureName: string,
): Promise<{ result: ScanResult; requestedUrls: string[] }> {
  const requestedUrls: string[] = [];
  const result = await scanUrl(scanOrigin, {
    allowAnyUrl: true,
    fetcher: makeManifestFetch(loadFixture(fixtureName), requestedUrls),
  });
  return { result, requestedUrls };
}

function checkIds(checks: ScannerCheck[]): string[] {
  return checks.map((check) => check.id);
}

function recommendationGroupKeys(
  groups: Record<RecommendationCategory, string[]>,
): RecommendationCategory[] {
  return Object.keys(groups).sort() as RecommendationCategory[];
}

describe("scanner public API contract", () => {
  it("exports the intended public scanner API surface", () => {
    expect(scanner.scanUrl).toBeTypeOf("function");
    expect(scanner.scoreManifest).toBeTypeOf("function");

    const pageProbe: PageProbeResult | undefined = undefined;
    expect(pageProbe).toBeUndefined();
  });

  it("keeps structured recommendation group keys stable", () => {
    const result = scoreManifest(loadValidFixture("manifest.minimal-valid.json"));
    expect(recommendationGroupKeys(result.recommendationGroups)).toEqual([
      "developerExperience",
      "docs",
      "safety",
      "schema",
    ]);
  });
});

describe("scanner regression fixtures", () => {
  it("scores the good fixture as high readiness with correct aggregate counts", async () => {
    const { result, requestedUrls } = await scanFixture(
      "https://support.example.com",
      "manifest.good.json",
    );

    expect(requestedUrls).toEqual([
      "https://support.example.com/.well-known/agentbridge.json",
    ]);
    expect(result.manifestFound).toBe(true);
    expect(result.validManifest).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.actionCount).toBe(3);
    expect(result.riskyActionCount).toBe(2);
    expect(result.missingConfirmationCount).toBe(0);
    expect(result.checks).toHaveLength(0);
    expect(checkIds(result.passed)).toContain("manifest.baseUrl.cross-origin");
  });

  it("scores the minimal valid fixture below the good fixture with doc and schema recommendations", async () => {
    const good = await scanFixture("https://support.example.com", "manifest.good.json");
    const minimal = await scanFixture(
      "https://support.example.com",
      "manifest.minimal-valid.json",
    );

    expect(minimal.result.validManifest).toBe(true);
    expect(minimal.result.score).toBeLessThan(good.result.score);
    expect(minimal.result.actionCount).toBe(1);
    expect(minimal.result.riskyActionCount).toBe(0);
    expect(checkIds(minimal.result.checks)).toEqual(
      expect.arrayContaining([
        "manifest.missing-contact",
        "manifest.missing-auth",
        "manifest.no-resources",
        "action.missing-output-schema",
        "action.no-examples",
        "action.no-summary-template",
      ]),
    );
    expect(minimal.result.recommendationGroups.docs.length).toBeGreaterThan(0);
    expect(minimal.result.recommendationGroups.schema.length).toBeGreaterThan(0);
    expect(minimal.result.recommendationGroups.developerExperience.length).toBeGreaterThan(0);
  });

  it("flags the missing-confirmation fixture as a risky action confirmation gap", async () => {
    const { result } = await scanFixture(
      "https://support.example.com",
      "manifest.missing-confirmation.json",
    );

    expect(result.validManifest).toBe(true);
    expect(result.actionCount).toBe(1);
    expect(result.riskyActionCount).toBe(1);
    expect(result.missingConfirmationCount).toBe(1);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "action.medium-risk-no-confirm",
        severity: "warning",
        path: "actions.add_internal_note.requiresConfirmation",
        category: "safety",
      }),
    );
    expect(result.issues).toContain(
      "actions.add_internal_note.requiresConfirmation: medium-risk action without requiresConfirmation.",
    );
    expect(result.recommendationGroups.safety).toEqual([
      expect.stringContaining("requiresConfirmation: true"),
    ]);
  });

  it("flags baseUrl and scanned-origin mismatch without invalidating the manifest", async () => {
    const { result } = await scanFixture(
      "https://support.example.com",
      "manifest.origin-mismatch.json",
    );

    expect(result.validManifest).toBe(true);
    expect(result.score).toBeLessThan(100);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "manifest.baseUrl.cross-origin",
        severity: "warning",
        path: "baseUrl",
        category: "safety",
        deduction: 10,
      }),
    );
    expect(result.issues).toContain(
      "baseUrl: Manifest baseUrl (https://api.example.com) differs from scanned URL (https://support.example.com).",
    );
  });

  it("fails the invalid fixture safely with useful validation details", async () => {
    const raw = loadFixture("manifest.invalid.json");
    const validation = validateManifest(raw);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors.join("\n")).toMatch(/baseUrl|requiresConfirmation/);
    }

    const { result } = await scanFixture(
      "https://support.example.com",
      "manifest.invalid.json",
    );

    expect(result.manifestFound).toBe(true);
    expect(result.validManifest).toBe(false);
    expect(result.score).toBe(10);
    expect(result.actionCount).toBe(0);
    expect(result.riskyActionCount).toBe(0);
    expect(result.missingConfirmationCount).toBe(0);
    expect(result.checks).toEqual([
      expect.objectContaining({
        id: "manifest.invalid",
        severity: "error",
        category: "schema",
      }),
    ]);
    expect(result.validationErrors?.join("\n")).toMatch(/baseUrl|requiresConfirmation/);
  });

  it("scores manifests loaded from disk the same way as fetched manifests", async () => {
    const manifest = loadValidFixture("manifest.good.json");
    const direct = scoreManifest(manifest);
    const { result: fetched } = await scanFixture(
      "https://support.example.com",
      "manifest.good.json",
    );

    expect(fetched.score).toBe(direct.score);
    expect(fetched.actionCount).toBe(direct.actionCount);
    expect(fetched.riskyActionCount).toBe(direct.riskyActionCount);
    expect(fetched.missingConfirmationCount).toBe(direct.missingConfirmationCount);
    expect(checkIds(fetched.checks)).toEqual(checkIds(direct.checks));
  });

  it("does not mutate manifest objects passed to scoreManifest", () => {
    const manifest = loadValidFixture("manifest.good.json");
    const before = JSON.stringify(manifest);

    scoreManifest(manifest);

    expect(JSON.stringify(manifest)).toBe(before);
  });
});
