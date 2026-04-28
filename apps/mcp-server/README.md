# @marmarlabs/agentbridge-mcp-server

MCP server that exposes [AgentBridge](https://github.com/marmar9615-cloud/agentbridge-protocol)
actions to MCP clients (OpenAI Codex, Claude Desktop, Cursor, custom)
with confirmation gates, origin pinning, and audit logging. Default
**stdio** transport for local desktop clients; opt-in **Streamable
HTTP** transport (v0.4.0) with bearer-token auth for hosted /
centralized clients.

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

### HTTP transport (experimental, opt-in)

Hosted/centralized MCP clients that cannot launch a local
subprocess can use the opt-in **Streamable HTTP** transport.
stdio remains the default.

```bash
export AGENTBRIDGE_TRANSPORT=http
export AGENTBRIDGE_HTTP_AUTH_TOKEN=$(openssl rand -hex 32)
# Optional: only needed if a browser-based MCP client will connect.
export AGENTBRIDGE_HTTP_ALLOWED_ORIGINS=http://localhost:5173
npx -y @marmarlabs/agentbridge-mcp-server
# → listens on http://127.0.0.1:3333/mcp
```

Clients send `Authorization: Bearer <token>`. Tokens in URL
query strings are rejected with `400`. Default bind is loopback;
non-loopback bind requires both auth and an Origin allowlist or
the server fails closed at startup. Full env-var table:
[docs/security-configuration.md](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/security-configuration.md).

> The HTTP transport is **experimental** in v0.4.0. See
> [docs/production-readiness.md](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/production-readiness.md)
> for what AgentBridge is and isn't safe for today.

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

Public release. **v0.3.0** shipped Production Foundations
(stricter remote-target allowlist, configurable timeouts/TTLs,
MCP stdout-hygiene test, threat model, v1.0 readiness checklist,
Trusted Publishing workflow). **v0.4.0** is release-prepared
on the `release/v0.4.0-http-polish` branch and adds an opt-in
Streamable HTTP transport with static bearer-token auth, exact-
origin allowlist, loopback-by-default bind, and HTTP smoke wired
into the local pre-publish flow. Stdio remains the default; HTTP
is opt-in via `AGENTBRIDGE_TRANSPORT=http`. **Not yet v1.0** —
see the
[v1-readiness checklist](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/v1-readiness.md)
for what we still owe before declaring production-ready.

AgentBridge is suitable for local development, manifest authoring,
scanner workflows, OpenAPI import, and MCP experiments. With the
v0.3.0+ controlled-staging configuration (see
[production-readiness.md](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/production-readiness.md))
it is also suitable for internal staging deployments behind an
explicit origin allowlist. It is not yet production security
infrastructure.

HTTP transport, signed manifests, OAuth scope enforcement, and
distributed audit storage are on the
[roadmap](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/roadmap.md).

## License

Apache-2.0
