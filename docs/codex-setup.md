# Use AgentBridge with OpenAI Codex

AgentBridge ships an **MCP server over stdio**
(`@marmarlabs/agentbridge-mcp-server`). OpenAI Codex can launch any stdio
MCP server, so the AgentBridge tools, resources, and prompts work in
Codex without any glue code — the same server you might already be
running in Claude Desktop or Cursor.

> The bundled server speaks **stdio** today. An HTTP transport is on
> [the roadmap](roadmap.md). Until then, every Codex setup below uses
> the stdio transport.

## What you get inside Codex

Once the server is wired up, Codex sees five tools, four resources, and
four prompts:

| Surface | Items |
|---|---|
| Tools | `discover_manifest`, `scan_agent_readiness`, `list_actions`, `call_action`, `get_audit_log` |
| Resources | `agentbridge://manifest`, `agentbridge://readiness`, `agentbridge://audit-log`, `agentbridge://spec/manifest-v0.1` |
| Prompts | `scan_app_for_agent_readiness`, `generate_manifest_from_api`, `explain_action_confirmation`, `review_manifest_for_security` |

The same safety story carries over: medium- and high-risk actions
return `confirmationRequired` plus a single-use, input-bound
`confirmationToken`; the second call must include
`confirmationApproved: true` and the same token to actually invoke the
action endpoint.

## Setup

Pick **one** of the three options below.

### Option A — Codex CLI (recommended)

If you have the `codex` CLI installed, register the server in one
command:

```bash
codex mcp add agentbridge -- npx -y @marmarlabs/agentbridge-mcp-server
```

Then verify Codex picked it up:

```
/mcp
```

You should see `agentbridge` listed. `codex mcp --help` lists the rest
of the management commands (remove, list, etc.).

### Option B — global `~/.codex/config.toml`

If you prefer to manage Codex servers as config, add this block to your
**user-global** Codex config (`~/.codex/config.toml`):

```toml
[mcp_servers.agentbridge]
command = "npx"
args = ["-y", "@marmarlabs/agentbridge-mcp-server"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

A copy-pasteable file lives at
[`examples/codex-config/config.global.toml`](../examples/codex-config/config.global.toml).

### Option C — project-scoped `.codex/config.toml`

To make AgentBridge available **only inside one repo**, drop the same
block into `.codex/config.toml` at the repo root:

```toml
[mcp_servers.agentbridge]
command = "npx"
args = ["-y", "@marmarlabs/agentbridge-mcp-server"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

Useful when a repo wants AgentBridge on tap (e.g. you're authoring a
manifest for that app) without polluting your global config. A
ready-made copy lives at
[`examples/codex-config/config.project.toml`](../examples/codex-config/config.project.toml).

The same AgentBridge MCP server can be reused by Claude Desktop,
Cursor, or any other MCP-compatible client at the same time — see
[mcp-client-setup.md](mcp-client-setup.md).

## Try it against the demo app

Clone the repo, install dependencies, and start the demo:

```bash
git clone https://github.com/marmar9615-cloud/agentbridge-protocol.git
cd agentbridge-protocol
npm install
npm run dev
```

The demo app boots on `http://localhost:3000` (and Studio on `:3001`).
By default the AgentBridge MCP server only allows **loopback** URLs;
set `AGENTBRIDGE_ALLOW_REMOTE=true` in the server's environment to talk
to a non-localhost surface.

In Codex, try a prompt like:

```
Use the agentbridge MCP server to discover the manifest at
http://localhost:3000. Then list the available actions and scan the
app for agent readiness. Do not execute any medium or high risk
actions.
```

You should see Codex call `discover_manifest`, `list_actions`, and
`scan_agent_readiness` against the demo. Risky actions
(`draft_refund_order`, `execute_refund_order`, `add_internal_note`)
will not run — they require explicit confirmation.

When you're ready to exercise the confirmation flow, ask Codex to
draft a refund. The first call returns
`{ status: "confirmationRequired", confirmationToken, summary, ... }`.
Show the summary to a human reviewer, then ask Codex to re-call
`call_action` with `confirmationApproved: true` and the same
`confirmationToken`.

## Troubleshooting

**Codex cannot find the MCP server.** Confirm the entry exists:

```bash
codex mcp list
```

If you used Option A but `codex mcp list` is empty, your CLI may be
writing to a project-scoped config you've moved out of. Re-run the
`codex mcp add` from the directory where you want the entry to live,
or fall back to Option B/C.

**`npx` prompt hangs at first run.** `npx -y` skips the install
prompt, but the very first download of the package can still take a
beat. If the launch keeps timing out, raise `startup_timeout_sec` in
your config.toml.

**Demo app not running.** The MCP server itself starts fine without
the demo, but `discover_manifest` calls against
`http://localhost:3000` will fail with a connection error until you
run `npm run dev` (or `npm run dev:demo`) in the cloned repo.

**`Only loopback URLs allowed`.** This is the default safety policy.
Set `AGENTBRIDGE_ALLOW_REMOTE=true` in the server's environment (an
`env` block in JSON configs, or via your shell when launching Codex)
to permit non-loopback hosts.

**A risky action returned `confirmationRequired`.** This is expected.
Re-call `call_action` with the same input plus
`confirmationApproved: true` and the `confirmationToken` from the
first response. Tokens are single-use, expire in five minutes by
default, and are rejected if reused with different input.

**Tool timed out.** Raise `tool_timeout_sec` in your config.toml. The
default `60` is enough for the bundled tools; long manifest fetches
behind slow networks may need more headroom.

**Package not found / `E404`.** Confirm npm can resolve the scope:

```bash
npm view @marmarlabs/agentbridge-mcp-server version
```

If that errors, your registry config is pointing somewhere other than
`https://registry.npmjs.org`. Fix it before retrying.

## Related docs

- [docs/mcp-client-setup.md](mcp-client-setup.md) — same server, other
  clients (Claude Desktop, Cursor, custom).
- [docs/quickstart.md](quickstart.md) — clone-to-running-stack walkthrough.
- [docs/roadmap.md](roadmap.md) — what's shipped and what's planned
  (signed manifests, HTTP transport, OAuth scopes, distributed audit
  storage).
- [SECURITY.md](../SECURITY.md) — how to report vulnerabilities.
