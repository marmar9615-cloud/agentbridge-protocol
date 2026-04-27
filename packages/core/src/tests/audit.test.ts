import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createAuditEvent, redact, appendAuditEvent, readAuditEvents } from "../audit";

const TMP_DIR = path.join(os.tmpdir(), `agentbridge-audit-test-${process.pid}`);

beforeEach(async () => {
  process.env.AGENTBRIDGE_DATA_DIR = TMP_DIR;
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
  delete process.env.AGENTBRIDGE_DATA_DIR;
});

describe("createAuditEvent", () => {
  it("produces a well-formed event", () => {
    const ev = createAuditEvent({
      source: "demo",
      actionName: "list_orders",
      status: "completed",
    });
    expect(ev.id).toBeTruthy();
    expect(ev.timestamp).toBeTruthy();
    expect(ev.source).toBe("demo");
  });
});

describe("redact", () => {
  it("redacts sensitive keys recursively", () => {
    const cleaned = redact({
      orderId: "ORD-1",
      authorization: "Bearer abc",
      nested: { token: "xyz", value: 42 },
      list: [{ password: "p" }],
    });
    expect(cleaned).toEqual({
      orderId: "ORD-1",
      authorization: "[REDACTED]",
      nested: { token: "[REDACTED]", value: 42 },
      list: [{ password: "[REDACTED]" }],
    });
  });

  it("handles primitives and null", () => {
    expect(redact(null)).toBe(null);
    expect(redact(42)).toBe(42);
    expect(redact("hello")).toBe("hello");
  });
});

describe("audit log persistence", () => {
  it("appends and reads back events", async () => {
    const ev1 = createAuditEvent({
      source: "demo",
      actionName: "list_orders",
      manifestUrl: "http://localhost:3000",
      status: "completed",
    });
    const ev2 = createAuditEvent({
      source: "mcp",
      actionName: "get_order",
      manifestUrl: "http://localhost:3000",
      status: "completed",
    });
    await appendAuditEvent(ev1);
    await appendAuditEvent(ev2);
    const all = await readAuditEvents();
    expect(all).toHaveLength(2);
    // Newest first
    expect(all[0].actionName).toBe("get_order");
  });

  it("filters by manifestUrl", async () => {
    await appendAuditEvent(
      createAuditEvent({
        source: "demo",
        actionName: "a",
        manifestUrl: "http://localhost:3000",
        status: "completed",
      }),
    );
    await appendAuditEvent(
      createAuditEvent({
        source: "mcp",
        actionName: "b",
        manifestUrl: "http://localhost:4000",
        status: "completed",
      }),
    );
    const filtered = await readAuditEvents({ url: "http://localhost:3000" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].actionName).toBe("a");
  });
});
