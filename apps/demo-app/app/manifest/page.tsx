import Link from "next/link";
import { headers } from "next/headers";
import { getDemoManifest } from "../../lib/manifest";

export const dynamic = "force-dynamic";

export default async function ManifestPage() {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;
  const manifest = getDemoManifest(baseUrl);

  return (
    <div>
      <h1>AgentBridge Manifest</h1>
      <p className="muted">
        Served at{" "}
        <Link href="/.well-known/agentbridge.json">/.well-known/agentbridge.json</Link>. This is
        what an AI agent fetches to discover the structured actions this app supports.
      </p>

      <div className="card">
        <h2>Summary</h2>
        <p>
          <strong>{manifest.name}</strong> v{manifest.version}
        </p>
        <p className="muted">{manifest.description}</p>
        <p>
          Actions: <strong>{manifest.actions.length}</strong> · Resources:{" "}
          <strong>{manifest.resources.length}</strong> · Auth:{" "}
          <code>{manifest.auth?.type ?? "none"}</code>
        </p>
      </div>

      <div className="card">
        <h2>Actions</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Title</th>
              <th>Method</th>
              <th>Risk</th>
              <th>Confirm?</th>
            </tr>
          </thead>
          <tbody>
            {manifest.actions.map((a) => (
              <tr key={a.name}>
                <td>
                  <code>{a.name}</code>
                </td>
                <td>{a.title}</td>
                <td>{a.method}</td>
                <td>
                  <span className={`pill pill-${a.risk}`}>{a.risk}</span>
                </td>
                <td>{a.requiresConfirmation ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Raw JSON</h2>
        <pre>{JSON.stringify(manifest, null, 2)}</pre>
      </div>
    </div>
  );
}
