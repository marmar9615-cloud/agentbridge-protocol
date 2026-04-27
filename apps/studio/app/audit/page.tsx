import { readAuditEvents, getAuditFilePath, type AuditEvent } from "@agentbridge/core";
import { AuditViewer } from "./viewer";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const events: AuditEvent[] = await readAuditEvents({ limit: 200 });
  return (
    <div>
      <h1>Audit log</h1>
      <p className="muted">
        All action invocations across <code>demo</code>, <code>studio</code>, and{" "}
        <code>mcp</code> sources. Local storage at <code>{getAuditFilePath()}</code>. This is
        an MVP local audit — production deployments would persist to a centralized store.
      </p>
      <AuditViewer initial={events} />
    </div>
  );
}
