import type { OpenApiDocument } from "./types";

export interface ParseResult {
  document: OpenApiDocument;
  warnings: string[];
}

// Accepts either an already-parsed object or a JSON string. Performs minimal
// shape validation — we don't fail loudly on unknown OpenAPI features, just
// note them. The conversion step is best-effort by design.
export function parseOpenApiDocument(input: string | Record<string, unknown>): ParseResult {
  const warnings: string[] = [];
  let doc: OpenApiDocument;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input) as OpenApiDocument;
    } catch (err) {
      throw new Error(`OpenAPI document is not valid JSON: ${(err as Error).message}`);
    }
  } else {
    doc = input as OpenApiDocument;
  }

  if (!doc || typeof doc !== "object") {
    throw new Error("OpenAPI document must be an object.");
  }

  if (!doc.openapi) {
    warnings.push("Missing top-level `openapi` version field. Treating as 3.x.");
  } else if (!doc.openapi.startsWith("3.")) {
    warnings.push(`Document declares openapi=${doc.openapi}. Only 3.x is well-tested.`);
  }

  if (!doc.paths || typeof doc.paths !== "object") {
    throw new Error("OpenAPI document has no `paths` object.");
  }

  return { document: doc, warnings };
}
