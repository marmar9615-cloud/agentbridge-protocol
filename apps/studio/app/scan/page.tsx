import Link from "next/link";
import { scanUrl, type ScanResult } from "@marmarlabs/agentbridge-scanner";
import { CopyButton } from "../../components/CopyButton";

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

  const errors = result.checks.filter((c) => c.severity === "error");
  const warnings = result.checks.filter((c) => c.severity === "warning");
  const infos = result.checks.filter((c) => c.severity === "info");
  const groups = result.recommendationGroups;

  return (
    <div>
      <p className="muted">
        <Link href="/">← New scan</Link>
      </p>
      <div className="section-head">
        <h1>
          Scan: <code>{result.url}</code>
        </h1>
        <CopyButton text={JSON.stringify(result, null, 2)} label="Copy JSON" />
      </div>

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
            <div className="muted" style={{ fontSize: 12 }}>
              {errors.length} errors · {warnings.length} warnings · {infos.length} info ·{" "}
              {result.passed.length} passed
            </div>
            <div style={{ marginTop: 8 }}>
              <Link href={`/manifest?url=${encodeURIComponent(result.url)}`}>View manifest</Link>{" "}
              ·{" "}
              <Link href={`/actions?url=${encodeURIComponent(result.url)}`}>
                View actions
              </Link>
            </div>
          </div>
        </div>
      </div>

      {result.notes.length > 0 && (
        <div className="card">
          <h2>Notes</h2>
          {result.notes.map((n, i) => (
            <div key={i} className="check-row">
              <span className="severity-tag severity-info">note</span>
              <div>{n}</div>
            </div>
          ))}
        </div>
      )}

      {result.validationErrors && result.validationErrors.length > 0 && (
        <div className="card">
          <h2>Validation errors</h2>
          {result.validationErrors.map((e, i) => (
            <div key={i} className="check-row">
              <span className="severity-tag severity-error">error</span>
              <div>
                <code>{e}</code>
              </div>
            </div>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <div className="card">
          <h2>Errors ({errors.length})</h2>
          {errors.map((e, i) => (
            <div key={i} className="check-row">
              <span className="severity-tag severity-error">error</span>
              <div>
                <strong>{e.message}</strong>{" "}
                <code className="muted" style={{ marginLeft: 4 }}>
                  {e.path}
                </code>
                {e.recommendation && (
                  <span className="recommendation">→ {e.recommendation}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="card">
          <h2>Warnings ({warnings.length})</h2>
          {warnings.map((w, i) => (
            <div key={i} className="check-row">
              <span className="severity-tag severity-warning">warn</span>
              <div>
                <strong>{w.message}</strong>{" "}
                <code className="muted" style={{ marginLeft: 4 }}>
                  {w.path}
                </code>
                {w.recommendation && (
                  <span className="recommendation">→ {w.recommendation}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {infos.length > 0 && (
        <div className="card">
          <h2>Info ({infos.length})</h2>
          {infos.map((info, i) => (
            <div key={i} className="check-row">
              <span className="severity-tag severity-info">info</span>
              <div>
                {info.message}{" "}
                <code className="muted" style={{ marginLeft: 4 }}>
                  {info.path}
                </code>
                {info.recommendation && (
                  <span className="recommendation">→ {info.recommendation}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(["safety", "schema", "docs", "developerExperience"] as const).map((cat) =>
        groups[cat].length > 0 ? (
          <div key={cat} className="card">
            <h2>Recommendations · {labelFor(cat)}</h2>
            {groups[cat].map((r, i) => (
              <div key={i} className="recommendation-card">
                {r}
              </div>
            ))}
          </div>
        ) : null,
      )}

      {result.passed.length > 0 && (
        <div className="card">
          <h2>Passed checks ({result.passed.length})</h2>
          {result.passed.map((p, i) => (
            <div key={i} className="check-row">
              <span className="severity-tag" style={{ color: "#047857" }}>
                ✓
              </span>
              <div>
                {p.message}{" "}
                <code className="muted" style={{ marginLeft: 4 }}>
                  {p.path}
                </code>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function labelFor(cat: string): string {
  switch (cat) {
    case "safety":
      return "Safety";
    case "schema":
      return "Schema";
    case "docs":
      return "Documentation";
    case "developerExperience":
      return "Developer experience";
    default:
      return cat;
  }
}
