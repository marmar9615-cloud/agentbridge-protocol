import { describe, it, expect } from "vitest";
import { validateManifest } from "../manifest";

const validManifest = {
  name: "Test App",
  version: "1.0.0",
  baseUrl: "http://localhost:3000",
  actions: [
    {
      name: "list_orders",
      title: "List Orders",
      description: "Returns all orders",
      inputSchema: { type: "object", properties: {} },
      method: "GET",
      endpoint: "/api/agentbridge/actions/list_orders",
      risk: "low",
      requiresConfirmation: false,
    },
  ],
};

describe("validateManifest", () => {
  it("accepts a valid manifest", () => {
    const result = validateManifest(validManifest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.name).toBe("Test App");
      expect(result.manifest.actions).toHaveLength(1);
    }
  });

  it("rejects manifest missing name", () => {
    const { name, ...rest } = validManifest;
    const result = validateManifest(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("name"))).toBe(true);
    }
  });

  it("rejects bad risk enum", () => {
    const bad = {
      ...validManifest,
      actions: [{ ...validManifest.actions[0], risk: "extreme" }],
    };
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects non-URL baseUrl", () => {
    const result = validateManifest({ ...validManifest, baseUrl: "not-a-url" });
    expect(result.ok).toBe(false);
  });

  it("defaults resources and permissions arrays", () => {
    const result = validateManifest(validManifest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.resources).toEqual([]);
      expect(result.manifest.actions[0].permissions).toEqual([]);
    }
  });
});
