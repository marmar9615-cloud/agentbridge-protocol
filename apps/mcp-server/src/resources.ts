import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAuditEvents } from "@marmarlabs/agentbridge-core";
import { scanUrl } from "@marmarlabs/agentbridge-scanner";

/* MCP resources surface AgentBridge data to agents as URIs they can fetch.
 *
 *   agentbridge://manifest?url=<encoded>      → live manifest summary
 *   agentbridge://readiness?url=<encoded>     → scanner report
 *   agentbridge://audit-log?url=<encoded>?    → recent audit events
 *   agentbridge://spec/manifest-v0.1          → bundled spec markdown
 *
 * Listing returns the static URIs; reading parses the URI's query string
 * for the dynamic url= parameter.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const SPEC_FILE = path.join(repoRoot, "spec", "agentbridge-manifest.v0.1.md");

export interface ResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const STATIC_RESOURCES: ResourceDescriptor[] = [
  {
    uri: "agentbridge://manifest",
    name: "Manifest summary",
    description:
      "Manifest for an AgentBridge surface. Supply ?url=<origin> to read a specific app's manifest.",
    mimeType: "application/json",
  },
  {
    uri: "agentbridge://readiness",
    name: "Readiness report",
    description:
      "Scanner readiness report for an AgentBridge surface. Supply ?url=<origin>.",
    mimeType: "application/json",
  },
  {
    uri: "agentbridge://audit-log",
    name: "Audit log",
    description:
      "Recent action invocations across demo / studio / mcp sources. Supply ?url=<origin>&limit=N.",
    mimeType: "application/json",
  },
  {
    uri: "agentbridge://spec/manifest-v0.1",
    name: "AgentBridge manifest spec v0.1",
    description: "The bundled human-readable manifest specification.",
    mimeType: "text/markdown",
  },
];

export interface ReadResult {
  uri: string;
  mimeType: string;
  text: string;
}

export async function readResource(rawUri: string): Promise<ReadResult> {
  const parsed = parseAgentbridgeUri(rawUri);
  if (!parsed) throw new Error(`unknown resource URI: ${rawUri}`);

  switch (parsed.path) {
    case "manifest": {
      const url = requireParam(parsed.params, "url");
      const result = await scanUrl(url);
      if (!result.manifest) {
        throw new Error(`no valid manifest at ${url}`);
      }
      return {
        uri: rawUri,
        mimeType: "application/json",
        text: JSON.stringify(result.manifest, null, 2),
      };
    }
    case "readiness": {
      const url = requireParam(parsed.params, "url");
      const result = await scanUrl(url);
      return {
        uri: rawUri,
        mimeType: "application/json",
        text: JSON.stringify(result, null, 2),
      };
    }
    case "audit-log": {
      const url = parsed.params.get("url") ?? undefined;
      const limit = Number(parsed.params.get("limit") ?? "50");
      const events = await readAuditEvents({
        url,
        limit: Number.isFinite(limit) ? limit : 50,
      });
      return {
        uri: rawUri,
        mimeType: "application/json",
        text: JSON.stringify({ events }, null, 2),
      };
    }
    case "spec/manifest-v0.1": {
      const text = readFileSync(SPEC_FILE, "utf8");
      return { uri: rawUri, mimeType: "text/markdown", text };
    }
    default:
      throw new Error(`unhandled resource path: ${parsed.path}`);
  }
}

function parseAgentbridgeUri(
  uri: string,
): { path: string; params: URLSearchParams } | null {
  const SCHEME = "agentbridge://";
  if (!uri.startsWith(SCHEME)) return null;
  const rest = uri.slice(SCHEME.length);
  const [pathPart, queryPart] = rest.split("?");
  return { path: pathPart, params: new URLSearchParams(queryPart ?? "") };
}

function requireParam(params: URLSearchParams, key: string): string {
  const v = params.get(key);
  if (!v) throw new Error(`missing required URI parameter: ${key}`);
  return v;
}
