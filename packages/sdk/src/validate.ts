import type { DefinedAction } from "./action";

// Convenience wrapper. The real work lives on the action itself — this exists
// so external callers (mcp-server, studio) can validate against an action's
// JSON Schema without needing the original Zod schema.
export function validateActionInput(
  action: DefinedAction,
  input: unknown,
): Record<string, unknown> {
  return action.validate(input);
}
