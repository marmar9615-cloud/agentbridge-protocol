// Runtime configuration knobs for the MCP server, parsed from environment
// variables once per process. Each knob has a hardcoded default and a clamped
// allowed range so that an operator can tune for their environment without
// being able to weaken the safety story (e.g. setting an absurd 0ms timeout
// or a 10GB response cap).

const DEFAULTS = {
  ACTION_TIMEOUT_MS: 10_000,
  MAX_RESPONSE_BYTES: 1_000_000,
  CONFIRMATION_TTL_SECONDS: 5 * 60,
} as const;

const BOUNDS = {
  ACTION_TIMEOUT_MS: { min: 1_000, max: 120_000 },
  MAX_RESPONSE_BYTES: { min: 1024, max: 10 * 1024 * 1024 },
  CONFIRMATION_TTL_SECONDS: { min: 30, max: 3600 },
} as const;

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

export const CONFIG_BOUNDS = BOUNDS;
export const CONFIG_DEFAULTS = DEFAULTS;
