import { promises as fs } from "node:fs";
import path from "node:path";
import { getAuditFilePath } from "@marmarlabs/agentbridge-core";
import { hashInput } from "./confirmations";

/* Idempotency-key store.
 *
 * If a caller passes `idempotencyKey` to call_action, we record the result
 * the first time. A repeat call with the same key returns the prior result
 * (and a warning) instead of re-invoking the upstream endpoint.
 *
 * If the input changes between calls but the key stays the same, we surface
 * the conflict explicitly rather than silently returning the wrong cached
 * result. This matches Stripe / Square idempotency semantics.
 */

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface IdempotencyRecord {
  key: string;
  url: string;
  actionName: string;
  inputHash: string;
  result: unknown;
  status: "ok" | "error";
  storedAt: number;
  expiresAt: number;
}

function storeFilePath(): string {
  const audit = getAuditFilePath();
  return path.join(path.dirname(audit), "idempotency.json");
}

async function readAll(): Promise<IdempotencyRecord[]> {
  const file = storeFilePath();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return (parsed as IdempotencyRecord[]).filter((r) => r.expiresAt > now);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(entries: IdempotencyRecord[]): Promise<void> {
  const file = storeFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export type LookupResult =
  | { kind: "miss" }
  | { kind: "hit"; record: IdempotencyRecord }
  | { kind: "conflict"; record: IdempotencyRecord };

export async function lookupIdempotent(args: {
  key: string;
  url: string;
  actionName: string;
  input: unknown;
}): Promise<LookupResult> {
  const entries = await readAll();
  const match = entries.find((e) => e.key === args.key);
  if (!match) return { kind: "miss" };
  if (
    match.url !== args.url ||
    match.actionName !== args.actionName ||
    match.inputHash !== hashInput(args.input)
  ) {
    return { kind: "conflict", record: match };
  }
  return { kind: "hit", record: match };
}

export async function recordIdempotent(args: {
  key: string;
  url: string;
  actionName: string;
  input: unknown;
  result: unknown;
  status: "ok" | "error";
}): Promise<void> {
  const now = Date.now();
  const record: IdempotencyRecord = {
    key: args.key,
    url: args.url,
    actionName: args.actionName,
    inputHash: hashInput(args.input),
    result: args.result,
    status: args.status,
    storedAt: now,
    expiresAt: now + IDEMPOTENCY_TTL_MS,
  };
  const entries = await readAll();
  // Replace existing entry for the same key.
  const filtered = entries.filter((e) => e.key !== args.key);
  filtered.push(record);
  await writeAll(filtered.slice(-500));
}

export async function _resetIdempotency(): Promise<void> {
  const file = storeFilePath();
  try {
    await fs.unlink(file);
  } catch {
    /* ignore */
  }
}
