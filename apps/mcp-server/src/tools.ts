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

const ajv = new Ajv({ allErrors: true, strict: false });

async function fetchManifest(url: string): Promise<AgentBridgeManifest> {
  const origin = assertAllowedUrl(url);
  const manifestUrl = new URL("/.well-known/agentbridge.json", origin).toString();
  const res = await fetch(manifestUrl, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`manifest fetch failed: HTTP ${res.status}`);
  }
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
  // Defer to the shared scanner so the MCP server and Studio share scoring.
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
    })),
  };
}

// ── Tool: call_action ────────────────────────────────────────────────
export interface CallActionInput {
  url: string;
  actionName: string;
  input?: Record<string, unknown>;
  confirmationApproved?: boolean;
}

export async function callAction(
  args: CallActionInput,
  fetchImpl: typeof fetch = fetch,
) {
  const manifest = await fetchManifest(args.url);
  const action = findAction(manifest, args.actionName);
  validateInputAgainstSchema(action, args.input ?? {});

  // Confirmation gate. ANY risky action without explicit approval returns a
  // confirmationRequired response and never touches the upstream endpoint.
  if (isRiskyAction(action) && args.confirmationApproved !== true) {
    const summary = summarizeAction(action, args.input);
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
      status: "confirmationRequired" as const,
      summary,
      action: {
        name: action.name,
        risk: action.risk,
        requiresConfirmation: action.requiresConfirmation,
      },
      hint:
        "Re-call this tool with confirmationApproved: true after a human has reviewed the summary.",
    };
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
      signal: AbortSignal.timeout(10_000),
    });
    upstreamBody = await res.json().catch(() => null);
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

  if (auditStatus === "error") {
    return { status: "error" as const, error: auditError, result: upstreamBody };
  }
  return { status: "ok" as const, result: upstreamBody };
}

// ── Tool: get_audit_log ──────────────────────────────────────────────
export async function getAuditLog({ url, limit }: { url?: string; limit?: number }) {
  const events = await readAuditEvents({ url, limit: limit ?? 50 });
  return { events };
}
