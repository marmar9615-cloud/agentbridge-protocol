import path from "node:path";
import { c } from "../colors";

export function runMcpConfig(): number {
  // Resolve absolute path to the MCP server entry the user can copy-paste
  // into Claude Desktop / Cursor / a custom client config.
  // We compute relative to cwd because the CLI may be invoked from anywhere
  // in the workspace.
  const mcpEntry = path.resolve(process.cwd(), "apps/mcp-server/src/index.ts");

  const claudeConfig = {
    mcpServers: {
      agentbridge: {
        command: "npx",
        args: ["tsx", mcpEntry],
      },
    },
  };

  const monorepoNpmCommand = {
    mcpServers: {
      agentbridge: {
        command: "npm",
        args: ["run", "dev:mcp", "--silent", "--prefix", process.cwd()],
      },
    },
  };

  process.stdout.write(`${c.bold("AgentBridge MCP client config")}\n\n`);
  process.stdout.write(`${c.dim("Option 1 — direct tsx invocation (works anywhere):")}\n`);
  process.stdout.write(JSON.stringify(claudeConfig, null, 2) + "\n\n");
  process.stdout.write(`${c.dim("Option 2 — npm script (requires this checkout):")}\n`);
  process.stdout.write(JSON.stringify(monorepoNpmCommand, null, 2) + "\n\n");
  process.stdout.write(
    `${c.bold("Where to put it")}\n  ${c.dim("Claude Desktop (macOS):")} ~/Library/Application Support/Claude/claude_desktop_config.json\n  ${c.dim("Claude Desktop (Windows):")} %APPDATA%\\Claude\\claude_desktop_config.json\n  ${c.dim("Cursor:")} settings → MCP\n\nRestart your client after editing. AgentBridge tools should appear in the\ntools panel.\n`,
  );
  return 0;
}
