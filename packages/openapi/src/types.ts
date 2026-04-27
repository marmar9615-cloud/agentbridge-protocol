// Loose OpenAPI 3.x types — we only model what we need to walk the doc
// and emit AgentBridge actions. Nothing here claims to be exhaustive.

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string; contact?: { email?: string; url?: string } };
  servers?: { url: string; description?: string }[];
  paths?: Record<string, OpenApiPathItem | undefined>;
  components?: { schemas?: Record<string, unknown> };
}

export interface OpenApiPathItem {
  parameters?: OpenApiParameter[];
  get?: OpenApiOperation;
  put?: OpenApiOperation;
  post?: OpenApiOperation;
  delete?: OpenApiOperation;
  patch?: OpenApiOperation;
  options?: OpenApiOperation;
  head?: OpenApiOperation;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
  tags?: string[];
  security?: unknown[];
}

export interface OpenApiParameter {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  required?: boolean;
  description?: string;
  schema?: Record<string, unknown>;
}

export interface OpenApiRequestBody {
  required?: boolean;
  description?: string;
  content?: Record<string, { schema?: Record<string, unknown> }>;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<string, { schema?: Record<string, unknown> }>;
}
