import Link from "next/link";
import { scanUrl } from "@marmar9615-cloud/agentbridge-scanner";
import { CopyButton } from "../../components/CopyButton";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ url?: string }>;
}

export default async function ManifestPage({ searchParams }: Props) {
  const { url = "http://localhost:3000" } = await searchParams;

  let manifest: any;
  let error: string | null = null;
  let validationErrors: string[] | undefined;
  try {
    const res = await scanUrl(url);
    if (!res.manifest) {
      error = "No valid manifest at that URL.";
      validationErrors = res.validationErrors;
    } else {
      manifest = res.manifest;
    }
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <div>
      <div className="section-head">
        <h1>Manifest viewer</h1>
        {manifest && (
          <CopyButton text={JSON.stringify(manifest, null, 2)} label="Copy manifest" />
        )}
      </div>
      <p className="muted">
        <code>{url}/.well-known/agentbridge.json</code> ·{" "}
        <Link href={`/scan?url=${encodeURIComponent(url)}`}>← back to scan</Link>
      </p>

      {error ? (
        <div className="card">
          <div className="callout">{error}</div>
          {validationErrors && validationErrors.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3>Validation errors</h3>
              {validationErrors.map((v, i) => (
                <div key={i} className="check-row">
                  <span className="severity-tag severity-error">error</span>
                  <div>
                    <code>{v}</code>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="card">
            <h2>Summary</h2>
            <p>
              <strong>{manifest.name}</strong> v{manifest.version}
              <span className="pill" style={{ marginLeft: 8 }}>
                ✓ valid
              </span>
            </p>
            {manifest.description && <p className="muted">{manifest.description}</p>}
            <p>
              Actions: <strong>{manifest.actions.length}</strong> · Resources:{" "}
              <strong>{manifest.resources.length}</strong> · Auth:{" "}
              <code>{manifest.auth?.type ?? "none"}</code>
              {manifest.contact && (
                <>
                  {" · "}Contact: <code>{manifest.contact}</code>
                </>
              )}
            </p>
          </div>

          <div className="card">
            <h2>Raw JSON</h2>
            <pre>{JSON.stringify(manifest, null, 2)}</pre>
          </div>
        </>
      )}
    </div>
  );
}
