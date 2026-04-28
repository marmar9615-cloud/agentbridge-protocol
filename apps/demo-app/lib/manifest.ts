// PROD: Real apps would attach OAuth scopes per action and check them on
// each invocation. The demo treats permissions as documentation only.

import { defineAgentAction, createAgentBridgeManifest, z } from "@marmarlabs/agentbridge-sdk";

export const listOrdersAction = defineAgentAction({
  name: "list_orders",
  title: "List orders",
  description: "Returns recent orders, optionally filtered by status.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/list_orders",
  risk: "low",
  requiresConfirmation: false,
  inputSchema: z.object({
    status: z.enum(["pending", "shipped", "delivered", "refunded"]).optional(),
  }),
  outputSchema: z.object({
    orders: z.array(z.unknown()),
  }),
  examples: [
    { description: "List all orders", input: {} },
    { description: "List only shipped orders", input: { status: "shipped" } },
  ],
  humanReadableSummaryTemplate: "List orders (status: {{status}})",
});

export const getOrderAction = defineAgentAction({
  name: "get_order",
  title: "Get order",
  description: "Returns full details for a single order, including notes and refund history.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/get_order",
  risk: "low",
  requiresConfirmation: false,
  inputSchema: z.object({
    orderId: z.string().min(1),
  }),
  outputSchema: z.object({ order: z.unknown() }),
  examples: [{ input: { orderId: "ORD-1001" } }],
  humanReadableSummaryTemplate: "Get order {{orderId}}",
});

export const draftRefundAction = defineAgentAction({
  name: "draft_refund_order",
  title: "Draft a refund",
  description:
    "Creates a refund draft for an order. The draft is not executed — it must be confirmed via execute_refund_order.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/draft_refund_order",
  risk: "medium",
  requiresConfirmation: true,
  inputSchema: z.object({
    orderId: z.string().min(1),
    reason: z.string().min(3),
    amount: z.number().positive(),
  }),
  outputSchema: z.object({
    draftId: z.string(),
    summary: z.string(),
  }),
  examples: [
    {
      description: "Draft a partial refund",
      input: { orderId: "ORD-1001", reason: "Damaged on arrival", amount: 24 },
    },
  ],
  humanReadableSummaryTemplate:
    "Draft a refund of ${{amount}} on order {{orderId}} (reason: {{reason}})",
});

export const executeRefundAction = defineAgentAction({
  name: "execute_refund_order",
  title: "Execute a drafted refund",
  description:
    "Executes a previously drafted refund. SIMULATED — no real payment processor is called. Marks the order as refunded.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/execute_refund_order",
  risk: "high",
  requiresConfirmation: true,
  inputSchema: z.object({
    draftId: z.string().min(1),
    confirmationText: z.string().min(1),
  }),
  outputSchema: z.object({
    simulated: z.literal(true),
    simulatedTransactionId: z.string(),
  }),
  examples: [
    {
      description: "Execute the refund draft after confirmation",
      input: { draftId: "draft_xxx", confirmationText: "CONFIRM" },
    },
  ],
  humanReadableSummaryTemplate: "EXECUTE refund draft {{draftId}} (irreversible in real life)",
});

export const addNoteAction = defineAgentAction({
  name: "add_internal_note",
  title: "Add an internal note",
  description: "Adds an internal note to an order. Visible to staff only.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/add_internal_note",
  risk: "medium",
  requiresConfirmation: true,
  inputSchema: z.object({
    orderId: z.string().min(1),
    note: z.string().min(1).max(500),
  }),
  outputSchema: z.object({
    noteId: z.string(),
  }),
  examples: [
    {
      input: { orderId: "ORD-1001", note: "Customer called about shipping ETA." },
    },
  ],
  humanReadableSummaryTemplate: 'Add note to order {{orderId}}: "{{note}}"',
});

export const ALL_ACTIONS = {
  list_orders: listOrdersAction,
  get_order: getOrderAction,
  draft_refund_order: draftRefundAction,
  execute_refund_order: executeRefundAction,
  add_internal_note: addNoteAction,
} as const;

export type ActionName = keyof typeof ALL_ACTIONS;

export function getDemoManifest(baseUrl: string) {
  return createAgentBridgeManifest({
    name: "Demo Order Manager",
    description:
      "A fake order management app exposing structured AgentBridge actions for AI agents.",
    version: "0.1.0",
    baseUrl,
    contact: "demo@agentbridge.local",
    auth: { type: "none", description: "Demo only — no auth. Production would require OAuth." },
    resources: [
      {
        name: "orders",
        description: "Customer orders with items, status, notes, and refund history.",
        url: "/orders",
      },
    ],
    actions: Object.values(ALL_ACTIONS),
  });
}
