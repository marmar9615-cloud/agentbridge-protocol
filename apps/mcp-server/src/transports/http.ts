/* HTTP transport adapter for the AgentBridge MCP server.
 *
 * Builds the same shared MCP `Server` (via `createMcpServer()`) the stdio
 * adapter uses, and connects it to a `StreamableHTTPServerTransport`.
 * Auth, Origin validation, and host-binding checks live in this module's
 * request handler — *in front of* `transport.handleRequest()` — so the
 * dispatcher in `../server.ts` and the safety checks in `../safety.ts`
 * stay transport-agnostic.
 *
 * Phase 1 auth model: a static bearer token from
 * `AGENTBRIDGE_HTTP_AUTH_TOKEN`, presented in the `Authorization: Bearer
 * <token>` header. Tokens in URL query strings are rejected with HTTP
 * 400. OAuth resource-server mode is reserved for a future release; the
 * `verifyBearer` boundary is the only place that needs to change when it
 * lands.
 *
 * See:
 *   docs/designs/http-mcp-transport-auth.md
 *   docs/adr/0001-http-mcp-transport.md
 */

import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../server";
import {
  LOOPBACK_HOSTS,
  resolveConfig,
  resolveHttpConfig,
  type HttpConfig,
} from "../config";

/** Endpoint path the MCP transport mounts at. */
export const HTTP_MCP_PATH = "/mcp";

/** Error response shape used for non-MCP-protocol failures (auth, origin, body parsing). */
interface HttpErrorBody {
  error: string;
  message: string;
}

/**
 * Options for {@link createHttpServer}. Tests pass these directly so they
 * don't have to mutate `process.env`.
 */
export interface CreateHttpServerOptions {
  /** Bearer token operator generated. Compared in constant time; never logged. */
  authToken: string;
  /** Bind interface. Loopback (`127.0.0.1`/`::1`/`localhost`) is the safe default. */
  host: string;
  /** TCP port. `0` selects an ephemeral port. */
  port: number;
  /**
   * Inbound Origin header allowlist. `null` means "operator did not set
   * `AGENTBRIDGE_HTTP_ALLOWED_ORIGINS`"; in that case requests carrying
   * an Origin header are rejected with 403 (fail closed) but
   * non-browser clients with no Origin header still go through bearer
   * auth. Non-loopback bind requires this to be a non-empty Set.
   */
  allowedOrigins: ReadonlySet<string> | null;
  /** Maximum request body size in bytes. Defaults to `resolveConfig().maxResponseBytes`. */
  maxRequestBytes?: number;
  /** Stderr writer. Defaults to `process.stderr.write`. Never receives the bearer token. */
  warn?: (msg: string) => void;
}

/** Object returned by {@link createHttpServer}. */
export interface HttpServerHandle {
  /** Underlying Node `http.Server` instance. Tests can attach listeners and close it. */
  server: HttpServer;
  /** The shared MCP server (same one stdio uses). */
  mcpServer: Server;
  /** The Streamable HTTP transport bound to `mcpServer`. */
  transport: StreamableHTTPServerTransport;
  /** Listen on the configured host/port. Resolves once the socket is bound, with the actual address. */
  listen(): Promise<AddressInfo>;
  /** Stop accepting new connections and close the MCP server + transport. */
  close(): Promise<void>;
}

/**
 * Construct (but do not start) an HTTP MCP server. Tests call this with
 * explicit options so they do not have to mutate process.env.
 *
 * The `runHttpServer` runtime entry adds the env-var validation and
 * eager `.listen()` on top of this factory.
 */
export function createHttpServer(opts: CreateHttpServerOptions): HttpServerHandle {
  const warn =
    opts.warn ?? ((msg: string) => process.stderr.write(`${msg}\n`));
  const maxRequestBytes = opts.maxRequestBytes ?? resolveConfig().maxResponseBytes;
  const expectedTokenBuf = Buffer.from(opts.authToken, "utf8");
  const allowedOrigins = opts.allowedOrigins;
  const isLoopbackBind = LOOPBACK_HOSTS.has(opts.host);

  // One MCP server, one transport. Stateless (no session IDs) and
  // JSON-only responses so non-SSE clients work; SSE off matches the
  // design's `AGENTBRIDGE_HTTP_ENABLE_SSE=false` default.
  const mcpServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  // The server is connected once at construction time so the transport's
  // onmessage/send wiring is in place before the first HTTP request lands.
  // The promise is fire-and-forget by design — `connect()` resolves
  // immediately for HTTP because there is no per-request stream to start.
  const connectPromise = mcpServer.connect(transport);

  const server = createServer((req, res) => {
    // The handler is sync-friendly; the async function we await below
    // owns its own try/catch so a rejected promise can't escape into
    // the Node 'uncaughtException' channel.
    handleRequest(req, res).catch((err) => {
      warn(`[agentbridge-mcp-http] request handler crashed: ${(err as Error).message}`);
      // If we have not already responded, send a 500 with no detail.
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal_error", message: "internal server error" });
      } else {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://placeholder.local");
    const originHeader = headerValue(req, "origin");

    // ── 1. CORS preflight ────────────────────────────────────────────
    if (req.method === "OPTIONS") {
      // Preflight respects the Origin allowlist. Without an Origin we
      // have no surface to advertise CORS for, so we 204 with no
      // Access-Control-* headers.
      if (originHeader === undefined) {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (!isOriginAllowed(originHeader, allowedOrigins)) {
        sendJson(res, 403, { error: "forbidden_origin", message: "origin not allowed" });
        return;
      }
      writeAllowedOriginCorsHeaders(res, originHeader);
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "authorization, content-type, mcp-session-id, mcp-protocol-version",
      );
      res.setHeader("Access-Control-Max-Age", "600");
      res.statusCode = 204;
      res.end();
      return;
    }

    // ── 2. Reject query-string tokens (any of the common names) ──────
    // Regardless of route — token leakage via URL is the threat we're
    // closing here; rejecting before path-matching prevents a future
    // route handler from forgetting the check.
    for (const key of ["token", "access_token", "bearer", "auth", "authorization"]) {
      if (url.searchParams.has(key)) {
        sendJson(res, 400, {
          error: "token_in_query_string",
          message:
            "Authentication tokens must be provided in the Authorization header, not in the URL query string.",
        });
        return;
      }
    }

    // ── 3. Path matching ─────────────────────────────────────────────
    if (url.pathname !== HTTP_MCP_PATH) {
      sendJson(res, 404, { error: "not_found", message: "no MCP endpoint at this path" });
      return;
    }

    // ── 4. Origin allowlist (only when Origin is present) ────────────
    // Per design §7: bearer auth is sufficient for non-browser clients
    // that don't send Origin. Browsers always send it; an unknown
    // Origin is an immediate 403.
    if (originHeader !== undefined && !isOriginAllowed(originHeader, allowedOrigins)) {
      sendJson(res, 403, { error: "forbidden_origin", message: "origin not allowed" });
      return;
    }

    // ── 5. Bearer-token auth ────────────────────────────────────────
    const authResult = verifyBearer(req, expectedTokenBuf);
    if (!authResult.ok) {
      // 401 with WWW-Authenticate; we never echo the supplied or
      // expected token in the body.
      res.setHeader("WWW-Authenticate", 'Bearer realm="agentbridge-mcp"');
      sendJson(res, 401, { error: "unauthorized", message: authResult.reason });
      return;
    }

    // ── 6. CORS response headers for allowed inbound Origin ──────────
    if (originHeader !== undefined) {
      writeAllowedOriginCorsHeaders(res, originHeader);
    }

    // ── 7. Body capture (size-capped) ────────────────────────────────
    let body: unknown = undefined;
    if (req.method === "POST") {
      const captured = await readBodyCapped(req, maxRequestBytes);
      if (captured.kind === "too_large") {
        sendJson(res, 413, {
          error: "payload_too_large",
          message: `request body exceeded ${maxRequestBytes} bytes`,
        });
        return;
      }
      const text = captured.text;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          sendJson(res, 400, { error: "invalid_json", message: "request body is not valid JSON" });
          return;
        }
      }
    }

    // ── 8. Hand off to the MCP transport ─────────────────────────────
    await connectPromise;
    await transport.handleRequest(req, res, body);
  }

  async function listen(): Promise<AddressInfo> {
    return await new Promise<AddressInfo>((resolve, reject) => {
      const onError = (err: Error) => {
        server.removeListener("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        const address = server.address();
        if (address === null || typeof address === "string") {
          // Pipe / null — should never happen for createServer + listen on host:port.
          reject(new Error(`unexpected listen address: ${String(address)}`));
          return;
        }
        // Host info already present via opts; we mostly want the actual port
        // so callers (tests) can build URLs.
        warn(
          `[agentbridge-mcp-http] listening on http://${
            opts.host.includes(":") ? `[${opts.host}]` : opts.host
          }:${address.port}${HTTP_MCP_PATH}`,
        );
        if (!isLoopbackBind) {
          warn(
            `[agentbridge-mcp-http] non-loopback bind to ${opts.host} — auth and Origin allowlist are required and have been verified.`,
          );
        }
        resolve(address);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(opts.port, opts.host);
    });
  }

  async function close(): Promise<void> {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // close() doesn't fire 'close' if server was never listening; force
      // resolution after a microtask in that case.
      if (server.listening === false) {
        resolve();
      }
    });
    try {
      await transport.close();
    } catch {
      /* transport.close is best-effort; swallow */
    }
    try {
      await mcpServer.close();
    } catch {
      /* ditto */
    }
  }

  return { server, mcpServer, transport, listen, close };
}

/**
 * Runtime HTTP entry. Reads env vars, validates the safety
 * preconditions ("auth required for http; public bind needs both auth
 * and Origins"), and starts listening. Resolves only on startup
 * failure — when listening succeeds, it returns a never-resolving
 * promise so the caller (`index.ts`) keeps the process alive.
 */
export async function runHttpServer(): Promise<void> {
  const cfg = resolveHttpConfig();
  validateHttpStartup(cfg);

  // After validateHttpStartup, authToken is guaranteed defined.
  const handle = createHttpServer({
    authToken: cfg.authToken!,
    host: cfg.host,
    port: cfg.port,
    allowedOrigins: cfg.allowedOrigins,
  });
  await handle.listen();
  // Hold the process open. Node will keep running while the server is
  // listening; this promise never resolves.
  await new Promise<void>(() => {});
}

/**
 * Throw if the parsed HTTP config violates a startup invariant.
 * Exported so tests can drive the validation without spinning up a
 * server. Error messages **never** include the auth token value.
 */
export function validateHttpStartup(cfg: HttpConfig): void {
  if (cfg.authToken === undefined) {
    throw new Error(
      "AGENTBRIDGE_HTTP_AUTH_TOKEN is required when AGENTBRIDGE_TRANSPORT=http. Generate one with: openssl rand -hex 32",
    );
  }
  if (cfg.authToken.length < 16) {
    throw new Error(
      "AGENTBRIDGE_HTTP_AUTH_TOKEN is too short (need at least 16 chars). Generate one with: openssl rand -hex 32",
    );
  }
  if (!cfg.isLoopbackBind) {
    if (cfg.allowedOrigins === null || cfg.allowedOrigins.size === 0) {
      throw new Error(
        `Public bind to ${cfg.host} requires AGENTBRIDGE_HTTP_ALLOWED_ORIGINS to be set to a non-empty comma-separated list of inbound origins.`,
      );
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

interface VerifyResult {
  ok: boolean;
  reason: string;
}

/**
 * Constant-time bearer-token comparison. Length-pads both sides to the
 * length of the expected token so timing leaks don't reveal length.
 * Returns `{ ok: true }` only when the supplied token matches.
 */
function verifyBearer(req: IncomingMessage, expected: Buffer): VerifyResult {
  const header = headerValue(req, "authorization");
  if (header === undefined) {
    return { ok: false, reason: "missing Authorization header" };
  }
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) {
    return { ok: false, reason: "Authorization header is not a Bearer token" };
  }
  const supplied = Buffer.from(m[1].trim(), "utf8");
  // Pad both to the longer length so timingSafeEqual sees equal-length
  // buffers regardless of input. The pad bytes don't match the
  // expected token, so a length mismatch still fails the equality
  // check, but the comparison time is constant.
  const len = Math.max(supplied.length, expected.length);
  const a = Buffer.alloc(len);
  const b = Buffer.alloc(len);
  supplied.copy(a);
  expected.copy(b);
  if (timingSafeEqual(a, b) && supplied.length === expected.length) {
    return { ok: true, reason: "" };
  }
  return { ok: false, reason: "invalid bearer token" };
}

function isOriginAllowed(
  origin: string,
  allowed: ReadonlySet<string> | null,
): boolean {
  if (allowed === null) return false;
  // Normalize via URL.origin so port/scheme are exact.
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  return allowed.has(parsed.origin);
}

/**
 * Set CORS response headers for an Origin we have already verified is in
 * the allowlist. Echoes the exact origin (never `*`) and asserts
 * `Allow-Credentials: true` so cookies/Authorization headers can flow.
 */
function writeAllowedOriginCorsHeaders(res: ServerResponse, origin: string): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
}

interface ReadBodyOk {
  kind: "ok";
  text: string;
}
interface ReadBodyTooLarge {
  kind: "too_large";
}

async function readBodyCapped(
  req: IncomingMessage,
  maxBytes: number,
): Promise<ReadBodyOk | ReadBodyTooLarge> {
  return await new Promise((resolve, reject) => {
    let total = 0;
    let exceeded = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (exceeded) return; // discard further chunks; we'll respond on 'end'
      total += chunk.length;
      if (total > maxBytes) {
        exceeded = true;
        // Hold on to the response until the client finishes uploading
        // so the response code (413) is delivered cleanly instead of
        // appearing to the client as a socket hang-up. The discarded
        // bytes never enter `chunks`.
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (exceeded) {
        resolve({ kind: "too_large" });
      } else {
        resolve({ kind: "ok", text: Buffer.concat(chunks).toString("utf8") });
      }
    });
    req.on("error", reject);
  });
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v[0];
  return v;
}

function sendJson(res: ServerResponse, status: number, body: HttpErrorBody): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
