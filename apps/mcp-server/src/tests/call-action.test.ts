import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { callAction } from "../tools";
import type { AgentBridgeManifest } from "@agentbridge/core";

const TMP_DIR = path.join(os.tmpdir(), `agentbridge-mcp-test-${process.pid}`);

beforeEach(async () => {
  process.env.AGENTBRIDGE_DATA_DIR = TMP_DIR;
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
  delete process.env.AGENTBRIDGE_DATA_DIR;
});

const manifest: AgentBridgeManifest = {
  name: "Demo",
  version: "0.1.0",
  baseUrl: "http://localhost:3000",
  contact: "demo@test.local",
  resources: [],
  actions: [
    {
      name: "list_orders",
      title: "List orders",
      description: "Returns all orders",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object" },
      method: "POST",
      endpoint: "/api/agentbridge/actions/list_orders",
      risk: "low",
      requiresConfirmation: false,
      permissions: [],
      examples: [{ input: {} }],
      humanReadableSummaryTemplate: "List all orders",
    },
    {
      name: "execute_refund_order",
      title: "Execute refund",
      description: "Executes a previously drafted refund (simulated).",
      inputSchema: {
        type: "object",
        properties: {
          draftId: { type: "string" },
          confirmationText: { type: "string" },
        },
        required: ["draftId", "confirmationText"],
      },
      outputSchema: { type: "object" },
      method: "POST",
      endpoint: "/api/agentbridge/actions/execute_refund_order",
      risk: "high",
      requiresConfirmation: true,
      permissions: [],
      examples: [{ input: { draftId: "d1", confirmationText: "CONFIRM" } }],
      humanReadableSummaryTemplate: "Execute refund draft {{draftId}}",
    },
  ],
};

// A fetch double that:
//   - returns the manifest for the well-known endpoint
//   - records every call so we can assert the upstream action endpoint
//     was (or wasn't) hit
function makeFetchSpy(actionResult: unknown = { ok: true, result: { simulated: true } }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    calls.push({ url: u, init });
    if (u.endsWith("/.well-known/agentbridge.json")) {
      return Promise.resolve(new Response(JSON.stringify(manifest), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(actionResult), { status: 200 }));
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("callAction confirmation gate", () => {
  it("refuses high-risk actions without confirmationApproved", async () => {
    const { fetcher, calls } = makeFetchSpy();
    // First fetch (manifest) uses global fetch, which we monkey-patch on globalThis.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
      const result = await callAction(
        {
          url: "http://localhost:3000",
          actionName: "execute_refund_order",
          input: { draftId: "d1", confirmationText: "CONFIRM" },
        },
        fetcher,
      );
      expect(result.status).toBe("confirmationRequired");
      expect("summary" in result && result.summary).toContain("Execute refund draft d1");
      // Only the manifest fetch should have happened — no action endpoint hit.
      expect(calls.filter((c) => c.url.includes("/api/agentbridge/actions/")).length).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("executes after explicit confirmationApproved=true", async () => {
    const { fetcher, calls } = makeFetchSpy({
      ok: true,
      result: { simulated: true, simulatedTransactionId: "sim_tx_123" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
      const result = await callAction(
        {
          url: "http://localhost:3000",
          actionName: "execute_refund_order",
          input: { draftId: "d1", confirmationText: "CONFIRM" },
          confirmationApproved: true,
        },
        fetcher,
      );
      expect(result.status).toBe("ok");
      const actionCalls = calls.filter((c) => c.url.includes("/api/agentbridge/actions/"));
      expect(actionCalls.length).toBe(1);
      expect(actionCalls[0].url).toContain("execute_refund_order");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("low-risk actions run without confirmation", async () => {
    const { fetcher, calls } = makeFetchSpy({ ok: true, result: { orders: [] } });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
      const result = await callAction(
        {
          url: "http://localhost:3000",
          actionName: "list_orders",
          input: {},
        },
        fetcher,
      );
      expect(result.status).toBe("ok");
      const actionCalls = calls.filter((c) => c.url.includes("/api/agentbridge/actions/"));
      expect(actionCalls.length).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("validates input against the action's JSON schema", async () => {
    const { fetcher } = makeFetchSpy();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
      await expect(
        callAction(
          {
            url: "http://localhost:3000",
            actionName: "execute_refund_order",
            input: { draftId: "d1" }, // missing confirmationText
            confirmationApproved: true,
          },
          fetcher,
        ),
      ).rejects.toThrow(/input validation failed/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
