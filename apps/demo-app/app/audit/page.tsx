import { readAuditEvents, getAuditFilePath } from "@agentbridge/core";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const events = await readAuditEvents({ limit: 100 });
  return (
    <div>
      <h1>Audit log</h1>
      <p className="muted">
        Recent action invocations across all sources (demo / studio / mcp). Stored at{" "}
        <code>{getAuditFilePath()}</code>. Sensitive headers stripped before persisting.
      </p>

      {events.length === 0 ? (
        <div className="card">
          <p className="muted">
            No events yet. Try calling an action via the studio, the MCP server, or directly:
          </p>
          <pre>{`curl -X POST http://localhost:3000/api/agentbridge/actions/list_orders \\
  -H 'content-type: application/json' -d '{}'`}</pre>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>Action</th>
                <th>Status</th>
                <th>Confirmed?</th>
                <th>Input</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.timestamp).toLocaleString()}</td>
                  <td>
                    <span className="pill">{e.source}</span>
                  </td>
                  <td>
                    <code>{e.actionName}</code>
                  </td>
                  <td>{e.status}</td>
                  <td>{e.confirmationApproved === undefined ? "—" : String(e.confirmationApproved)}</td>
                  <td>
                    <code style={{ fontSize: 11 }}>
                      {JSON.stringify(e.input ?? {}).slice(0, 80)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
