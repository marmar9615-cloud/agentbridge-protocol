import { readFileSync } from "node:fs";
import path from "node:path";
import { marked } from "marked";

export const dynamic = "force-dynamic";

// Resolve the spec file relative to the workspace root. We walk up from cwd
// until we hit the workspace package.json — same trick as packages/core uses
// for the audit log path.
function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      );
      if (pkg.name === "agentbridge") return dir;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export default function SpecPage() {
  const repo = findRepoRoot();
  const file = path.join(repo, "spec", "agentbridge-manifest.v0.1.md");
  let body: string;
  try {
    const md = readFileSync(file, "utf8");
    body = marked.parse(md, { async: false }) as string;
  } catch (err) {
    body = `<p>Failed to load spec: <code>${(err as Error).message}</code></p>`;
  }

  return (
    <div>
      <h1>AgentBridge Manifest Spec</h1>
      <p className="muted">
        Source: <code>spec/agentbridge-manifest.v0.1.md</code> ·{" "}
        <a
          href="https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/spec/agentbridge-manifest.v0.1.md"
          target="_blank"
          rel="noreferrer"
        >
          view on GitHub
        </a>{" "}
        · <a href="/spec/schema.json">JSON Schema</a>
      </p>
      <article className="card spec-content" dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
