# MCP client config

Example configurations for hooking the AgentBridge MCP server into common
MCP clients. Pick the client you use, copy the snippet, restart the
client.

The same launcher (`npx -y @marmarlabs/agentbridge-mcp-server`) works in
every client below — only the surrounding config syntax differs.

## OpenAI Codex

One-line setup with the Codex CLI:

```bash
codex mcp add agentbridge -- npx -y @marmarlabs/agentbridge-mcp-server
```

Or via `~/.codex/config.toml` (global) / `.codex/config.toml`
(project-scoped):

```toml
[mcp_servers.agentbridge]
command = "npx"
args = ["-y", "@marmarlabs/agentbridge-mcp-server"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

Copy-pasteable files: [`../codex-config/`](../codex-config/). Full
walkthrough and troubleshooting:
[`docs/codex-setup.md`](../../docs/codex-setup.md).

## Claude Desktop (macOS / Windows)

**macOS:** edit `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows:** edit `%APPDATA%\Claude\claude_desktop_config.json`

### Option A — published package (recommended)

```json
{
  "mcpServers": {
    "agentbridge": {
      "command": "npx",
      "args": ["-y", "@marmarlabs/agentbridge-mcp-server"],
      "env": {
        "AGENTBRIDGE_ALLOW_REMOTE": "false"
      }
    }
  }
}
```

See [`claude-desktop.json`](./claude-desktop.json) for a copy-pasteable file.

### Option B — local checkout (for development on this repo)

```json
{
  "mcpServers": {
    "agentbridge": {
      "command": "node",
      "args": [
        "/absolute/path/to/agentbridge-protocol/apps/mcp-server/dist/index.js"
      ]
    }
  }
}
```

Run `npm run build` first to produce `apps/mcp-server/dist/index.js`.

## Cursor

Settings → MCP. Same shape as Claude Desktop.

## Custom MCP client (HTTP example)

The bundled MCP server speaks **stdio**. If your client needs HTTP, run it
behind an MCP HTTP transport adapter. See [`docs/mcp-client-setup.md`](../../docs/mcp-client-setup.md).

## After connecting

1. Restart your MCP client.
2. Confirm the `agentbridge` server appears with 5 tools
   (`discover_manifest`, `scan_agent_readiness`, `list_actions`,
   `call_action`, `get_audit_log`) plus 4 resources and 4 prompts.
3. Ask your agent to scan `http://localhost:3000` after starting the demo
   app (`npm run dev:demo`).
4. Try a high-risk action — your agent will get a `confirmationRequired`
   response with a token. Review the summary, then explicitly approve.

## Print the config from the CLI

You don't have to write any of this by hand:

```bash
npx @marmarlabs/agentbridge-cli mcp-config
```

prints copy-pasteable config snippets for direct invocation and for a
local-checkout setup.
