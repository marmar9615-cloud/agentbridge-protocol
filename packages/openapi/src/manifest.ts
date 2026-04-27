import type { AgentAction, AgentBridgeManifest } from "@marmar9615-cloud/agentbridge-core";
import { validateManifest } from "@marmar9615-cloud/agentbridge-core";
import type { OpenApiDocument } from "./types";
import { operationToAgentAction } from "./convert";

export interface GenerateManifestOptions {
  /** Override the manifest baseUrl. Falls back to OpenAPI servers[0].url. */
  baseUrl?: string;
  /** Optional name override. Falls back to OpenAPI info.title. */
  name?: string;
  /** Optional version override. Falls back to OpenAPI info.version. */
  version?: string;
  /** Optional contact override. Falls back to OpenAPI info.contact. */
  contact?: string;
  /** Optional namespace prefix for generated action names. */
  namePrefix?: string;
  /** Treat the resulting manifest as draft and skip strict validation. */
  skipValidation?: boolean;
}

export interface GenerateManifestResult {
  manifest: AgentBridgeManifest;
  warnings: string[];
  /** Operations skipped (e.g. unsupported method). Useful for CLI output. */
  skipped: { path: string; method: string; reason: string }[];
}

const SUPPORTED_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export function generateManifestFromOpenApi(
  doc: OpenApiDocument,
  options: GenerateManifestOptions = {},
): GenerateManifestResult {
  const warnings: string[] = [];
  const skipped: GenerateManifestResult["skipped"] = [];
  const actions: AgentAction[] = [];
  const baseUrl =
    options.baseUrl ?? doc.servers?.[0]?.url ?? "http://localhost:3000";

  for (const [pathStr, pathItem] of Object.entries(doc.paths ?? {})) {
    if (!pathItem) continue;
    for (const method of SUPPORTED_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      try {
        const action = operationToAgentAction(operation, method, pathStr, doc, {
          namePrefix: options.namePrefix,
        });
        actions.push(action);
      } catch (err) {
        skipped.push({
          path: pathStr,
          method: method.toUpperCase(),
          reason: (err as Error).message,
        });
      }
    }
    // Note unsupported HTTP methods that we silently ignore.
    for (const m of ["options", "head", "trace"] as const) {
      if ((pathItem as Record<string, unknown>)[m]) {
        skipped.push({
          path: pathStr,
          method: m.toUpperCase(),
          reason: `Method ${m.toUpperCase()} not supported by AgentBridge actions.`,
        });
      }
    }
  }

  // Deduplicate names by appending suffix on collision.
  const seenNames = new Map<string, number>();
  for (const action of actions) {
    const count = seenNames.get(action.name) ?? 0;
    if (count > 0) {
      const suffix = count + 1;
      const newName = `${action.name}_${suffix}`;
      warnings.push(
        `Duplicate action name "${action.name}" — renamed to "${newName}". Add explicit operationIds to avoid this.`,
      );
      action.name = newName;
    }
    seenNames.set(action.name, count + 1);
  }

  const manifest: AgentBridgeManifest = {
    name: options.name ?? doc.info?.title ?? "Generated AgentBridge Manifest",
    description: doc.info?.description,
    version: options.version ?? doc.info?.version ?? "0.1.0",
    baseUrl,
    contact: options.contact ?? doc.info?.contact?.email ?? doc.info?.contact?.url,
    auth: undefined,
    resources: [],
    actions,
    generatedAt: new Date().toISOString(),
  };

  if (!options.skipValidation) {
    const validation = validateManifest(manifest);
    if (!validation.ok) {
      // Don't throw — return the manifest with warnings so the CLI can
      // surface the issues without losing the generated draft.
      warnings.push(
        `Generated manifest failed validation:\n  ${validation.errors.join("\n  ")}`,
      );
    }
  }

  return { manifest, warnings, skipped };
}
