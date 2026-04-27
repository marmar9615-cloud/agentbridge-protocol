import Link from "next/link";

export default function HomePage() {
  return (
    <div>
      <h1>Demo Order Manager</h1>
      <p className="muted">
        A toy order-management app that exposes the same operations to humans (this UI) and to
        AI agents (via an AgentBridge manifest).
      </p>

      <div className="card">
        <h2>Two ways to use this app</h2>
        <p>
          <strong>As a human:</strong> click around — the{" "}
          <Link href="/orders">Orders page</Link> shows recent orders, and you can drill into
          individual orders.
        </p>
        <p>
          <strong>As an AI agent:</strong> fetch{" "}
          <Link href="/.well-known/agentbridge.json">/.well-known/agentbridge.json</Link> to
          discover the structured actions this app supports, then call them through{" "}
          <code>/api/agentbridge/actions/&lt;name&gt;</code>.
        </p>
      </div>

      <div className="card callout">
        <strong>AgentBridge manifest available.</strong> See the{" "}
        <Link href="/manifest">manifest viewer</Link> for a pretty-printed version, or fetch it
        directly: <code>curl http://localhost:3000/.well-known/agentbridge.json</code>
      </div>

      <div className="card">
        <h2>Try it from the terminal</h2>
        <pre>{`# Discover the manifest
curl -s http://localhost:3000/.well-known/agentbridge.json | jq .

# Low-risk action — runs immediately
curl -s -X POST http://localhost:3000/api/agentbridge/actions/list_orders \\
  -H 'content-type: application/json' -d '{}'

# Higher-risk actions are gated by the AgentBridge MCP server / Studio,
# which require explicit confirmation before invoking.`}</pre>
      </div>

      <div className="card">
        <h2>What gets logged</h2>
        <p>
          Every invocation appears in the <Link href="/audit">audit log</Link> with the action
          name, source (demo / studio / mcp), input, and result. Sensitive headers and
          credentials are stripped before persisting.
        </p>
      </div>
    </div>
  );
}
