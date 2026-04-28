import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  generateManifestFromOpenApi,
  inferRiskFromMethod,
  operationToAgentAction,
  parseOpenApiDocument,
} from "../index";
import type { OpenApiDocument } from "../types";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const regressionFixture = JSON.parse(
  readFileSync(
    path.join(repoRoot, "examples/openapi-regression/catalog-regression.openapi.json"),
    "utf8",
  ),
) as OpenApiDocument;

function generate() {
  return generateManifestFromOpenApi(regressionFixture);
}

describe("OpenAPI regression fixture", () => {
  it("normalizes operationIds and fallback path names into stable action names", () => {
    const { manifest } = generate();

    expect(manifest.actions.map((a) => a.name)).toEqual([
      "list_orders_v2",
      "create_order",
      "get_orders_order_id",
      "replace_order_status",
      "patch_order_metadata",
      "delete_order_danger",
      "create_refund_draft",
      "delete_projects_project_id_notes_note_id",
    ]);
  });

  it("maps summary and description without deriving behavior from tags", () => {
    const listOrders = generate().manifest.actions.find((a) => a.name === "list_orders_v2");

    expect(listOrders?.title).toBe("List orders");
    expect(listOrders?.description).toBe("Returns orders filtered by status or customer.");
    expect(listOrders?.permissions).toEqual([]);
  });

  it("uses method-based risk and confirmation inference", () => {
    const actions = Object.fromEntries(generate().manifest.actions.map((a) => [a.name, a]));

    expect(actions.list_orders_v2.risk).toBe("low");
    expect(actions.list_orders_v2.requiresConfirmation).toBe(false);

    for (const name of [
      "create_order",
      "replace_order_status",
      "patch_order_metadata",
      "create_refund_draft",
    ]) {
      expect(actions[name].risk).toBe("medium");
      expect(actions[name].requiresConfirmation).toBe(true);
    }

    expect(actions.delete_order_danger.risk).toBe("high");
    expect(actions.delete_order_danger.requiresConfirmation).toBe(true);
    expect(actions.delete_projects_project_id_notes_note_id.risk).toBe("high");
    expect(actions.delete_projects_project_id_notes_note_id.requiresConfirmation).toBe(true);
  });

  it("keeps HEAD as a low-risk inference helper value but skips it as an action method", () => {
    const result = generate();

    expect(inferRiskFromMethod("HEAD")).toBe("low");
    expect(result.manifest.actions.some((a) => a.endpoint === "/reports/{reportId}/exports")).toBe(
      false,
    );
    expect(result.skipped).toEqual([
      {
        path: "/reports/{reportId}/exports",
        method: "HEAD",
        reason: "Method HEAD not supported by AgentBridge actions.",
      },
    ]);
  });

  it("converts query and path parameters into input schema properties", () => {
    const getOrder = generate().manifest.actions.find((a) => a.name === "get_orders_order_id");
    const input = getOrder?.inputSchema as any;

    expect(input.required).toContain("orderId");
    expect(input.properties.orderId).toEqual({ type: "string" });
    expect(input.properties.includeNotes).toMatchObject({
      type: "boolean",
      description: "Include internal staff notes.",
    });
  });

  it("merges JSON object request bodies with path parameters", () => {
    const draft = generate().manifest.actions.find((a) => a.name === "create_refund_draft");
    const input = draft?.inputSchema as any;

    expect(input.required).toEqual(
      expect.arrayContaining(["orderId", "amount", "reason", "lineItems"]),
    );
    expect(input.properties.orderId).toEqual({ type: "string" });
    expect(input.properties.amount).toMatchObject({ type: "number", minimum: 0.01 });
    expect(input.properties.reason).toMatchObject({ type: "string", minLength: 3 });
  });

  it("preserves nested object, array, enum, and ref-derived schemas", () => {
    const draft = generate().manifest.actions.find((a) => a.name === "create_refund_draft");
    const lineItems = (draft?.inputSchema as any).properties.lineItems;
    const metadata = (draft?.inputSchema as any).properties.metadata;

    expect(lineItems.type).toBe("array");
    expect(lineItems.items.properties.sku.type).toBe("string");
    expect(lineItems.items.properties.quantity.minimum).toBe(1);
    expect(lineItems.items.properties.disposition.enum).toEqual(["keep", "refund", "replace"]);
    expect(metadata.properties.notifyCustomer.type).toBe("boolean");
  });

  it("uses 2xx/default JSON response schemas as output schemas", () => {
    const getOrder = generate().manifest.actions.find((a) => a.name === "get_orders_order_id");
    const createOrder = generate().manifest.actions.find((a) => a.name === "create_order");

    expect((getOrder?.outputSchema as any).properties.id.type).toBe("string");
    expect((createOrder?.outputSchema as any).properties.status.enum).toEqual([
      "pending",
      "shipped",
      "refunded",
      "cancelled",
    ]);
  });

  it("does not infer auth, permissions, or action examples from security/tags/examples yet", () => {
    const { manifest } = generate();
    const draft = manifest.actions.find((a) => a.name === "create_refund_draft");

    expect(manifest.auth).toBeUndefined();
    expect(manifest.resources).toEqual([]);
    expect(draft?.permissions).toEqual([]);
    expect(draft?.examples).toEqual([]);
  });

  it("inherits manifest metadata from OpenAPI info and servers", () => {
    const { manifest } = generate();

    expect(manifest.name).toBe("Catalog Regression API");
    expect(manifest.version).toBe("2.1.0");
    expect(manifest.description).toBe(
      "Fixture covering OpenAPI to AgentBridge converter edge cases.",
    );
    expect(manifest.baseUrl).toBe("https://api.example.com");
    expect(manifest.contact).toBe("platform@example.com");
  });

  it("fails invalid or unsupported inputs with clear errors and warnings", () => {
    expect(() => parseOpenApiDocument("null")).toThrow(/must be an object/);
    expect(() => parseOpenApiDocument(JSON.stringify({ openapi: "3.0.3" }))).toThrow(
      /no `paths` object/,
    );

    const parsed = parseOpenApiDocument({ openapi: "2.0", paths: {} });
    expect(parsed.warnings).toEqual([
      "Document declares openapi=2.0. Only 3.x is well-tested.",
    ]);

    expect(() =>
      operationToAgentAction({ summary: "Check export readiness" }, "head", "/reports", {
        openapi: "3.0.3",
        paths: {},
      }),
    ).toThrow(/Method head on \/reports is not supported/);
  });
});
