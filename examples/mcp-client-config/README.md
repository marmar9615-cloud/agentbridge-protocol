# MCP client config

Example configurations for hooking the AgentBridge MCP server into common
MCP clients. Pick the client you use, copy the snippet, edit the absolute
path to point at your local checkout, and restart the client.

## Claude Desktop (macOS)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentbridge": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/agentbridge-protocol/apps/mcp-server/src/index.ts"
      ]
    }
  }
}
```

See [`claude-desktop.json`](./claude-desktop.json) for a copy-pasteable file.

## Claude Desktop (Windows)

```
%APPDATA%\Claude\claude_desktop_config.json
```

Same shape as macOS — just adjust the path.

## Cursor

Cursor's settings → MCP. Use the same shape:

```json
{
  "mcpServers": {
    "agentbridge": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/agentbridge-protocol/apps/mcp-server/src/index.ts"]
    }
  }
}
```

## Custom MCP client (HTTP example)

The bundled MCP server speaks **stdio**. If your client needs HTTP, run it
behind an MCP HTTP transport adapter. See [`docs/mcp-client-setup.md`](../../docs/mcp-client-setup.md).

## After connecting

1. Restart your MCP client.
2. Confirm the `agentbridge` server appears with 5 tools (`discover_manifest`,
   `scan_agent_readiness`, `list_actions`, `call_action`, `get_audit_log`)
   and 4 resources / 4 prompts.
3. Ask your agent to scan `http://localhost:3000` after starting the demo
   app (`npm run dev:demo`).
4. Try a high-risk action — your agent will get a `confirmationRequired`
   response with a token. Review the summary, then explicitly approve.

## Print the config from the CLI

You don't have to write any of this by hand:

```bash
npx agentbridge mcp-config
```

prints both the direct-tsx form and an npm-script form, with the absolute
path resolved from the current working directory.
