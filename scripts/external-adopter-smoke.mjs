#!/usr/bin/env node
/**
 * Simulate an external developer cloning AgentBridge and using it.
 *
 * Snapshots HEAD via `git archive`, untars into a temp directory, runs
 * `npm ci`, typecheck, tests, build, then boots demo-app and runs the
 * compiled CLI scan against it. Verifies the MCP server dist binary
 * starts cleanly.
 *
 * Usage:
 *   node scripts/external-adopter-smoke.mjs           # cleanup on success
 *   node scripts/external-adopter-smoke.mjs --keep    # always preserve tmpdir
 *
 * Notes:
 *   - Uses `git archive HEAD`, so it tests the LAST committed state, not
 *     uncommitted working-tree changes. Commit before running.
 *   - Demo app uses port 3000 (hardcoded). Fail-fast if 3000 is in use.
 *   - On failure the tmpdir is preserved for inspection (path printed).
 */
import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

const KEEP = process.argv.includes("--keep");
const PORT = 3000;
const root = process.cwd();
const tmpRoot = mkdtempSync(path.join(tmpdir(), "agentbridge-smoke-"));

let demoProc = null;
let cleanupOnExit = !KEEP;

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

function fail(msg) {
  console.error(`[smoke] FAIL: ${msg}`);
  cleanupOnExit = false;
  console.error(`[smoke] tmpdir preserved: ${tmpRoot}`);
  process.exit(1);
}

function waitForUrl(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    (async function poll() {
      while (Date.now() < deadline) {
        try {
          const r = await fetch(url);
          if (r.ok) return resolve();
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
      reject(new Error(`Timeout waiting for ${url}`));
    })();
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, "127.0.0.1");
  });
}

process.on("exit", () => {
  if (demoProc && demoProc.exitCode === null) {
    try {
      demoProc.kill("SIGKILL");
    } catch {}
  }
  if (cleanupOnExit && existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

(async () => {
  log(`tmpdir: ${tmpRoot}`);

  // 1. Verify port 3000 is free
  if (!(await isPortFree(PORT))) {
    fail(`port ${PORT} in use; stop dev server before running smoke`);
  }

  // 2. git archive HEAD into tmpdir
  log("snapshotting HEAD via git archive");
  try {
    execSync(`git -C "${root}" archive HEAD | tar -x -C "${tmpRoot}"`, {
      stdio: "inherit",
    });
  } catch {
    fail("git archive failed (commit your changes first)");
  }

  // 3. npm ci
  log("npm ci");
  try {
    execSync("npm ci --no-audit --no-fund", { cwd: tmpRoot, stdio: "inherit" });
  } catch {
    fail("npm ci failed");
  }

  // 4. tests
  log("npm test");
  try {
    execSync("npm test", { cwd: tmpRoot, stdio: "inherit" });
  } catch {
    fail("npm test failed");
  }

  // 5. build
  log("build publishable packages");
  try {
    execSync(
      "npm run build -w packages/core -w packages/sdk -w packages/scanner -w packages/openapi -w packages/cli -w apps/mcp-server",
      { cwd: tmpRoot, stdio: "inherit" },
    );
  } catch {
    fail("build failed");
  }

  // 6. pack-check
  log("pack:dry-run");
  try {
    execSync("node scripts/pack-check.mjs", { cwd: tmpRoot, stdio: "inherit" });
  } catch {
    fail("pack-check failed");
  }

  // 7. boot demo-app, run CLI scan, kill demo
  log(`booting demo-app on :${PORT}`);
  demoProc = spawn("npm", ["run", "dev:demo"], {
    cwd: tmpRoot,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  demoProc.stdout.on("data", () => {});
  demoProc.stderr.on("data", () => {});

  try {
    await waitForUrl(`http://localhost:${PORT}/.well-known/agentbridge.json`, 60_000);
  } catch (err) {
    fail(`demo-app did not become ready: ${err.message}`);
  }

  log("running CLI scan against demo");
  try {
    execSync(`node packages/cli/dist/bin.js scan http://localhost:${PORT}`, {
      cwd: tmpRoot,
      stdio: "inherit",
    });
  } catch {
    fail("CLI scan failed");
  }

  log("stopping demo-app");
  if (demoProc.exitCode === null) {
    demoProc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
    if (demoProc.exitCode === null) demoProc.kill("SIGKILL");
  }

  // 8. MCP server boot check
  log("MCP server boot check");
  try {
    const mcp = spawn("node", ["apps/mcp-server/dist/index.js"], {
      cwd: tmpRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    await new Promise((r) => setTimeout(r, 1500));
    if (mcp.exitCode !== null) {
      fail(`MCP server exited prematurely with code ${mcp.exitCode}`);
    }
    mcp.kill("SIGTERM");
  } catch (err) {
    fail(`MCP server boot failed: ${err.message}`);
  }

  log("PASS");
})();
