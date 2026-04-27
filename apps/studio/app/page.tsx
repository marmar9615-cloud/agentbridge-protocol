"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState("http://localhost:3000");
  const [submitting, setSubmitting] = useState(false);

  return (
    <div>
      <h1>Scan an AgentBridge surface</h1>
      <p className="muted">
        Point Studio at a URL. We&apos;ll fetch its <code>/.well-known/agentbridge.json</code>,
        score it, and let you exercise its actions safely.
      </p>

      <div className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitting(true);
            router.push(`/scan?url=${encodeURIComponent(url)}`);
          }}
        >
          <label htmlFor="url">URL</label>
          <div className="row">
            <input
              id="url"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="grow"
            />
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? "Scanning..." : "Scan"}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            By default, only loopback URLs are allowed. Set{" "}
            <code>AGENTBRIDGE_ALLOW_REMOTE=true</code> to scan remote hosts.
          </p>
        </form>
      </div>

      <div className="card">
        <h2>Quick links</h2>
        <ul>
          <li>
            <a href="/scan?url=http%3A%2F%2Flocalhost%3A3000">Scan local demo app</a>
          </li>
          <li>
            <a href="/actions?url=http%3A%2F%2Flocalhost%3A3000">List demo actions</a>
          </li>
          <li>
            <a href="/audit">View audit log</a>
          </li>
        </ul>
      </div>
    </div>
  );
}
