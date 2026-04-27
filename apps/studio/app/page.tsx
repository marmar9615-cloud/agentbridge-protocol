"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState("http://localhost:3000");
  const [submitting, setSubmitting] = useState(false);

  return (
    <div>
      <h1>Make your app agent-ready.</h1>
      <p className="muted">
        Studio inspects any AgentBridge surface — scoring its readiness, validating its manifest,
        and letting you exercise its actions safely with confirmation gates.
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
            Loopback URLs only by default. Set{" "}
            <code>AGENTBRIDGE_ALLOW_REMOTE=true</code> to scan remote hosts.
          </p>
        </form>
      </div>

      <div className="card">
        <h2>Quick links</h2>
        <ul>
          <li>
            <a href="/scan?url=http%3A%2F%2Flocalhost%3A3000">
              Scan the local demo app (http://localhost:3000)
            </a>
          </li>
          <li>
            <a href="/actions?url=http%3A%2F%2Flocalhost%3A3000">List demo actions</a>
          </li>
          <li>
            <a href="/manifest?url=http%3A%2F%2Flocalhost%3A3000">View demo manifest</a>
          </li>
          <li>
            <a href="/audit">Audit log</a>
          </li>
          <li>
            <a href="/spec">AgentBridge manifest spec</a>
          </li>
          <li>
            <a href="http://localhost:3000" target="_blank" rel="noreferrer">
              Open the demo app (new tab)
            </a>
          </li>
        </ul>
      </div>

      <div className="card">
        <h2>Workflow</h2>
        <ol>
          <li>
            <strong>Scan</strong> a URL to score its readiness and surface issues.
          </li>
          <li>
            <strong>Browse the manifest</strong> to see exactly what an agent will discover.
          </li>
          <li>
            <strong>Open an action</strong> to call it through Studio's confirmation flow.
          </li>
          <li>
            <strong>Check the audit log</strong> to verify what happened.
          </li>
        </ol>
      </div>
    </div>
  );
}
