import { describe, it, expect } from "vitest";
import { resolveConfig, CONFIG_BOUNDS, CONFIG_DEFAULTS } from "../config";

describe("resolveConfig — defaults", () => {
  it("returns hardcoded defaults when no env vars are set", () => {
    const cfg = resolveConfig({ env: {} });
    expect(cfg.actionTimeoutMs).toBe(CONFIG_DEFAULTS.ACTION_TIMEOUT_MS);
    expect(cfg.maxResponseBytes).toBe(CONFIG_DEFAULTS.MAX_RESPONSE_BYTES);
    expect(cfg.confirmationTtlMs).toBe(
      CONFIG_DEFAULTS.CONFIRMATION_TTL_SECONDS * 1000,
    );
  });
});

describe("resolveConfig — AGENTBRIDGE_ACTION_TIMEOUT_MS", () => {
  it("accepts a valid in-range value", () => {
    const cfg = resolveConfig({
      env: { AGENTBRIDGE_ACTION_TIMEOUT_MS: "30000" },
    });
    expect(cfg.actionTimeoutMs).toBe(30000);
  });

  it("clamps below the minimum", () => {
    const warnings: string[] = [];
    const cfg = resolveConfig({
      env: { AGENTBRIDGE_ACTION_TIMEOUT_MS: "10" },
      warn: (m) => warnings.push(m),
    });
    expect(cfg.actionTimeoutMs).toBe(CONFIG_BOUNDS.ACTION_TIMEOUT_MS.min);
    expect(warnings.join("\n")).toMatch(/clamped to 1000/);
  });

  it("clamps above the maximum", () => {
    const warnings: string[] = [];
    const cfg = resolveConfig({
      env: { AGENTBRIDGE_ACTION_TIMEOUT_MS: "9999999" },
      warn: (m) => warnings.push(m),
    });
    expect(cfg.actionTimeoutMs).toBe(CONFIG_BOUNDS.ACTION_TIMEOUT_MS.max);
    expect(warnings.join("\n")).toMatch(/clamped to 120000/);
  });

  it("falls back to default on non-numeric input with a warning", () => {
    const warnings: string[] = [];
    const cfg = resolveConfig({
      env: { AGENTBRIDGE_ACTION_TIMEOUT_MS: "not-a-number" },
      warn: (m) => warnings.push(m),
    });
    expect(cfg.actionTimeoutMs).toBe(CONFIG_DEFAULTS.ACTION_TIMEOUT_MS);
    expect(warnings.join("\n")).toMatch(/is not an integer/);
  });
});

describe("resolveConfig — AGENTBRIDGE_MAX_RESPONSE_BYTES", () => {
  it("accepts a valid in-range value", () => {
    const cfg = resolveConfig({
      env: { AGENTBRIDGE_MAX_RESPONSE_BYTES: "65536" },
    });
    expect(cfg.maxResponseBytes).toBe(65536);
  });

  it("clamps below 1024 bytes", () => {
    const warnings: string[] = [];
    const cfg = resolveConfig({
      env: { AGENTBRIDGE_MAX_RESPONSE_BYTES: "10" },
      warn: (m) => warnings.push(m),
    });
    expect(cfg.maxResponseBytes).toBe(CONFIG_BOUNDS.MAX_RESPONSE_BYTES.min);
  });

  it("clamps above 10MB", () => {
    const warnings: string[] = [];
    const cfg = resolveConfig({
      env: { AGENTBRIDGE_MAX_RESPONSE_BYTES: "999999999" },
      warn: (m) => warnings.push(m),
    });
    expect(cfg.maxResponseBytes).toBe(CONFIG_BOUNDS.MAX_RESPONSE_BYTES.max);
  });
});

describe("resolveConfig — AGENTBRIDGE_CONFIRMATION_TTL_SECONDS", () => {
  it("converts seconds to ms for in-range values", () => {
    const cfg = resolveConfig({
      env: { AGENTBRIDGE_CONFIRMATION_TTL_SECONDS: "120" },
    });
    expect(cfg.confirmationTtlMs).toBe(120 * 1000);
  });

  it("clamps below 30 seconds", () => {
    const warnings: string[] = [];
    const cfg = resolveConfig({
      env: { AGENTBRIDGE_CONFIRMATION_TTL_SECONDS: "5" },
      warn: (m) => warnings.push(m),
    });
    expect(cfg.confirmationTtlMs).toBe(
      CONFIG_BOUNDS.CONFIRMATION_TTL_SECONDS.min * 1000,
    );
  });

  it("clamps above 1 hour", () => {
    const warnings: string[] = [];
    const cfg = resolveConfig({
      env: { AGENTBRIDGE_CONFIRMATION_TTL_SECONDS: "99999" },
      warn: (m) => warnings.push(m),
    });
    expect(cfg.confirmationTtlMs).toBe(
      CONFIG_BOUNDS.CONFIRMATION_TTL_SECONDS.max * 1000,
    );
  });
});
