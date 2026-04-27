import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseOpenApiDocument,
  generateManifestFromOpenApi,
  operationToAgentAction,
  inferRiskFromMethod,
  inferConfirmationFromRisk,
  normalizeActionName,
  convertOpenApiSchemaToJsonSchema,
} from "../index";
import type { OpenApiDocument } from "../types";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(here, "../../fixtures");
const fixture = JSON.parse(
  readFileSync(path.join(fixtureDir, "simple-store.openapi.json"), "utf8"),
) as OpenApiDocument;

describe("inferRiskFromMethod", () => {
  it("GET → low", () => expect(inferRiskFromMethod("GET")).toBe("low"));
  it("POST → medium", () => expect(inferRiskFromMethod("POST")).toBe("medium"));
  it("PATCH → medium", () => expect(inferRiskFromMethod("PATCH")).toBe("medium"));
  it("DELETE → high", () => expect(inferRiskFromMethod("DELETE")).toBe("high"));
  it("lowercase tolerated", () => expect(inferRiskFromMethod("delete")).toBe("high"));
});

describe("inferConfirmationFromRisk", () => {
  it("low → false", () => expect(inferConfirmationFromRisk("low")).toBe(false));
  it("medium → true", () => expect(inferConfirmationFromRisk("medium")).toBe(true));
  it("high → true", () => expect(inferConfirmationFromRisk("high")).toBe(true));
});

describe("normalizeActionName", () => {
  it("camelCase → snake_case", () =>
    expect(normalizeActionName("listProducts")).toBe("list_products"));
  it("kebab-case → snake_case", () =>
    expect(normalizeActionName("create-product")).toBe("create_product"));
  it("strips path artifacts", () =>
    expect(normalizeActionName("DELETE /products/{id}")).toBe("delete_products_id"));
  it("falls back when input is empty", () =>
    expect(normalizeActionName("")).toBe("action"));
  it("prepends letter prefix when starts with digit", () =>
    expect(normalizeActionName("123abc")).toBe("a_123abc"));
});

describe("convertOpenApiSchemaToJsonSchema", () => {
  it("resolves $ref against components.schemas", () => {
    const schema = convertOpenApiSchemaToJsonSchema(
      { $ref: "#/components/schemas/Product" },
      fixture,
    );
    expect(schema.type).toBe("object");
    expect((schema.properties as any).id).toBeDefined();
  });

  it("converts nullable: true to type union with null", () => {
    const schema = convertOpenApiSchemaToJsonSchema(
      { type: "string", nullable: true },
      fixture,
    );
    expect(schema.type).toEqual(["string", "null"]);
    expect(schema.nullable).toBeUndefined();
  });

  it("handles unresolved refs gracefully", () => {
    const schema = convertOpenApiSchemaToJsonSchema(
      { $ref: "#/components/schemas/DoesNotExist" },
      fixture,
    );
    expect(typeof schema.description).toBe("string");
  });
});

describe("parseOpenApiDocument", () => {
  it("parses a JSON string", () => {
    const result = parseOpenApiDocument(JSON.stringify(fixture));
    expect(result.document.info?.title).toBe("Simple Store API");
  });

  it("accepts an already-parsed object", () => {
    const result = parseOpenApiDocument(fixture as unknown as Record<string, unknown>);
    expect(result.document.openapi).toBeDefined();
  });

  it("rejects invalid JSON", () => {
    expect(() => parseOpenApiDocument("{not json")).toThrow(/not valid JSON/);
  });

  it("rejects docs without paths", () => {
    expect(() =>
      parseOpenApiDocument(JSON.stringify({ openapi: "3.0.3" })),
    ).toThrow(/no `paths`/);
  });
});

describe("operationToAgentAction", () => {
  it("uses operationId when present", () => {
    const op = fixture.paths!["/products"]!.get!;
    const action = operationToAgentAction(op, "get", "/products", fixture);
    expect(action.name).toBe("list_products");
    expect(action.title).toBe("List products");
    expect(action.method).toBe("GET");
    expect(action.endpoint).toBe("/products");
    expect(action.risk).toBe("low");
    expect(action.requiresConfirmation).toBe(false);
  });

  it("derives a name when operationId is missing", () => {
    const op = fixture.paths!["/health"]!.get!;
    const action = operationToAgentAction(op, "get", "/health", fixture);
    expect(action.name).toMatch(/health/);
  });

  it("merges request body schema into input properties", () => {
    const op = fixture.paths!["/products"]!.post!;
    const action = operationToAgentAction(op, "post", "/products", fixture);
    const props = (action.inputSchema.properties as Record<string, unknown>) ?? {};
    expect(props.name).toBeDefined();
    expect(props.priceCents).toBeDefined();
    expect((action.inputSchema as any).required).toEqual(
      expect.arrayContaining(["name", "priceCents"]),
    );
  });

  it("adds path params as required", () => {
    const op = fixture.paths!["/products/{productId}"]!.delete!;
    const action = operationToAgentAction(op, "delete", "/products/{productId}", fixture);
    const props = (action.inputSchema.properties as Record<string, unknown>) ?? {};
    expect(props.productId).toBeDefined();
    expect((action.inputSchema as any).required).toContain("productId");
    expect(action.risk).toBe("high");
    expect(action.requiresConfirmation).toBe(true);
  });

  it("rejects unsupported methods", () => {
    expect(() =>
      operationToAgentAction({} as any, "options", "/x", fixture),
    ).toThrow(/not supported/);
  });
});

describe("generateManifestFromOpenApi", () => {
  it("produces a valid manifest from the fixture", () => {
    const result = generateManifestFromOpenApi(fixture, {
      baseUrl: "https://api.simple-store.example",
    });
    expect(result.manifest.actions.length).toBeGreaterThanOrEqual(3);
    const names = result.manifest.actions.map((a) => a.name);
    expect(names).toContain("list_products");
    expect(names).toContain("create_product");
    expect(names).toContain("delete_product");
  });

  it("inherits info.title and info.version", () => {
    const result = generateManifestFromOpenApi(fixture);
    expect(result.manifest.name).toBe("Simple Store API");
    expect(result.manifest.version).toBe("1.0.0");
  });

  it("override options take precedence", () => {
    const result = generateManifestFromOpenApi(fixture, {
      name: "Custom Name",
      version: "9.9.9",
      baseUrl: "http://localhost:9000",
    });
    expect(result.manifest.name).toBe("Custom Name");
    expect(result.manifest.version).toBe("9.9.9");
    expect(result.manifest.baseUrl).toBe("http://localhost:9000");
  });
});
