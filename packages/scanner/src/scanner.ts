import { validateManifest, type AgentBridgeManifest } from "@agentbridge/core";
import { scoreManifest } from "./score";
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
  issues: string[];
  recommendations: string[];
  page?: PageProbeResult;
  notes: string[];
  validationErrors?: string[];
}

export interface ScanOptions {
  /** Run the optional Playwright probe. Defaults to false. */
  probe?: boolean;
  /** Override the global SSRF allowlist. Don't use in production. */
  allowAnyUrl?: boolean;
  /** Inject a fetcher (used by tests). */
  fetcher?: typeof fetch;
}

export async function scanUrl(rawUrl: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const fetchImpl = opts.fetcher ?? fetch;
  const url = normalizeAndCheckUrl(rawUrl, opts.allowAnyUrl ?? false);
  const manifestUrl = new URL("/.well-known/agentbridge.json", url).toString();
  const notes: string[] = [];

  // Manifest fetch
  let manifestRaw: unknown = null;
  let manifestFound = false;
  try {
    const res = await fetchWithTimeout(fetchImpl, manifestUrl, 5000);
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
      issues: ["No /.well-known/agentbridge.json found at this origin."],
      recommendations: [
        "Publish an AgentBridge manifest at /.well-known/agentbridge.json so agents can discover your actions.",
      ],
      notes,
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
      issues: ["Manifest exists but failed schema validation."],
      recommendations: [
        "Fix the manifest validation errors (see validationErrors). The AgentBridge SDK can validate locally before publishing.",
      ],
      notes,
      validationErrors: validation.errors,
    };
  }

  const manifest = validation.manifest;
  const scoring = scoreManifest(manifest);

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
    score: scoring.score,
    actionCount: scoring.actionCount,
    riskyActionCount: scoring.riskyActionCount,
    missingConfirmationCount: scoring.missingConfirmationCount,
    issues: scoring.issues,
    recommendations: scoring.recommendations,
    page,
    notes,
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
