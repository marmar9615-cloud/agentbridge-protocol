# http-client-config

Working recipe for the **opt-in Streamable HTTP** MCP transport
shipped in `@marmarlabs/agentbridge-mcp-server@0.4.0`. Use this
when your MCP client cannot launch a local subprocess (hosted /
centralized agent platforms). For local desktop clients (Codex,
Claude Desktop, Cursor) **stdio remains the recommended default**
— see [`mcp-client-config/`](../mcp-client-config) and
[`codex-config/`](../codex-config) for those.

## What this example is

A copy-pasteable, fully-local walkthrough that:

1. starts the AgentBridge MCP server in HTTP mode on
   `127.0.0.1:3333`,
2. exercises every safety boundary with `curl` so you can see
   exactly what the server enforces, and
3. shows the JSON shape an HTTP MCP client should send for
   `initialize` and `tools/list`.

Nothing here touches the network beyond loopback. No real secrets
are required; the placeholder token below is for local testing
only.

## Required env vars

Generate a real token with `openssl rand -hex 32` and store it in
your shell or your client's secrets manager. Never commit it.

| Env var | Why |
|---|---|
| `AGENTBRIDGE_TRANSPORT=http` | Opt into the HTTP transport (default is stdio). |
| `AGENTBRIDGE_HTTP_AUTH_TOKEN=<hex>` | **Required.** Static bearer token. ≥ 16 chars. The server fails closed at startup without it. |
| `AGENTBRIDGE_HTTP_HOST=127.0.0.1` | Loopback bind (default). Anything else is "public bind" with extra validation. |
| `AGENTBRIDGE_HTTP_PORT=3333` | TCP port (default 3333; `0` = ephemeral). |
| `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS=…` | Comma-separated inbound `Origin` allowlist. **Required for non-loopback bind.** Independent from outbound `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`. |

## Start the server (loopback dev mode)

```bash
export AGENTBRIDGE_TRANSPORT=http
export AGENTBRIDGE_HTTP_AUTH_TOKEN=replace-with-at-least-16-chars-token
export AGENTBRIDGE_HTTP_ALLOWED_ORIGINS=http://localhost:3333
export AGENTBRIDGE_HTTP_HOST=127.0.0.1
export AGENTBRIDGE_HTTP_PORT=3333

npx -y @marmarlabs/agentbridge-mcp-server
# stderr: [agentbridge-mcp-http] listening on http://127.0.0.1:3333/mcp
```

The server keeps running until you `Ctrl-C`. Stdout is silent in
HTTP mode.

## curl smoke tests

Run these in a second shell, with the same `AGENTBRIDGE_HTTP_AUTH_TOKEN`
in scope.

### Missing auth → `401`

```bash
curl -s -i -X POST http://127.0.0.1:3333/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-smoke","version":"0"}}}'
# HTTP/1.1 401 Unauthorized
# WWW-Authenticate: Bearer realm="agentbridge-mcp"
# {"error":"unauthorized","message":"missing Authorization header"}
```

### Wrong bearer → `401`

```bash
curl -s -i -X POST http://127.0.0.1:3333/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer wrong-token-but-long-enough' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-smoke","version":"0"}}}'
# HTTP/1.1 401 Unauthorized
# {"error":"unauthorized","message":"invalid bearer token"}
```

### Token in query string → `400`

```bash
curl -s -i -X POST "http://127.0.0.1:3333/mcp?token=$AGENTBRIDGE_HTTP_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# HTTP/1.1 400 Bad Request
# {"error":"token_in_query_string","message":"Authentication tokens must be provided in the Authorization header, not in the URL query string."}
```

### Bad Origin → `403`

```bash
curl -s -i -X POST http://127.0.0.1:3333/mcp \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AGENTBRIDGE_HTTP_AUTH_TOKEN" \
  -H 'Origin: https://attacker.example.test' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# HTTP/1.1 403 Forbidden
# {"error":"forbidden_origin","message":"origin not allowed"}
```

### Valid `initialize` → `200` with `serverInfo`

```bash
curl -s -i -X POST http://127.0.0.1:3333/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $AGENTBRIDGE_HTTP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-smoke","version":"0"}}}'
# HTTP/1.1 200 OK
# Content-Type: application/json
# {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{},"resources":{},"prompts":{}},"serverInfo":{"name":"agentbridge","version":"0.4.0"}},"jsonrpc":"2.0","id":1}
```

### Valid `tools/list`

```bash
curl -s -X POST http://127.0.0.1:3333/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $AGENTBRIDGE_HTTP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

The response lists the same five tools that stdio exposes:
`discover_manifest`, `scan_agent_readiness`, `list_actions`,
`call_action`, `get_audit_log`.

## Generic MCP HTTP client config

Hosted MCP clients vary in config shape, but the wire contract is
the same. Anything that posts JSON-RPC to your endpoint with a
bearer header works:

```json
{
  "mcpServers": {
    "agentbridge": {
      "transport": "streamable-http",
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer ${AGENTBRIDGE_HTTP_AUTH_TOKEN}"
      }
    }
  }
}
```

`${AGENTBRIDGE_HTTP_AUTH_TOKEN}` should resolve to the token your
operator generated. **Do not commit the literal token.** Most
hosted MCP clients support env-var expansion or a secrets manager.

## Codex / Claude Desktop note

OpenAI Codex and Claude Desktop currently launch MCP servers as
local subprocesses (stdio). For those clients, keep using the
stdio recipes in
[`../codex-config/`](../codex-config) and
[`../mcp-client-config/`](../mcp-client-config). The HTTP recipe
here is only useful when:

- you run a hosted/centralized MCP client that cannot launch a
  subprocess, or
- you need to expose AgentBridge MCP to multiple agent processes
  on the same machine.

## Public bind caution

The recipes above bind to `127.0.0.1` (loopback). Binding to a
public interface is **opt-in and fails closed** unless **both**
of these are set:

- `AGENTBRIDGE_HTTP_AUTH_TOKEN`
- `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS=<non-empty list>`

If either is missing the server exits with a clear stderr error
before opening a socket. Even with both set, prefer:

- terminating TLS at a reverse proxy you control,
- restricting the inbound network path with firewall rules /
  VPC config,
- rotating `AGENTBRIDGE_HTTP_AUTH_TOKEN` on every operator
  change.

Outbound app targets are controlled separately. For production-like
testing against a real app origin, prefer an exact target allowlist:

```bash
export AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://app.example.com
```

This outbound allowlist is independent from
`AGENTBRIDGE_HTTP_ALLOWED_ORIGINS`, which only checks inbound browser
`Origin` headers for the HTTP MCP endpoint.

## Security warnings

- The bearer token is the only credential the HTTP transport
  uses today. Treat it like a long-lived API key. Rotate it
  on operator change. Never check it into source.
- Audit redaction strips `authorization`, `cookie`, `password`,
  `token`, `secret`, `api_key`, `apikey` recursively before
  audit events hit disk. The bearer token itself never appears
  in audit, stderr, or response bodies.
- The HTTP transport reuses every other safety control unchanged
  — confirmation gate, origin pinning, outbound target-origin
  allowlist, idempotency, simulated destructive demo actions.
  None of those weaken under HTTP.
- The HTTP transport is **experimental** in v0.4.0. Production
  hosting of the HTTP transport is on the v1.0 path; today it is
  appropriate for local development, internal staging, and
  integration with hosted MCP clients in non-production
  environments. See
  [`docs/production-readiness.md`](../../docs/production-readiness.md).
- Full env-var reference and recipes:
  [`docs/security-configuration.md`](../../docs/security-configuration.md).
- Threat coverage:
  [`docs/threat-model.md`](../../docs/threat-model.md).
