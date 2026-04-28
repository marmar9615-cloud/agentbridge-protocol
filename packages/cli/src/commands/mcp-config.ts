import path from "node:path";
import { c } from "../colors";

// Snippets for hooking the AgentBridge MCP server into different MCP clients.
// The package shape (`npx -y @marmarlabs/agentbridge-mcp-server` over stdio) is
// the same across clients — only the surrounding config syntax differs. We
// print copy-pasteable blocks for the most common ones plus the raw stdio
// command so any MCP-compatible client can be wired up.
export function runMcpConfig(): number {
  const npxArgs = ["-y", "@marmarlabs/agentbridge-mcp-server"];
  const npxArgsJson = JSON.stringify(npxArgs);

  // Codex config.toml is TOML, written by hand because it's a tiny block.
  const codexToml = [
    "[mcp_servers.agentbridge]",
    `command = "npx"`,
    `args = ${npxArgsJson}`,
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 60",
    "enabled = true",
  ].join("\n");

  const jsonConfig = {
    mcpServers: {
      agentbridge: {
        command: "npx",
        args: npxArgs,
      },
    },
  };

  // Local-checkout (development) — points at the compiled bin.
  const mcpDistEntry = path.resolve(process.cwd(), "apps/mcp-server/dist/index.js");
  const localCheckoutConfig = {
    mcpServers: {
      agentbridge: {
        command: "node",
        args: [mcpDistEntry],
      },
    },
  };

  const out = process.stdout;

  out.write(`${c.bold("AgentBridge MCP server")}\n\n`);

  out.write(`${c.dim("Raw stdio command (any MCP-compatible client):")}\n`);
  out.write(`  npx -y @marmarlabs/agentbridge-mcp-server\n\n`);

  out.write(`${c.dim("OpenAI Codex — CLI:")}\n`);
  out.write(`  codex mcp add agentbridge -- npx -y @marmarlabs/agentbridge-mcp-server\n`);
  out.write(`  ${c.dim("# verify in Codex with /mcp")}\n\n`);

  out.write(`${c.dim("OpenAI Codex — ~/.codex/config.toml:")}\n`);
  for (const line of codexToml.split("\n")) {
    out.write(`  ${line}\n`);
  }
  out.write("\n");

  out.write(`${c.dim("Claude Desktop:")}\n`);
  out.write(
    indentBlock(JSON.stringify(jsonConfig, null, 2)) + "\n",
  );
  out.write(
    `  ${c.dim("# macOS:")} ~/Library/Application Support/Claude/claude_desktop_config.json\n`,
  );
  out.write(`  ${c.dim("# Windows:")} %APPDATA%\\Claude\\claude_desktop_config.json\n\n`);

  out.write(`${c.dim("Cursor / generic MCP JSON:")}\n`);
  out.write(indentBlock(JSON.stringify(jsonConfig, null, 2)) + "\n");
  out.write(`  ${c.dim("# Cursor: Settings → MCP")}\n\n`);

  out.write(`${c.dim("Local checkout (development; run `npm run build` first):")}\n`);
  out.write(indentBlock(JSON.stringify(localCheckoutConfig, null, 2)) + "\n\n");

  // ── HTTP transport (experimental, v0.4.0) ───────────────────────
  // Stdio is the recommended default for local desktop clients; HTTP
  // is for hosted/centralized MCP clients that cannot launch a local
  // subprocess. We print the env-var recipe and a generic JSON shape
  // that hosted clients can adapt. The placeholder token here is
  // documentation only — operators must generate their own.
  const httpClientConfig = {
    mcpServers: {
      agentbridge: {
        transport: "streamable-http",
        url: "http://127.0.0.1:3333/mcp",
        headers: {
          Authorization: "Bearer ${AGENTBRIDGE_HTTP_AUTH_TOKEN}",
        },
      },
    },
  };

  out.write(`${c.bold("HTTP transport (experimental, v0.4.0 — opt-in)")}\n`);
  out.write(
    `${c.dim("Use only when your MCP client cannot launch a local subprocess (hosted/centralized clients).")}\n`,
  );
  out.write(`${c.dim("Stdio remains the recommended default for Codex / Claude Desktop / Cursor.")}\n\n`);

  out.write(`${c.dim("Env vars to start the server in HTTP mode:")}\n`);
  out.write(`  AGENTBRIDGE_TRANSPORT=http\n`);
  out.write(`  AGENTBRIDGE_HTTP_AUTH_TOKEN=$(openssl rand -hex 32)\n`);
  out.write(`  AGENTBRIDGE_HTTP_HOST=127.0.0.1            ${c.dim("# loopback default; non-loopback bind requires Origin allowlist")}\n`);
  out.write(`  AGENTBRIDGE_HTTP_PORT=3333\n`);
  out.write(`  AGENTBRIDGE_HTTP_ALLOWED_ORIGINS=http://localhost:5173   ${c.dim("# inbound Origin allowlist (browser clients only)")}\n`);
  out.write(`  npx -y @marmarlabs/agentbridge-mcp-server\n`);
  out.write(`  ${c.dim("# stderr: [agentbridge-mcp-http] listening on http://127.0.0.1:3333/mcp")}\n\n`);

  out.write(`${c.dim("Generic hosted-MCP-client config (adapt to your client):")}\n`);
  out.write(indentBlock(JSON.stringify(httpClientConfig, null, 2)) + "\n");
  out.write(`  ${c.dim("# Resolve ${AGENTBRIDGE_HTTP_AUTH_TOKEN} via your client's secrets manager — never commit the literal token.")}\n\n`);

  out.write(
    `${c.bold("Safety reminder")}\n` +
      `  ${c.dim("Outbound: loopback-only by default. Production-recommended: set AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://app.example.com,https://admin.example.com.")}\n` +
      `  ${c.dim("Outbound broad escape hatch: AGENTBRIDGE_ALLOW_REMOTE=true (emits a stderr warning).")}\n` +
      `  ${c.dim("Inbound HTTP: AGENTBRIDGE_HTTP_ALLOWED_ORIGINS gates Origin headers — independent from outbound AGENTBRIDGE_ALLOWED_TARGET_ORIGINS.")}\n` +
      `  ${c.dim("HTTP requires AGENTBRIDGE_HTTP_AUTH_TOKEN; tokens in URL query strings are rejected with 400.")}\n` +
      `  ${c.dim("Public bind (host other than 127.0.0.1/::1/localhost) requires both auth and Origin allowlist or fails closed at startup.")}\n` +
      `  ${c.dim("Medium/high-risk actions require confirmationApproved + a single-use confirmationToken.")}\n` +
      `  ${c.dim("See docs/security-configuration.md for the full env-var reference.")}\n` +
      `  ${c.dim("HTTP recipe: examples/http-client-config/ (curl smoke for auth/origin/query-token).")}\n`,
  );

  return 0;
}

function indentBlock(s: string): string {
  return s
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
