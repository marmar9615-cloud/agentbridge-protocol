import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AuditEventSchema } from "./schemas";
import type { AuditEvent } from "./types";

// Sensitive keys are stripped before persisting an audit event.
// We don't want tokens or auth headers showing up in a developer's audit log.
const REDACT_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "token",
  "secret",
  "api_key",
  "apikey",
]);

export interface CreateAuditEventInput {
  source: AuditEvent["source"];
  actionName: string;
  manifestUrl?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  status: AuditEvent["status"];
  confirmationApproved?: boolean;
  error?: string;
}

export function createAuditEvent(input: CreateAuditEventInput): AuditEvent {
  const event: AuditEvent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    source: input.source,
    actionName: input.actionName,
    manifestUrl: input.manifestUrl,
    status: input.status,
    confirmationApproved: input.confirmationApproved,
    input: redact(input.input) as Record<string, unknown> | undefined,
    result: redact(input.result),
    error: input.error,
  };
  // Validate before returning so callers always get a well-formed event.
  return AuditEventSchema.parse(event);
}

export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

// Resolve the on-disk audit log path. Defaults to <repo>/data/audit.json,
// computed by walking up from cwd until we find a directory containing
// the workspace package.json (with `"name": "agentbridge"`).
function resolveDataDir(): string {
  if (process.env.AGENTBRIDGE_DATA_DIR) {
    return process.env.AGENTBRIDGE_DATA_DIR;
  }
  return path.join(findRepoRoot(), "data");
}

function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;
  // Walk up at most 8 levels — protects against runaway loops.
  for (let i = 0; i < 8; i++) {
    try {
      const pkgPath = path.join(dir, "package.json");
      // Sync read is fine here; resolveDataDir runs once per process for cache.
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.name === "agentbridge") return dir;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: cwd. Better than crashing.
  return start;
}

function auditFilePath(): string {
  return path.join(resolveDataDir(), "audit.json");
}

export async function appendAuditEvent(event: AuditEvent): Promise<void> {
  const file = auditFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const events = await readAuditEventsFromDisk(file);
  events.push(event);
  // Keep only the most recent 500 events to prevent unbounded growth.
  const trimmed = events.slice(-500);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(trimmed, null, 2), "utf8");
  await fs.rename(tmp, file);
}

async function readAuditEventsFromDisk(file: string): Promise<AuditEvent[]> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as AuditEvent[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function readAuditEvents(
  opts: { url?: string; limit?: number } = {},
): Promise<AuditEvent[]> {
  const events = await readAuditEventsFromDisk(auditFilePath());
  let result = events;
  if (opts.url) {
    result = result.filter((e) => e.manifestUrl === opts.url);
  }
  // Newest first, optionally capped.
  result = result.slice().reverse();
  if (opts.limit) result = result.slice(0, opts.limit);
  return result;
}

export function getAuditFilePath(): string {
  return auditFilePath();
}
