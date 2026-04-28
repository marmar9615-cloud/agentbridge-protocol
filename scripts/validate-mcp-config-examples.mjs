#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const cli = join(root, "packages/cli/dist/bin.js");
const serverPackage = "@marmarlabs/agentbridge-mcp-server";
const oldScope = ["@marmar", "9615-cloud"].join("");
const leakedSecret = "codex-test-secret-token-should-not-leak";

function read(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFencedBlocks(markdown, language) {
  const blocks = [];
  const re = /```([A-Za-z0-9_-]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(markdown)) !== null) {
    if (match[1].toLowerCase() === language) {
      blocks.push(match[2].trim());
    }
  }
  return blocks;
}

function extractJsonObjects(text) {
  const objects = [];
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
          // Ignore prose braces; only parseable JSON config blocks matter.
        }
        start = -1;
      }
    }
  }

  return objects;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAgentbridgeServer(config) {
  assert(config && typeof config === "object", "config is not an object");
  const rootConfig = config;
  assert(rootConfig.mcpServers, "config missing mcpServers");
  assert(rootConfig.mcpServers.agentbridge, "config missing mcpServers.agentbridge");
  return rootConfig.mcpServers.agentbridge;
}

function assertCodexToml(toml, label) {
  assert(toml.includes("[mcp_servers.agentbridge]"), `${label}: missing Codex server block`);
  assert(/command\s*=\s*"npx"/.test(toml), `${label}: missing npx command`);
  assert(
    new RegExp(`args\\s*=\\s*\\[\\s*"-y"\\s*,\\s*"${escapeRegExp(serverPackage)}"\\s*\\]`).test(
      toml,
    ),
    `${label}: missing @marmarlabs server package args`,
  );
  assert(/startup_timeout_sec\s*=\s*20/.test(toml), `${label}: missing startup timeout`);
  assert(/tool_timeout_sec\s*=\s*60/.test(toml), `${label}: missing tool timeout`);
  assert(/enabled\s*=\s*true/.test(toml), `${label}: missing enabled=true`);
}

function assertStdioLauncher(config, label) {
  const server = getAgentbridgeServer(config);
  assert(server.command === "npx", `${label}: expected npx command`);
  assert(Array.isArray(server.args), `${label}: args must be an array`);
  assert(server.args[0] === "-y", `${label}: expected -y arg`);
  assert(server.args[1] === serverPackage, `${label}: expected @marmarlabs server package`);
}

function assertNoQueryTokenConfig(config, label) {
  const server = getAgentbridgeServer(config);
  const url = typeof server.url === "string" ? server.url : "";
  assert(!/[?&](token|access_token|auth|authorization)=/i.test(url), `${label}: URL contains token`);
}

function assertNoOldScope(text, label) {
  assert(!text.includes(oldScope), `${label}: found old npm scope`);
}

function assertNoRealLookingSecrets(text, label) {
  assert(!text.includes(leakedSecret), `${label}: leaked process env token`);
  assert(!/Bearer\s+[a-f0-9]{32,}/i.test(text), `${label}: found real-looking hex bearer token`);
  assert(!/sk_[A-Za-z0-9]{16,}/.test(text), `${label}: found real-looking sk_ secret`);
  assert(!/gh[pousr]_[A-Za-z0-9_]{20,}/.test(text), `${label}: found real-looking GitHub token`);
}

const codexGlobal = read("examples/codex-config/config.global.toml");
const codexProject = read("examples/codex-config/config.project.toml");
const mcpReadme = read("examples/mcp-client-config/README.md");
const httpReadme = read("examples/http-client-config/README.md");
const setupDoc = read("docs/mcp-client-setup.md");

assertCodexToml(codexGlobal, "config.global.toml");
assertCodexToml(codexProject, "config.project.toml");
for (const block of extractFencedBlocks(mcpReadme, "toml")) {
  assertCodexToml(block, "mcp-client-config README TOML");
}

const claudeFile = JSON.parse(read("examples/mcp-client-config/claude-desktop.json"));
assertStdioLauncher(claudeFile, "claude-desktop.json");

const markdownJsonBlocks = [
  ...extractFencedBlocks(mcpReadme, "json"),
  ...extractFencedBlocks(httpReadme, "json"),
];
assert(markdownJsonBlocks.length >= 3, "expected JSON snippets in MCP config examples");
const parsedMarkdownConfigs = markdownJsonBlocks.map((block) => JSON.parse(block));
assert(
  parsedMarkdownConfigs.some((config) => getAgentbridgeServer(config).command === "npx"),
  "missing stdio JSON snippet",
);
assert(
  parsedMarkdownConfigs.some((config) => getAgentbridgeServer(config).command === "node"),
  "missing local checkout JSON snippet",
);
assert(
  parsedMarkdownConfigs.some((config) => getAgentbridgeServer(config).transport === "streamable-http"),
  "missing HTTP JSON snippet",
);
for (const config of parsedMarkdownConfigs) {
  const server = getAgentbridgeServer(config);
  if (server.command === "npx") {
    assertStdioLauncher(config, "README stdio JSON");
  }
  assertNoQueryTokenConfig(config, "README JSON config");
}

for (const [label, text] of [
  ["mcp-client-config README", mcpReadme],
  ["http-client-config README", httpReadme],
  ["docs/mcp-client-setup.md", setupDoc],
  ["Codex TOML configs", codexGlobal + codexProject],
]) {
  assertNoOldScope(text, label);
  assertNoRealLookingSecrets(text, label);
}

for (const text of [httpReadme, setupDoc]) {
  assert(text.includes("AGENTBRIDGE_TRANSPORT=http"), "missing HTTP transport env var");
  assert(text.includes("AGENTBRIDGE_HTTP_AUTH_TOKEN"), "missing HTTP auth token env var");
  assert(text.includes("AGENTBRIDGE_HTTP_ALLOWED_ORIGINS"), "missing HTTP allowed origins env var");
  assert(text.includes("AGENTBRIDGE_ALLOWED_TARGET_ORIGINS"), "missing outbound target allowlist env var");
}
const queryTokenMentions = httpReadme.match(/[?&]token=/g) ?? [];
assert(queryTokenMentions.length === 1, "query-token example should appear only as rejected curl smoke");
assert(httpReadme.includes("HTTP/1.1 400 Bad Request"), "query-token rejection example missing 400");

const cliOutput = spawnSync(process.execPath, [cli, "mcp-config"], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    AGENTBRIDGE_HTTP_AUTH_TOKEN: leakedSecret,
  },
});
if (cliOutput.stdout) process.stdout.write(cliOutput.stdout);
if (cliOutput.stderr) process.stderr.write(cliOutput.stderr);
assert(cliOutput.status === 0, `agentbridge mcp-config failed with exit ${cliOutput.status}`);

const output = cliOutput.stdout + cliOutput.stderr;
assertNoOldScope(output, "agentbridge mcp-config output");
assertNoRealLookingSecrets(output, "agentbridge mcp-config output");
assertCodexToml(output, "agentbridge mcp-config output");
assert(
  output.includes("codex mcp add agentbridge -- npx -y @marmarlabs/agentbridge-mcp-server"),
  "mcp-config missing Codex one-liner",
);
assert(output.includes("AGENTBRIDGE_TRANSPORT=http"), "mcp-config missing HTTP transport env var");
assert(
  output.includes("AGENTBRIDGE_HTTP_AUTH_TOKEN=$(openssl rand -hex 32)"),
  "mcp-config missing placeholder token generator",
);
assert(
  output.includes("AGENTBRIDGE_HTTP_ALLOWED_ORIGINS=http://localhost:5173"),
  "mcp-config missing inbound Origin allowlist",
);
assert(
  output.includes("AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://app.example.com"),
  "mcp-config missing outbound target allowlist example",
);

const cliJsonObjects = extractJsonObjects(output);
assert(cliJsonObjects.length >= 4, "expected JSON snippets in mcp-config output");
const cliStdioConfigs = cliJsonObjects.filter(
  (config) => getAgentbridgeServer(config).command === "npx",
);
assert(cliStdioConfigs.length >= 2, "expected stdio JSON snippets in mcp-config output");
for (const config of cliStdioConfigs) {
  assertStdioLauncher(config, "mcp-config stdio JSON");
  assertNoQueryTokenConfig(config, "mcp-config stdio JSON");
}
const cliHttpConfig = cliJsonObjects.find(
  (config) => getAgentbridgeServer(config).transport === "streamable-http",
);
assert(cliHttpConfig, "mcp-config missing HTTP JSON");
const cliHttpServer = getAgentbridgeServer(cliHttpConfig);
assert(cliHttpServer.url === "http://127.0.0.1:3333/mcp", "mcp-config HTTP URL drifted");
assertNoQueryTokenConfig(cliHttpConfig, "mcp-config HTTP JSON");
assert(
  cliHttpServer.headers?.Authorization === "Bearer ${AGENTBRIDGE_HTTP_AUTH_TOKEN}",
  "mcp-config HTTP JSON should use env placeholder bearer token",
);

process.stdout.write("ok MCP client config examples validated\n");
