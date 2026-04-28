# Codex plugin skeleton — experimental

> **Heads up.** This is a **local plugin skeleton**, not a published
> Codex plugin. It's here to show how AgentBridge could be packaged as
> a plugin if/when you want to bundle the MCP config + a skill spec
> together. It is **not** submitted to any plugin marketplace, and the
> Codex plugin schema may evolve — treat this directory as an example,
> not a distribution.

For the **stable, supported** way to use AgentBridge with Codex, see
[`docs/codex-setup.md`](../../docs/codex-setup.md). That covers the
`codex mcp add` CLI and the `~/.codex/config.toml` and
`.codex/config.toml` setups, all of which work today without this
plugin layer.

## What's in here

```
examples/codex-plugin/
├── .codex-plugin/
│   └── plugin.json          # plugin metadata + interface definition
├── .mcp.json                # MCP server config bundled with the plugin
├── skills/
│   └── agentbridge/
│       └── SKILL.md         # skill guide for an agent using AgentBridge
└── README.md                # this file
```

- **`.codex-plugin/plugin.json`** describes the plugin to Codex:
  display name, description, version, capabilities, and the path to
  the bundled MCP config and skills.
- **`.mcp.json`** is a standard MCP-server descriptor — same shape
  Codex / Claude Desktop / Cursor accept. Points at
  `npx -y @marmarlabs/agentbridge-mcp-server`.
- **`skills/agentbridge/SKILL.md`** is the operating guide for an
  agent that has the AgentBridge MCP server available. It explains
  when to use each tool and the non-negotiable safety rules
  (confirmation gate, origin pinning, loopback default).

## Caveats

- The plugin schema (file paths, key names, required fields) may
  change. If Codex updates its plugin format, the values in
  `plugin.json` will need to be brought up to date.
- The bundled MCP config uses `npx -y @marmarlabs/agentbridge-mcp-server`
  off the public npm registry. Make sure the box has network access
  on first run; subsequent runs hit the npm cache.
- Treat this skeleton as illustrative — do not assume it's
  byte-for-byte correct against a future plugin spec without
  re-validating.

## Try it locally

If your Codex install supports loading a plugin from a local
directory, point it at this folder. Otherwise, use the supported flow
in [`docs/codex-setup.md`](../../docs/codex-setup.md), which gives you
the same MCP server without needing the plugin wrapper.

## Related

- [`docs/codex-setup.md`](../../docs/codex-setup.md) — supported
  Codex setup paths (`codex mcp add`, global config, project-scoped
  config).
- [`examples/codex-config/`](../codex-config/) — copy-pasteable
  `config.toml` blocks for the supported flow.
- [`docs/mcp-client-setup.md`](../../docs/mcp-client-setup.md) — same
  AgentBridge server, other MCP clients (Claude Desktop, Cursor,
  custom).
- [`SECURITY.md`](../../SECURITY.md) — how to report security issues.
