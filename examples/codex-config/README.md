# Codex config examples

Two ready-made `config.toml` blocks for hooking
[`@marmarlabs/agentbridge-mcp-server`](https://www.npmjs.com/package/@marmarlabs/agentbridge-mcp-server)
into [OpenAI Codex](https://openai.com/codex/).

| File | What it's for |
|---|---|
| [`config.global.toml`](./config.global.toml) | Drop into `~/.codex/config.toml` to make AgentBridge available in every Codex session. |
| [`config.project.toml`](./config.project.toml) | Drop into `.codex/config.toml` at a repo root to make AgentBridge available only when Codex is launched from that repo. |

Both blocks reach the same AgentBridge stdio server
(`npx -y @marmarlabs/agentbridge-mcp-server`) — the difference is only
where Codex picks the config up from.

## When to use which

- **Global config** — you author manifests across multiple repos, or
  you want AgentBridge tools in every Codex session by default.
- **Project-scoped config** — you only want AgentBridge attached when
  you're actively working on one specific repo. Keeps your global
  Codex config minimal and avoids attaching MCP servers to unrelated
  codebases.

You can also use **both** — global keeps the server warm for ad-hoc
exploration; project-scoped lets a specific repo pin a different
config (e.g. extra env vars, a different startup timeout).

## Apply

```bash
# Global
mkdir -p ~/.codex
cat config.global.toml >> ~/.codex/config.toml

# Project-scoped (run from the repo root you want to enable)
mkdir -p .codex
cat config.project.toml >> .codex/config.toml
```

> If `~/.codex/config.toml` already has a `[mcp_servers.agentbridge]`
> section, edit it in place rather than appending — TOML rejects
> duplicate sections.

## Verify

Launch Codex and run:

```
/mcp
```

`agentbridge` should appear in the list. If it doesn't, see
[`docs/codex-setup.md`](../../docs/codex-setup.md#troubleshooting).

## Try it

Boot the demo app (from the repo root):

```bash
npm install
npm run dev
```

Then in Codex:

```
Use the agentbridge MCP server to discover the manifest at
http://localhost:3000. List the actions, run scan_agent_readiness,
and stop. Do not execute any medium or high risk actions.
```

You should see Codex call `discover_manifest`, `list_actions`, and
`scan_agent_readiness` against the demo. Risky actions (`draft_refund_order`,
`execute_refund_order`, `add_internal_note`) will not execute — they
require explicit `confirmationApproved: true` plus a single-use
`confirmationToken` from the previous response.

Detailed walkthrough, prompt suggestions, and a confirmation-flow
example are in [`docs/codex-setup.md`](../../docs/codex-setup.md).
