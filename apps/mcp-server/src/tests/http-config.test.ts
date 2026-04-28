import { describe, it, expect } from "vitest";
import { resolveTransport, resolveHttpConfig, LOOPBACK_HOSTS } from "../config";

/* These tests pin the env-var contract for the HTTP transport. They
 * never touch process.env — every call passes an explicit `env` map so
 * tests are isolated from each other and from the surrounding shell.
 */

const collectWarnings = () => {
  const warnings: string[] = [];
  return {
    warn: (msg: string) => warnings.push(msg),
    warnings,
  };
};

describe("resolveTransport", () => {
  it("defaults to stdio when AGENTBRIDGE_TRANSPORT is unset", () => {
    expect(resolveTransport({ env: {} })).toBe("stdio");
  });

  it("defaults to stdio when AGENTBRIDGE_TRANSPORT is empty", () => {
    expect(resolveTransport({ env: { AGENTBRIDGE_TRANSPORT: "" } })).toBe("stdio");
  });

  it("returns http when AGENTBRIDGE_TRANSPORT=http", () => {
    expect(resolveTransport({ env: { AGENTBRIDGE_TRANSPORT: "http" } })).toBe("http");
  });

  it("accepts case-insensitive http (HTTP, Http) and trims whitespace", () => {
    for (const v of ["HTTP", "Http", "  http  "]) {
      expect(resolveTransport({ env: { AGENTBRIDGE_TRANSPORT: v } })).toBe("http");
    }
  });

  it("falls back to stdio with a stderr warning on unknown value", () => {
    const { warn, warnings } = collectWarnings();
    expect(
      resolveTransport({ env: { AGENTBRIDGE_TRANSPORT: "websocket" }, warn }),
    ).toBe("stdio");
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/AGENTBRIDGE_TRANSPORT="websocket"/);
    expect(warnings[0]).toMatch(/falling back to stdio/);
  });
});

describe("resolveHttpConfig", () => {
  it("uses 127.0.0.1 as the default host", () => {
    const cfg = resolveHttpConfig({ env: {} });
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.isLoopbackBind).toBe(true);
  });

  it("uses 3333 as the default port", () => {
    const cfg = resolveHttpConfig({ env: {} });
    expect(cfg.port).toBe(3333);
  });

  it("accepts an operator-supplied port", () => {
    expect(resolveHttpConfig({ env: { AGENTBRIDGE_HTTP_PORT: "9090" } }).port).toBe(9090);
  });

  it("accepts port 0 for ephemeral binding (used by tests)", () => {
    expect(resolveHttpConfig({ env: { AGENTBRIDGE_HTTP_PORT: "0" } }).port).toBe(0);
  });

  it("clamps an out-of-range port to the bound and warns", () => {
    const { warn, warnings } = collectWarnings();
    const cfg = resolveHttpConfig({
      env: { AGENTBRIDGE_HTTP_PORT: "999999" },
      warn,
    });
    expect(cfg.port).toBe(65535);
    expect(warnings.some((w) => /AGENTBRIDGE_HTTP_PORT/.test(w))).toBe(true);
  });

  it("falls back to default port for non-integer values and warns", () => {
    const { warn, warnings } = collectWarnings();
    const cfg = resolveHttpConfig({
      env: { AGENTBRIDGE_HTTP_PORT: "not-a-number" },
      warn,
    });
    expect(cfg.port).toBe(3333);
    expect(warnings.some((w) => /AGENTBRIDGE_HTTP_PORT/.test(w))).toBe(true);
  });

  it("flags loopback hosts as isLoopbackBind=true", () => {
    for (const host of ["127.0.0.1", "localhost", "::1", "[::1]"]) {
      expect(LOOPBACK_HOSTS.has(host)).toBe(true);
      expect(resolveHttpConfig({ env: { AGENTBRIDGE_HTTP_HOST: host } }).isLoopbackBind).toBe(true);
    }
  });

  it("flags non-loopback hosts as isLoopbackBind=false", () => {
    for (const host of ["0.0.0.0", "10.0.0.5", "::", "example.local"]) {
      expect(resolveHttpConfig({ env: { AGENTBRIDGE_HTTP_HOST: host } }).isLoopbackBind).toBe(false);
    }
  });

  it("returns undefined for missing AGENTBRIDGE_HTTP_AUTH_TOKEN", () => {
    expect(resolveHttpConfig({ env: {} }).authToken).toBeUndefined();
  });

  it("treats an empty AGENTBRIDGE_HTTP_AUTH_TOKEN as undefined (operator forgot to set)", () => {
    expect(
      resolveHttpConfig({ env: { AGENTBRIDGE_HTTP_AUTH_TOKEN: "" } }).authToken,
    ).toBeUndefined();
  });

  it("returns the token verbatim when set (does NOT log it)", () => {
    const { warn, warnings } = collectWarnings();
    const cfg = resolveHttpConfig({
      env: { AGENTBRIDGE_HTTP_AUTH_TOKEN: "secret-token-value-for-test" },
      warn,
    });
    expect(cfg.authToken).toBe("secret-token-value-for-test");
    // The token must never appear in any warning emitted at parse time.
    for (const w of warnings) {
      expect(w).not.toContain("secret-token-value-for-test");
    }
  });

  it("returns null for AGENTBRIDGE_HTTP_ALLOWED_ORIGINS when unset", () => {
    expect(resolveHttpConfig({ env: {} }).allowedOrigins).toBeNull();
  });

  it("returns null for AGENTBRIDGE_HTTP_ALLOWED_ORIGINS when empty string", () => {
    expect(
      resolveHttpConfig({ env: { AGENTBRIDGE_HTTP_ALLOWED_ORIGINS: "  " } }).allowedOrigins,
    ).toBeNull();
  });

  it("parses a comma-separated allowlist into a Set of normalized origins", () => {
    const cfg = resolveHttpConfig({
      env: {
        AGENTBRIDGE_HTTP_ALLOWED_ORIGINS:
          "https://app.example.com, https://admin.example.com, http://localhost:5173",
      },
    });
    expect(cfg.allowedOrigins).not.toBeNull();
    const list = [...(cfg.allowedOrigins ?? [])].sort();
    expect(list).toEqual([
      "http://localhost:5173",
      "https://admin.example.com",
      "https://app.example.com",
    ]);
  });

  it("normalizes origins via URL.origin (drops paths, queries, fragments)", () => {
    const cfg = resolveHttpConfig({
      env: {
        AGENTBRIDGE_HTTP_ALLOWED_ORIGINS:
          "https://app.example.com/some/path?x=1#frag",
      },
    });
    expect([...(cfg.allowedOrigins ?? [])]).toEqual(["https://app.example.com"]);
  });

  it("ignores malformed origins with a stderr warning, keeping the rest", () => {
    const { warn, warnings } = collectWarnings();
    const cfg = resolveHttpConfig({
      env: {
        AGENTBRIDGE_HTTP_ALLOWED_ORIGINS: "not a url, https://app.example.com",
      },
      warn,
    });
    expect([...(cfg.allowedOrigins ?? [])]).toEqual(["https://app.example.com"]);
    expect(warnings.some((w) => /invalid origin "not a url"/.test(w))).toBe(true);
  });

  it("ignores non-http(s) origins (e.g. javascript:) with a warning", () => {
    const { warn, warnings } = collectWarnings();
    const cfg = resolveHttpConfig({
      env: {
        AGENTBRIDGE_HTTP_ALLOWED_ORIGINS: "javascript:alert(1), https://app.example.com",
      },
      warn,
    });
    expect([...(cfg.allowedOrigins ?? [])]).toEqual(["https://app.example.com"]);
    expect(warnings.some((w) => /only supports http\(s\)/.test(w))).toBe(true);
  });

  it("inbound AGENTBRIDGE_HTTP_ALLOWED_ORIGINS is independent from outbound AGENTBRIDGE_ALLOWED_TARGET_ORIGINS", () => {
    // The outbound env var is read by safety.ts, not config.ts. Setting
    // one must not influence the other.
    const cfg = resolveHttpConfig({
      env: {
        AGENTBRIDGE_HTTP_ALLOWED_ORIGINS: "https://browser-allowed.example.com",
        AGENTBRIDGE_ALLOWED_TARGET_ORIGINS: "https://outbound-target.example.com",
      },
    });
    expect([...(cfg.allowedOrigins ?? [])]).toEqual([
      "https://browser-allowed.example.com",
    ]);
    // No accidental cross-contamination.
    expect(cfg.allowedOrigins?.has("https://outbound-target.example.com")).toBe(false);
  });
});
