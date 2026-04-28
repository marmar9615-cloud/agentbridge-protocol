import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, TOOLS } from "../server";

/* The transport-abstraction refactor (v0.4.0 implementation PR 1) moved
 * the MCP server wiring out of index.ts into a `createMcpServer()`
 * factory. These tests pin the factory's behavior so future transports
 * (HTTP) can plug in without forking the dispatcher.
 *
 * They use the SDK's InMemoryTransport pair so we can drive the server
 * end-to-end through the real MCP wire protocol without needing a
 * subprocess. The stdio-hygiene.test.ts subprocess test still proves
 * the dist binary's stdout discipline is intact.
 */

async function connectClientToFactory() {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "factory-test", version: "0" });
  await client.connect(clientTransport);
  return { server, client };
}

describe("createMcpServer (transport-agnostic factory)", () => {
  it("exposes the five AgentBridge tools in the expected order", async () => {
    const { server, client } = await connectClientToFactory();
    try {
      const list = await client.listTools();
      expect(list.tools.map((t) => t.name)).toEqual([
        "discover_manifest",
        "scan_agent_readiness",
        "list_actions",
        "call_action",
        "get_audit_log",
      ]);
      // Sanity: the static TOOLS export and what the server returns over
      // the wire describe the same set of tools.
      expect(list.tools.map((t) => t.name)).toEqual(
        TOOLS.map((t) => t.name),
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("exposes the four AgentBridge resources", async () => {
    const { server, client } = await connectClientToFactory();
    try {
      const list = await client.listResources();
      expect(list.resources.map((r) => r.uri).sort()).toEqual([
        "agentbridge://audit-log",
        "agentbridge://manifest",
        "agentbridge://readiness",
        "agentbridge://spec/manifest-v0.1",
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("exposes the four AgentBridge prompts", async () => {
    const { server, client } = await connectClientToFactory();
    try {
      const list = await client.listPrompts();
      expect(list.prompts.map((p) => p.name).sort()).toEqual([
        "explain_action_confirmation",
        "generate_manifest_from_api",
        "review_manifest_for_security",
        "scan_app_for_agent_readiness",
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns isError=true content (not a JSON-RPC error) when an unknown tool is called", async () => {
    // Behavior preservation: pre-refactor, dispatchTool's `default:` throws
    // were caught by the CallToolRequestSchema handler and converted into
    // an isError response. The factory must keep that contract.
    const { server, client } = await connectClientToFactory();
    try {
      const result = (await client.callTool({
        name: "no_such_tool",
        arguments: {},
      })) as {
        isError?: boolean;
        content?: { type: string; text: string }[];
      };
      expect(result.isError).toBe(true);
      const text = result.content?.[0]?.text ?? "";
      expect(text).toMatch(/unknown tool: no_such_tool/);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
