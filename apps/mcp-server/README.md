# @marmarlabs/agentbridge-mcp-server

stdio MCP server that exposes [AgentBridge](https://github.com/marmar9615-cloud/agentbridge-protocol)
actions to MCP clients (OpenAI Codex, Claude Desktop, Cursor, custom)
with confirmation gates, origin pinning, and audit logging.

## Install

```bash
npm install -g @marmarlabs/agentbridge-mcp-server
# or run directly:
npx -y @marmarlabs/agentbridge-mcp-server
```

## Wire it up

The server speaks **stdio**. The same launcher
(`npx -y @marmarlabs/agentbridge-mcp-server`) works in every client
below — only the surrounding config syntax differs.

### OpenAI Codex

```bash
codex mcp add agentbridge -- npx -y @marmarlabs/agentbridge-mcp-server
```

Verify with `/mcp` inside Codex. Or paste this into
`~/.codex/config.toml` (global) or `.codex/config.toml` (per-repo):

```toml
[mcp_servers.agentbridge]
command = "npx"
args = ["-y", "@marmarlabs/agentbridge-mcp-server"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

Full Codex walkthrough:
[docs/codex-setup.md](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/codex-setup.md).

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Restart Claude Desktop. AgentBridge tools will appear in the tools panel.

### Cursor

Settings → MCP → Add server. Same `command`/`args` shape as Claude
Desktop.

### Custom or other MCP clients

Anything that can launch a stdio MCP server runs AgentBridge as-is:

```bash
npx -y @marmarlabs/agentbridge-mcp-server
```

See
[docs/mcp-client-setup.md](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/mcp-client-setup.md)
for everything else.

## Tools exposed

| Tool | Purpose |
|---|---|
| `discover_manifest` | Fetch and summarize the manifest at a URL |
| `scan_agent_readiness` | Score a URL's AgentBridge readiness |
| `list_actions` | List all actions in a manifest |
| `call_action` | Invoke an action (with confirmation gate for risky actions) |
| `get_audit_log` | Read the local audit log |

## Safety guarantees

- **Confirmation gate** — risky (medium/high) actions return a
  `confirmationRequired` response with a single-use, input-bound token.
  The agent must re-call with `confirmationApproved: true` AND the same
  token to execute.
- **Origin pinning** — action endpoints must share origin with the
  manifest's `baseUrl`. Cross-origin calls are rejected.
- **Loopback-only by default** — only `localhost`/`127.0.0.1`/`::1` URLs
  are allowed. Production-recommended: set
  `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://app.example.com,https://admin.example.com`
  for an exact-origin allowlist. Broad escape hatch:
  `AGENTBRIDGE_ALLOW_REMOTE=true` (emits a one-time stderr warning).
- **Configurable bounds** — `AGENTBRIDGE_ACTION_TIMEOUT_MS`,
  `AGENTBRIDGE_MAX_RESPONSE_BYTES`, `AGENTBRIDGE_CONFIRMATION_TTL_SECONDS`
  are clamped to safe ranges. See
  [docs/security-configuration.md](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/security-configuration.md).
- **Idempotency** — pass `idempotencyKey` to safely retry a `call_action`
  request; the same key+input replays the prior result.
- **Audit redaction** — `authorization`, `cookie`, `password`, `token`,
  `secret`, and `api_key` keys are redacted before being written to the
  audit log.

## Resources & prompts

The server also exposes static resources (manifest spec, scoring rubric,
example manifests) and pre-canned prompts for common workflows.

## Status

Public release. **v0.3.0** is the "Production Foundations" release:
stricter remote-target allowlist, configurable timeouts/TTLs, an
MCP stdout-hygiene test, a threat model, a v1.0 readiness checklist,
a draft npm Trusted Publishing workflow, and updated docs. **Not
yet v1.0** — see the
[v1-readiness checklist](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/v1-readiness.md)
for what we still owe before declaring production-ready.

AgentBridge is suitable for local development, manifest authoring,
scanner workflows, OpenAPI import, and MCP experiments. With the
v0.3.0 controlled-staging configuration (see
[production-readiness.md](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/production-readiness.md))
it is also suitable for internal staging deployments behind an
explicit origin allowlist. It is not yet production security
infrastructure.

HTTP transport, signed manifests, OAuth scope enforcement, and
distributed audit storage are on the
[roadmap](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/roadmap.md).

## License

Apache-2.0
