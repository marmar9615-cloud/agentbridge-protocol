import type { AgentBridgeManifest, AgentAction } from "@agentbridge/core";

export interface ScoringResult {
  score: number;
  issues: string[];
  recommendations: string[];
  actionCount: number;
  riskyActionCount: number;
  missingConfirmationCount: number;
}

// Each issue carries a paired recommendation. Deductions accumulate but the
// final score is floored at 0. This produces an at-a-glance signal for the
// dashboard while keeping the suggestion list focused and actionable.
export function scoreManifest(manifest: AgentBridgeManifest): ScoringResult {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  if (manifest.actions.length === 0) {
    score -= 30;
    issues.push("Manifest declares no actions.");
    recommendations.push(
      "Add at least one action so agents have something to call. Start with a low-risk read-only action like list_orders.",
    );
  }

  if (!manifest.contact) {
    score -= 5;
    issues.push("Manifest missing `contact` field.");
    recommendations.push(
      "Add a `contact` (email or URL) so agent operators know who maintains this surface.",
    );
  }

  let riskyCount = 0;
  let missingConfirmation = 0;

  for (const action of manifest.actions) {
    const id = `actions.${action.name}`;
    const perActionDeductions = scoreAction(action);
    score -= perActionDeductions.deduction;
    issues.push(...perActionDeductions.issues.map((i) => `${id}: ${i}`));
    recommendations.push(...perActionDeductions.recommendations);

    if (action.risk !== "low" || action.requiresConfirmation) riskyCount += 1;
    if (action.risk === "high" && !action.requiresConfirmation) missingConfirmation += 1;
    if (action.risk === "medium" && !action.requiresConfirmation) missingConfirmation += 1;
  }

  return {
    score: Math.max(0, Math.round(score)),
    issues,
    recommendations,
    actionCount: manifest.actions.length,
    riskyActionCount: riskyCount,
    missingConfirmationCount: missingConfirmation,
  };
}

function scoreAction(action: AgentAction): {
  deduction: number;
  issues: string[];
  recommendations: string[];
} {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let deduction = 0;

  if (!action.description || action.description.length < 10) {
    deduction += 3;
    issues.push("description is missing or too short.");
    recommendations.push(
      `Add a clear, agent-friendly description for "${action.name}" so an agent knows when to call it.`,
    );
  }

  if (!action.examples || action.examples.length === 0) {
    deduction += 2;
    issues.push("no examples provided.");
    recommendations.push(
      `Add at least one example invocation for "${action.name}" — agents use examples to learn correct call shapes.`,
    );
  }

  if (!action.humanReadableSummaryTemplate) {
    deduction += 2;
    issues.push("missing humanReadableSummaryTemplate.");
    recommendations.push(
      `Add a humanReadableSummaryTemplate to "${action.name}" so confirmation prompts are user-friendly.`,
    );
  }

  if (!action.outputSchema) {
    deduction += 2;
    issues.push("missing outputSchema.");
    recommendations.push(
      `Document the output shape of "${action.name}" so agents know what to expect.`,
    );
  }

  if (action.risk === "high" && !action.requiresConfirmation) {
    deduction += 15;
    issues.push("high-risk action without requiresConfirmation.");
    recommendations.push(
      `"${action.name}" is high risk — set requiresConfirmation: true to force a human-in-the-loop check.`,
    );
  } else if (action.risk === "medium" && !action.requiresConfirmation) {
    deduction += 7;
    issues.push("medium-risk action without requiresConfirmation.");
    recommendations.push(
      `"${action.name}" is medium risk — consider setting requiresConfirmation: true.`,
    );
  }

  return { deduction, issues, recommendations };
}
