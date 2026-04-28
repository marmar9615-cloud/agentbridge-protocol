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

  out.write(
    `${c.bold("Safety reminder")}\n  ${c.dim("Loopback-only by default. Set AGENTBRIDGE_ALLOW_REMOTE=true to permit non-localhost URLs.")}\n  ${c.dim("Medium/high-risk actions require confirmationApproved + a single-use confirmationToken.")}\n`,
  );

  return 0;
}

function indentBlock(s: string): string {
  return s
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
