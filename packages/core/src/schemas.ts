import { z } from "zod";
import { ManifestSignatureSchema } from "./signing/schemas";

export const ActionRiskLevel = z.enum(["low", "medium", "high"]);
export type ActionRiskLevel = z.infer<typeof ActionRiskLevel>;

export const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

// inputSchema and outputSchema are stored as plain JSON Schema documents.
// We don't constrain them further here — JSON Schema itself is the contract.
const JsonSchemaObject = z.record(z.unknown());

export const PermissionPolicySchema = z.object({
  scope: z.string(),
  description: z.string().optional(),
});

export const ConfirmationPolicySchema = z.object({
  required: z.boolean(),
  reason: z.string().optional(),
});

export const ActionExampleSchema = z.object({
  description: z.string().optional(),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()).optional(),
});

export const AgentActionSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  inputSchema: JsonSchemaObject,
  outputSchema: JsonSchemaObject.optional(),
  method: HttpMethodSchema,
  endpoint: z.string().min(1),
  risk: ActionRiskLevel,
  requiresConfirmation: z.boolean(),
  permissions: z.array(PermissionPolicySchema).default([]),
  examples: z.array(ActionExampleSchema).default([]),
  humanReadableSummaryTemplate: z.string().optional(),
});

export const AgentResourceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().optional(),
});

export const ManifestAuthSchema = z.object({
  type: z.enum(["none", "bearer", "oauth2", "api_key"]),
  description: z.string().optional(),
});

export const AgentBridgeManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().min(1),
  baseUrl: z.string().url(),
  resources: z.array(AgentResourceSchema).default([]),
  actions: z.array(AgentActionSchema).default([]),
  auth: ManifestAuthSchema.optional(),
  contact: z.string().optional(),
  generatedAt: z.string().optional(),
  // v0.5.0: optional signed-manifest envelope. Absent for unsigned
  // manifests (the v0.4.x default and still the v0.5.0 default).
  // Sign/verify APIs and runtime enforcement land in subsequent
  // v0.5.0 PRs; this schema field is the contract they target.
  // See [docs/designs/signed-manifests.md].
  signature: ManifestSignatureSchema.optional(),
});

export const AuditEventStatus = z.enum([
  "completed",
  "confirmation_required",
  "rejected",
  "error",
]);

export const AuditEventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  source: z.enum(["demo", "studio", "mcp"]),
  manifestUrl: z.string().optional(),
  actionName: z.string(),
  status: AuditEventStatus,
  confirmationApproved: z.boolean().optional(),
  input: z.record(z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
