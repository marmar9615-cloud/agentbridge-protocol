import { describe, it, expect, vi } from "vitest";
import { scanUrl } from "../scanner";
import type { AgentBridgeManifest } from "@agentbridge/core";

function makeFetch(handler: (url: string) => Promise<Response> | Response): typeof fetch {
  return ((url: RequestInfo | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    return Promise.resolve(handler(u));
  }) as typeof fetch;
}

const fullManifest: AgentBridgeManifest = {
  name: "Test",
  version: "0.1.0",
  baseUrl: "http://localhost:3000",
  contact: "demo@test.local",
  resources: [],
  actions: [
    {
      name: "list_orders",
      title: "List Orders",
      description: "Returns all orders for review.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "array" },
      method: "GET",
      endpoint: "/api/agentbridge/actions/list_orders",
      risk: "low",
      requiresConfirmation: false,
      permissions: [],
      examples: [{ input: {}, description: "List all orders" }],
      humanReadableSummaryTemplate: "List all orders",
    },
    {
      name: "execute_refund_order",
      title: "Execute Refund",
      description: "Executes a refund draft.",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      method: "POST",
      endpoint: "/api/agentbridge/actions/execute_refund_order",
      risk: "high",
      requiresConfirmation: true,
      permissions: [],
      examples: [{ input: { draftId: "d1" } }],
      humanReadableSummaryTemplate: "Execute refund draft {{draftId}}",
    },
  ],
};

describe("scanUrl", () => {
  it("scores 0 when manifest is missing", async () => {
    const fetcher = makeFetch(() => new Response("", { status: 404 }));
    const result = await scanUrl("http://localhost:3000", { fetcher });
    expect(result.manifestFound).toBe(false);
    expect(result.score).toBe(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("scores high for a complete, well-formed manifest", async () => {
    const fetcher = makeFetch(
      () => new Response(JSON.stringify(fullManifest), { status: 200 }),
    );
    const result = await scanUrl("http://localhost:3000", { fetcher });
    expect(result.validManifest).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.actionCount).toBe(2);
    expect(result.riskyActionCount).toBe(1);
    expect(result.missingConfirmationCount).toBe(0);
  });

  it("flags high-risk action without confirmation", async () => {
    const dangerous: AgentBridgeManifest = {
      ...fullManifest,
      actions: [
        { ...fullManifest.actions[1], requiresConfirmation: false },
      ],
    };
    const fetcher = makeFetch(
      () => new Response(JSON.stringify(dangerous), { status: 200 }),
    );
    const result = await scanUrl("http://localhost:3000", { fetcher });
    expect(result.missingConfirmationCount).toBe(1);
    expect(result.score).toBeLessThan(95);
    expect(
      result.recommendations.some((r) => r.includes("requiresConfirmation")),
    ).toBe(true);
  });

  it("rejects non-loopback URLs by default", async () => {
    await expect(scanUrl("http://example.com")).rejects.toThrow(/loopback/);
  });

  it("rejects non-http URLs", async () => {
    await expect(scanUrl("file:///etc/passwd")).rejects.toThrow(/http/);
  });

  it("returns validationErrors when manifest is malformed", async () => {
    const broken = { name: "X" }; // missing required fields
    const fetcher = makeFetch(
      () => new Response(JSON.stringify(broken), { status: 200 }),
    );
    const result = await scanUrl("http://localhost:3000", { fetcher });
    expect(result.manifestFound).toBe(true);
    expect(result.validManifest).toBe(false);
    expect(result.validationErrors?.length).toBeGreaterThan(0);
  });
});
