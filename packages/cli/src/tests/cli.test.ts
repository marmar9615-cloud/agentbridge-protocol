import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../args";
import { runCli } from "../index";

const here = path.dirname(fileURLToPath(import.meta.url));

// Lightweight harness for capturing stdout/stderr from runCli.
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

describe("parseArgs", () => {
  it("captures positionals and flags", () => {
    const a = parseArgs(["scan", "http://localhost:3000", "--json"]);
    expect(a.command).toBe("scan");
    expect(a.subcommand).toBe("http://localhost:3000");
    expect(a.flags.json).toBe(true);
  });

  it("parses flag with value", () => {
    const a = parseArgs(["generate", "openapi", "spec.json", "--out", "out.json"]);
    expect(a.command).toBe("generate");
    expect(a.subcommand).toBe("openapi");
    expect(a.positionals).toEqual(["spec.json"]);
    expect(a.flags.out).toBe("out.json");
  });

  it("parses --key=value form", () => {
    const a = parseArgs(["scan", "http://x", "--json=true", "--base-url=http://localhost:9"]);
    expect(a.flags.json).toBe("true");
    expect(a.flags["base-url"]).toBe("http://localhost:9");
  });
});

describe("CLI entry", () => {
  it("prints version", async () => {
    const cap = captureStdio();
    const code = await runCli({ argv: ["version"] });
    cap.restore();
    expect(code).toBe(0);
    expect(cap.out.join("")).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("returns 2 with no command", async () => {
    const cap = captureStdio();
    const code = await runCli({ argv: [] });
    cap.restore();
    expect(code).toBe(1);
  });

  it("returns 2 on unknown command", async () => {
    const cap = captureStdio();
    const code = await runCli({ argv: ["unknown-cmd"] });
    cap.restore();
    expect(code).toBe(2);
    expect(cap.err.join("")).toMatch(/unknown command/);
  });

  it("scan returns 1 for empty url", async () => {
    const cap = captureStdio();
    const code = await runCli({ argv: ["scan"] });
    cap.restore();
    expect(code).toBe(2);
  });
});

describe("mcp-config command", () => {
  it("prints snippets for Codex CLI, Codex config.toml, Claude Desktop, Cursor, and raw stdio", async () => {
    const cap = captureStdio();
    const code = await runCli({ argv: ["mcp-config"] });
    cap.restore();
    expect(code).toBe(0);
    const output = cap.out.join("");

    // Codex CLI one-liner.
    expect(output).toContain("codex mcp add agentbridge");
    expect(output).toContain("npx -y @marmarlabs/agentbridge-mcp-server");

    // Codex config.toml block.
    expect(output).toContain("[mcp_servers.agentbridge]");
    expect(output).toContain('command = "npx"');
    expect(output).toContain('args = ["-y","@marmarlabs/agentbridge-mcp-server"]');
    expect(output).toContain("startup_timeout_sec = 20");
    expect(output).toContain("tool_timeout_sec = 60");
    expect(output).toContain("enabled = true");

    // Claude Desktop + Cursor labels are still present (we did not drop them).
    expect(output).toContain("Claude Desktop");
    expect(output).toContain("Cursor");

    // Generic MCP JSON object shape.
    expect(output).toContain('"mcpServers"');
    expect(output).toContain('"command": "npx"');
    expect(output).toContain('"@marmarlabs/agentbridge-mcp-server"');

    // Safety reminder.
    expect(output).toContain("AGENTBRIDGE_ALLOW_REMOTE");
    expect(output).toContain("confirmationToken");
  });
});

describe("validate command (file path)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentbridge-cli-validate-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("validates a good manifest from disk", async () => {
    const manifest = {
      name: "Test",
      version: "1.0.0",
      baseUrl: "http://localhost:3000",
      actions: [],
    };
    const file = path.join(tmpDir, "m.json");
    await fs.writeFile(file, JSON.stringify(manifest), "utf8");
    const cap = captureStdio();
    const code = await runCli({ argv: ["validate", file] });
    cap.restore();
    expect(code).toBe(0);
    expect(cap.out.join("")).toMatch(/valid manifest/);
  });

  it("rejects malformed JSON", async () => {
    const file = path.join(tmpDir, "bad.json");
    await fs.writeFile(file, "{not json", "utf8");
    const cap = captureStdio();
    const code = await runCli({ argv: ["validate", file] });
    cap.restore();
    expect(code).toBe(1);
  });

  it("rejects an invalid manifest", async () => {
    const file = path.join(tmpDir, "invalid.json");
    await fs.writeFile(file, JSON.stringify({ name: "X" }), "utf8");
    const cap = captureStdio();
    const code = await runCli({ argv: ["validate", file] });
    cap.restore();
    expect(code).toBe(1);
  });

  it("--json output is parseable", async () => {
    const manifest = {
      name: "Test",
      version: "1.0.0",
      baseUrl: "http://localhost:3000",
      actions: [],
    };
    const file = path.join(tmpDir, "m.json");
    await fs.writeFile(file, JSON.stringify(manifest), "utf8");
    const cap = captureStdio();
    const code = await runCli({ argv: ["validate", file, "--json"] });
    cap.restore();
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out.join(""));
    expect(parsed.ok).toBe(true);
  });
});

describe("init command", () => {
  let tmpDir: string;
  let prevCwd: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentbridge-cli-init-"));
    prevCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates config and starter manifest", async () => {
    const cap = captureStdio();
    const code = await runCli({ argv: ["init"] });
    cap.restore();
    expect(code).toBe(0);
    expect(await fileExists(path.join(tmpDir, "agentbridge.config.ts"))).toBe(true);
    expect(
      await fileExists(path.join(tmpDir, "public", ".well-known", "agentbridge.json")),
    ).toBe(true);
  });

  it("does not overwrite without --force", async () => {
    await fs.writeFile(path.join(tmpDir, "agentbridge.config.ts"), "// existing\n", "utf8");
    const cap = captureStdio();
    await runCli({ argv: ["init"] });
    cap.restore();
    const content = await fs.readFile(path.join(tmpDir, "agentbridge.config.ts"), "utf8");
    expect(content).toBe("// existing\n");
  });

  it("overwrites with --force", async () => {
    await fs.writeFile(path.join(tmpDir, "agentbridge.config.ts"), "// existing\n", "utf8");
    const cap = captureStdio();
    await runCli({ argv: ["init", "--force"] });
    cap.restore();
    const content = await fs.readFile(path.join(tmpDir, "agentbridge.config.ts"), "utf8");
    expect(content).not.toBe("// existing\n");
  });

  it("--format json writes JSON config", async () => {
    const cap = captureStdio();
    await runCli({ argv: ["init", "--format", "json"] });
    cap.restore();
    expect(await fileExists(path.join(tmpDir, "agentbridge.config.json"))).toBe(true);
  });
});

describe("generate openapi", () => {
  let tmpDir: string;
  let prevCwd: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentbridge-cli-gen-"));
    prevCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("converts the simple-store fixture", async () => {
    // Resolve fixture relative to the repo root.
    const fixture = path.resolve(
      here,
      "../../../openapi/fixtures/simple-store.openapi.json",
    );
    const cap = captureStdio();
    const code = await runCli({
      argv: ["generate", "openapi", fixture, "--base-url", "http://localhost:9000"],
    });
    cap.restore();
    expect(code).toBe(0);
    const out = await fs.readFile(
      path.join(tmpDir, "agentbridge.generated.json"),
      "utf8",
    );
    const manifest = JSON.parse(out);
    expect(manifest.baseUrl).toBe("http://localhost:9000");
    expect(manifest.actions.length).toBeGreaterThan(0);
  });
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
