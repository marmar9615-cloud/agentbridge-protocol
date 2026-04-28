/* AgentBridge MCP server entry point.
 *
 * Default transport: stdio. HTTP is opt-in via
 * `AGENTBRIDGE_TRANSPORT=http`. The shared server (tools, resources,
 * prompts, dispatcher) lives in ./server.ts; transport adapters live
 * in ./transports/*.ts. This file is intentionally tiny — it picks a
 * transport and routes top-level startup errors to stderr.
 *
 * v0.4.0 design: docs/designs/http-mcp-transport-auth.md.
 */

import { resolveTransport } from "./config";
import { runStdioServer } from "./transports/stdio";
import { runHttpServer } from "./transports/http";

async function main(): Promise<void> {
  const transport = resolveTransport();
  if (transport === "http") {
    await runHttpServer();
    return;
  }
  await runStdioServer();
}

main().catch((err) => {
  console.error("[agentbridge-mcp] fatal:", err);
  process.exit(1);
});
