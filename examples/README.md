# Examples

Self-contained examples showing how to integrate AgentBridge in different contexts.

| Directory | What it shows |
|---|---|
| [`nextjs-basic/`](./nextjs-basic) | Minimal Next.js integration using `@marmarlabs/agentbridge-sdk`. |
| [`adopter-quickstart/`](./adopter-quickstart) | Static manifest examples for adding AgentBridge to an existing app. |
| [`openapi-store/`](./openapi-store) | OpenAPI document → AgentBridge manifest via the CLI. |
| [`openapi-regression/`](./openapi-regression) | OpenAPI converter regression fixtures for stable v1.0 mapping behavior. |
| [`mcp-client-config/`](./mcp-client-config) | Wiring AgentBridge MCP into Claude Desktop / Cursor / custom clients. |
| [`codex-config/`](./codex-config) | OpenAI Codex `config.toml` snippets — global and project-scoped. |
| [`codex-plugin/`](./codex-plugin) | **Experimental** local Codex plugin skeleton (plugin.json + .mcp.json + skill). Not a published plugin. |
| [`http-client-config/`](./http-client-config) | **Experimental (v0.4.0).** Opt-in HTTP MCP transport recipe — env vars, curl smoke for auth/origin/query-token, generic hosted-client JSON. |

For a runnable, full-featured example, see [`apps/demo-app/`](../apps/demo-app) at the repo root.
