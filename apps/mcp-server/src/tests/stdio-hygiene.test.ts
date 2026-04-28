import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* The MCP server speaks JSON-RPC over stdio. Every byte on stdout MUST be a
 * valid JSON-RPC message. Any startup banners, warnings, or diagnostic logs
 * must go to stderr, otherwise MCP clients fail to parse the protocol stream.
 *
 * These tests boot the *built* dist bundle as a subprocess (i.e. the same
 * artifact a user gets via `npx -y @marmarlabs/agentbridge-mcp-server`) and
 * verify the contract.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.resolve(here, "..", "..", "dist", "index.js");
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const coreDist = path.resolve(
  repoRoot,
  "node_modules",
  "@marmarlabs",
  "agentbridge-core",
  "dist",
  "index.js",
);
const scannerDist = path.resolve(
  repoRoot,
  "node_modules",
  "@marmarlabs",
  "agentbridge-scanner",
  "dist",
  "index.js",
);
const TMP_DATA_DIR = path.join(
  os.tmpdir(),
  `agentbridge-stdio-hygiene-${process.pid}`,
);

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function runMcp(input: string, env: Record<string, string> = {}): Promise<SpawnResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [distEntry], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        AGENTBRIDGE_DATA_DIR: TMP_DATA_DIR,
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code }));
    child.stdin.end(input);
  });
}

describe("MCP stdio hygiene (built dist)", () => {
  beforeAll(async () => {
    // Build whatever dist is missing so the test exercises the current source.
    // CI's `npm test` runs after `npm run typecheck:clean` (which removes
    // every dist) and before `npm run build`, so we may need to build the
    // server's transitive deps too. Workspace-link symlinks under
    // node_modules/@marmarlabs/* point at the package source, but the runtime
    // entry is `dist/index.js`.
    const needsBuild =
      !existsSync(distEntry) || !existsSync(coreDist) || !existsSync(scannerDist);
    if (needsBuild) {
      const result = spawnSync(
        "npm",
        [
          "run",
          "build",
          "-w",
          "packages/core",
          "-w",
          "packages/scanner",
          "-w",
          "apps/mcp-server",
        ],
        { cwd: repoRoot, stdio: "ignore" },
      );
      if (
        result.status !== 0 ||
        !existsSync(distEntry) ||
        !existsSync(coreDist) ||
        !existsSync(scannerDist)
      ) {
        throw new Error(
          "Failed to build dist directories needed for stdio-hygiene test",
        );
      }
    }
    await fs.rm(TMP_DATA_DIR, { recursive: true, force: true });
    await fs.mkdir(TMP_DATA_DIR, { recursive: true });
  }, 90000);

  afterAll(async () => {
    await fs.rm(TMP_DATA_DIR, { recursive: true, force: true });
  });

  it("EOF on stdin produces no stdout output (clean shutdown)", async () => {
    const { stdout, stderr } = await runMcp("");
    expect(stdout).toBe("");
    // stderr may contain platform noise but nothing should reference an unhandled crash.
    expect(stderr).not.toMatch(/UnhandledPromiseRejection|TypeError|ReferenceError/);
  }, 15000);

  it("an MCP initialize request emits parseable JSON-RPC on stdout", async () => {
    const initialize = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "stdio-hygiene-test", version: "0" },
      },
    });
    const initialized = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    const input = `${initialize}\n${initialized}\n`;
    const { stdout } = await runMcp(input);
    const lines = stdout.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(line);
      }).not.toThrow();
      const msg = parsed as { jsonrpc?: string };
      expect(msg.jsonrpc).toBe("2.0");
    }
  }, 15000);

  it("AGENTBRIDGE_ALLOW_REMOTE warning is routed to stderr, never stdout", async () => {
    // Drive a single tools/call that triggers assertAllowedUrl with the broad escape
    // hatch on. The action will fail (no demo app running) but the safety warning
    // must show on stderr.
    const initialize = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "stdio-hygiene-test", version: "0" },
      },
    });
    const initialized = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    const call = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "discover_manifest",
        arguments: { url: "https://app.example.com" },
      },
    });
    const input = `${initialize}\n${initialized}\n${call}\n`;
    const { stdout, stderr } = await runMcp(input, {
      AGENTBRIDGE_ALLOW_REMOTE: "true",
    });

    // Stdout: still parseable JSON-RPC.
    for (const line of stdout.split("\n").filter((l) => l.trim() !== "")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // The broad-remote warning text must NEVER appear on stdout.
    expect(stdout).not.toMatch(/AGENTBRIDGE_ALLOW_REMOTE=true permits all/);
    // It must appear on stderr.
    expect(stderr).toMatch(/AGENTBRIDGE_ALLOW_REMOTE=true permits all/);
  }, 15000);
});
