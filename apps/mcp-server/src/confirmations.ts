import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { getAuditFilePath } from "@marmarlabs/agentbridge-core";
import { resolveConfig } from "./config";

/* Pending-confirmation store.
 *
 * Risky actions follow a two-call protocol:
 *   1. First call returns { confirmationRequired, confirmationToken } and
 *      records the pending confirmation here, keyed by a hash of
 *      (url, actionName, input) plus a random token.
 *   2. Second call must include both `confirmationApproved: true` AND the
 *      same `confirmationToken`. The token only matches if the input hash
 *      still matches — preventing reuse with different input.
 *
 * Tokens expire after the configured TTL (default 5 minutes; configurable
 * via AGENTBRIDGE_CONFIRMATION_TTL_SECONDS within [30, 3600]). Expired
 * entries are pruned on every read so the store doesn't grow unbounded.
 *
 * Persistence is a JSON file alongside the audit log so it survives a
 * server restart (handy when an agent's call/respond cycle takes longer
 * than the lifetime of one stdio process).
 */

// Legacy constant kept for backwards compatibility with any external imports;
// runtime code should call resolveConfirmationTtlMs() so env-var changes apply.
export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export function resolveConfirmationTtlMs(): number {
  return resolveConfig().confirmationTtlMs;
}

export interface PendingConfirmation {
  token: string;
  url: string;
  actionName: string;
  inputHash: string;
  createdAt: number;
  expiresAt: number;
}

function storeFilePath(): string {
  // Co-locate with the audit log so AGENTBRIDGE_DATA_DIR controls both.
  const audit = getAuditFilePath();
  return path.join(path.dirname(audit), "confirmations.json");
}

export function hashInput(value: unknown): string {
  // Stable JSON stringify (sorted keys) so { a:1, b:2 } and { b:2, a:1 } hash
  // identically. Without this, idempotency + token binding would be flaky.
  const sorted = stableStringify(value ?? {});
  return createHash("sha256").update(sorted).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

async function readAll(): Promise<PendingConfirmation[]> {
  const file = storeFilePath();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return (parsed as PendingConfirmation[]).filter((p) => p.expiresAt > now);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(entries: PendingConfirmation[]): Promise<void> {
  const file = storeFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function createPendingConfirmation(args: {
  url: string;
  actionName: string;
  input: unknown;
  ttlMs?: number;
}): Promise<PendingConfirmation> {
  const token = randomBytes(16).toString("hex");
  const ttl = args.ttlMs ?? resolveConfirmationTtlMs();
  const now = Date.now();
  const entry: PendingConfirmation = {
    token,
    url: args.url,
    actionName: args.actionName,
    inputHash: hashInput(args.input),
    createdAt: now,
    expiresAt: now + ttl,
  };
  const entries = await readAll();
  entries.push(entry);
  // Cap at 200 most recent to bound the file.
  await writeAll(entries.slice(-200));
  return entry;
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "missing-token" | "unknown-token" | "expired" | "input-mismatch" | "wrong-action" | "wrong-url" };

export async function consumeConfirmation(args: {
  token: string | undefined;
  url: string;
  actionName: string;
  input: unknown;
}): Promise<ConsumeResult> {
  if (!args.token) return { ok: false, reason: "missing-token" };
  const entries = await readAll();
  const idx = entries.findIndex((e) => e.token === args.token);
  if (idx === -1) return { ok: false, reason: "unknown-token" };
  const entry = entries[idx];
  if (entry.expiresAt <= Date.now()) {
    entries.splice(idx, 1);
    await writeAll(entries);
    return { ok: false, reason: "expired" };
  }
  if (entry.url !== args.url) return { ok: false, reason: "wrong-url" };
  if (entry.actionName !== args.actionName) return { ok: false, reason: "wrong-action" };
  if (entry.inputHash !== hashInput(args.input)) return { ok: false, reason: "input-mismatch" };
  // Single-use: remove on consume.
  entries.splice(idx, 1);
  await writeAll(entries);
  return { ok: true };
}

// Test-only helper.
export async function _resetConfirmations(): Promise<void> {
  const file = storeFilePath();
  try {
    await fs.unlink(file);
  } catch {
    /* ignore */
  }
}
