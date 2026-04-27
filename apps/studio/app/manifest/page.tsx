import Link from "next/link";
import { scanUrl } from "@agentbridge/scanner";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ url?: string }>;
}

export default async function ManifestPage({ searchParams }: Props) {
  const { url = "http://localhost:3000" } = await searchParams;

  let manifest: unknown;
  let error: string | null = null;
  try {
    const res = await scanUrl(url);
    if (!res.manifest) {
      error = "No valid manifest at that URL.";
    } else {
      manifest = res.manifest;
    }
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <div>
      <h1>Manifest viewer</h1>
      <p className="muted">
        <code>{url}/.well-known/agentbridge.json</code> ·{" "}
        <Link href={`/scan?url=${encodeURIComponent(url)}`}>← back to scan</Link>
      </p>

      {error ? (
        <div className="callout">{error}</div>
      ) : (
        <div className="card">
          <pre>{JSON.stringify(manifest, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
