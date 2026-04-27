# Hooking AgentBridge MCP into your client

The AgentBridge MCP server speaks stdio. Most modern MCP clients can run a
local stdio process directly.

## Quick check from the CLI

```bash
npx agentbridge mcp-config
```

prints two snippets — pick the one that fits your client and paste it into
its config file.

## Claude Desktop

**macOS:** edit `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows:** edit `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agentbridge": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/agentbridge-protocol/apps/mcp-server/src/index.ts"
      ],
      "env": {
        "AGENTBRIDGE_ALLOW_REMOTE": "false"
      }
    }
  }
}
```

Restart Claude Desktop. You should see `agentbridge` in the tools panel
with these surfaces:

| Surface | Items |
|---|---|
| Tools | `discover_manifest`, `scan_agent_readiness`, `list_actions`, `call_action`, `get_audit_log` |
| Resources | `agentbridge://manifest`, `agentbridge://readiness`, `agentbridge://audit-log`, `agentbridge://spec/manifest-v0.1` |
| Prompts | `scan_app_for_agent_readiness`, `generate_manifest_from_api`, `explain_action_confirmation`, `review_manifest_for_security` |

## Cursor

Settings → MCP. Same shape as Claude Desktop.

## Custom clients (HTTP)

The bundled MCP server doesn't ship an HTTP transport. To put one in front,
wrap the stdio server with an MCP HTTP transport adapter such as the
[official MCP SDK transports](https://github.com/modelcontextprotocol/typescript-sdk#transports).
We expect to ship a first-class HTTP transport in a future release — see
[roadmap.md](./roadmap.md).

## Verifying it's working

Ask your agent something like:

> What can the app at http://localhost:3000 do? Just discover the
> manifest, don't call anything yet.

The agent should call `discover_manifest`, then `list_actions`, and report
back: 5 actions, 3 risky, all required confirmations declared.

Then ask:

> Refund order ORD-1001 for $24 because the item arrived damaged.

You should see the agent:
1. Call `call_action` for `draft_refund_order` (returns `confirmationRequired` + token).
2. Show you the human-readable summary: `Draft a refund of $24 on order ORD-1001 (reason: damaged on arrival)`.
3. Wait for your approval before re-calling with `confirmationApproved: true` + the token.
4. Same flow for `execute_refund_order` (high risk).

## Troubleshooting

**The server starts but no tools appear**
- Confirm the path is absolute and points at `apps/mcp-server/src/index.ts`.
- Run `npx tsx /your/path/apps/mcp-server/src/index.ts < /dev/null` directly. The process should exit cleanly without errors.

**`Only loopback URLs allowed` errors**
- Default behaviour. To talk to a remote AgentBridge surface, set `AGENTBRIDGE_ALLOW_REMOTE=true` in the `env` block of your MCP config.

**Confirmation tokens "expired" too quickly**
- Default TTL is 5 minutes. Tokens are stored at `data/confirmations.json` so they survive a server restart, but not arbitrarily long. Re-call without `confirmationApproved` to get a fresh token.

**Idempotency conflicts**
- The same `idempotencyKey` was used with different inputs. Use a new key for the new request.
