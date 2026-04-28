import Link from "next/link";
import { scanUrl } from "@marmarlabs/agentbridge-scanner";
import { ActionsBrowser } from "./browser";

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
        <ActionsBrowser url={url} actions={manifest.actions} />
      )}
    </div>
  );
}
