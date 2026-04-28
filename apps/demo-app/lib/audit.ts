import { createAuditEvent, appendAuditEvent } from "@marmarlabs/agentbridge-core";

export interface DemoAuditInput {
  actionName: string;
  manifestUrl: string;
  input?: Record<string, unknown>;
  result?: unknown;
  status: "completed" | "error";
  error?: string;
}

export async function writeDemoAudit(input: DemoAuditInput): Promise<void> {
  const event = createAuditEvent({
    source: "demo",
    actionName: input.actionName,
    manifestUrl: input.manifestUrl,
    input: input.input,
    result: input.result,
    status: input.status,
    error: input.error,
  });
  try {
    await appendAuditEvent(event);
  } catch (err) {
    // Audit failures shouldn't block the action result. Log to stderr.
    console.error("[demo-app] audit write failed:", (err as Error).message);
  }
}
