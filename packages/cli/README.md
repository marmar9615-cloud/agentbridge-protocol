# @marmarlabs/agentbridge-cli

Command-line interface for [AgentBridge](https://github.com/marmar9615-cloud/agentbridge-protocol).
Scan, validate, scaffold, and generate manifests from your terminal.

## Install

```bash
npm install -g @marmarlabs/agentbridge-cli
# or invoke directly:
npx @marmarlabs/agentbridge-cli scan http://localhost:3000
```

## Commands

### `agentbridge scan <url>`

Score a URL's AgentBridge readiness. Prints a 0–100 score and grouped
recommendations.

```bash
agentbridge scan http://localhost:3000
agentbridge scan https://api.example.com --json
```

### `agentbridge validate <file-or-url>`

Validate a manifest from disk or URL.

```bash
agentbridge validate ./public/.well-known/agentbridge.json
agentbridge validate http://localhost:3000
```

### `agentbridge init`

Scaffold an `agentbridge.config.ts` and starter manifest in the current
directory.

```bash
agentbridge init               # TypeScript config
agentbridge init --format json # JSON manifest only
```

### `agentbridge generate openapi <src>`

Convert an OpenAPI 3.x document into an AgentBridge manifest.

```bash
agentbridge generate openapi ./store.openapi.json --out ./agentbridge.json
agentbridge generate openapi https://api.example.com/openapi.json --base-url https://api.example.com
```

### `agentbridge mcp-config`

Print copy-pasteable MCP client config snippets for OpenAI Codex (CLI
one-liner and `config.toml`), Claude Desktop, Cursor, and any other
MCP-compatible client.

```bash
# OpenAI Codex one-liner (also printed by mcp-config)
codex mcp add agentbridge -- npx -y @marmarlabs/agentbridge-mcp-server
```

Full Codex walkthrough:
[docs/codex-setup.md](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/codex-setup.md).
For everything else (Claude Desktop, Cursor, custom):
[docs/mcp-client-setup.md](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/mcp-client-setup.md).

### `agentbridge version`

Print the CLI version.

## Regression-tested examples

CLI regression coverage exercises the repo examples that adopters are
most likely to copy:

- `examples/adopter-quickstart/manifest.basic.json`
- `examples/adopter-quickstart/manifest.production-shaped.json`
- `examples/scanner-regression/*.json` (valid fixtures pass; the
  intentionally invalid fixture fails safely)
- `examples/openapi-store/store.openapi.json`
- `examples/openapi-regression/catalog-regression.openapi.json`
- `examples/sdk-basic/manifest.ts` generated to JSON and validated
- `examples/signed-manifest-basic/manifest.ts` generated to signed
  JSON and schema-validated
- `agentbridge mcp-config`, including stdio, Codex, Claude Desktop,
  Cursor / generic JSON, and the v0.4.0 HTTP transport block

After building the workspace, run the same example validation pass
manually with:

```bash
npm run validate:examples
npm run validate:mcp-config-examples
```

## Exit codes

- `0` — success
- `1` — validation failure or runtime error
- `2` — invalid arguments

## Status

Public release. v0.2.2 is a docs-and-CLI-output release that adds
OpenAI Codex onboarding to the `mcp-config` command and to the docs —
no other code or behavior changes. AgentBridge is suitable for local
development, manifest authoring, scanner workflows, OpenAPI import,
and MCP experiments. It is not yet production security
infrastructure.

The CLI command surface is stable for the v0.x line.

## License

Apache-2.0
