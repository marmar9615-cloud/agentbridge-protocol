/* AgentBridge MCP server.
 *
 * Speaks MCP over stdio. Exposes tools, resources, and prompts to AI agents
 * for discovering, scanning, and safely invoking AgentBridge actions on a
 * target URL.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  callAction,
  discoverManifest,
  getAuditLog,
  listActions,
  scanAgentReadiness,
} from "./tools";
import { PROMPTS, renderPrompt } from "./prompts";
import { STATIC_RESOURCES, readResource } from "./resources";

const server = new Server(
  { name: "agentbridge", version: "0.3.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);

// ── Tools ────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "discover_manifest",
    title: "Discover AgentBridge manifest",
    description:
      "Fetch and summarize an AgentBridge manifest from a URL. Use this first to understand what actions a site exposes.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Origin URL of the target app" } },
      required: ["url"],
    },
    outputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        version: { type: "string" },
        baseUrl: { type: "string" },
        actionCount: { type: "number" },
        actionsByRisk: { type: "object" },
      },
    },
  },
  {
    name: "scan_agent_readiness",
    title: "Scan agent readiness",
    description:
      "Score how agent-ready a URL is. Returns a 0–100 score, structured checks, and grouped recommendations.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "list_actions",
    title: "List actions",
    description: "List all actions in the AgentBridge manifest at a URL.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "call_action",
    title: "Call an AgentBridge action",
    description:
      "Invoke an AgentBridge action. Risky actions return a confirmationRequired response with a confirmationToken; the client must re-call with confirmationApproved: true AND the same confirmationToken to execute. Optional idempotencyKey replays prior results for the same key+input.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        actionName: { type: "string" },
        input: { type: "object" },
        confirmationApproved: { type: "boolean" },
        confirmationToken: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["url", "actionName"],
    },
  },
  {
    name: "get_audit_log",
    title: "Read audit log",
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
    const result = await dispatchTool(name, args as Record<string, unknown>);
    // Return both readable text (for human-facing MCP UIs) AND structured
    // content (for agent-side parsing). Older clients ignore structuredContent.
    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
    };
  }
});

async function dispatchTool(name: string, args: Record<string, unknown>) {
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
        confirmationToken:
          typeof args.confirmationToken === "string" ? args.confirmationToken : undefined,
        idempotencyKey:
          typeof args.idempotencyKey === "string" ? args.idempotencyKey : undefined,
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

// ── Resources ────────────────────────────────────────────────────────
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: STATIC_RESOURCES,
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const { uri } = req.params;
  const result = await readResource(uri);
  return {
    contents: [{ uri: result.uri, mimeType: result.mimeType, text: result.text }],
  };
});

// ── Prompts ──────────────────────────────────────────────────────────
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS.map((p) => ({
    name: p.name,
    description: p.description,
    arguments: p.arguments,
  })),
}));

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  // SDK GetPromptResult is a discriminated union — cast to the index-signature
  // form so TS doesn't try to narrow into the task-result branch.
  return renderPrompt(name, args as Record<string, string>) as unknown as {
    [x: string]: unknown;
    description?: string;
    messages: { role: "user"; content: { type: "text"; text: string } }[];
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[agentbridge-mcp] fatal:", err);
  process.exit(1);
});
