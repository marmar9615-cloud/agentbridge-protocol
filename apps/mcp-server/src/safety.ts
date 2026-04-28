// Defensive URL helpers used before any outbound fetch from the MCP server.
//
// Two protections:
//   1. assertAllowedUrl — gates which hosts the MCP server is willing to talk
//      to. Loopback only by default. Two opt-in modes for non-loopback hosts:
//        a. AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=<comma-separated origin list>
//           — strict, exact-origin allowlist. Production-recommended.
//        b. AGENTBRIDGE_ALLOW_REMOTE=true — broad escape hatch that permits
//           any remote http(s) origin. Emits a one-time stderr warning.
//      The strict allowlist wins if both are set.
//   2. assertSameOrigin — once we've fetched a manifest, every action endpoint
//      must live under the same origin as the manifest's `baseUrl`. A poisoned
//      manifest cannot redirect calls to a third-party host.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

let warnedAboutBroadRemote = false;

export interface AssertAllowedUrlOptions {
  /** Override env vars for tests. */
  env?: Record<string, string | undefined>;
  /** Override stderr writer for tests. */
  warn?: (msg: string) => void;
}

export function assertAllowedUrl(url: string, opts: AssertAllowedUrlOptions = {}): URL {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((msg: string) => process.stderr.write(`${msg}\n`));

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are allowed (got ${parsed.protocol})`);
  }

  if (LOOPBACK_HOSTS.has(parsed.hostname)) return parsed;

  const allowlistRaw = env.AGENTBRIDGE_ALLOWED_TARGET_ORIGINS;
  const allowlist = parseAllowedOrigins(allowlistRaw);

  if (allowlist !== null) {
    if (!allowlist.has(parsed.origin)) {
      throw new Error(
        `Target origin ${parsed.origin} is not in AGENTBRIDGE_ALLOWED_TARGET_ORIGINS.`,
      );
    }
    return parsed;
  }

  if (env.AGENTBRIDGE_ALLOW_REMOTE === "true") {
    // When opts.warn is provided (tests), fire every call so callers can assert
    // on it. When using the default stderr writer (production), gate to one
    // warning per process so the operator gets one clear notice and the MCP
    // stdio stream doesn't get spammed.
    const message =
      "[agentbridge] AGENTBRIDGE_ALLOW_REMOTE=true permits all remote target origins. " +
      "For production, set AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=<comma-separated origins> instead.";
    if (opts.warn !== undefined) {
      opts.warn(message);
    } else if (!warnedAboutBroadRemote) {
      warnedAboutBroadRemote = true;
      warn(message);
    }
    return parsed;
  }

  throw new Error(
    `Only loopback URLs allowed by default. Set AGENTBRIDGE_ALLOWED_TARGET_ORIGINS to a comma-separated origin list, ` +
      `or AGENTBRIDGE_ALLOW_REMOTE=true to permit ${parsed.hostname}.`,
  );
}

// Parse and normalize the allowlist env var. Returns null when unset or empty
// (treat as "not configured" so the broader escape hatch can apply). Returns a
// Set of normalized origins otherwise.
function parseAllowedOrigins(raw: string | undefined): Set<string> | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const out = new Set<string>();
  for (const piece of trimmed.split(",")) {
    const candidate = piece.trim();
    if (candidate === "") continue;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error(
        `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS contains invalid origin "${candidate}". ` +
          `Use full origins like https://app.example.com.`,
      );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS only supports http(s) origins (got "${candidate}").`,
      );
    }
    out.add(url.origin);
  }
  return out;
}

export function assertSameOrigin(manifestBaseUrl: string, endpoint: string): URL {
  const base = new URL(manifestBaseUrl);
  const target = new URL(endpoint, base);
  if (base.origin !== target.origin) {
    throw new Error(
      `Action endpoint origin (${target.origin}) does not match manifest baseUrl origin (${base.origin})`,
    );
  }
  return target;
}

// Test-only helper to reset the one-shot warning gate.
export function _resetAllowedUrlWarning(): void {
  warnedAboutBroadRemote = false;
}
