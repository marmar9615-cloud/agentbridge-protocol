// Runtime configuration knobs for the MCP server, parsed from environment
// variables once per process. Each knob has a hardcoded default and a clamped
// allowed range so that an operator can tune for their environment without
// being able to weaken the safety story (e.g. setting an absurd 0ms timeout
// or a 10GB response cap).
//
// Two layers:
//   resolveConfig()      — universal runtime config, used by both transports.
//   resolveTransport()   — transport selection (stdio vs http).
//   resolveHttpConfig()  — HTTP-transport-specific config. Parses env vars
//                          but does NOT enforce "must be set" — the HTTP
//                          adapter validates the combination at startup so
//                          the failure message can be specific.

const DEFAULTS = {
  ACTION_TIMEOUT_MS: 10_000,
  MAX_RESPONSE_BYTES: 1_000_000,
  CONFIRMATION_TTL_SECONDS: 5 * 60,
  HTTP_HOST: "127.0.0.1",
  HTTP_PORT: 3333,
} as const;

const BOUNDS = {
  ACTION_TIMEOUT_MS: { min: 1_000, max: 120_000 },
  MAX_RESPONSE_BYTES: { min: 1024, max: 10 * 1024 * 1024 },
  CONFIRMATION_TTL_SECONDS: { min: 30, max: 3600 },
  // 0 is allowed because tests need ephemeral ports and there is no real
  // production reason to reject it. Out-of-range values (negative, > 65535)
  // fall back to the default with a stderr warning.
  HTTP_PORT: { min: 0, max: 65_535 },
} as const;

// Hosts treated as loopback / safe-by-default. Anything else is "public bind"
// and the HTTP adapter requires both auth and an Origin allowlist.
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
]);

function readClampedInt(
  envVar: string,
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
  warn: (msg: string) => void,
): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    warn(
      `[agentbridge] ${envVar}="${raw}" is not an integer; falling back to ${fallback}.`,
    );
    return fallback;
  }
  if (parsed < bounds.min || parsed > bounds.max) {
    const clamped = Math.min(Math.max(parsed, bounds.min), bounds.max);
    warn(
      `[agentbridge] ${envVar}=${parsed} is outside [${bounds.min}, ${bounds.max}]; clamped to ${clamped}.`,
    );
    return clamped;
  }
  return parsed;
}

export interface ResolvedConfig {
  actionTimeoutMs: number;
  maxResponseBytes: number;
  confirmationTtlMs: number;
}

export interface ResolveConfigOptions {
  env?: Record<string, string | undefined>;
  warn?: (msg: string) => void;
}

export function resolveConfig(opts: ResolveConfigOptions = {}): ResolvedConfig {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((msg: string) => process.stderr.write(`${msg}\n`));
  const actionTimeoutMs = readClampedInt(
    "AGENTBRIDGE_ACTION_TIMEOUT_MS",
    env.AGENTBRIDGE_ACTION_TIMEOUT_MS,
    DEFAULTS.ACTION_TIMEOUT_MS,
    BOUNDS.ACTION_TIMEOUT_MS,
    warn,
  );
  const maxResponseBytes = readClampedInt(
    "AGENTBRIDGE_MAX_RESPONSE_BYTES",
    env.AGENTBRIDGE_MAX_RESPONSE_BYTES,
    DEFAULTS.MAX_RESPONSE_BYTES,
    BOUNDS.MAX_RESPONSE_BYTES,
    warn,
  );
  const confirmationTtlSeconds = readClampedInt(
    "AGENTBRIDGE_CONFIRMATION_TTL_SECONDS",
    env.AGENTBRIDGE_CONFIRMATION_TTL_SECONDS,
    DEFAULTS.CONFIRMATION_TTL_SECONDS,
    BOUNDS.CONFIRMATION_TTL_SECONDS,
    warn,
  );
  return {
    actionTimeoutMs,
    maxResponseBytes,
    confirmationTtlMs: confirmationTtlSeconds * 1000,
  };
}

export type TransportKind = "stdio" | "http";

/**
 * Pick the transport. Defaults to stdio; HTTP is opt-in via
 * AGENTBRIDGE_TRANSPORT=http. Unknown values fall back to stdio with a
 * stderr warning so a typo does not silently expose an HTTP listener.
 */
export function resolveTransport(opts: ResolveConfigOptions = {}): TransportKind {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((msg: string) => process.stderr.write(`${msg}\n`));
  const raw = env.AGENTBRIDGE_TRANSPORT;
  if (raw === undefined || raw === "") return "stdio";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "stdio" || normalized === "http") return normalized;
  warn(
    `[agentbridge] AGENTBRIDGE_TRANSPORT="${raw}" is not one of "stdio" | "http"; falling back to stdio.`,
  );
  return "stdio";
}

export interface HttpConfig {
  host: string;
  /** True when host is a loopback address. False is "public bind" and forces stricter validation in the HTTP adapter. */
  isLoopbackBind: boolean;
  port: number;
  /** Bearer token from AGENTBRIDGE_HTTP_AUTH_TOKEN. Undefined means "operator did not set one"; the HTTP adapter rejects http-mode startup in that case. */
  authToken: string | undefined;
  /** Set of allowed inbound Origin headers, parsed from AGENTBRIDGE_HTTP_ALLOWED_ORIGINS. `null` means "operator did not set the env var"; an empty Set means "set but empty after parsing." Only requests carrying an Origin header consult this set; non-browser clients with no Origin still go through bearer auth. */
  allowedOrigins: ReadonlySet<string> | null;
}

/**
 * Parse the AGENTBRIDGE_HTTP_* env vars. Pure function — does NOT decide
 * whether http mode is allowed. The HTTP adapter (transports/http.ts)
 * runs the safety check ("auth required for http; public bind needs both
 * auth and origins") at startup and emits a transport-specific error
 * message there.
 */
export function resolveHttpConfig(opts: ResolveConfigOptions = {}): HttpConfig {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((msg: string) => process.stderr.write(`${msg}\n`));

  const rawHost = env.AGENTBRIDGE_HTTP_HOST;
  const host = rawHost && rawHost.trim() !== "" ? rawHost.trim() : DEFAULTS.HTTP_HOST;
  const isLoopbackBind = LOOPBACK_HOSTS.has(host);

  const port = readClampedInt(
    "AGENTBRIDGE_HTTP_PORT",
    env.AGENTBRIDGE_HTTP_PORT,
    DEFAULTS.HTTP_PORT,
    BOUNDS.HTTP_PORT,
    warn,
  );

  // Auth token is read raw; do NOT log its value or contents on parse failure.
  // The HTTP adapter validates "is this set when http transport is selected".
  const rawToken = env.AGENTBRIDGE_HTTP_AUTH_TOKEN;
  const authToken = rawToken && rawToken !== "" ? rawToken : undefined;

  const allowedOrigins = parseAllowedOrigins(env.AGENTBRIDGE_HTTP_ALLOWED_ORIGINS, warn);

  return { host, isLoopbackBind, port, authToken, allowedOrigins };
}

function parseAllowedOrigins(
  raw: string | undefined,
  warn: (msg: string) => void,
): ReadonlySet<string> | null {
  if (raw === undefined) return null;
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
      // Skip malformed origins with a clear stderr warning rather than
      // crashing the process. The empty/effectively-empty result causes
      // the HTTP adapter to reject every request that supplies an Origin
      // header, which is the conservative fail-closed posture.
      warn(
        `[agentbridge] AGENTBRIDGE_HTTP_ALLOWED_ORIGINS contains invalid origin "${candidate}"; ignored.`,
      );
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      warn(
        `[agentbridge] AGENTBRIDGE_HTTP_ALLOWED_ORIGINS only supports http(s) origins (got "${candidate}"); ignored.`,
      );
      continue;
    }
    out.add(url.origin);
  }
  return out;
}

export const CONFIG_BOUNDS = BOUNDS;
export const CONFIG_DEFAULTS = DEFAULTS;
