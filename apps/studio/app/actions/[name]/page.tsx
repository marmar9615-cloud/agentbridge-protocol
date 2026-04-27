import Link from "next/link";
import { scanUrl } from "@agentbridge/scanner";
import { ActionRunner } from "./runner";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ url?: string }>;
}

export default async function ActionDetailPage({ params, searchParams }: Props) {
  const { name } = await params;
  const { url = "http://localhost:3000" } = await searchParams;

  let manifest: any;
  let error: string | null = null;
  try {
    const res = await scanUrl(url);
    if (!res.manifest) error = "No valid manifest found.";
    else manifest = res.manifest;
  } catch (err) {
    error = (err as Error).message;
  }

  if (error) {
    return (
      <div>
        <h1>Action: {name}</h1>
        <div className="callout">{error}</div>
      </div>
    );
  }

  const action = manifest.actions.find((a: any) => a.name === name);
  if (!action) {
    return (
      <div>
        <h1>Action not found</h1>
        <p>
          No action named <code>{name}</code> in this manifest.{" "}
          <Link href={`/actions?url=${encodeURIComponent(url)}`}>← back</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="muted">
        <Link href={`/actions?url=${encodeURIComponent(url)}`}>← all actions</Link>
      </p>
      <h1>
        <code>{action.name}</code>{" "}
        <span className={`pill pill-${action.risk}`}>{action.risk}</span>
        {action.requiresConfirmation && (
          <span className="pill" style={{ marginLeft: 6 }}>
            confirm
          </span>
        )}
      </h1>
      <p>
        <strong>{action.title}</strong>
      </p>
      <p className="muted">{action.description}</p>

      <div className="card">
        <h2>Try it</h2>
        <ActionRunner manifestUrl={url} action={action} />
      </div>

      <div className="card">
        <h2>Endpoint</h2>
        <pre>{`${action.method} ${url}${action.endpoint}`}</pre>
      </div>

      <div className="card">
        <h2>Input schema</h2>
        <pre>{JSON.stringify(action.inputSchema, null, 2)}</pre>
      </div>

      {action.outputSchema && (
        <div className="card">
          <h2>Output schema</h2>
          <pre>{JSON.stringify(action.outputSchema, null, 2)}</pre>
        </div>
      )}

      {action.examples && action.examples.length > 0 && (
        <div className="card">
          <h2>Examples</h2>
          {action.examples.map((ex: any, i: number) => (
            <div key={i} style={{ marginBottom: 12 }}>
              {ex.description && <p className="muted">{ex.description}</p>}
              <pre>{JSON.stringify(ex.input, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
