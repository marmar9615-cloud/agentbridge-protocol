import Link from "next/link";
import { scanUrl, type ScanResult } from "@agentbridge/scanner";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ url?: string }>;
}

export default async function ScanPage({ searchParams }: Props) {
  const { url } = await searchParams;
  if (!url) {
    return (
      <div>
        <h1>Scan</h1>
        <p className="callout">No URL provided. <Link href="/">Go back</Link>.</p>
      </div>
    );
  }

  let result: ScanResult | null = null;
  let error: string | null = null;
  try {
    result = await scanUrl(url);
  } catch (err) {
    error = (err as Error).message;
  }

  if (error || !result) {
    return (
      <div>
        <h1>Scan failed</h1>
        <div className="callout">
          {error}. <Link href="/">Try again</Link>.
        </div>
      </div>
    );
  }

  const scoreClass =
    result.score >= 80 ? "score-good" : result.score >= 50 ? "score-mid" : "score-bad";

  return (
    <div>
      <p className="muted">
        <Link href="/">← New scan</Link>
      </p>
      <h1>
        Scan: <code>{result.url}</code>
      </h1>

      <div className="card">
        <div className="row">
          <span className={`score ${scoreClass}`}>{result.score}</span>
          <div>
            <div>
              <strong>Manifest:</strong>{" "}
              {result.manifestFound
                ? result.validManifest
                  ? "found and valid"
                  : "found but invalid"
                : "not found"}
            </div>
            <div className="muted">
              {result.actionCount} actions · {result.riskyActionCount} risky ·{" "}
              {result.missingConfirmationCount} missing confirmation
            </div>
            <div style={{ marginTop: 8 }}>
              <Link href={`/manifest?url=${encodeURIComponent(result.url)}`}>View manifest</Link>{" "}
              ·{" "}
              <Link href={`/actions?url=${encodeURIComponent(result.url)}`}>View actions</Link>
            </div>
          </div>
        </div>
      </div>

      {result.notes.length > 0 && (
        <div className="card">
          <h2>Notes</h2>
          {result.notes.map((n, i) => (
            <div key={i} className="issue">
              {n}
            </div>
          ))}
        </div>
      )}

      {result.validationErrors && result.validationErrors.length > 0 && (
        <div className="card">
          <h2>Validation errors</h2>
          {result.validationErrors.map((e, i) => (
            <div key={i} className="issue">
              <code>{e}</code>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Issues ({result.issues.length})</h2>
        {result.issues.length === 0 ? (
          <p className="muted">No issues — this manifest is in great shape.</p>
        ) : (
          result.issues.map((issue, i) => (
            <div key={i} className="issue">
              {issue}
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>Recommendations ({result.recommendations.length})</h2>
        {result.recommendations.length === 0 ? (
          <p className="muted">Nothing to recommend.</p>
        ) : (
          result.recommendations.map((rec, i) => (
            <div key={i} className="issue">
              {rec}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
