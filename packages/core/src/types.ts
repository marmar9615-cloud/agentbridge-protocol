import type { z } from "zod";
import type {
  AgentActionSchema,
  AgentBridgeManifestSchema,
  AgentResourceSchema,
  AuditEventSchema,
  ConfirmationPolicySchema,
  PermissionPolicySchema,
  ActionExampleSchema,
  ManifestAuthSchema,
} from "./schemas";

export type AgentAction = z.infer<typeof AgentActionSchema>;
export type AgentBridgeManifest = z.infer<typeof AgentBridgeManifestSchema>;
export type AgentResource = z.infer<typeof AgentResourceSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>;
export type ConfirmationPolicy = z.infer<typeof ConfirmationPolicySchema>;
export type ActionExample = z.infer<typeof ActionExampleSchema>;
export type ManifestAuth = z.infer<typeof ManifestAuthSchema>;

// JSON Schema is intentionally loosely typed — it's a recursive open structure.
export type ActionInputSchema = Record<string, unknown>;
