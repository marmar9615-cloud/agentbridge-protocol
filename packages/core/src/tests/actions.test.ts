import { describe, it, expect } from "vitest";
import { isRiskyAction, summarizeAction } from "../actions";
import type { AgentAction } from "../types";

const baseAction: AgentAction = {
  name: "test",
  title: "Test",
  description: "Test action",
  inputSchema: { type: "object" },
  method: "POST",
  endpoint: "/api/test",
  risk: "low",
  requiresConfirmation: false,
  permissions: [],
  examples: [],
};

describe("isRiskyAction", () => {
  it("returns false for low risk without confirmation", () => {
    expect(isRiskyAction(baseAction)).toBe(false);
  });

  it("returns true for high risk", () => {
    expect(isRiskyAction({ ...baseAction, risk: "high" })).toBe(true);
  });

  it("returns true for medium risk", () => {
    expect(isRiskyAction({ ...baseAction, risk: "medium" })).toBe(true);
  });

  it("returns true for low risk that requires confirmation", () => {
    expect(isRiskyAction({ ...baseAction, requiresConfirmation: true })).toBe(true);
  });
});

describe("summarizeAction", () => {
  it("substitutes placeholders", () => {
    const action: AgentAction = {
      ...baseAction,
      humanReadableSummaryTemplate: "Refund order {{orderId}} for ${{amount}}",
    };
    expect(summarizeAction(action, { orderId: "ORD-1", amount: 50 })).toBe(
      "Refund order ORD-1 for $50",
    );
  });

  it("substitutes <unknown> for missing keys", () => {
    const action: AgentAction = {
      ...baseAction,
      humanReadableSummaryTemplate: "Action on {{missing}}",
    };
    expect(summarizeAction(action, {})).toBe("Action on <unknown>");
  });

  it("falls back to title when no template", () => {
    expect(summarizeAction(baseAction, { foo: "bar" })).toBe("Test");
  });

  it("supports dotted lookups", () => {
    const action: AgentAction = {
      ...baseAction,
      humanReadableSummaryTemplate: "Order {{order.id}}",
    };
    expect(summarizeAction(action, { order: { id: "ORD-9" } })).toBe("Order ORD-9");
  });
});
