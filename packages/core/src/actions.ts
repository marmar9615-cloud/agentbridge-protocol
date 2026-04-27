import type { AgentAction } from "./types";

// An action is "risky" if it isn't read-only/low risk OR if it explicitly
// requires confirmation. The MCP server uses this to decide whether the
// confirmation gate must be cleared before executing.
export function isRiskyAction(action: AgentAction): boolean {
  return action.risk !== "low" || action.requiresConfirmation;
}

const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

// Renders an action's humanReadableSummaryTemplate with values from `input`.
// Missing keys produce "<unknown>" so summaries stay stable for confirmation prompts.
export function summarizeAction(
  action: AgentAction,
  input: Record<string, unknown> | undefined,
): string {
  const template = action.humanReadableSummaryTemplate;
  if (!template) {
    return action.title || action.name;
  }
  const values = input ?? {};
  return template.replace(PLACEHOLDER_RE, (_match, key: string) => {
    const value = lookupKey(values, key);
    if (value === undefined || value === null) return "<unknown>";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

function lookupKey(obj: Record<string, unknown>, dottedKey: string): unknown {
  const parts = dottedKey.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
