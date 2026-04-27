import { AgentBridgeManifestSchema } from "./schemas";
import type { AgentBridgeManifest } from "./types";

export type ValidateManifestResult =
  | { ok: true; manifest: AgentBridgeManifest }
  | { ok: false; errors: string[] };

export function validateManifest(input: unknown): ValidateManifestResult {
  const parsed = AgentBridgeManifestSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, manifest: parsed.data };
  }
  const errors = parsed.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
  return { ok: false, errors };
}
