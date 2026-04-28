# Examples

Self-contained examples showing how to integrate AgentBridge in different contexts.
The CLI regression suite validates the manifest and OpenAPI examples
that adopters are most likely to copy. MCP client config examples are
covered by `npm run validate:mcp-config-examples`.

| Directory | What it shows |
|---|---|
| [`nextjs-basic/`](./nextjs-basic) | Minimal Next.js integration using `@marmarlabs/agentbridge-sdk`. |
| [`sdk-basic/`](./sdk-basic) | Lightweight SDK module showing action definitions, manifest creation, and validation. |
| [`signed-manifest-basic/`](./signed-manifest-basic) | SDK signing example that emits a schema-valid signed manifest with test-only Ed25519 key material. |
| [`adopter-quickstart/`](./adopter-quickstart) | Static manifest examples for adding AgentBridge to an existing app. |
| [`openapi-store/`](./openapi-store) | OpenAPI document → AgentBridge manifest via the CLI. |
| [`openapi-regression/`](./openapi-regression) | OpenAPI converter regression fixtures for stable v1.0 mapping behavior. |
| [`scanner-regression/`](./scanner-regression) | Scanner readiness fixtures for public API and scoring regression tests. |
| [`mcp-client-config/`](./mcp-client-config) | Wiring AgentBridge MCP into Claude Desktop / Cursor / custom clients. |
| [`codex-config/`](./codex-config) | OpenAI Codex `config.toml` snippets — global and project-scoped. |
| [`codex-plugin/`](./codex-plugin) | **Experimental** local Codex plugin skeleton (plugin.json + .mcp.json + skill). Not a published plugin. |
| [`http-client-config/`](./http-client-config) | **Experimental (v0.4.0).** Opt-in HTTP MCP transport recipe — env vars, curl smoke for auth/origin/query-token, generic hosted-client JSON. |

For a runnable, full-featured example, see [`apps/demo-app/`](../apps/demo-app) at the repo root.
