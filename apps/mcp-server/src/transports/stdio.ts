/* stdio transport adapter for the AgentBridge MCP server.
 *
 * Builds the shared `Server` via `createMcpServer()` and connects it to a
 * `StdioServerTransport`. This is the default and (for now) only runtime
 * transport: HTTP arrives in a follow-up PR per
 * docs/designs/http-mcp-transport-auth.md.
 *
 * Stdout discipline is preserved: the MCP SDK's StdioServerTransport
 * only writes JSON-RPC bytes to stdout, and this module deliberately
 * does not log anything (warnings/diagnostics already go to stderr from
 * safety.ts and config.ts via process.stderr.write). The
 * stdio-hygiene.test.ts subprocess test is the canonical proof.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../server";

/**
 * Build the shared MCP server, attach a stdio transport, and return once
 * the connection is established. Resolves to the connected `Server` so
 * callers can `close()` it during tests.
 *
 * Throws on transport setup failure; callers (i.e. `index.ts`) should
 * route that to `console.error` + non-zero exit so the failure surfaces
 * on stderr without polluting stdout.
 */
export async function runStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
