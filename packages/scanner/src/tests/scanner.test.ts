import { describe, it, expect } from "vitest";
import { scanUrl } from "../scanner";
import { scoreManifest } from "../score";
import type { AgentBridgeManifest } from "@marmarlabs/agentbridge-core";

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
  auth: { type: "none" },
  resources: [{ name: "orders" }],
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
      inputSchema: { type: "object", properties: { draftId: { type: "string" } } },
      outputSchema: { type: "object" },
      method: "POST",
      endpoint: "/api/agentbridge/actions/execute_refund_order",
      risk: "high",
      requiresConfirmation: true,
      permissions: [{ scope: "orders:write" }],
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
    // Structured field also populated.
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks[0].id).toBe("manifest.not-found");
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
    expect(result.passed.length).toBeGreaterThan(0);
  });

  it("flags high-risk action without confirmation as error", async () => {
    const dangerous: AgentBridgeManifest = {
      ...fullManifest,
      actions: [{ ...fullManifest.actions[1], requiresConfirmation: false }],
    };
    const fetcher = makeFetch(
      () => new Response(JSON.stringify(dangerous), { status: 200 }),
    );
    const result = await scanUrl("http://localhost:3000", { fetcher });
    expect(result.missingConfirmationCount).toBe(1);
    expect(result.score).toBeLessThan(95);
    const errorChecks = result.checks.filter((c) => c.severity === "error");
    expect(errorChecks.some((c) => c.id === "action.high-risk-no-confirm")).toBe(true);
    expect(result.recommendationGroups.safety.length).toBeGreaterThan(0);
  });

  it("flags DELETE method without high risk or confirmation", async () => {
    const m: AgentBridgeManifest = {
      ...fullManifest,
      actions: [
        {
          ...fullManifest.actions[0],
          name: "delete_thing",
          method: "DELETE",
          risk: "low",
          requiresConfirmation: false,
        },
      ],
    };
    const fetcher = makeFetch(() => new Response(JSON.stringify(m), { status: 200 }));
    const result = await scanUrl("http://localhost:3000", { fetcher });
    expect(
      result.checks.some((c) => c.id === "action.destructive-method-low-friction"),
    ).toBe(true);
  });

  it("flags non-object inputSchema", async () => {
    const m: AgentBridgeManifest = {
      ...fullManifest,
      actions: [{ ...fullManifest.actions[0], inputSchema: { type: "string" } }],
    };
    const fetcher = makeFetch(() => new Response(JSON.stringify(m), { status: 200 }));
    const result = await scanUrl("http://localhost:3000", { fetcher });
    expect(result.checks.some((c) => c.id === "action.input-schema-not-object")).toBe(true);
  });

  it("rejects non-loopback URLs by default", async () => {
    await expect(scanUrl("http://example.com")).rejects.toThrow(/loopback/);
  });

  it("rejects non-http URLs", async () => {
    await expect(scanUrl("file:///etc/passwd")).rejects.toThrow(/http/);
  });

  it("returns validationErrors when manifest is malformed", async () => {
    const broken = { name: "X" };
    const fetcher = makeFetch(() => new Response(JSON.stringify(broken), { status: 200 }));
    const result = await scanUrl("http://localhost:3000", { fetcher });
    expect(result.manifestFound).toBe(true);
    expect(result.validManifest).toBe(false);
    expect(result.validationErrors?.length).toBeGreaterThan(0);
    expect(result.checks[0].id).toBe("manifest.invalid");
  });

  it("flags cross-origin baseUrl as warning", async () => {
    const m: AgentBridgeManifest = {
      ...fullManifest,
      baseUrl: "http://localhost:9999",
    };
    const fetcher = makeFetch(() => new Response(JSON.stringify(m), { status: 200 }));
    const result = await scanUrl("http://localhost:3000", { fetcher });
    expect(result.checks.some((c) => c.id === "manifest.baseUrl.cross-origin")).toBe(true);
  });

  it("populates recommendationGroups by category", async () => {
    const fetcher = makeFetch(
      () => new Response(JSON.stringify(fullManifest), { status: 200 }),
    );
    const result = await scanUrl("http://localhost:3000", { fetcher });
    expect(result.recommendationGroups).toHaveProperty("safety");
    expect(result.recommendationGroups).toHaveProperty("schema");
    expect(result.recommendationGroups).toHaveProperty("docs");
    expect(result.recommendationGroups).toHaveProperty("developerExperience");
  });
});

describe("scoreManifest direct", () => {
  it("uses the provided manifest verbatim", () => {
    const result = scoreManifest(fullManifest);
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.actionCount).toBe(2);
    expect(result.checks.every((c) => typeof c.id === "string")).toBe(true);
  });
});
