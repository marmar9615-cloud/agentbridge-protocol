import type { AgentBridgeManifest, AgentAction } from "@marmarlabs/agentbridge-core";
import {
  verifyManifestSignature,
  type VerifyManifestSignatureFailure,
} from "@marmarlabs/agentbridge-core";

export type CheckSeverity = "info" | "warning" | "error";
export type RecommendationCategory =
  | "safety"
  | "schema"
  | "docs"
  | "developerExperience";

/**
 * Optional signed-manifest checking config (v0.5.0). When omitted,
 * scanner output is bit-for-bit identical to v0.4.x — unsigned
 * manifests still score the same and signed manifests do **not**
 * trigger any signature check.
 *
 * When `keySet` is provided, the scanner runs `verifyManifestSignature`
 * from @marmarlabs/agentbridge-core and emits a stable check ID per
 * the verifier outcome (success → `manifest.signature.verified`;
 * failure → `manifest.signature.<reason>`). When `keySet` is omitted
 * but `requireSignature` is true, the scanner still emits
 * `manifest.signature.missing` if no signature is present.
 *
 * No remote key fetch. The scanner accepts a key set the operator
 * already loaded; runtime fetch of `/.well-known/agentbridge-keys.json`
 * is reserved for a later v0.5.0 PR.
 *
 * Signature checks never authorize anything — they sit alongside the
 * existing readiness checks. Verification is additive.
 */
export interface SignatureScoringOptions {
  /**
   * The publisher's key set, typically loaded from
   * `/.well-known/agentbridge-keys.json`. Anything that conforms to
   * `AgentBridgeKeySetSchema` from @marmarlabs/agentbridge-core. When
   * omitted, the scanner cannot verify signatures and only the
   * `manifest.signature.missing` check is exercised (and only when
   * `requireSignature` is true).
   */
  keySet?: unknown;
  /**
   * Optional strict-equality check on `signature.iss`. Forwarded to
   * `verifyManifestSignature`. Useful when the scanner is invoked
   * with knowledge of the origin the manifest was fetched from.
   */
  expectedIssuer?: string;
  /**
   * When true, an unsigned manifest emits `manifest.signature.missing`
   * as `error` (deduction 15). When false (default), an unsigned
   * manifest emits the same check id as `info` with no deduction —
   * informational only, scanner output otherwise unchanged.
   */
  requireSignature?: boolean;
  /**
   * Override "now" for freshness checks. Forwarded to
   * `verifyManifestSignature`.
   */
  now?: Date | string;
  /**
   * Allowed clock skew for `signedAt`/`expiresAt` comparisons.
   * Forwarded to `verifyManifestSignature`.
   */
  clockSkewSeconds?: number;
}

/** Optional second argument to `scoreManifest`. */
export interface ScoringOptions {
  signature?: SignatureScoringOptions;
}

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
export function scoreManifest(
  manifest: AgentBridgeManifest,
  options: ScoringOptions = {},
): ScoringResult {
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

  // ── Signed-manifest checks (v0.5.0, opt-in) ────────────────────────
  if (options.signature !== undefined) {
    const sig = scoreSignature(manifest, options.signature);
    for (const c of sig.failed) checks.push(c);
    for (const c of sig.passed) passed.push(c);
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

// ── Signed-manifest scoring ──────────────────────────────────────────
//
// Maps `verifyManifestSignature` outcomes to stable scanner check IDs
// per docs/designs/signed-manifests.md §13.5. Severity / deduction
// reflect the v0.5.0 default mode unless `requireSignature` flips
// the missing-signature severity to error.
//
// What this function deliberately does NOT do:
//   - No remote fetch of /.well-known/agentbridge-keys.json. The
//     operator passes the key set in.
//   - No bypass of any other safety check. Verification is additive.
//   - No deduction for `malformed-key-set` — that's an
//     operator-supplied input problem, not a manifest readiness
//     defect. Surfaced as warning so the operator notices, but the
//     manifest's score is unaffected.

function scoreSignature(
  manifest: AgentBridgeManifest,
  options: SignatureScoringOptions,
): { failed: ScannerCheck[]; passed: ScannerCheck[] } {
  const failed: ScannerCheck[] = [];
  const passed: ScannerCheck[] = [];

  const requireSig = options.requireSignature === true;
  const hasSig = manifest.signature !== undefined;

  // Branch 1: no signature on the manifest.
  if (!hasSig) {
    if (requireSig) {
      failed.push({
        id: "manifest.signature.missing",
        severity: "error",
        message: "Manifest does not carry a `signature` block, and the scanner is in require-signature mode.",
        path: "signature",
        recommendation:
          "Sign the manifest with `signManifest()` from @marmarlabs/agentbridge-sdk and publish the public key set at /.well-known/agentbridge-keys.json.",
        category: "safety",
        deduction: 15,
      });
    } else {
      // Default mode: informational only. The score does not move,
      // and v0.4.x scanner output is preserved when callers don't
      // enable require-signature mode.
      failed.push({
        id: "manifest.signature.missing",
        severity: "info",
        message: "Manifest does not carry a `signature` block (informational; verification is opt-in in v0.5.0).",
        path: "signature",
        recommendation:
          "Optional: sign the manifest with `signManifest()` from @marmarlabs/agentbridge-sdk so agents can verify its publisher offline.",
        category: "safety",
        deduction: 0,
      });
    }
    return { failed, passed };
  }

  // Branch 2: signature present but no key set was supplied — verifier
  // can't run. Emit an info note so the operator knows verification
  // was skipped; do not deduct (it's an operator config gap, not a
  // manifest defect).
  if (options.keySet === undefined) {
    failed.push({
      id: "manifest.signature.unverified-no-key-set",
      severity: "info",
      message: "Manifest carries a signature, but no key set was supplied to the scanner — verification was skipped.",
      path: "signature",
      recommendation:
        "Pass the publisher's key set (typically from /.well-known/agentbridge-keys.json) via the scanner's signature.keySet option to verify.",
      category: "safety",
      deduction: 0,
    });
    return { failed, passed };
  }

  // Branch 3: both signature and key set present — run the verifier.
  const result = verifyManifestSignature(manifest, options.keySet, {
    expectedIssuer: options.expectedIssuer,
    now: options.now,
    clockSkewSeconds: options.clockSkewSeconds,
  });

  if (result.ok) {
    passed.push({
      id: "manifest.signature.verified",
      severity: "info",
      message: `Signature verified (alg=${result.alg}, kid=${result.kid}, iss=${result.iss}).`,
      path: "signature",
      category: "safety",
      deduction: 0,
    });
    return { failed, passed };
  }

  const mapped = mapVerifyFailure(result.reason);
  failed.push({
    id: mapped.id,
    severity: mapped.severity,
    message: result.message,
    path: "signature",
    recommendation: mapped.recommendation,
    category: "safety",
    deduction: mapped.deduction,
  });
  return { failed, passed };
}

interface MappedSignatureFailure {
  id: string;
  severity: CheckSeverity;
  deduction: number;
  recommendation: string;
}

/**
 * Maps a `VerifyManifestSignatureFailure` to its scanner check ID,
 * severity, deduction, and recommendation. Stable identifiers — once
 * shipped, renaming any of them is a major bump per
 * docs/v1-readiness.md §13.
 */
function mapVerifyFailure(
  reason: VerifyManifestSignatureFailure,
): MappedSignatureFailure {
  switch (reason) {
    case "missing-signature":
      // Only reachable here when `keySet` was provided (we'd have
      // returned earlier otherwise). Treat as the same default-mode
      // info as the no-key-set branch.
      return {
        id: "manifest.signature.missing",
        severity: "info",
        deduction: 0,
        recommendation:
          "Optional: sign the manifest with `signManifest()` from @marmarlabs/agentbridge-sdk so agents can verify its publisher offline.",
      };
    case "malformed-signature":
      return {
        id: "manifest.signature.malformed",
        severity: "error",
        deduction: 25,
        recommendation:
          "Re-sign the manifest with a current SDK; the signature block fails schema validation (bad iss / dates / value, or expiresAt not after signedAt).",
      };
    case "malformed-key-set":
      // Operator-side issue; surfaced for visibility but not deducted
      // from the manifest's readiness score.
      return {
        id: "manifest.signature.key-set-malformed",
        severity: "warning",
        deduction: 0,
        recommendation:
          "Fix the supplied key set so it conforms to AgentBridgeKeySetSchema. Verification was skipped — the manifest itself may still be valid.",
      };
    case "unsupported-algorithm":
      return {
        id: "manifest.signature.unsupported-algorithm",
        severity: "error",
        deduction: 20,
        recommendation:
          "Use one of the v0.5.0 supported algorithms: EdDSA (Ed25519, default) or ES256 (ECDSA P-256).",
      };
    case "unknown-kid":
      return {
        id: "manifest.signature.unknown-kid",
        severity: "error",
        deduction: 25,
        recommendation:
          "Sign with a kid present in the publisher's key set, or rotate the key set to include the kid the manifest references.",
      };
    case "revoked-kid":
      return {
        id: "manifest.signature.revoked-kid",
        severity: "error",
        deduction: 30,
        recommendation:
          "Re-sign the manifest with a current, non-revoked kid. The key id used here appears in keySet.revokedKids.",
      };
    case "issuer-mismatch":
      return {
        id: "manifest.signature.issuer-mismatch",
        severity: "error",
        deduction: 25,
        recommendation:
          "Ensure signature.iss equals the canonical origin of manifest.baseUrl AND keySet.issuer (and any expectedIssuer the runtime supplies).",
      };
    case "before-signed-at":
      return {
        id: "manifest.signature.before-signed-at",
        severity: "error",
        deduction: 20,
        recommendation:
          "Check the signer's clock — signedAt is in the future relative to the verifier's now (outside the configured skew window).",
      };
    case "expired":
      return {
        id: "manifest.signature.expired",
        severity: "error",
        deduction: 20,
        recommendation:
          "Ask the publisher to re-sign the manifest. The signature's expiresAt has passed (outside the configured skew window).",
      };
    case "canonicalization-failed":
      return {
        id: "manifest.signature.canonicalization-failed",
        severity: "error",
        deduction: 25,
        recommendation:
          "The manifest contains values that cannot be canonicalized (circular references, BigInt, etc.). Remove them and re-sign.",
      };
    case "signature-invalid":
      return {
        id: "manifest.signature.invalid",
        severity: "error",
        deduction: 25,
        recommendation:
          "Verify the manifest has not been tampered with after signing, that the kid resolves to the right public key, and that the signature was produced over the canonical bytes.",
      };
    case "key-type-mismatch":
      return {
        id: "manifest.signature.key-type-mismatch",
        severity: "error",
        deduction: 20,
        recommendation:
          "Match the key entry's alg + JWK kty/crv to the signature's alg (EdDSA → kty=OKP/crv=Ed25519; ES256 → kty=EC/crv=P-256).",
      };
    default: {
      // Defensive — TypeScript exhaustiveness. If a new failure
      // reason is added to the verifier without updating this
      // mapping, surface it explicitly rather than silently dropping.
      const _exhaustive: never = reason;
      return {
        id: `manifest.signature.unknown-failure-${String(_exhaustive)}`,
        severity: "error",
        deduction: 0,
        recommendation:
          "An unrecognized verifier failure reason was returned; please file an issue.",
      };
    }
  }
}
