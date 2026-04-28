# Security configuration

Every knob you can turn on the AgentBridge MCP server, what it
defaults to, what range it accepts, and how to use it in different
environments. Companion to
[production-readiness.md](production-readiness.md) (the practical
"is this safe yet?") and [threat-model.md](threat-model.md) (the
threats these knobs mitigate).

## At a glance

### Universal (apply to both transports)

| Env var | What it does | Default | Allowed range |
|---|---|---|---|
| `AGENTBRIDGE_TRANSPORT` | Selects the MCP transport. `stdio` (default) is the local-subprocess transport; `http` opts into the Streamable HTTP transport. Unknown values fall back to `stdio` with a stderr warning. | `stdio` | `stdio` \| `http` |
| `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` | **Outbound.** Strict allowlist of remote target origins (comma-separated) the MCP server is willing to fetch manifests from and call actions against. Recommended for production. | unset | comma-separated http(s) origins |
| `AGENTBRIDGE_ALLOW_REMOTE` | **Outbound.** Broad escape hatch — permits all http(s) remote target origins. Emits a one-time stderr warning. | unset (loopback only) | `true` or unset |
| `AGENTBRIDGE_ACTION_TIMEOUT_MS` | Outbound HTTP timeout for action calls. | `10000` (10s) | `1000`–`120000` |
| `AGENTBRIDGE_MAX_RESPONSE_BYTES` | Hard cap on action response body size; HTTP transport also uses this as the inbound request-body cap. | `1000000` (1MB) | `1024`–`10485760` (1KB–10MB) |
| `AGENTBRIDGE_CONFIRMATION_TTL_SECONDS` | TTL for pending confirmation tokens. | `300` (5 minutes) | `30`–`3600` (30s–1h) |
| `AGENTBRIDGE_DATA_DIR` | Directory for `audit.json`, `confirmations.json`, `idempotency.json`. | `<repo>/data` | absolute path |

### HTTP transport (only when `AGENTBRIDGE_TRANSPORT=http`)

| Env var | What it does | Default | Allowed range |
|---|---|---|---|
| `AGENTBRIDGE_HTTP_HOST` | Bind interface. Loopback (`127.0.0.1`/`localhost`/`::1`) is safe by default. Anything else is "public bind" and the server requires both auth and an Origin allowlist. | `127.0.0.1` | hostname or IP |
| `AGENTBRIDGE_HTTP_PORT` | TCP port. `0` selects an ephemeral port (used by tests). | `3333` | `0`–`65535` |
| `AGENTBRIDGE_HTTP_AUTH_TOKEN` | **Required for HTTP mode.** Static bearer token; clients send `Authorization: Bearer <token>`. Compared in constant time. Generate with `openssl rand -hex 32`. Never logged, never echoed in error responses. | unset | non-empty string, ≥ 16 chars |
| `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS` | **Inbound** allowlist of `Origin` headers (comma-separated, exact-`URL.origin` match). Required for non-loopback bind. Independent from the outbound `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`. | unset (rejects requests that supply an Origin header) | comma-separated http(s) origins |

Out-of-range integers are clamped to the nearest bound, with a
stderr warning. Non-integer values fall back to the default with a
stderr warning.

> **Inbound vs outbound.**
> `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS` is the **inbound** allowlist — it
> gates which `Origin` headers the HTTP MCP server will accept from
> calling clients (typically browsers).
> `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` is the **outbound** allowlist —
> it gates which target-app origins the MCP server is willing to
> fetch manifests from and invoke action endpoints against.
> The two are independent and not interchangeable. Setting one does
> nothing for the other.

## `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`

The strict, exact-origin allowlist for non-loopback target hosts.
**This is the production-recommended way to allow remote targets.**

- Compared via `URL.origin` (scheme + host + port). Path, query,
  and fragment are ignored.
- Loopback (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`) is always
  allowed; you don't need to add it to the list.
- The strict allowlist wins when both `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`
  and `AGENTBRIDGE_ALLOW_REMOTE=true` are set.
- Prefix attacks fail: `https://example.com.evil.test` is rejected
  against an allowlist entry of `https://example.com`.
- Port matters: `https://app.example.com` does not match
  `https://app.example.com:8443`.
- Only `http:` and `https:` origins are accepted in the list.
- An empty value is treated as "not set" and falls through to
  default behavior.

```bash
# Single host
export AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://app.example.com

# Multiple hosts (comma-separated, whitespace OK)
export AGENTBRIDGE_ALLOWED_TARGET_ORIGINS="https://app.example.com, https://admin.example.com"

# Non-default port
export AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://staging.app.internal:8443
```

## `AGENTBRIDGE_ALLOW_REMOTE`

The broad escape hatch. Permits any remote http(s) origin.
Intended for local testing, ad-hoc scans, and CI against a known
host. **Not recommended for production** — use
`AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` instead.

- Set to `true` to enable; any other value (including unset) keeps
  the loopback-only default.
- Emits a one-time stderr warning per process when active so the
  operator notices the wider trust boundary.
- Non-http schemes (`javascript:`, `file:`, `data:`, `ftp:`) are
  still rejected.
- If `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` is also set, the strict
  allowlist takes precedence and `AGENTBRIDGE_ALLOW_REMOTE` is
  effectively a no-op.

```bash
# Local one-off test against a remote staging host
AGENTBRIDGE_ALLOW_REMOTE=true \
  npx -y @marmarlabs/agentbridge-mcp-server
```

## `AGENTBRIDGE_ACTION_TIMEOUT_MS`

How long the MCP server waits for an action endpoint to respond
before aborting.

- **Default.** `10000` ms (10 seconds).
- **Range.** `1000`–`120000` ms (1 second to 2 minutes). Out-of-
  range values are clamped to the nearest bound with a stderr
  warning.
- **Why bounded.** A 0ms timeout would silently disable every
  action; a 10-minute timeout would block the agent and
  destabilize the stdio session.
- **When to raise.** Long-running batch actions, slow upstream APIs.
- **When to lower.** You want a tighter SLO and would rather an
  action fail fast than block.

```bash
export AGENTBRIDGE_ACTION_TIMEOUT_MS=30000
```

## `AGENTBRIDGE_MAX_RESPONSE_BYTES`

The hard cap on the action response body. Anything larger is
rejected (the `tools/call` returns an error and the audit event
records the cap-exceeded condition).

- **Default.** `1000000` bytes (1 MB).
- **Range.** `1024`–`10485760` bytes (1 KB to 10 MB).
- **Why bounded.** A truly unbounded response would let a hostile
  upstream consume the MCP process's memory and saturate the stdio
  pipe; a tiny cap would break ordinary scan/manifest reads.
- **When to raise.** Actions that legitimately return large
  payloads (full audit dumps, list endpoints with no pagination).
- **When to lower.** High-assurance deployments where you'd rather
  refuse anything beyond a known small response.

```bash
export AGENTBRIDGE_MAX_RESPONSE_BYTES=262144   # 256 KB
```

## `AGENTBRIDGE_CONFIRMATION_TTL_SECONDS`

How long a pending confirmation token remains valid before it
expires.

- **Default.** `300` seconds (5 minutes).
- **Range.** `30`–`3600` seconds (30 seconds to 1 hour).
- **Why bounded.** A 1-second TTL would race the agent's "show
  human, get approval" turn; a 24-hour TTL would create long-lived
  on-disk approvals that could be replayed long after the operator
  forgot they existed.
- **When to raise.** Workflows with a slow human reviewer in the
  loop (multi-step approvals, off-hours batches).
- **When to lower.** High-risk environments where any approval
  older than a minute is suspicious.
- Tokens are stored at `data/confirmations.json` (or
  `<AGENTBRIDGE_DATA_DIR>/confirmations.json`) and survive a
  server restart up to the TTL.

```bash
export AGENTBRIDGE_CONFIRMATION_TTL_SECONDS=120
```

## `AGENTBRIDGE_DATA_DIR`

Directory the MCP server uses for the audit log, pending
confirmations, and idempotency records.

- **Default.** `<repo>/data` (resolved by walking up from `cwd`
  until a workspace root is found, then falling back to `cwd`).
- **Set this in production.** Pin it to a per-tenant, per-process
  directory with restrictive permissions (`0700` owned by the
  service account).
- The directory holds three JSON files:
  - `audit.json` — last 500 audit events.
  - `confirmations.json` — pending confirmations, expire on read.
  - `idempotency.json` — last 500 idempotency records (24h TTL).
- Atomic writes are used (`tmp + rename`) so a crash mid-write
  does not corrupt the file.

```bash
export AGENTBRIDGE_DATA_DIR=/var/lib/agentbridge/staging
install -m 0700 -d "$AGENTBRIDGE_DATA_DIR"
```

## Configuration recipes

### Local development (default)

No env vars required. Loopback only, defaults across the board.

```bash
npx -y @marmarlabs/agentbridge-mcp-server
```

### Controlled staging

Strict origin allowlist, persistent data dir, slightly tighter
TTL.

```bash
export AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://staging.app.internal
export AGENTBRIDGE_DATA_DIR=/var/lib/agentbridge/staging
export AGENTBRIDGE_CONFIRMATION_TTL_SECONDS=120
npx -y @marmarlabs/agentbridge-mcp-server
```

### Production-like (controlled)

Strict origin allowlist, lower max response size, persistent data
dir owned by a dedicated user.

```bash
export AGENTBRIDGE_ALLOWED_TARGET_ORIGINS="https://app.example.com,https://admin.example.com"
export AGENTBRIDGE_DATA_DIR=/var/lib/agentbridge/prod
export AGENTBRIDGE_ACTION_TIMEOUT_MS=15000
export AGENTBRIDGE_MAX_RESPONSE_BYTES=524288   # 512 KB
export AGENTBRIDGE_CONFIRMATION_TTL_SECONDS=180
sudo -u agentbridge npx -y @marmarlabs/agentbridge-mcp-server
```

Pair this with the production checklist in
[production-readiness.md](production-readiness.md) — the env vars
above are necessary but not sufficient.

### Inside an MCP client config

Configuration env vars sit in the client's `env` block. Example for
Claude Desktop / Cursor JSON:

```json
{
  "mcpServers": {
    "agentbridge": {
      "command": "npx",
      "args": ["-y", "@marmarlabs/agentbridge-mcp-server"],
      "env": {
        "AGENTBRIDGE_ALLOWED_TARGET_ORIGINS": "https://staging.app.internal",
        "AGENTBRIDGE_DATA_DIR": "/Users/me/.agentbridge/staging",
        "AGENTBRIDGE_CONFIRMATION_TTL_SECONDS": "120"
      }
    }
  }
}
```

For Codex `~/.codex/config.toml`:

```toml
[mcp_servers.agentbridge]
command = "npx"
args = ["-y", "@marmarlabs/agentbridge-mcp-server"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true

[mcp_servers.agentbridge.env]
AGENTBRIDGE_ALLOWED_TARGET_ORIGINS = "https://staging.app.internal"
AGENTBRIDGE_DATA_DIR = "/Users/me/.agentbridge/staging"
AGENTBRIDGE_CONFIRMATION_TTL_SECONDS = "120"
```

## Diagnosing config

The MCP server logs configuration warnings to stderr (never
stdout, which carries the JSON-RPC stream). Run it directly with
`< /dev/null` to see what your env produces:

```bash
AGENTBRIDGE_ACTION_TIMEOUT_MS=10 \
  AGENTBRIDGE_MAX_RESPONSE_BYTES=999999999 \
  npx -y @marmarlabs/agentbridge-mcp-server < /dev/null 2>&1 1>/dev/null
# Output (stderr):
# [agentbridge] AGENTBRIDGE_ACTION_TIMEOUT_MS=10 is outside [1000, 120000]; clamped to 1000.
# [agentbridge] AGENTBRIDGE_MAX_RESPONSE_BYTES=999999999 is outside [1024, 10485760]; clamped to 10485760.
```

## HTTP transport recipes (v0.4.0)

The HTTP transport is opt-in via `AGENTBRIDGE_TRANSPORT=http`.
stdio remains the default. The endpoint is mounted at `/mcp`.
Clients authenticate with `Authorization: Bearer <token>`.
Tokens in URL query strings are rejected with HTTP `400`.
JSON responses are returned (no SSE in v0.4.0). For the full
contract, see
[designs/http-mcp-transport-auth.md](designs/http-mcp-transport-auth.md)
and [adr/0001-http-mcp-transport.md](adr/0001-http-mcp-transport.md).

### Loopback / local development (recommended starting point)

```bash
export AGENTBRIDGE_TRANSPORT=http
export AGENTBRIDGE_HTTP_AUTH_TOKEN=$(openssl rand -hex 32)
# Optional: only needed if a browser-based MCP client will connect.
export AGENTBRIDGE_HTTP_ALLOWED_ORIGINS=http://localhost:5173
npx -y @marmarlabs/agentbridge-mcp-server
```

The server listens on `127.0.0.1:3333` by default. The token is
sourced from your shell environment and **never** appears in
logs or HTTP error bodies.

### Non-loopback bind (controlled environments only)

When `AGENTBRIDGE_HTTP_HOST` is anything other than loopback,
the server fails closed at startup unless **both**
`AGENTBRIDGE_HTTP_AUTH_TOKEN` and a non-empty
`AGENTBRIDGE_HTTP_ALLOWED_ORIGINS` are set:

```bash
export AGENTBRIDGE_TRANSPORT=http
export AGENTBRIDGE_HTTP_HOST=0.0.0.0
export AGENTBRIDGE_HTTP_AUTH_TOKEN=$(openssl rand -hex 32)
export AGENTBRIDGE_HTTP_ALLOWED_ORIGINS=https://agent-platform.example.com
npx -y @marmarlabs/agentbridge-mcp-server
```

The server emits a stderr notice (`[agentbridge-mcp-http]
non-loopback bind to 0.0.0.0 — auth and Origin allowlist are
required and have been verified.`) so the operator sees the
broader trust boundary.

> **Production-readiness caveat.** v0.4.0 ships HTTP transport
> as an *opt-in* runtime, not a production-readiness milestone.
> See [production-readiness.md](production-readiness.md) for
> what AgentBridge is and isn't safe for today.

## See also

- [production-readiness.md](production-readiness.md) — the
  pre-flight checklist before pointing AgentBridge at real
  systems.
- [threat-model.md](threat-model.md) — what each knob is
  defending against.
- [v1-readiness.md](v1-readiness.md) — the bar these knobs are
  helping us reach.
- [designs/http-mcp-transport-auth.md](designs/http-mcp-transport-auth.md)
  — the v0.4.0 HTTP transport design.
- [adr/0001-http-mcp-transport.md](adr/0001-http-mcp-transport.md)
  — the ADR.
