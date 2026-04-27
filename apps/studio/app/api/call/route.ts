import { NextRequest, NextResponse } from "next/server";
import {
  appendAuditEvent,
  createAuditEvent,
  summarizeAction,
} from "@agentbridge/core";
import { scanUrl } from "@agentbridge/scanner";

export const dynamic = "force-dynamic";

interface CallBody {
  manifestUrl: string;
  actionName: string;
  input: Record<string, unknown>;
  confirmationApproved?: boolean;
}

export async function POST(req: NextRequest) {
  let body: CallBody;
  try {
    body = (await req.json()) as CallBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  // Re-validate manifest before each call. Cheap (cached HTTP); the safety
  // model is "freshly verify what an action looks like before invoking it".
  let manifest;
  try {
    const scan = await scanUrl(body.manifestUrl);
    if (!scan.manifest) {
      return NextResponse.json(
        { ok: false, error: "no valid manifest at that URL" },
        { status: 400 },
      );
    }
    manifest = scan.manifest;
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }

  const action = manifest.actions.find((a) => a.name === body.actionName);
  if (!action) {
    return NextResponse.json(
      { ok: false, error: `action not found: ${body.actionName}` },
      { status: 404 },
    );
  }

  // Confirmation gate. If the action is risky and the caller hasn't
  // explicitly approved, refuse and return the summary. The studio UI uses
  // this to drive the confirmation modal; the gate is symmetric with the
  // MCP server's call_action behavior.
  const isRisky = action.risk !== "low" || action.requiresConfirmation;
  if (isRisky && body.confirmationApproved !== true) {
    const summary = summarizeAction(action, body.input);
    await appendAuditEvent(
      createAuditEvent({
        source: "studio",
        actionName: body.actionName,
        manifestUrl: body.manifestUrl,
        input: body.input,
        status: "confirmation_required",
        confirmationApproved: false,
      }),
    );
    return NextResponse.json({
      ok: true,
      status: "confirmationRequired",
      summary,
      action: {
        name: action.name,
        risk: action.risk,
        requiresConfirmation: action.requiresConfirmation,
      },
    });
  }

  // Origin-pin: the action endpoint must live under the manifest's baseUrl.
  // Prevents a poisoned manifest from redirecting an action elsewhere.
  const target = new URL(action.endpoint, manifest.baseUrl);
  if (new URL(manifest.baseUrl).origin !== target.origin) {
    return NextResponse.json(
      { ok: false, error: "action endpoint outside manifest baseUrl" },
      { status: 400 },
    );
  }

  let upstreamStatus = 0;
  let upstreamBody: unknown = null;
  let auditStatus: "completed" | "error" = "completed";
  let auditError: string | undefined;
  try {
    const res = await fetch(target, {
      method: action.method,
      headers: { "content-type": "application/json" },
      body: action.method === "GET" ? undefined : JSON.stringify(body.input),
    });
    upstreamStatus = res.status;
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
      source: "studio",
      actionName: body.actionName,
      manifestUrl: body.manifestUrl,
      input: body.input,
      result: upstreamBody,
      status: auditStatus,
      confirmationApproved: body.confirmationApproved ?? false,
      error: auditError,
    }),
  );

  return NextResponse.json({
    ok: auditStatus === "completed",
    status: auditStatus,
    upstreamStatus,
    result: upstreamBody,
    error: auditError,
  });
}
