// Defensive URL helpers used before any outbound fetch from the MCP server.
//
// Two protections:
//   1. assertAllowedUrl — gates which hosts the MCP server is willing to talk
//      to. Loopback only by default; flip AGENTBRIDGE_ALLOW_REMOTE=true to
//      permit remote hosts (still HTTP/HTTPS only).
//   2. assertSameOrigin — once we've fetched a manifest, every action endpoint
//      must live under the same origin as the manifest's `baseUrl`. A poisoned
//      manifest cannot redirect calls to a third-party host.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

export function assertAllowedUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are allowed (got ${parsed.protocol})`);
  }
  const allowRemote = process.env.AGENTBRIDGE_ALLOW_REMOTE === "true";
  if (!allowRemote && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Only loopback URLs allowed by default. Set AGENTBRIDGE_ALLOW_REMOTE=true to permit ${parsed.hostname}.`,
    );
  }
  return parsed;
}

export function assertSameOrigin(manifestBaseUrl: string, endpoint: string): URL {
  const base = new URL(manifestBaseUrl);
  const target = new URL(endpoint, base);
  if (base.origin !== target.origin) {
    throw new Error(
      `Action endpoint origin (${target.origin}) does not match manifest baseUrl origin (${base.origin})`,
    );
  }
  return target;
}
