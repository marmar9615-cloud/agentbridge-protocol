/* ──────────────────────────────────────────────────────────────────────
 * AgentBridge MCP tool implementations.
 *
 * PROD: a production deployment would add the following before each call:
 *   - OAuth/bearer auth on the caller (which agent? which user?)
 *   - Per-tool RBAC (does this caller have permission for this action?)
 *   - Tenant isolation (route to the manifest URL bound to the caller's tenant)
 *   - Policy engine integration (OPA/Cedar) for action-level allow/deny
 *   - Rate limiting + cost accounting
 *   - Signed manifests (verify the publisher's signature before trusting actions)
 *
 * The MVP demonstrates the *shape* of these guarantees. Real enforcement is a
 * documented follow-on.
 * ────────────────────────────────────────────────────────────────────── */

import Ajv from "ajv";
import {
  appendAuditEvent,
  createAuditEvent,
  isRiskyAction,
  readAuditEvents,
  summarizeAction,
  validateManifest,
  type AgentBridgeManifest,
  type AgentAction,
} from "@agentbridge/core";
import { scanUrl } from "@agentbridge/scanner";
import { assertAllowedUrl, assertSameOrigin } from "./safety";
import {
  CONFIRMATION_TTL_MS,
  consumeConfirmation,
  createPendingConfirmation,
} from "./confirmations";
import { lookupIdempotent, recordIdempotent } from "./idempotency";

const ajv = new Ajv({ allErrors: true, strict: false });

const ACTION_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000; // 1MB cap on action responses to keep MCP payloads reasonable.

async function fetchManifest(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentBridgeManifest> {
  const origin = assertAllowedUrl(url);
  const manifestUrl = new URL("/.well-known/agentbridge.json", origin).toString();
  const res = await fetchImpl(manifestUrl, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`);
  const json = await res.json();
  const validation = validateManifest(json);
  if (!validation.ok) {
    throw new Error(`invalid manifest: ${validation.errors.join("; ")}`);
  }
  return validation.manifest;
}

function findAction(manifest: AgentBridgeManifest, name: string): AgentAction {
  const action = manifest.actions.find((a) => a.name === name);
  if (!action) throw new Error(`unknown action: ${name}`);
  return action;
}

function validateInputAgainstSchema(action: AgentAction, input: unknown): void {
  const compiled = ajv.compile(action.inputSchema);
  if (!compiled(input ?? {})) {
    const messages = (compiled.errors ?? [])
      .map((e) => `${e.instancePath || "<root>"} ${e.message}`)
      .join("; ");
    throw new Error(`input validation failed: ${messages}`);
  }
}

// ── Tool: discover_manifest ──────────────────────────────────────────
export async function discoverManifest({ url }: { url: string }) {
  const manifest = await fetchManifest(url);
  const byRisk = manifest.actions.reduce<Record<string, number>>((acc, a) => {
    acc[a.risk] = (acc[a.risk] ?? 0) + 1;
    return acc;
  }, {});
  return {
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    baseUrl: manifest.baseUrl,
    contact: manifest.contact,
    actionCount: manifest.actions.length,
    actionsByRisk: byRisk,
    resourceCount: manifest.resources.length,
    auth: manifest.auth?.type ?? "none",
  };
}

// ── Tool: scan_agent_readiness ───────────────────────────────────────
export async function scanAgentReadiness({ url }: { url: string }) {
  return scanUrl(url);
}

// ── Tool: list_actions ───────────────────────────────────────────────
export async function listActions({ url }: { url: string }) {
  const manifest = await fetchManifest(url);
  return {
    actions: manifest.actions.map((a) => ({
      name: a.name,
      title: a.title,
      description: a.description,
      method: a.method,
      endpoint: a.endpoint,
      risk: a.risk,
      requiresConfirmation: a.requiresConfirmation,
      permissions: a.permissions ?? [],
    })),
  };
}

// ── Tool: call_action ────────────────────────────────────────────────
export interface CallActionInput {
  url: string;
  actionName: string;
  input?: Record<string, unknown>;
  confirmationApproved?: boolean;
  confirmationToken?: string;
  idempotencyKey?: string;
}

export type CallActionResult =
  | {
      status: "confirmationRequired";
      summary: string;
      action: { name: string; risk: string; requiresConfirmation: boolean };
      confirmationToken: string;
      confirmationExpiresInSeconds: number;
      hint: string;
    }
  | {
      status: "ok";
      result: unknown;
      idempotent?: { key: string; replayed: boolean };
    }
  | {
      status: "error";
      error: string;
      result?: unknown;
      idempotent?: { key: string; replayed: boolean };
    };

export async function callAction(
  args: CallActionInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CallActionResult> {
  const manifest = await fetchManifest(args.url, fetchImpl);
  const action = findAction(manifest, args.actionName);
  validateInputAgainstSchema(action, args.input ?? {});

  // ── Idempotency (replay) ───────────────────────────────────────────
  if (args.idempotencyKey) {
    const lookup = await lookupIdempotent({
      key: args.idempotencyKey,
      url: args.url,
      actionName: args.actionName,
      input: args.input ?? {},
    });
    if (lookup.kind === "hit") {
      return {
        status: lookup.record.status === "ok" ? "ok" : "error",
        result: lookup.record.result,
        idempotent: { key: args.idempotencyKey, replayed: true },
        ...(lookup.record.status === "error" ? { error: "replayed prior error" } : {}),
      } as CallActionResult;
    }
    if (lookup.kind === "conflict") {
      throw new Error(
        `idempotencyKey "${args.idempotencyKey}" was previously used with different input. Use a new key for the new request.`,
      );
    }
  }

  // ── Confirmation gate ──────────────────────────────────────────────
  if (isRiskyAction(action)) {
    if (args.confirmationApproved !== true) {
      // First call: issue a token and refuse to execute.
      const summary = summarizeAction(action, args.input);
      const pending = await createPendingConfirmation({
        url: args.url,
        actionName: args.actionName,
        input: args.input ?? {},
      });
      await appendAuditEvent(
        createAuditEvent({
          source: "mcp",
          actionName: args.actionName,
          manifestUrl: args.url,
          input: args.input,
          status: "confirmation_required",
          confirmationApproved: false,
        }),
      );
      return {
        status: "confirmationRequired",
        summary,
        action: {
          name: action.name,
          risk: action.risk,
          requiresConfirmation: action.requiresConfirmation,
        },
        confirmationToken: pending.token,
        confirmationExpiresInSeconds: Math.round(CONFIRMATION_TTL_MS / 1000),
        hint:
          "Re-call this tool with confirmationApproved: true AND the same confirmationToken after a human reviews the summary.",
      };
    }
    // Approval claimed — verify the token actually matches.
    const consume = await consumeConfirmation({
      token: args.confirmationToken,
      url: args.url,
      actionName: args.actionName,
      input: args.input ?? {},
    });
    if (!consume.ok) {
      throw new Error(
        `confirmation rejected: ${consume.reason}. Re-issue a confirmation by calling without confirmationApproved.`,
      );
    }
  }

  // Origin-pin: never call out beyond the manifest's baseUrl.
  const target = assertSameOrigin(manifest.baseUrl, action.endpoint);

  let upstreamBody: unknown = null;
  let auditStatus: "completed" | "error" = "completed";
  let auditError: string | undefined;
  try {
    const res = await fetchImpl(target.toString(), {
      method: action.method,
      headers: { "content-type": "application/json" },
      body: action.method === "GET" ? undefined : JSON.stringify(args.input ?? {}),
      signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
    });
    const text = await readWithCap(res, MAX_RESPONSE_BYTES);
    try {
      upstreamBody = text === "" ? null : JSON.parse(text);
    } catch {
      upstreamBody = text;
    }
    if (!res.ok) {
      auditStatus = "error";
      auditError = `upstream ${res.status}`;
    }
  } catch (err) {
    auditStatus = "error";
    auditError = (err as Error).message;
  }

  await appendAuditEvent(
    createAuditEvent({
      source: "mcp",
      actionName: args.actionName,
      manifestUrl: args.url,
      input: args.input,
      result: upstreamBody,
      status: auditStatus,
      confirmationApproved: args.confirmationApproved ?? false,
      error: auditError,
    }),
  );

  if (args.idempotencyKey) {
    await recordIdempotent({
      key: args.idempotencyKey,
      url: args.url,
      actionName: args.actionName,
      input: args.input ?? {},
      result: upstreamBody,
      status: auditStatus === "completed" ? "ok" : "error",
    });
  }

  if (auditStatus === "error") {
    return {
      status: "error",
      error: auditError ?? "unknown error",
      result: upstreamBody,
      ...(args.idempotencyKey
        ? { idempotent: { key: args.idempotencyKey, replayed: false } }
        : {}),
    };
  }
  return {
    status: "ok",
    result: upstreamBody,
    ...(args.idempotencyKey
      ? { idempotent: { key: args.idempotencyKey, replayed: false } }
      : {}),
  };
}

// Read the response body with a hard size cap. Throws if exceeded.
async function readWithCap(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`upstream response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  return new TextDecoder().decode(concat(chunks));
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// ── Tool: get_audit_log ──────────────────────────────────────────────
export async function getAuditLog({ url, limit }: { url?: string; limit?: number }) {
  const events = await readAuditEvents({ url, limit: limit ?? 50 });
  return { events };
}
