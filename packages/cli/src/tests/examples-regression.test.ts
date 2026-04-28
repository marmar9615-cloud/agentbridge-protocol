import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runCli } from "../index";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const cliPackageJson = JSON.parse(
  readFileSync(path.join(repoRoot, "packages/cli/package.json"), "utf8"),
) as { version: string };

function fixturePath(...parts: string[]): string {
  return path.join(repoRoot, ...parts);
}

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

function assertNoRealLookingSecrets(output: string): void {
  expect(output).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/=-]{24,}/);
  expect(output).not.toMatch(/sk_[A-Za-z0-9]{16,}/);
  expect(output).not.toMatch(/gh[pousr]_[A-Za-z0-9_]{20,}/);
  expect(output).not.toContain("codex-test-secret-token-should-not-leak");
}

describe("CLI public example regressions", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentbridge-cli-examples-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("version reports the CLI package metadata version", async () => {
    const cap = captureStdio();
    const code = await runCli({ argv: ["version"] });
    cap.restore();

    expect(code).toBe(0);
    expect(cap.out.join("").trim()).toBe(cliPackageJson.version);
  });

  it("mcp-config preserves stdio, desktop-client, Codex, generic, and HTTP snippets without leaking tokens", async () => {
    const previous = process.env.AGENTBRIDGE_HTTP_AUTH_TOKEN;
    process.env.AGENTBRIDGE_HTTP_AUTH_TOKEN = "codex-test-secret-token-should-not-leak";

    const cap = captureStdio();
    const code = await runCli({ argv: ["mcp-config"] });
    cap.restore();
    if (previous === undefined) {
      delete process.env.AGENTBRIDGE_HTTP_AUTH_TOKEN;
    } else {
      process.env.AGENTBRIDGE_HTTP_AUTH_TOKEN = previous;
    }

    const output = cap.out.join("");
    expect(code).toBe(0);
    expect(output).toContain("Raw stdio command");
    expect(output).toContain("npx -y @marmarlabs/agentbridge-mcp-server");
    expect(output).toContain("OpenAI Codex");
    expect(output).toContain("codex mcp add agentbridge");
    expect(output).toContain("[mcp_servers.agentbridge]");
    expect(output).toContain("Claude Desktop");
    expect(output).toContain("Cursor / generic MCP JSON");
    expect(output).toContain('"mcpServers"');
    expect(output).toContain("HTTP transport (experimental, v0.4.0");
    expect(output).toContain("AGENTBRIDGE_TRANSPORT=http");
    expect(output).toContain("AGENTBRIDGE_HTTP_AUTH_TOKEN=$(openssl rand -hex 32)");
    expect(output).toContain('"streamable-http"');
    expect(output).toContain('"Authorization": "Bearer ${AGENTBRIDGE_HTTP_AUTH_TOKEN}"');
    expect(output).toContain("examples/http-client-config/");
    assertNoRealLookingSecrets(output);
  });

  it.each([
    "examples/adopter-quickstart/manifest.basic.json",
    "examples/adopter-quickstart/manifest.production-shaped.json",
    "examples/scanner-regression/manifest.good.json",
    "examples/scanner-regression/manifest.minimal-valid.json",
    "examples/scanner-regression/manifest.missing-confirmation.json",
    "examples/scanner-regression/manifest.origin-mismatch.json",
  ])("validates example manifest %s", async (manifestPath) => {
    const cap = captureStdio();
    const code = await runCli({ argv: ["validate", fixturePath(manifestPath)] });
    cap.restore();

    const output = cap.out.join("") + cap.err.join("");
    expect(code).toBe(0);
    expect(output).toContain("valid manifest");
    assertNoRealLookingSecrets(output);
  });

  it("fails safely for the scanner invalid fixture", async () => {
    const cap = captureStdio();
    const code = await runCli({
      argv: ["validate", fixturePath("examples/scanner-regression/manifest.invalid.json")],
    });
    cap.restore();

    const output = cap.out.join("") + cap.err.join("");
    expect(code).toBe(1);
    expect(output).toContain("manifest failed validation");
    expect(output).toContain("baseUrl");
    expect(output).toContain("requiresConfirmation");
    assertNoRealLookingSecrets(output);
  });

  it.each([
    {
      name: "openapi-store",
      source: "examples/openapi-store/store.openapi.json",
      expectedName: "Acme Store API",
      expectedAction: "list_products",
      skipped: false,
    },
    {
      name: "openapi-regression",
      source: "examples/openapi-regression/catalog-regression.openapi.json",
      expectedName: "Catalog Regression API",
      expectedAction: "list_orders_v2",
      skipped: true,
    },
  ])(
    "generates and validates the $name OpenAPI example",
    async ({ source, expectedName, expectedAction, skipped }) => {
      const outPath = path.join(tmpDir, `${path.basename(source)}.agentbridge.json`);
      const generate = captureStdio();
      const generateCode = await runCli({
        argv: ["generate", "openapi", fixturePath(source), "--out", outPath],
      });
      generate.restore();

      const generateOutput = generate.out.join("") + generate.err.join("");
      expect(generateCode).toBe(0);
      expect(generateOutput).toContain("generated manifest");
      if (skipped) {
        expect(generateOutput).toContain("Skipped operations");
        expect(generateOutput).toContain("HEAD /reports/{reportId}/exports");
      }
      assertNoRealLookingSecrets(generateOutput);

      const validate = captureStdio();
      const validateCode = await runCli({ argv: ["validate", outPath] });
      validate.restore();
      const validateOutput = validate.out.join("") + validate.err.join("");
      expect(validateCode).toBe(0);
      expect(validateOutput).toContain(expectedName);
      assertNoRealLookingSecrets(validateOutput);

      const manifest = JSON.parse(await fs.readFile(outPath, "utf8"));
      expect(manifest.actions.some((action: { name: string }) => action.name === expectedAction)).toBe(
        true,
      );
    },
  );
});
