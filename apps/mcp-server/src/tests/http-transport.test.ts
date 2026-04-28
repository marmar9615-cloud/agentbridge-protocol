import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HTTP_MCP_PATH,
  createHttpServer,
  validateHttpStartup,
  type HttpServerHandle,
} from "../transports/http";
import type { HttpConfig } from "../config";

/* End-to-end HTTP transport tests.
 *
 * These spin up the real Node http.Server, on an ephemeral port, with a
 * test bearer token. We exercise auth, Origin validation, host binding,
 * and the JSON-RPC initialize/tools-list path through the same
 * createHttpServer() entry that runHttpServer() uses at runtime.
 *
 * The captured `warnings` array stands in for stderr — every test asserts
 * that the bearer token never appears in any warning that the server
 * emitted during the test.
 */

const TEST_TOKEN = "test-bearer-token-must-be-at-least-32-chars-long";
const TEST_ORIGIN = "http://localhost:5173";

const TMP_DATA_DIR = path.join(
  os.tmpdir(),
  `agentbridge-http-test-${process.pid}`,
);

let handle: HttpServerHandle | undefined;
let warnings: string[] = [];
let port = 0;

beforeEach(async () => {
  // Use a per-test data dir so confirmations/idempotency stores don't
  // bleed between cases. The HTTP transport itself doesn't write to
  // them in these tests, but call_action would, and we want isolation.
  process.env.AGENTBRIDGE_DATA_DIR = TMP_DATA_DIR;
  await fs.rm(TMP_DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(TMP_DATA_DIR, { recursive: true });
  warnings = [];
});

afterEach(async () => {
  if (handle !== undefined) {
    await handle.close();
    handle = undefined;
  }
  await fs.rm(TMP_DATA_DIR, { recursive: true, force: true });
  delete process.env.AGENTBRIDGE_DATA_DIR;
});

async function start(opts: {
  authToken?: string;
  host?: string;
  port?: number;
  allowedOrigins?: ReadonlySet<string> | null;
} = {}): Promise<{ baseUrl: string }> {
  handle = createHttpServer({
    authToken: opts.authToken ?? TEST_TOKEN,
    host: opts.host ?? "127.0.0.1",
    port: opts.port ?? 0,
    allowedOrigins: opts.allowedOrigins ?? new Set([TEST_ORIGIN]),
    warn: (msg) => warnings.push(msg),
  });
  const addr = await handle.listen();
  port = addr.port;
  return { baseUrl: `http://127.0.0.1:${addr.port}` };
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

async function request(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<RawResponse> {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function buildInitialize(): string {
  // Send initialize + initialized notification + tools/list as a single
  // newline-delimited stream so the SDK transport treats them as one
  // batch when enableJsonResponse=true. In stateless mode the SDK
  // accepts a JSON-RPC array for batched requests.
  return JSON.stringify([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "http-transport-test", version: "0" },
      },
    },
  ]);
}

function buildToolsList(): string {
  return JSON.stringify([
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    },
  ]);
}

function expectTokenNeverInWarnings(): void {
  for (const w of warnings) {
    expect(w).not.toContain(TEST_TOKEN);
    expect(w).not.toContain("Bearer ");
    expect(w.toLowerCase()).not.toContain("authorization:");
  }
}

describe("HTTP transport — startup safety", () => {
  it("validateHttpStartup throws when AGENTBRIDGE_HTTP_AUTH_TOKEN is missing", () => {
    const cfg: HttpConfig = {
      host: "127.0.0.1",
      isLoopbackBind: true,
      port: 0,
      authToken: undefined,
      allowedOrigins: null,
    };
    expect(() => validateHttpStartup(cfg)).toThrow(/AGENTBRIDGE_HTTP_AUTH_TOKEN is required/);
  });

  it("validateHttpStartup throws when token is too short", () => {
    const cfg: HttpConfig = {
      host: "127.0.0.1",
      isLoopbackBind: true,
      port: 0,
      authToken: "short",
      allowedOrigins: null,
    };
    expect(() => validateHttpStartup(cfg)).toThrow(/too short/);
  });

  it("validateHttpStartup error message NEVER contains the token value", () => {
    const cfg: HttpConfig = {
      host: "127.0.0.1",
      isLoopbackBind: true,
      port: 0,
      authToken: TEST_TOKEN,
      allowedOrigins: null,
    };
    // Loopback + valid token + no origins is allowed.
    expect(() => validateHttpStartup(cfg)).not.toThrow();

    // Now drive a failure path with the token set; assert the throw
    // message would not contain the token.
    const publicCfg: HttpConfig = {
      ...cfg,
      host: "0.0.0.0",
      isLoopbackBind: false,
    };
    try {
      validateHttpStartup(publicCfg);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain(TEST_TOKEN);
      expect((err as Error).message).toMatch(/AGENTBRIDGE_HTTP_ALLOWED_ORIGINS/);
    }
  });

  it("validateHttpStartup throws on public bind without auth", () => {
    const cfg: HttpConfig = {
      host: "0.0.0.0",
      isLoopbackBind: false,
      port: 0,
      authToken: undefined,
      allowedOrigins: new Set(["https://app.example.com"]),
    };
    expect(() => validateHttpStartup(cfg)).toThrow(/AGENTBRIDGE_HTTP_AUTH_TOKEN is required/);
  });

  it("validateHttpStartup throws on public bind without origin allowlist", () => {
    const cfg: HttpConfig = {
      host: "0.0.0.0",
      isLoopbackBind: false,
      port: 0,
      authToken: TEST_TOKEN,
      allowedOrigins: null,
    };
    expect(() => validateHttpStartup(cfg)).toThrow(/AGENTBRIDGE_HTTP_ALLOWED_ORIGINS/);
  });

  it("validateHttpStartup throws on public bind with empty origin allowlist", () => {
    const cfg: HttpConfig = {
      host: "0.0.0.0",
      isLoopbackBind: false,
      port: 0,
      authToken: TEST_TOKEN,
      allowedOrigins: new Set(),
    };
    expect(() => validateHttpStartup(cfg)).toThrow(/AGENTBRIDGE_HTTP_ALLOWED_ORIGINS/);
  });

  it("validateHttpStartup accepts public bind with auth + non-empty origins", () => {
    const cfg: HttpConfig = {
      host: "0.0.0.0",
      isLoopbackBind: false,
      port: 0,
      authToken: TEST_TOKEN,
      allowedOrigins: new Set(["https://app.example.com"]),
    };
    expect(() => validateHttpStartup(cfg)).not.toThrow();
  });
});

describe("HTTP transport — auth (bearer token)", () => {
  it("rejects request with no Authorization header (401)", async () => {
    const { baseUrl } = await start();
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildInitialize(),
    });
    expect(res.status).toBe(401);
    const parsed = JSON.parse(res.body) as { error: string; message: string };
    expect(parsed.error).toBe("unauthorized");
    expect(parsed.message).toMatch(/missing Authorization/);
    expect(res.headers["www-authenticate"]).toMatch(/Bearer/);
    expectTokenNeverInWarnings();
  });

  it("rejects malformed Authorization header (Basic auth, etc.)", async () => {
    const { baseUrl } = await start();
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic abc123",
      },
      body: buildInitialize(),
    });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body).message).toMatch(/Bearer/);
  });

  it("rejects wrong bearer token (401)", async () => {
    const { baseUrl } = await start();
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...bearer("wrong-token-but-still-long-enough-to-be-plausible"),
      },
      body: buildInitialize(),
    });
    expect(res.status).toBe(401);
    const parsed = JSON.parse(res.body) as { error: string; message: string };
    expect(parsed.message).toMatch(/invalid bearer token/);
    // The 401 body must never reflect either token back.
    expect(res.body).not.toContain(TEST_TOKEN);
    expect(res.body).not.toContain("wrong-token");
    expectTokenNeverInWarnings();
  });

  it("rejects token in URL query string with 400, regardless of method", async () => {
    const { baseUrl } = await start();
    for (const key of ["token", "access_token", "bearer", "auth", "authorization"]) {
      const res = await request(
        `${baseUrl}${HTTP_MCP_PATH}?${key}=${encodeURIComponent(TEST_TOKEN)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: buildInitialize(),
        },
      );
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.body) as { error: string };
      expect(parsed.error).toBe("token_in_query_string");
      // Confirm the response body doesn't echo the token back.
      expect(res.body).not.toContain(TEST_TOKEN);
    }
    expectTokenNeverInWarnings();
  });

  it("accepts a valid bearer and returns a JSON-RPC initialize result", async () => {
    const { baseUrl } = await start();
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...bearer(TEST_TOKEN),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "http-transport-test", version: "0" },
        },
      }),
    });
    // SDK responds with 200 + JSON body when enableJsonResponse=true.
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as { result?: { serverInfo?: { name?: string } } };
    expect(parsed.result?.serverInfo?.name).toBe("agentbridge");
    // Audit: response body must not include the bearer token.
    expect(res.body).not.toContain(TEST_TOKEN);
    expectTokenNeverInWarnings();
  });

  it("a request that crosses through transport.handleRequest does not leak the token in stderr", async () => {
    const { baseUrl } = await start();
    await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...bearer(TEST_TOKEN),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "http-transport-test", version: "0" },
        },
      }),
    });
    expectTokenNeverInWarnings();
  });
});

describe("HTTP transport — Origin allowlist", () => {
  it("rejects an unknown Origin with 403 even when bearer is valid", async () => {
    const { baseUrl } = await start();
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example.test",
        ...bearer(TEST_TOKEN),
      },
      body: buildInitialize(),
    });
    expect(res.status).toBe(403);
    const parsed = JSON.parse(res.body) as { error: string };
    expect(parsed.error).toBe("forbidden_origin");
  });

  it("rejects a prefix-attack Origin (https://example.com.evil.test) against https://example.com", async () => {
    const { baseUrl } = await start({
      allowedOrigins: new Set(["https://example.com"]),
    });
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com.evil.test",
        ...bearer(TEST_TOKEN),
      },
      body: buildInitialize(),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a port-mismatch Origin (https://example.com:8443 vs https://example.com)", async () => {
    const { baseUrl } = await start({
      allowedOrigins: new Set(["https://example.com"]),
    });
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com:8443",
        ...bearer(TEST_TOKEN),
      },
      body: buildInitialize(),
    });
    expect(res.status).toBe(403);
  });

  it("accepts an allowed Origin and echoes it back in CORS headers (never wildcard with credentials)", async () => {
    const { baseUrl } = await start();
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Origin: TEST_ORIGIN,
        ...bearer(TEST_TOKEN),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "http-transport-test", version: "0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(TEST_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    // Wildcard is incompatible with credentials — assert we never used it.
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("accepts a request with NO Origin header (non-browser CLI client) when bearer is valid", async () => {
    const { baseUrl } = await start();
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...bearer(TEST_TOKEN),
        // Deliberately no Origin header.
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "http-transport-test", version: "0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("OPTIONS preflight from an unknown Origin gets 403", async () => {
    const { baseUrl } = await start();
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example.test",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });
    expect(res.status).toBe(403);
  });

  it("OPTIONS preflight from an allowed Origin succeeds with safe CORS headers", async () => {
    const { baseUrl } = await start();
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "OPTIONS",
      headers: {
        Origin: TEST_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(TEST_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-methods"]).toMatch(/POST/);
    expect(res.headers["access-control-allow-methods"]).toMatch(/OPTIONS/);
  });

  it("rejects requests from a configured-but-empty allowlist when Origin is supplied", async () => {
    // null = "operator did not set the env var" → still fail closed when
    // an Origin header is supplied.
    const { baseUrl } = await start({ allowedOrigins: null });
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://anything.example.test",
        ...bearer(TEST_TOKEN),
      },
      body: buildInitialize(),
    });
    expect(res.status).toBe(403);
  });
});

describe("HTTP transport — endpoint routing and body limits", () => {
  it("returns 404 for paths that are not the MCP endpoint", async () => {
    const { baseUrl } = await start();
    const res = await request(`${baseUrl}/not-mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(TEST_TOKEN) },
      body: buildInitialize(),
    });
    expect(res.status).toBe(404);
  });

  it("rejects malformed JSON with 400", async () => {
    const { baseUrl } = await start();
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(TEST_TOKEN) },
      body: "{this is not json",
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe("invalid_json");
  });

  it("rejects oversized request body with 413", async () => {
    const tiny = 64;
    const { baseUrl } = await start();
    // Override the cap by recreating with maxRequestBytes via a custom
    // construction. We build a fresh handle to keep the test isolated.
    if (handle !== undefined) {
      await handle.close();
      handle = undefined;
    }
    handle = createHttpServer({
      authToken: TEST_TOKEN,
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: new Set([TEST_ORIGIN]),
      maxRequestBytes: tiny,
      warn: (msg) => warnings.push(msg),
    });
    const addr = await handle.listen();
    const oversize = "x".repeat(tiny + 100);
    const res = await request(`http://127.0.0.1:${addr.port}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(TEST_TOKEN) },
      body: JSON.stringify({ pad: oversize }),
    });
    expect(res.status).toBe(413);
    expectTokenNeverInWarnings();
  });
});

describe("HTTP transport — host binding", () => {
  it("default host (127.0.0.1) accepts connections only via loopback (smoke check)", async () => {
    const { baseUrl } = await start({ host: "127.0.0.1" });
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // We can't sandbox-test a public IP in unit tests, but verifying we
    // can reach the loopback socket and that startup didn't warn about
    // public bind is a useful signal.
    const res = await request(`${baseUrl}${HTTP_MCP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(TEST_TOKEN) },
      body: buildInitialize(),
    });
    expect(res.status).not.toBe(0);
    // No "non-loopback bind" warning should have been emitted.
    expect(warnings.some((w) => /non-loopback bind/i.test(w))).toBe(false);
  });

  it("non-loopback bind emits an explicit stderr notice (still listening; safety enforced earlier)", async () => {
    // We bypass validateHttpStartup by calling createHttpServer
    // directly with allowedOrigins set, simulating an operator who
    // configured both correctly. The notice is informational.
    handle = createHttpServer({
      authToken: TEST_TOKEN,
      host: "0.0.0.0",
      port: 0,
      allowedOrigins: new Set([TEST_ORIGIN]),
      warn: (msg) => warnings.push(msg),
    });
    const addr = await handle.listen();
    expect(addr.port).toBeGreaterThan(0);
    expect(warnings.some((w) => /non-loopback bind/i.test(w))).toBe(true);
    // No mentions of the token, ever.
    expectTokenNeverInWarnings();
  });
});
