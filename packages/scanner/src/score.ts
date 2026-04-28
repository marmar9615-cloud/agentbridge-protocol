import type { AgentBridgeManifest, AgentAction } from "@marmarlabs/agentbridge-core";

export type CheckSeverity = "info" | "warning" | "error";
export type RecommendationCategory =
  | "safety"
  | "schema"
  | "docs"
  | "developerExperience";

export interface ScannerCheck {
  /** Stable identifier — useful for suppression/CI rules. */
  id: string;
  severity: CheckSeverity;
  message: string;
  /** JSON-Pointer-ish path to the offending field, e.g. `actions.refund.outputSchema`. */
  path: string;
  recommendation?: string;
  category: RecommendationCategory;
  /** Score deduction this check contributed. 0 for purely informational checks. */
  deduction: number;
}

export interface RecommendationGroup {
  category: RecommendationCategory;
  items: string[];
}

export interface ScoringResult {
  score: number;
  /** Structured per-check results. Authoritative — strings below are derived. */
  checks: ScannerCheck[];
  /** Recommendations grouped by category for the dashboard / CLI. */
  recommendationGroups: Record<RecommendationCategory, string[]>;
  /** Backwards-compat: flat issue strings (warnings + errors). */
  issues: string[];
  /** Backwards-compat: flat recommendation strings, all categories. */
  recommendations: string[];
  /** Checks that passed (severity === "info" with deduction === 0 and message ends with PASSED). */
  passed: ScannerCheck[];
  actionCount: number;
  riskyActionCount: number;
  missingConfirmationCount: number;
}

const DESTRUCTIVE_METHODS = new Set(["DELETE"]);

// Each check produces a ScannerCheck. Build a list of checks first, then
// derive score / grouped recommendations / legacy fields from it.
export function scoreManifest(manifest: AgentBridgeManifest): ScoringResult {
  const checks: ScannerCheck[] = [];
  const passed: ScannerCheck[] = [];

  // ── Manifest-level checks ──────────────────────────────────────────
  pushOrPass(
    checks,
    passed,
    manifest.actions.length === 0,
    {
      id: "manifest.no-actions",
      severity: "error",
      message: "Manifest declares no actions.",
      path: "actions",
      recommendation:
        "Add at least one action so agents have something to call. Start with a low-risk read-only action.",
      category: "developerExperience",
      deduction: 30,
    },
    "Manifest declares at least one action.",
  );

  pushOrPass(
    checks,
    passed,
    !manifest.contact,
    {
      id: "manifest.missing-contact",
      severity: "warning",
      message: "Manifest missing `contact` field.",
      path: "contact",
      recommendation:
        "Add a `contact` (email or URL) so agent operators know who maintains this surface.",
      category: "developerExperience",
      deduction: 5,
    },
    "Manifest declares a contact.",
  );

  pushOrPass(
    checks,
    passed,
    !manifest.version,
    {
      id: "manifest.missing-version",
      severity: "error",
      message: "Manifest missing `version` field.",
      path: "version",
      recommendation:
        "Set a semver `version` (e.g. `1.0.0`) so agents can detect manifest changes.",
      category: "developerExperience",
      deduction: 10,
    },
    "Manifest version present.",
  );

  pushOrPass(
    checks,
    passed,
    !manifest.auth,
    {
      id: "manifest.missing-auth",
      severity: "info",
      message: "Manifest does not declare an `auth` block.",
      path: "auth",
      recommendation:
        "Declare an `auth` block (even `{ type: \"none\" }`) so agents know what credentials to expect.",
      category: "safety",
      deduction: 2,
    },
    "Manifest declares its auth posture.",
  );

  pushOrPass(
    checks,
    passed,
    manifest.resources.length === 0,
    {
      id: "manifest.no-resources",
      severity: "info",
      message: "No `resources` declared.",
      path: "resources",
      recommendation:
        "Declare resources (orders, customers, tickets, etc.) so agents can build a mental model of the data your actions touch.",
      category: "docs",
      deduction: 1,
    },
    "Resources declared.",
  );

  // baseUrl validity is enforced by Zod, but flag if it's blank or trivially malformed.
  try {
    const u = new URL(manifest.baseUrl);
    pushOrPass(
      checks,
      passed,
      u.protocol !== "http:" && u.protocol !== "https:",
      {
        id: "manifest.baseUrl.protocol",
        severity: "error",
        message: `baseUrl uses unsupported protocol: ${u.protocol}`,
        path: "baseUrl",
        recommendation: "Use http(s) for the manifest baseUrl.",
        category: "safety",
        deduction: 20,
      },
      "baseUrl uses http(s).",
    );
  } catch {
    checks.push({
      id: "manifest.baseUrl.invalid",
      severity: "error",
      message: `baseUrl is not a valid URL: ${manifest.baseUrl}`,
      path: "baseUrl",
      recommendation: "Set baseUrl to the canonical origin of your app, e.g. https://orders.acme.com",
      category: "developerExperience",
      deduction: 25,
    });
  }

  // ── Per-action checks ──────────────────────────────────────────────
  let riskyCount = 0;
  let missingConfirmation = 0;

  for (const action of manifest.actions) {
    const actionChecks = scoreAction(action);
    for (const c of actionChecks.failed) checks.push(c);
    for (const c of actionChecks.passed) passed.push(c);

    if (action.risk !== "low" || action.requiresConfirmation) riskyCount += 1;
    if (
      (action.risk === "high" || action.risk === "medium") &&
      !action.requiresConfirmation
    ) {
      missingConfirmation += 1;
    }
  }

  // ── Derive aggregate fields ────────────────────────────────────────
  const totalDeduction = checks.reduce((sum, c) => sum + c.deduction, 0);
  const score = Math.max(0, Math.round(100 - totalDeduction));

  const recommendationGroups: Record<RecommendationCategory, string[]> = {
    safety: [],
    schema: [],
    docs: [],
    developerExperience: [],
  };
  for (const c of checks) {
    if (c.recommendation) recommendationGroups[c.category].push(c.recommendation);
  }

  const issues = checks
    .filter((c) => c.severity !== "info")
    .map((c) => (c.path === "<root>" ? c.message : `${c.path}: ${c.message}`));
  const recommendations = checks
    .filter((c) => Boolean(c.recommendation))
    .map((c) => c.recommendation as string);

  return {
    score,
    checks,
    recommendationGroups,
    issues,
    recommendations,
    passed,
    actionCount: manifest.actions.length,
    riskyActionCount: riskyCount,
    missingConfirmationCount: missingConfirmation,
  };
}

function scoreAction(action: AgentAction): {
  failed: ScannerCheck[];
  passed: ScannerCheck[];
} {
  const failed: ScannerCheck[] = [];
  const passed: ScannerCheck[] = [];
  const base = `actions.${action.name}`;

  pushOrPass(
    failed,
    passed,
    !action.title || action.title.length < 2,
    {
      id: "action.missing-title",
      severity: "warning",
      message: "title is missing or too short.",
      path: `${base}.title`,
      recommendation: `Add a short human-readable title for "${action.name}".`,
      category: "docs",
      deduction: 2,
    },
    `${base}.title present.`,
  );

  pushOrPass(
    failed,
    passed,
    !action.description || action.description.length < 10,
    {
      id: "action.short-description",
      severity: "warning",
      message: "description is missing or too short.",
      path: `${base}.description`,
      recommendation: `Add a clear, agent-friendly description for "${action.name}" so an agent knows when to call it.`,
      category: "docs",
      deduction: 3,
    },
    `${base}.description present.`,
  );

  // Input schema must at minimum be an object schema.
  const inputType = (action.inputSchema as Record<string, unknown> | undefined)?.type;
  pushOrPass(
    failed,
    passed,
    inputType !== "object",
    {
      id: "action.input-schema-not-object",
      severity: "warning",
      message: `inputSchema should be an object schema (got type=${JSON.stringify(inputType)}).`,
      path: `${base}.inputSchema`,
      recommendation: `Declare inputSchema as an object schema with explicit \`properties\` for "${action.name}".`,
      category: "schema",
      deduction: 4,
    },
    `${base}.inputSchema is an object schema.`,
  );

  pushOrPass(
    failed,
    passed,
    !action.outputSchema,
    {
      id: "action.missing-output-schema",
      severity: "warning",
      message: "missing outputSchema.",
      path: `${base}.outputSchema`,
      recommendation: `Document the output shape of "${action.name}" so agents know what to expect.`,
      category: "schema",
      deduction: 2,
    },
    `${base}.outputSchema present.`,
  );

  pushOrPass(
    failed,
    passed,
    !action.examples || action.examples.length === 0,
    {
      id: "action.no-examples",
      severity: "warning",
      message: "no examples provided.",
      path: `${base}.examples`,
      recommendation: `Add at least one example invocation for "${action.name}" — agents use examples to learn correct call shapes.`,
      category: "docs",
      deduction: 2,
    },
    `${base}.examples present.`,
  );

  pushOrPass(
    failed,
    passed,
    !action.humanReadableSummaryTemplate,
    {
      id: "action.no-summary-template",
      severity: "warning",
      message: "missing humanReadableSummaryTemplate.",
      path: `${base}.humanReadableSummaryTemplate`,
      recommendation: `Add a humanReadableSummaryTemplate to "${action.name}" so confirmation prompts read naturally.`,
      category: "docs",
      deduction: 2,
    },
    `${base}.humanReadableSummaryTemplate present.`,
  );

  // Confirmation gates — error for high, warning for medium.
  if (action.risk === "high" && !action.requiresConfirmation) {
    failed.push({
      id: "action.high-risk-no-confirm",
      severity: "error",
      message: "high-risk action without requiresConfirmation.",
      path: `${base}.requiresConfirmation`,
      recommendation: `"${action.name}" is high risk — set requiresConfirmation: true to force a human-in-the-loop check.`,
      category: "safety",
      deduction: 15,
    });
  } else if (action.risk === "medium" && !action.requiresConfirmation) {
    failed.push({
      id: "action.medium-risk-no-confirm",
      severity: "warning",
      message: "medium-risk action without requiresConfirmation.",
      path: `${base}.requiresConfirmation`,
      recommendation: `"${action.name}" is medium risk — consider setting requiresConfirmation: true.`,
      category: "safety",
      deduction: 7,
    });
  } else {
    passed.push({
      id: "action.confirmation-appropriate",
      severity: "info",
      message: `${base}: confirmation policy matches risk level.`,
      path: `${base}.requiresConfirmation`,
      category: "safety",
      deduction: 0,
    });
  }

  // Destructive method should be high risk OR require confirmation.
  if (
    DESTRUCTIVE_METHODS.has(action.method) &&
    action.risk !== "high" &&
    !action.requiresConfirmation
  ) {
    failed.push({
      id: "action.destructive-method-low-friction",
      severity: "error",
      message: `${action.method} action without high risk or confirmation.`,
      path: `${base}.method`,
      recommendation: `${action.method} is destructive — mark "${action.name}" as risk: "high" and/or requiresConfirmation: true.`,
      category: "safety",
      deduction: 10,
    });
  }

  // Risky actions should declare permissions so operators know what's needed.
  if (
    (action.risk === "medium" || action.risk === "high") &&
    (!action.permissions || action.permissions.length === 0)
  ) {
    failed.push({
      id: "action.risky-no-permissions",
      severity: "info",
      message: "risky action has no declared permissions.",
      path: `${base}.permissions`,
      recommendation: `Declare permissions for "${action.name}" (e.g. orders:write) so operators can scope tokens correctly.`,
      category: "safety",
      deduction: 1,
    });
  }

  return { failed, passed };
}

// Push the failing check (with deduction) when `condition` is true; otherwise
// record a passed check (deduction 0, severity info) for the dashboard.
function pushOrPass(
  failedSink: ScannerCheck[],
  passedSink: ScannerCheck[],
  condition: boolean,
  failedCheck: ScannerCheck,
  passedMessage: string,
): void {
  if (condition) {
    failedSink.push(failedCheck);
  } else {
    passedSink.push({
      id: failedCheck.id,
      severity: "info",
      message: passedMessage,
      path: failedCheck.path,
      category: failedCheck.category,
      deduction: 0,
    });
  }
}
