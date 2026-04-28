import { validateManifest, type AgentBridgeManifest } from "@marmarlabs/agentbridge-core";
import {
  scoreManifest,
  type ScannerCheck,
  type RecommendationCategory,
} from "./score";
import { probePage, type PageProbeResult } from "./playwright";

export interface ScanResult {
  url: string;
  manifestUrl: string;
  manifestFound: boolean;
  validManifest: boolean;
  manifest?: AgentBridgeManifest;
  score: number;
  actionCount: number;
  riskyActionCount: number;
  missingConfirmationCount: number;
  /** Structured per-check results (preferred). */
  checks: ScannerCheck[];
  /** Checks that passed (informational). */
  passed: ScannerCheck[];
  /** Recommendations grouped by category. */
  recommendationGroups: Record<RecommendationCategory, string[]>;
  /** Backwards-compat: flat issue strings. */
  issues: string[];
  /** Backwards-compat: flat recommendation strings. */
  recommendations: string[];
  page?: PageProbeResult;
  notes: string[];
  validationErrors?: string[];
  /** ISO timestamp of when the scan completed. */
  scannedAt: string;
}

export interface ScanOptions {
  /** Run the optional Playwright probe. Defaults to false. */
  probe?: boolean;
  /** Override the global SSRF allowlist. Don't use in production. */
  allowAnyUrl?: boolean;
  /** Inject a fetcher (used by tests). */
  fetcher?: typeof fetch;
  /** Manifest fetch timeout (ms). Default 5000. */
  timeoutMs?: number;
}

const EMPTY_GROUPS: Record<RecommendationCategory, string[]> = {
  safety: [],
  schema: [],
  docs: [],
  developerExperience: [],
};

export async function scanUrl(rawUrl: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const fetchImpl = opts.fetcher ?? fetch;
  const url = normalizeAndCheckUrl(rawUrl, opts.allowAnyUrl ?? false);
  const manifestUrl = new URL("/.well-known/agentbridge.json", url).toString();
  const notes: string[] = [];
  const scannedAt = new Date().toISOString();

  let manifestRaw: unknown = null;
  let manifestFound = false;
  try {
    const res = await fetchWithTimeout(fetchImpl, manifestUrl, opts.timeoutMs ?? 5000);
    if (res.ok) {
      manifestFound = true;
      manifestRaw = await res.json();
    } else {
      notes.push(`Manifest fetch returned HTTP ${res.status}.`);
    }
  } catch (err) {
    notes.push(`Manifest fetch failed: ${(err as Error).message}`);
  }

  if (!manifestFound) {
    return {
      url,
      manifestUrl,
      manifestFound: false,
      validManifest: false,
      score: 0,
      actionCount: 0,
      riskyActionCount: 0,
      missingConfirmationCount: 0,
      checks: [
        {
          id: "manifest.not-found",
          severity: "error",
          message: "No /.well-known/agentbridge.json found at this origin.",
          path: "<root>",
          recommendation:
            "Publish an AgentBridge manifest at /.well-known/agentbridge.json so agents can discover your actions.",
          category: "developerExperience",
          deduction: 100,
        },
      ],
      passed: [],
      recommendationGroups: {
        ...EMPTY_GROUPS,
        developerExperience: [
          "Publish an AgentBridge manifest at /.well-known/agentbridge.json so agents can discover your actions.",
        ],
      },
      issues: ["No /.well-known/agentbridge.json found at this origin."],
      recommendations: [
        "Publish an AgentBridge manifest at /.well-known/agentbridge.json so agents can discover your actions.",
      ],
      notes,
      scannedAt,
    };
  }

  const validation = validateManifest(manifestRaw);
  if (!validation.ok) {
    return {
      url,
      manifestUrl,
      manifestFound: true,
      validManifest: false,
      score: 10,
      actionCount: 0,
      riskyActionCount: 0,
      missingConfirmationCount: 0,
      checks: [
        {
          id: "manifest.invalid",
          severity: "error",
          message: "Manifest exists but failed schema validation.",
          path: "<root>",
          recommendation:
            "Fix the manifest validation errors (see validationErrors). The AgentBridge SDK can validate locally before publishing.",
          category: "schema",
          deduction: 90,
        },
      ],
      passed: [],
      recommendationGroups: {
        ...EMPTY_GROUPS,
        schema: [
          "Fix the manifest validation errors (see validationErrors). The AgentBridge SDK can validate locally before publishing.",
        ],
      },
      issues: ["Manifest exists but failed schema validation."],
      recommendations: [
        "Fix the manifest validation errors (see validationErrors). The AgentBridge SDK can validate locally before publishing.",
      ],
      notes,
      validationErrors: validation.errors,
      scannedAt,
    };
  }

  const manifest = validation.manifest;
  const scoring = scoreManifest(manifest);
  const checks = [...scoring.checks];
  const passed = [...scoring.passed];

  // Cross-origin check: warn if manifest baseUrl is a different origin from
  // the URL we just scanned. Common during dev when scanning by IP and the
  // manifest hardcodes localhost — and a real risk in production if a CDN
  // serves a manifest pointing elsewhere.
  try {
    const scanned = new URL(url);
    const baseUrl = new URL(manifest.baseUrl);
    if (scanned.origin !== baseUrl.origin) {
      checks.push({
        id: "manifest.baseUrl.cross-origin",
        severity: "warning",
        message: `Manifest baseUrl (${baseUrl.origin}) differs from scanned URL (${scanned.origin}).`,
        path: "baseUrl",
        recommendation:
          "Set baseUrl to match the origin agents will reach — otherwise tools that origin-pin endpoints will refuse to call them.",
        category: "safety",
        deduction: 10,
      });
    } else {
      passed.push({
        id: "manifest.baseUrl.cross-origin",
        severity: "info",
        message: "baseUrl origin matches scanned URL.",
        path: "baseUrl",
        category: "safety",
        deduction: 0,
      });
    }
  } catch {
    /* baseUrl validity errors are caught upstream in scoreManifest */
  }

  // Recompute aggregate fields after the cross-origin check.
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

  let page: PageProbeResult | undefined;
  if (opts.probe) {
    try {
      page = await probePage(url);
    } catch (err) {
      notes.push(`Page probe skipped: ${(err as Error).message}`);
    }
  }

  return {
    url,
    manifestUrl,
    manifestFound: true,
    validManifest: true,
    manifest,
    score,
    actionCount: scoring.actionCount,
    riskyActionCount: scoring.riskyActionCount,
    missingConfirmationCount: scoring.missingConfirmationCount,
    checks,
    passed,
    recommendationGroups,
    issues,
    recommendations,
    page,
    notes,
    scannedAt,
  };
}

function normalizeAndCheckUrl(input: string, allowAnyUrl: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are allowed (got ${parsed.protocol})`);
  }
  const allowRemote = allowAnyUrl || process.env.AGENTBRIDGE_ALLOW_REMOTE === "true";
  if (!allowRemote && !isLoopback(parsed.hostname)) {
    throw new Error(
      `Only loopback URLs allowed by default. Set AGENTBRIDGE_ALLOW_REMOTE=true to scan remote hosts.`,
    );
  }
  return parsed.origin;
}

function isLoopback(host: string): boolean {
  if (host === "localhost") return true;
  if (host === "127.0.0.1" || host === "0.0.0.0") return true;
  if (host === "::1" || host === "[::1]") return true;
  return false;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
