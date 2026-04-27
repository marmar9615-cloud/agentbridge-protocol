import path from "node:path";
import { c } from "../colors";

export function runMcpConfig(): number {
  // Compiled bin path (after `npm run build`) for the local-checkout option.
  // Computed relative to cwd because the CLI may be invoked from anywhere
  // in the workspace.
  const mcpDistEntry = path.resolve(process.cwd(), "apps/mcp-server/dist/index.js");

  const npxConfig = {
    mcpServers: {
      agentbridge: {
        command: "npx",
        args: ["@marmar9615-cloud/agentbridge-mcp-server"],
      },
    },
  };

  const localCheckoutConfig = {
    mcpServers: {
      agentbridge: {
        command: "node",
        args: [mcpDistEntry],
      },
    },
  };

  process.stdout.write(`${c.bold("AgentBridge MCP client config")}\n\n`);
  process.stdout.write(`${c.dim("Option A — published package (recommended once on npm):")}\n`);
  process.stdout.write(JSON.stringify(npxConfig, null, 2) + "\n\n");
  process.stdout.write(`${c.dim("Option B — local checkout (development; run `npm run build` first):")}\n`);
  process.stdout.write(JSON.stringify(localCheckoutConfig, null, 2) + "\n\n");
  process.stdout.write(
    `${c.bold("Where to put it")}\n  ${c.dim("Claude Desktop (macOS):")} ~/Library/Application Support/Claude/claude_desktop_config.json\n  ${c.dim("Claude Desktop (Windows):")} %APPDATA%\\Claude\\claude_desktop_config.json\n  ${c.dim("Cursor:")} settings → MCP\n\nRestart your client after editing. AgentBridge tools should appear in the\ntools panel.\n`,
  );
  return 0;
}
