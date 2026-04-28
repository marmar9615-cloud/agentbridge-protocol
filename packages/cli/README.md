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

Print example MCP client configuration snippets (Claude Desktop, Cursor)
for wiring AgentBridge into your AI client.

### `agentbridge version`

Print the CLI version.

## Exit codes

- `0` — success
- `1` — validation failure or runtime error
- `2` — invalid arguments

## Status

Public release. v0.2.1 is a docs-only patch over v0.2.0 that cleans up
package README wording — no code or behavior changes. AgentBridge is
suitable for local development, manifest authoring, scanner workflows,
OpenAPI import, and MCP experiments. It is not yet production security
infrastructure.

The CLI command surface is stable for the v0.x line.

## License

Apache-2.0
