import {
  validateManifest,
  type AgentBridgeManifest,
  type AgentResource,
  type ManifestAuth,
} from "@marmar9615-cloud/agentbridge-core";
import type { DefinedAction } from "./action";

export interface CreateAgentBridgeManifestConfig {
  name: string;
  description?: string;
  version: string;
  baseUrl: string;
  contact?: string;
  resources?: AgentResource[];
  auth?: ManifestAuth;
  actions: DefinedAction[];
}

// Build a manifest from a list of DefinedAction objects. The runtime validators
// inside DefinedAction are stripped — only the JSON-Schema-shaped definition
// makes it into the published manifest.
export function createAgentBridgeManifest(
  config: CreateAgentBridgeManifestConfig,
): AgentBridgeManifest {
  const manifest: AgentBridgeManifest = {
    name: config.name,
    description: config.description,
    version: config.version,
    baseUrl: config.baseUrl,
    contact: config.contact,
    auth: config.auth,
    resources: config.resources ?? [],
    actions: config.actions.map((a) => a.definition),
    generatedAt: new Date().toISOString(),
  };

  // Validate before returning — fail loud during app startup if a bad action
  // sneaks in. Better than serving an invalid manifest to agents.
  const result = validateManifest(manifest);
  if (!result.ok) {
    throw new Error(
      `createAgentBridgeManifest produced an invalid manifest:\n  ${result.errors.join("\n  ")}`,
    );
  }
  return result.manifest;
}
