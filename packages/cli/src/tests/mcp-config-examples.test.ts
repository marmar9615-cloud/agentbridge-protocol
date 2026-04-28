import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../index";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const serverPackage = "@marmarlabs/agentbridge-mcp-server";
const oldScope = ["@marmar", "9615-cloud"].join("");
const leakedSecret = "codex-test-secret-token-should-not-leak";

function fixturePath(...parts: string[]): string {
  return path.join(repoRoot, ...parts);
}

function readFixture(...parts: string[]): string {
  return readFileSync(fixturePath(...parts), "utf8");
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

function extractFencedBlocks(markdown: string, language: string): string[] {
  const blocks: string[] = [];
  const re = /```([A-Za-z0-9_-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    if (match[1].toLowerCase() === language) {
      blocks.push(match[2].trim());
    }
  }
  return blocks;
}

function extractJsonObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        try {
          objects.push(JSON.parse(candidate));
        } catch {
          // Non-config braces can appear in prose; only parsed JSON matters.
        }
        start = -1;
      }
    }
  }

  return objects;
}

function getAgentbridgeServer(config: unknown): Record<string, unknown> {
  expect(config).toBeTruthy();
  const root = config as { mcpServers?: { agentbridge?: Record<string, unknown> } };
  expect(root.mcpServers).toBeTruthy();
  expect(root.mcpServers?.agentbridge).toBeTruthy();
  return root.mcpServers!.agentbridge!;
}

function assertStdioLauncher(config: unknown): void {
  const server = getAgentbridgeServer(config);
  expect(server.command).toBe("npx");
  expect(server.args).toEqual(["-y", serverPackage]);
}

function assertCodexToml(toml: string): void {
  expect(toml).toContain("[mcp_servers.agentbridge]");
  expect(toml).toMatch(/command\s*=\s*"npx"/);
  expect(toml).toMatch(
    new RegExp(`args\\s*=\\s*\\[\\s*"-y"\\s*,\\s*"${escapeRegExp(serverPackage)}"\\s*\\]`),
  );
  expect(toml).toMatch(/startup_timeout_sec\s*=\s*20/);
  expect(toml).toMatch(/tool_timeout_sec\s*=\s*60/);
  expect(toml).toMatch(/enabled\s*=\s*true/);
}

function assertNoOldScope(text: string): void {
  expect(text).not.toContain(oldScope);
}

function assertNoRealLookingSecrets(text: string): void {
  expect(text).not.toContain(leakedSecret);
  expect(text).not.toMatch(/Bearer\s+[a-f0-9]{32,}/i);
  expect(text).not.toMatch(/sk_[A-Za-z0-9]{16,}/);
  expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9_]{20,}/);
}

function assertNoQueryTokenConfig(config: unknown): void {
  const server = getAgentbridgeServer(config);
  const url = typeof server.url === "string" ? server.url : "";
  expect(url).not.toMatch(/[?&](token|access_token|auth|authorization)=/i);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("MCP client config example regressions", () => {
  it("keeps checked-in Codex TOML examples structurally valid", () => {
    const globalConfig = readFixture("examples/codex-config/config.global.toml");
    const projectConfig = readFixture("examples/codex-config/config.project.toml");
    const readme = readFixture("examples/mcp-client-config/README.md");

    assertCodexToml(globalConfig);
    assertCodexToml(projectConfig);
    for (const block of extractFencedBlocks(readme, "toml")) {
      assertCodexToml(block);
    }

    assertNoOldScope(globalConfig + projectConfig + readme);
  });

  it("keeps Claude, Cursor, generic, and HTTP JSON snippets parseable", () => {
    const claudeFile = JSON.parse(readFixture("examples/mcp-client-config/claude-desktop.json"));
    assertStdioLauncher(claudeFile);

    const markdownJsonBlocks = [
      ...extractFencedBlocks(readFixture("examples/mcp-client-config/README.md"), "json"),
      ...extractFencedBlocks(readFixture("examples/http-client-config/README.md"), "json"),
    ];
    expect(markdownJsonBlocks.length).toBeGreaterThanOrEqual(3);

    const parsed = markdownJsonBlocks.map((block) => JSON.parse(block));
    expect(parsed.some((config) => getAgentbridgeServer(config).command === "npx")).toBe(true);
    expect(parsed.some((config) => getAgentbridgeServer(config).command === "node")).toBe(true);
    expect(
      parsed.some((config) => getAgentbridgeServer(config).transport === "streamable-http"),
    ).toBe(true);

    for (const config of parsed.filter((item) => getAgentbridgeServer(item).command === "npx")) {
      assertStdioLauncher(config);
    }
    for (const config of parsed) {
      assertNoQueryTokenConfig(config);
    }
  });

  it("keeps HTTP examples explicit about auth, origins, and token placement", () => {
    const httpReadme = readFixture("examples/http-client-config/README.md");
    const mcpReadme = readFixture("examples/mcp-client-config/README.md");
    const docsSetup = readFixture("docs/mcp-client-setup.md");

    for (const text of [httpReadme, docsSetup]) {
      expect(text).toContain("AGENTBRIDGE_TRANSPORT=http");
      expect(text).toContain("AGENTBRIDGE_HTTP_AUTH_TOKEN");
      expect(text).toContain("AGENTBRIDGE_HTTP_ALLOWED_ORIGINS");
    }

    expect(httpReadme).toContain("AGENTBRIDGE_ALLOWED_TARGET_ORIGINS");
    expect(docsSetup).toContain("AGENTBRIDGE_ALLOWED_TARGET_ORIGINS");
    expect(mcpReadme).toContain("npx -y @marmarlabs/agentbridge-mcp-server");

    const queryTokenMentions = httpReadme.match(/[?&]token=/g) ?? [];
    expect(queryTokenMentions).toHaveLength(1);
    expect(httpReadme).toContain("Token in query string");
    expect(httpReadme).toContain("HTTP/1.1 400 Bad Request");
    expect(httpReadme).toContain("not in the URL query string");
  });

  it("keeps agentbridge mcp-config consistent with checked-in examples", async () => {
    const previous = process.env.AGENTBRIDGE_HTTP_AUTH_TOKEN;
    process.env.AGENTBRIDGE_HTTP_AUTH_TOKEN = leakedSecret;

    const cap = captureStdio();
    const code = await runCli({ argv: ["mcp-config"] });
    cap.restore();
    if (previous === undefined) {
      delete process.env.AGENTBRIDGE_HTTP_AUTH_TOKEN;
    } else {
      process.env.AGENTBRIDGE_HTTP_AUTH_TOKEN = previous;
    }

    const output = cap.out.join("") + cap.err.join("");
    expect(code).toBe(0);
    assertNoOldScope(output);
    assertNoRealLookingSecrets(output);

    assertCodexToml(output);
    expect(output).toContain("codex mcp add agentbridge -- npx -y @marmarlabs/agentbridge-mcp-server");
    expect(output).toContain("AGENTBRIDGE_TRANSPORT=http");
    expect(output).toContain("AGENTBRIDGE_HTTP_AUTH_TOKEN=$(openssl rand -hex 32)");
    expect(output).toContain("AGENTBRIDGE_HTTP_ALLOWED_ORIGINS=http://localhost:5173");
    expect(output).toContain("AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://app.example.com");
    expect(output).toContain("tokens in URL query strings are rejected with 400");

    const jsonObjects = extractJsonObjects(output);
    expect(jsonObjects.length).toBeGreaterThanOrEqual(4);
    const stdioConfigs = jsonObjects.filter(
      (config) => getAgentbridgeServer(config).command === "npx",
    );
    expect(stdioConfigs.length).toBeGreaterThanOrEqual(2);
    for (const config of stdioConfigs) {
      assertStdioLauncher(config);
    }

    const httpConfig = jsonObjects.find(
      (config) => getAgentbridgeServer(config).transport === "streamable-http",
    );
    expect(httpConfig).toBeTruthy();
    const httpServer = getAgentbridgeServer(httpConfig);
    expect(httpServer.url).toBe("http://127.0.0.1:3333/mcp");
    expect(httpServer.headers).toEqual({
      Authorization: "Bearer ${AGENTBRIDGE_HTTP_AUTH_TOKEN}",
    });
    assertNoQueryTokenConfig(httpConfig);
  });
});
