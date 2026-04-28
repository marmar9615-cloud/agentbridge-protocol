import { describe, expect, it } from "vitest";
import { validateManifest } from "@marmarlabs/agentbridge-core";
import * as sdk from "../index";
import {
  createSdkBasicManifest,
  draftTicketReply,
  manifest as sdkBasicManifest,
  manifestValidation,
  validateDraftTicketReplyInput,
} from "../../../../examples/sdk-basic/manifest";

const {
  createActionHandler,
  createAgentBridgeManifest,
  defineAgentAction,
  validateActionInput,
  z,
} = sdk;

function createDraftRefundAction() {
  return defineAgentAction({
    name: "draft_refund_order",
    title: "Draft refund order",
    description: "Creates a refund draft for human review. It does not execute a refund.",
    method: "POST",
    endpoint: "/api/agentbridge/actions/draft_refund_order",
    risk: "medium",
    requiresConfirmation: true,
    inputSchema: z.object({
      orderId: z.string().min(1),
      amount: z.number().positive(),
      reason: z.string().min(3),
    }),
    outputSchema: z.object({
      draftId: z.string(),
      summary: z.string(),
    }),
    permissions: [
      {
        scope: "refunds:draft",
        description: "Create refund drafts for review.",
      },
    ],
    examples: [
      {
        description: "Damaged item",
        input: {
          orderId: "ORD-1001",
          amount: 24,
          reason: "Damaged on arrival",
        },
        output: {
          draftId: "draft_123",
          summary: "Refund draft for ORD-1001",
        },
      },
    ],
    humanReadableSummaryTemplate:
      "Draft a ${{amount}} refund on order {{orderId}} (reason: {{reason}})",
  });
}

describe("SDK public API contract", () => {
  it("exports the intended public SDK functions and zod re-export", () => {
    expect(defineAgentAction).toBeTypeOf("function");
    expect(createAgentBridgeManifest).toBeTypeOf("function");
    expect(createActionHandler).toBeTypeOf("function");
    expect(validateActionInput).toBeTypeOf("function");
    expect(z.object).toBeTypeOf("function");
  });

  it("defineAgentAction preserves manifest-facing action fields", () => {
    const action = createDraftRefundAction();

    expect(action.definition).toMatchObject({
      name: "draft_refund_order",
      title: "Draft refund order",
      description: "Creates a refund draft for human review. It does not execute a refund.",
      method: "POST",
      endpoint: "/api/agentbridge/actions/draft_refund_order",
      risk: "medium",
      requiresConfirmation: true,
      permissions: [
        {
          scope: "refunds:draft",
          description: "Create refund drafts for review.",
        },
      ],
      examples: [
        {
          description: "Damaged item",
          input: {
            orderId: "ORD-1001",
            amount: 24,
            reason: "Damaged on arrival",
          },
          output: {
            draftId: "draft_123",
            summary: "Refund draft for ORD-1001",
          },
        },
      ],
      humanReadableSummaryTemplate:
        "Draft a ${{amount}} refund on order {{orderId}} (reason: {{reason}})",
    });

    expect(action.definition.inputSchema).toMatchObject({
      type: "object",
      required: ["orderId", "amount", "reason"],
    });
    expect((action.definition.inputSchema.properties as any).amount).toMatchObject({
      type: "number",
      exclusiveMinimum: 0,
    });
    expect(action.definition.outputSchema).toMatchObject({
      type: "object",
      required: ["draftId", "summary"],
    });
  });

  it("createAgentBridgeManifest returns a core-valid manifest with metadata preserved", () => {
    const action = createDraftRefundAction();
    const manifest = createAgentBridgeManifest({
      name: "Acme Orders",
      description: "Order support actions exposed through AgentBridge.",
      version: "1.2.3",
      baseUrl: "https://orders.example.com",
      contact: "platform@example.com",
      auth: {
        type: "bearer",
        description: "Use operator-scoped bearer tokens.",
      },
      resources: [
        {
          name: "orders",
          description: "Customer orders and refund drafts.",
          url: "/orders",
        },
      ],
      actions: [action],
    });

    expect(validateManifest(manifest)).toMatchObject({ ok: true });
    expect(manifest).toMatchObject({
      name: "Acme Orders",
      description: "Order support actions exposed through AgentBridge.",
      version: "1.2.3",
      baseUrl: "https://orders.example.com",
      contact: "platform@example.com",
      auth: {
        type: "bearer",
        description: "Use operator-scoped bearer tokens.",
      },
      resources: [
        {
          name: "orders",
          description: "Customer orders and refund drafts.",
          url: "/orders",
        },
      ],
      actions: [
        {
          name: "draft_refund_order",
        },
      ],
    });
    expect(Object.keys(manifest).sort()).toEqual([
      "actions",
      "auth",
      "baseUrl",
      "contact",
      "description",
      "generatedAt",
      "name",
      "resources",
      "version",
    ]);
  });

  it("validateActionInput accepts valid input and reports useful Zod failures", () => {
    const action = createDraftRefundAction();

    expect(
      validateActionInput(action, {
        orderId: "ORD-1001",
        amount: 24,
        reason: "Damaged on arrival",
      }),
    ).toEqual({
      orderId: "ORD-1001",
      amount: 24,
      reason: "Damaged on arrival",
    });

    expect(() =>
      validateActionInput(action, {
        orderId: "ORD-1001",
        reason: "Damaged on arrival",
      }),
    ).toThrow(/Invalid input for "draft_refund_order": amount: Required/);

    expect(() =>
      validateActionInput(action, {
        orderId: "ORD-1001",
        amount: "24",
        reason: "Damaged on arrival",
      }),
    ).toThrow(/amount: Expected number, received string/);
  });

  it("validateActionInput preserves the raw JSON Schema object-input fallback", () => {
    const action = defineAgentAction({
      name: "raw_schema_action",
      title: "Raw schema action",
      description: "Uses raw JSON Schema input.",
      method: "POST",
      endpoint: "/api/agentbridge/actions/raw_schema_action",
      risk: "low",
      inputSchema: {
        type: "object",
        properties: {
          note: { type: "string" },
        },
      },
    });

    expect(validateActionInput(action, { note: 123 })).toEqual({ note: 123 });
    expect(() => validateActionInput(action, null)).toThrow(
      /Action "raw_schema_action" expected an object input/,
    );
  });

  it("createActionHandler validates POST input before calling the handler", async () => {
    const action = createDraftRefundAction();
    const seen: Record<string, unknown>[] = [];
    const handler = createActionHandler(action, async (input) => {
      seen.push(input);
      return {
        draftId: "draft_123",
        acceptedAmount: (input as any).amount,
      };
    });

    const response = await handler(
      new Request("https://orders.example.com/api/agentbridge/actions/draft_refund_order", {
        method: "POST",
        body: JSON.stringify({
          orderId: "ORD-1001",
          amount: 24,
          reason: "Damaged on arrival",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: {
        draftId: "draft_123",
        acceptedAmount: 24,
      },
    });
    expect(seen).toEqual([
      {
        orderId: "ORD-1001",
        amount: 24,
        reason: "Damaged on arrival",
      },
    ]);
  });

  it("createActionHandler returns JSON 400 responses for malformed or invalid POST input", async () => {
    const action = createDraftRefundAction();
    const handler = createActionHandler(action, () => {
      throw new Error("handler should not be called for invalid input");
    });

    const malformed = await handler(
      new Request("https://orders.example.com/api/agentbridge/actions/draft_refund_order", {
        method: "POST",
        body: "{not json",
      }),
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Invalid request body"),
    });

    const invalid = await handler(
      new Request("https://orders.example.com/api/agentbridge/actions/draft_refund_order", {
        method: "POST",
        body: JSON.stringify({
          orderId: "ORD-1001",
          reason: "Damaged on arrival",
        }),
      }),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid input for "draft_refund_order": amount: Required',
    });
  });

  it("createActionHandler parses GET query parameters before validation", async () => {
    const action = defineAgentAction({
      name: "get_order",
      title: "Get order",
      description: "Returns one order.",
      method: "GET",
      endpoint: "/api/agentbridge/actions/get_order",
      risk: "low",
      requiresConfirmation: false,
      inputSchema: z.object({
        orderId: z.string().min(1),
      }),
      outputSchema: z.object({
        order: z.unknown(),
      }),
    });
    const handler = createActionHandler(action, async (input) => ({ input }));

    const response = await handler(
      new Request("https://orders.example.com/api/agentbridge/actions/get_order?orderId=ORD-1001"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: {
        input: {
          orderId: "ORD-1001",
        },
      },
    });
  });

  it("createActionHandler returns JSON 500 responses for handler failures", async () => {
    const action = createDraftRefundAction();
    const handler = createActionHandler(action, async () => {
      throw new Error("database unavailable");
    });

    const response = await handler(
      new Request("https://orders.example.com/api/agentbridge/actions/draft_refund_order", {
        method: "POST",
        body: JSON.stringify({
          orderId: "ORD-1001",
          amount: 24,
          reason: "Damaged on arrival",
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "database unavailable",
    });
  });

  it("keeps the SDK basic example valid against the core manifest contract", () => {
    expect(manifestValidation).toMatchObject({ ok: true });
    expect(validateManifest(sdkBasicManifest)).toMatchObject({ ok: true });

    const manifest = createSdkBasicManifest("http://localhost:3000");
    expect(manifest.baseUrl).toBe("http://localhost:3000");
    expect(manifest.actions.map((a) => a.name)).toEqual([
      "list_tickets",
      "draft_ticket_reply",
      "simulate_ticket_escalation",
    ]);
    expect(manifest.actions.map((a) => [a.risk, a.requiresConfirmation])).toEqual([
      ["low", false],
      ["medium", true],
      ["high", true],
    ]);
  });

  it("keeps the SDK basic example input validator usable at runtime", () => {
    expect(
      validateDraftTicketReplyInput({
        ticketId: "T-1001",
        body: "Thanks for the report.",
      }),
    ).toEqual({
      ticketId: "T-1001",
      body: "Thanks for the report.",
      tone: "friendly",
    });

    expect(() =>
      validateActionInput(draftTicketReply, {
        ticketId: "T-1001",
        body: "",
      }),
    ).toThrow(/body: String must contain at least 1 character/);
  });
});
