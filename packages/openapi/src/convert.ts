import type { AgentAction } from "@agentbridge/core";
import type {
  HttpMethod,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
} from "./types";

const SUPPORTED_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

// AgentBridge currently only supports GET/POST/PUT/PATCH/DELETE.
function isSupportedMethod(m: string): m is "GET" | "POST" | "PUT" | "PATCH" | "DELETE" {
  return (SUPPORTED_METHODS as string[]).includes(m);
}

export function inferRiskFromMethod(method: string): "low" | "medium" | "high" {
  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD":
    case "OPTIONS":
      return "low";
    case "POST":
    case "PATCH":
    case "PUT":
      return "medium";
    case "DELETE":
      return "high";
    default:
      return "medium";
  }
}

export function inferConfirmationFromRisk(risk: "low" | "medium" | "high"): boolean {
  return risk !== "low";
}

const NAME_FALLBACK_RE = /[^a-z0-9]+/g;

// snake_case, lowercase, leading-letter-required, max 60 chars.
export function normalizeActionName(name: string): string {
  let n = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s\-./]+/g, "_")
    .toLowerCase()
    .replace(NAME_FALLBACK_RE, "_")
    .replace(/^_+|_+$/g, "");
  if (!n) n = "action";
  if (!/^[a-z]/.test(n)) n = `a_${n}`;
  if (n.length > 60) n = n.slice(0, 60).replace(/_+$/, "");
  return n;
}

// Walks a JSON Schema and replaces $ref pointers like #/components/schemas/X
// with their referenced subschema (one level — we don't attempt to handle
// recursive refs perfectly, just enough for typical OpenAPI emit).
export function convertOpenApiSchemaToJsonSchema(
  schema: unknown,
  doc: OpenApiDocument,
  seen: Set<string> = new Set(),
): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const out: Record<string, unknown> = { ...(schema as Record<string, unknown>) };

  if (typeof out["$ref"] === "string") {
    const ref = out["$ref"] as string;
    if (seen.has(ref)) {
      // Cycle — leave the ref so consumers can warn/handle.
      return { description: `Cyclic ref to ${ref}` };
    }
    const resolved = resolveRef(ref, doc);
    if (!resolved) return { description: `Unresolved ref: ${ref}` };
    const next = new Set(seen);
    next.add(ref);
    return convertOpenApiSchemaToJsonSchema(resolved, doc, next);
  }

  // Recursively convert nested schemas.
  if (out["properties"] && typeof out["properties"] === "object") {
    const props = out["properties"] as Record<string, unknown>;
    const converted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      converted[k] = convertOpenApiSchemaToJsonSchema(v, doc, seen);
    }
    out["properties"] = converted;
  }
  if (out["items"]) {
    out["items"] = convertOpenApiSchemaToJsonSchema(out["items"], doc, seen);
  }
  for (const key of ["allOf", "oneOf", "anyOf"]) {
    if (Array.isArray(out[key])) {
      out[key] = (out[key] as unknown[]).map((s) =>
        convertOpenApiSchemaToJsonSchema(s, doc, seen),
      );
    }
  }
  // OpenAPI's `nullable: true` → JSON Schema `type: [..., "null"]`
  if (out["nullable"] === true && typeof out["type"] === "string") {
    out["type"] = [out["type"] as string, "null"];
    delete out["nullable"];
  }
  return out;
}

function resolveRef(ref: string, doc: OpenApiDocument): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/");
  let cur: unknown = doc;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[decodeURIComponent(part)];
  }
  return cur;
}

export interface OperationToActionOptions {
  /** Used to rewrite the path into `endpoint`. Defaults to the path itself. */
  endpointPrefix?: string;
  /** Optional name prefix to namespace generated actions. */
  namePrefix?: string;
}

// Converts a single OpenAPI operation into an AgentAction. Best-effort:
// missing fields produce sensible defaults rather than failures.
export function operationToAgentAction(
  operation: OpenApiOperation,
  method: string,
  pathStr: string,
  doc: OpenApiDocument,
  options: OperationToActionOptions = {},
): AgentAction {
  const upperMethod = method.toUpperCase();
  if (!isSupportedMethod(upperMethod)) {
    throw new Error(
      `Method ${method} on ${pathStr} is not supported by AgentBridge actions.`,
    );
  }

  const idSource =
    operation.operationId ??
    `${method}_${pathStr.replace(/[{}]/g, "").replace(/\//g, "_")}`;
  const namespaced = options.namePrefix ? `${options.namePrefix}_${idSource}` : idSource;
  const name = normalizeActionName(namespaced);

  const inputSchema = buildInputSchema(operation, pathStr, doc);
  const outputSchema = pickFirstResponseSchema(operation, doc);

  const risk = inferRiskFromMethod(upperMethod);
  const requiresConfirmation = inferConfirmationFromRisk(risk);

  const description =
    operation.description?.trim() ??
    operation.summary?.trim() ??
    `${upperMethod} ${pathStr} (auto-generated from OpenAPI).`;

  const title = operation.summary?.trim() || titleCase(name);

  return {
    name,
    title,
    description,
    method: upperMethod,
    endpoint: rewriteEndpoint(pathStr, options.endpointPrefix),
    risk,
    requiresConfirmation,
    inputSchema,
    outputSchema,
    permissions: [],
    examples: [],
    humanReadableSummaryTemplate: buildSummaryTemplate(upperMethod, pathStr, name),
  };
}

// Combine path + query parameters and request body into a single object schema.
// Path params become required string properties; query params follow their
// declared `required`. Body schema's properties are merged at the top level
// (best-effort — JSON bodies with array root or oneOf are preserved as-is
// under a single `body` key).
function buildInputSchema(
  operation: OpenApiOperation,
  pathStr: string,
  doc: OpenApiDocument,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of operation.parameters ?? []) {
    addParameter(param, properties, required, doc);
  }
  // Path-item-level parameters can be inherited; we don't have access here,
  // but for the common case they're folded into operation.parameters by tooling.

  const body = operation.requestBody;
  if (body) {
    const json = body.content?.["application/json"]?.schema;
    if (json) {
      const converted = convertOpenApiSchemaToJsonSchema(json, doc);
      if (converted["type"] === "object" && converted["properties"]) {
        const bodyProps = converted["properties"] as Record<string, unknown>;
        for (const [k, v] of Object.entries(bodyProps)) {
          if (!(k in properties)) properties[k] = v;
        }
        if (Array.isArray(converted["required"])) {
          for (const r of converted["required"] as string[]) {
            if (!required.includes(r) && body.required !== false) required.push(r);
          }
        }
      } else {
        // Non-object body — stash under `body`.
        properties["body"] = converted;
        if (body.required) required.push("body");
      }
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function addParameter(
  param: OpenApiParameter,
  properties: Record<string, unknown>,
  required: string[],
  doc: OpenApiDocument,
): void {
  if (!param || !param.name) return;
  const schema = param.schema
    ? convertOpenApiSchemaToJsonSchema(param.schema, doc)
    : { type: "string" };
  if (param.description) (schema as Record<string, unknown>).description = param.description;
  properties[param.name] = schema;
  // Path params are always required by OpenAPI rules.
  const isReq = param.required === true || param.in === "path";
  if (isReq && !required.includes(param.name)) required.push(param.name);
}

function pickFirstResponseSchema(
  operation: OpenApiOperation,
  doc: OpenApiDocument,
): Record<string, unknown> | undefined {
  const responses = operation.responses ?? {};
  // Prefer 200, then any 2xx, then default.
  const preferredOrder = Object.keys(responses).sort((a, b) => {
    const score = (k: string) => (k === "200" ? 0 : k.startsWith("2") ? 1 : k === "default" ? 2 : 3);
    return score(a) - score(b);
  });
  for (const code of preferredOrder) {
    const r = responses[code];
    const schema = r?.content?.["application/json"]?.schema;
    if (schema) return convertOpenApiSchemaToJsonSchema(schema, doc);
  }
  return undefined;
}

function rewriteEndpoint(pathStr: string, prefix?: string): string {
  if (!prefix) return pathStr;
  return `${prefix.replace(/\/$/, "")}${pathStr}`;
}

function buildSummaryTemplate(method: string, pathStr: string, name: string): string {
  // Use path params as natural summary placeholders.
  const params = [...pathStr.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  if (params.length === 0) {
    return `${name.replace(/_/g, " ")} (${method} ${pathStr})`;
  }
  const placeholders = params.map((p) => `${p}={{${p}}}`).join(", ");
  return `${name.replace(/_/g, " ")} ${placeholders}`;
}

function titleCase(name: string): string {
  return name
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
