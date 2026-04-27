import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateManifest } from "../manifest";

// Resolve repo root so this test works from any cwd.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const examplesDir = path.join(repoRoot, "spec", "examples");

const examples = ["minimal-manifest.json", "ecommerce-manifest.json", "support-ticket-manifest.json"];

describe("spec/examples — manifests validate against the core schema", () => {
  for (const filename of examples) {
    it(`validates ${filename}`, () => {
      const raw = JSON.parse(readFileSync(path.join(examplesDir, filename), "utf8"));
      const result = validateManifest(raw);
      if (!result.ok) {
        // Useful failure output.
        throw new Error(
          `${filename} failed validation:\n  ${result.errors.join("\n  ")}`,
        );
      }
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.manifest.name.length).toBeGreaterThan(0);
        expect(result.manifest.actions.length).toBeGreaterThan(0);
      }
    });
  }
});
