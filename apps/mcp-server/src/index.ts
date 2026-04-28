/* AgentBridge MCP server entry point.
 *
 * Speaks MCP over stdio by default. The shared server (tools, resources,
 * prompts, dispatcher) lives in ./server.ts; the transport adapter lives
 * in ./transports/stdio.ts. This file is intentionally tiny — it picks a
 * transport and routes top-level startup errors to stderr.
 *
 * v0.4.0 will add an opt-in HTTP transport (see
 * docs/designs/http-mcp-transport-auth.md). Until then, stdio is the
 * only runtime transport.
 */

import { runStdioServer } from "./transports/stdio";

runStdioServer().catch((err) => {
  console.error("[agentbridge-mcp] fatal:", err);
  process.exit(1);
});
