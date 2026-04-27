#!/usr/bin/env tsx
/* AgentBridge MCP server.
 *
 * Speaks MCP over stdio. Exposes 5 tools for AI agents to discover, scan,
 * and safely invoke AgentBridge actions on a target URL.
 *
 * Run:
 *   npm run dev:mcp
 *
 * Then connect from any MCP-compatible client (Claude Desktop, the official
 * MCP CLI, etc.) by pointing it at this command.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  callAction,
  discoverManifest,
  getAuditLog,
  listActions,
  scanAgentReadiness,
} from "./tools";

const server = new Server(
  {
    name: "agentbridge",
    version: "0.1.0",
  },
  {
    capabilities: { tools: {} },
  },
);

const TOOLS = [
  {
    name: "discover_manifest",
    description:
      "Fetch and summarize an AgentBridge manifest from a URL. Use this first to understand what actions a site exposes.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Origin URL of the target app" } },
      required: ["url"],
    },
  },
  {
    name: "scan_agent_readiness",
    description:
      "Score how agent-ready a URL is. Returns a 0–100 score plus issues and recommendations.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "list_actions",
    description: "List all actions in the AgentBridge manifest at a URL.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "call_action",
    description:
      "Invoke an AgentBridge action. Risky actions require confirmationApproved: true; otherwise this tool returns a confirmationRequired response with a human-readable summary.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        actionName: { type: "string" },
        input: { type: "object" },
        confirmationApproved: { type: "boolean" },
      },
      required: ["url", "actionName"],
    },
  },
  {
    name: "get_audit_log",
    description:
      "Read the local AgentBridge audit log. Filter by manifest URL with the optional `url` parameter.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    const result = await dispatch(name, args as Record<string, unknown>);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error: ${(err as Error).message}`,
        },
      ],
    };
  }
});

async function dispatch(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "discover_manifest":
      return discoverManifest({ url: String(args.url) });
    case "scan_agent_readiness":
      return scanAgentReadiness({ url: String(args.url) });
    case "list_actions":
      return listActions({ url: String(args.url) });
    case "call_action":
      return callAction({
        url: String(args.url),
        actionName: String(args.actionName),
        input: (args.input as Record<string, unknown> | undefined) ?? {},
        confirmationApproved: args.confirmationApproved === true,
      });
    case "get_audit_log":
      return getAuditLog({
        url: typeof args.url === "string" ? args.url : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep alive — the SDK handles graceful shutdown via stdin EOF.
}

main().catch((err) => {
  console.error("[agentbridge-mcp] fatal:", err);
  process.exit(1);
});
