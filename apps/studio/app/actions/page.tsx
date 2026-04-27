import Link from "next/link";
import { scanUrl } from "@agentbridge/scanner";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ url?: string }>;
}

export default async function ActionsPage({ searchParams }: Props) {
  const { url = "http://localhost:3000" } = await searchParams;

  let manifest: any;
  let error: string | null = null;
  try {
    const res = await scanUrl(url);
    if (!res.manifest) {
      error = "No valid manifest found.";
    } else {
      manifest = res.manifest;
    }
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <div>
      <h1>Actions</h1>
      <p className="muted">
        Target: <code>{url}</code> ·{" "}
        <Link href={`/scan?url=${encodeURIComponent(url)}`}>← back to scan</Link>
      </p>

      {error ? (
        <div className="callout">{error}</div>
      ) : (
        <div>
          {manifest.actions.map((action: any) => (
            <Link
              key={action.name}
              href={`/actions/${action.name}?url=${encodeURIComponent(url)}`}
              style={{ color: "inherit", textDecoration: "none" }}
            >
              <div className="card action-card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <strong>
                      <code>{action.name}</code>
                    </strong>{" "}
                    — {action.title}
                  </div>
                  <div>
                    <span className={`pill pill-${action.risk}`}>{action.risk}</span>{" "}
                    {action.requiresConfirmation && (
                      <span className="pill" style={{ marginLeft: 6 }}>
                        confirm
                      </span>
                    )}
                  </div>
                </div>
                <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                  {action.description}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
