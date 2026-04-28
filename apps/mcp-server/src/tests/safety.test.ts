import { describe, it, expect, afterEach } from "vitest";
import { assertAllowedUrl, _resetAllowedUrlWarning } from "../safety";

afterEach(() => {
  _resetAllowedUrlWarning();
});

describe("assertAllowedUrl — loopback default", () => {
  it("allows localhost without any env var set", () => {
    const url = assertAllowedUrl("http://localhost:3000", { env: {} });
    expect(url.hostname).toBe("localhost");
  });

  it("allows 127.0.0.1 and ::1 by default", () => {
    expect(() => assertAllowedUrl("http://127.0.0.1:8080", { env: {} })).not.toThrow();
    expect(() => assertAllowedUrl("http://[::1]:8080", { env: {} })).not.toThrow();
  });

  it("denies remote hosts by default", () => {
    expect(() => assertAllowedUrl("https://app.example.com", { env: {} })).toThrow(
      /Only loopback URLs allowed by default/,
    );
  });
});

describe("assertAllowedUrl — non-http(s) schemes", () => {
  it("rejects javascript:", () => {
    expect(() => assertAllowedUrl("javascript:alert(1)", { env: {} })).toThrow(
      /Only http\(s\) URLs are allowed/,
    );
  });

  it("rejects file:", () => {
    expect(() => assertAllowedUrl("file:///etc/passwd", { env: {} })).toThrow(
      /Only http\(s\) URLs are allowed/,
    );
  });

  it("rejects data:", () => {
    expect(() => assertAllowedUrl("data:text/plain,hello", { env: {} })).toThrow(
      /Only http\(s\) URLs are allowed/,
    );
  });

  it("rejects ftp:", () => {
    expect(() =>
      assertAllowedUrl("ftp://example.com/file", { env: {} }),
    ).toThrow(/Only http\(s\) URLs are allowed/);
  });

  it("non-http schemes are rejected even when AGENTBRIDGE_ALLOW_REMOTE=true", () => {
    expect(() =>
      assertAllowedUrl("javascript:alert(1)", {
        env: { AGENTBRIDGE_ALLOW_REMOTE: "true" },
      }),
    ).toThrow(/Only http\(s\) URLs are allowed/);
  });
});

describe("assertAllowedUrl — AGENTBRIDGE_ALLOW_REMOTE escape hatch", () => {
  it("allows remote hosts when AGENTBRIDGE_ALLOW_REMOTE=true", () => {
    expect(() =>
      assertAllowedUrl("https://app.example.com", {
        env: { AGENTBRIDGE_ALLOW_REMOTE: "true" },
      }),
    ).not.toThrow();
  });

  it("emits a stderr warning when broad remote mode is enabled", () => {
    const warnings: string[] = [];
    assertAllowedUrl("https://app.example.com", {
      env: { AGENTBRIDGE_ALLOW_REMOTE: "true" },
      warn: (msg) => warnings.push(msg),
    });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join("\n")).toMatch(
      /AGENTBRIDGE_ALLOW_REMOTE=true permits all remote target origins/,
    );
    expect(warnings.join("\n")).toMatch(/AGENTBRIDGE_ALLOWED_TARGET_ORIGINS/);
  });
});

describe("assertAllowedUrl — AGENTBRIDGE_ALLOWED_TARGET_ORIGINS allowlist", () => {
  it("allows a remote host whose origin is in the allowlist", () => {
    expect(() =>
      assertAllowedUrl("https://app.example.com/orders", {
        env: { AGENTBRIDGE_ALLOWED_TARGET_ORIGINS: "https://app.example.com" },
      }),
    ).not.toThrow();
  });

  it("denies a remote host whose origin is not in the allowlist", () => {
    expect(() =>
      assertAllowedUrl("https://other.example.com/orders", {
        env: { AGENTBRIDGE_ALLOWED_TARGET_ORIGINS: "https://app.example.com" },
      }),
    ).toThrow(/not in AGENTBRIDGE_ALLOWED_TARGET_ORIGINS/);
  });

  it("matches against URL.origin so prefix attacks fail", () => {
    expect(() =>
      assertAllowedUrl("https://example.com.evil.test/leak", {
        env: { AGENTBRIDGE_ALLOWED_TARGET_ORIGINS: "https://example.com" },
      }),
    ).toThrow(/not in AGENTBRIDGE_ALLOWED_TARGET_ORIGINS/);
  });

  it("supports multiple origins separated by commas (and ignores whitespace)", () => {
    const env = {
      AGENTBRIDGE_ALLOWED_TARGET_ORIGINS:
        "https://app.example.com, https://admin.example.com",
    };
    expect(() =>
      assertAllowedUrl("https://app.example.com", { env }),
    ).not.toThrow();
    expect(() =>
      assertAllowedUrl("https://admin.example.com", { env }),
    ).not.toThrow();
    expect(() =>
      assertAllowedUrl("https://other.example.com", { env }),
    ).toThrow(/not in AGENTBRIDGE_ALLOWED_TARGET_ORIGINS/);
  });

  it("port mismatch is rejected (origin includes the port)", () => {
    expect(() =>
      assertAllowedUrl("https://app.example.com:8443", {
        env: { AGENTBRIDGE_ALLOWED_TARGET_ORIGINS: "https://app.example.com" },
      }),
    ).toThrow(/not in AGENTBRIDGE_ALLOWED_TARGET_ORIGINS/);
  });

  it("loopback URLs remain allowed even when an allowlist is set", () => {
    expect(() =>
      assertAllowedUrl("http://localhost:3000", {
        env: { AGENTBRIDGE_ALLOWED_TARGET_ORIGINS: "https://app.example.com" },
      }),
    ).not.toThrow();
  });

  it("the allowlist wins when both env vars are set", () => {
    const warnings: string[] = [];
    assertAllowedUrl("https://app.example.com", {
      env: {
        AGENTBRIDGE_ALLOW_REMOTE: "true",
        AGENTBRIDGE_ALLOWED_TARGET_ORIGINS: "https://app.example.com",
      },
      warn: (msg) => warnings.push(msg),
    });
    expect(warnings.length).toBe(0);
    expect(() =>
      assertAllowedUrl("https://other.example.com", {
        env: {
          AGENTBRIDGE_ALLOW_REMOTE: "true",
          AGENTBRIDGE_ALLOWED_TARGET_ORIGINS: "https://app.example.com",
        },
      }),
    ).toThrow(/not in AGENTBRIDGE_ALLOWED_TARGET_ORIGINS/);
  });

  it("rejects a malformed origin in the allowlist", () => {
    expect(() =>
      assertAllowedUrl("https://app.example.com", {
        env: { AGENTBRIDGE_ALLOWED_TARGET_ORIGINS: "not-a-url" },
      }),
    ).toThrow(/AGENTBRIDGE_ALLOWED_TARGET_ORIGINS contains invalid origin/);
  });

  it("rejects a non-http scheme inside the allowlist", () => {
    expect(() =>
      assertAllowedUrl("https://app.example.com", {
        env: { AGENTBRIDGE_ALLOWED_TARGET_ORIGINS: "ftp://example.com" },
      }),
    ).toThrow(/only supports http\(s\) origins/);
  });

  it("an empty allowlist string falls through to default behavior", () => {
    expect(() =>
      assertAllowedUrl("https://app.example.com", {
        env: { AGENTBRIDGE_ALLOWED_TARGET_ORIGINS: "" },
      }),
    ).toThrow(/Only loopback URLs allowed by default/);
  });
});
