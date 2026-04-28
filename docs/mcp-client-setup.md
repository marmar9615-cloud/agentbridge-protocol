# Hooking AgentBridge MCP into your client

The AgentBridge MCP server speaks **stdio**. Most modern MCP clients
can launch a local stdio process directly, so the same server entry
(`npx -y @marmarlabs/agentbridge-mcp-server`) plugs into every client
listed below — only the surrounding config syntax changes.

## Quick check from the CLI

```bash
npx @marmarlabs/agentbridge-cli mcp-config
```

prints copy-pasteable snippets for each supported client. Pick the one
that fits your setup and paste it into the right config file.

## OpenAI Codex

Two paths — a one-line CLI command, or a `config.toml` block. Both
target the same stdio launcher.

### CLI

```bash
codex mcp add agentbridge -- npx -y @marmarlabs/agentbridge-mcp-server
```

Verify with `/mcp` inside Codex. Detailed walkthrough, troubleshooting,
and a project-scoped variant live in
[docs/codex-setup.md](codex-setup.md).

### config.toml

```toml
[mcp_servers.agentbridge]
command = "npx"
args = ["-y", "@marmarlabs/agentbridge-mcp-server"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

Drop into `~/.codex/config.toml` (global) or
`.codex/config.toml` at a repo root (project-scoped). Ready-made files:
[`examples/codex-config/`](../examples/codex-config/).

## Claude Desktop

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

### Option B — local checkout (development)

```json
{
  "mcpServers": {
    "agentbridge": {
      "command": "node",
      "args": [
        "/absolute/path/to/agentbridge-protocol/apps/mcp-server/dist/index.js"
      ],
      "env": {
        "AGENTBRIDGE_ALLOW_REMOTE": "false"
      }
    }
  }
}
```

Run `npm run build` first to produce `apps/mcp-server/dist/index.js`.

Restart Claude Desktop. You should see `agentbridge` in the tools panel
with these surfaces:

| Surface | Items |
|---|---|
| Tools | `discover_manifest`, `scan_agent_readiness`, `list_actions`, `call_action`, `get_audit_log` |
| Resources | `agentbridge://manifest`, `agentbridge://readiness`, `agentbridge://audit-log`, `agentbridge://spec/manifest-v0.1` |
| Prompts | `scan_app_for_agent_readiness`, `generate_manifest_from_api`, `explain_action_confirmation`, `review_manifest_for_security` |

## Cursor

Cursor supports MCP servers natively. Settings → MCP → Add server, then
use the same `command` and `args` shape as other clients:

- **command:** `npx`
- **args:** `["-y", "@marmarlabs/agentbridge-mcp-server"]`

Or paste the JSON form directly:

```json
{
  "mcpServers": {
    "agentbridge": {
      "command": "npx",
      "args": ["-y", "@marmarlabs/agentbridge-mcp-server"]
    }
  }
}
```

## Custom or other MCP clients

Anything that can launch a stdio MCP server runs AgentBridge as-is. The
raw command:

```bash
npx -y @marmarlabs/agentbridge-mcp-server
```

If your client expects a JSON server descriptor, the same shape used by
Claude Desktop and Cursor (`command: "npx"`, `args: ["-y",
"@marmarlabs/agentbridge-mcp-server"]`) works in most clients.

If your client only supports HTTP MCP, the bundled server doesn't ship
an HTTP transport yet. Wrap it with an MCP HTTP transport adapter such
as the [official MCP SDK transports](https://github.com/modelcontextprotocol/typescript-sdk#transports);
a first-class HTTP transport is on [the roadmap](roadmap.md).

## Safety expectations for all clients

The AgentBridge MCP server enforces the same safety story regardless of
which client is talking to it:

- **Low-risk actions** may execute directly when the agent calls
  `call_action` with valid input.
- **Medium- and high-risk actions** return
  `{ status: "confirmationRequired", confirmationToken, summary, ... }`
  on the first call. The agent must re-call with
  `confirmationApproved: true` **and** the same `confirmationToken`
  (single-use, input-bound, default 5-minute TTL) to actually run.
- **Origin pinning.** Action endpoints must share origin with the
  manifest's `baseUrl`. A poisoned manifest cannot redirect calls.
- **Loopback-only by default.** Only `localhost` / `127.0.0.1` /
  `::1` URLs are allowed by default. To permit other hosts you have
  two opt-ins:
  - **Production-recommended:** set
    `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://app.example.com,https://admin.example.com`
    — strict, exact-origin allowlist. Prefix attacks
    (`https://example.com.evil.test`) are rejected.
  - **Broad escape hatch:** `AGENTBRIDGE_ALLOW_REMOTE=true` permits
    any remote http(s) origin and emits a one-time stderr warning.
  - The strict allowlist always wins when both are set. Full
    reference: [docs/security-configuration.md](security-configuration.md).
- **Audit redaction.** `authorization`, `cookie`, `password`, `token`,
  `secret`, and `api_key` keys are stripped recursively before any
  audit event is persisted.
- **Demo destructive actions are simulated.** The demo app's
  `execute_refund_order`, etc., return `{ simulated: true, ... }` —
  no real payment processor is touched anywhere in this codebase.

## Verifying it's working

Boot the demo (`npm run dev`), then ask your agent something like:

> What can the app at http://localhost:3000 do? Just discover the
> manifest, don't call anything yet.

The agent should call `discover_manifest`, then `list_actions`, and
report back: 5 actions, 3 risky, all required confirmations declared.

Then ask:

> Refund order ORD-1001 for $24 because the item arrived damaged.

You should see the agent:
1. Call `call_action` for `draft_refund_order` (returns
   `confirmationRequired` + token).
2. Show you the human-readable summary:
   `Draft a refund of $24 on order ORD-1001 (reason: damaged on arrival)`.
3. Wait for your approval before re-calling with
   `confirmationApproved: true` + the token.
4. Same flow for `execute_refund_order` (high risk).

## Troubleshooting

**The server starts but no tools appear**
- Run `npx -y @marmarlabs/agentbridge-mcp-server < /dev/null` and
  confirm it exits cleanly. If it errors, fix that before reattaching
  to your client.
- For the local-checkout path, confirm the path is absolute and points
  at `apps/mcp-server/dist/index.js` (the compiled bin, not the TS
  source). Run `node /your/path/apps/mcp-server/dist/index.js < /dev/null`
  directly.

**`Only loopback URLs allowed` errors**
- Default behaviour. To talk to a remote AgentBridge surface, the
  recommended option is to set
  `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://your-app.example.com`
  in the `env` block of your MCP config (or your shell when
  launching the client). For ad-hoc testing you can use the
  broader `AGENTBRIDGE_ALLOW_REMOTE=true`, which also permits
  remote URLs and emits a stderr warning.

**`Target origin … is not in AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`**
- The strict allowlist rejected the origin. Add the exact origin
  (scheme + host + port) to the comma-separated value, or fall
  back to the broader `AGENTBRIDGE_ALLOW_REMOTE=true` for testing.
  See [docs/security-configuration.md](security-configuration.md).

**Confirmation tokens "expired" too quickly**
- Default TTL is 5 minutes. Tokens are stored at
  `data/confirmations.json` so they survive a server restart, but not
  arbitrarily long. Re-call `call_action` without
  `confirmationApproved` to receive a fresh token.

**Idempotency conflicts**
- The same `idempotencyKey` was used with different inputs. Use a new
  key for the new request.

**Codex-specific issues**
- See [docs/codex-setup.md](codex-setup.md#troubleshooting) for
  Codex-specific timeouts, registration, and `/mcp` verification.
