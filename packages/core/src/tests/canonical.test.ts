import { describe, it, expect } from "vitest";
import {
  canonicalizeJson,
  canonicalizeManifestForSigning,
  CanonicalizationError,
} from "../signing/canonical";

describe("canonicalizeJson — primitives", () => {
  it("serializes null", () => {
    expect(canonicalizeJson(null)).toBe("null");
  });

  it("serializes booleans", () => {
    expect(canonicalizeJson(true)).toBe("true");
    expect(canonicalizeJson(false)).toBe("false");
  });

  it("serializes integers", () => {
    expect(canonicalizeJson(0)).toBe("0");
    expect(canonicalizeJson(1)).toBe("1");
    expect(canonicalizeJson(-1)).toBe("-1");
    expect(canonicalizeJson(42)).toBe("42");
  });

  it("normalizes -0 to 0 (RFC 8785 §3.2.2.3)", () => {
    expect(canonicalizeJson(-0)).toBe("0");
  });

  it("uses ECMA-262 number-to-string for floats (RFC 8785 §3.2.2.3)", () => {
    expect(canonicalizeJson(1.5)).toBe("1.5");
    expect(canonicalizeJson(1.0)).toBe("1");
    expect(canonicalizeJson(0.1)).toBe("0.1");
    expect(canonicalizeJson(1e21)).toBe("1e+21");
    expect(canonicalizeJson(0.0000001)).toBe("1e-7");
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalizeJson(Number.NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => canonicalizeJson(Number.NEGATIVE_INFINITY)).toThrow(/non-finite/);
  });

  it("serializes strings using minimal escaping (RFC 8785 §3.2.2.2)", () => {
    expect(canonicalizeJson("")).toBe('""');
    expect(canonicalizeJson("hello")).toBe('"hello"');
    // " and \\ are escaped via short escapes
    expect(canonicalizeJson('a"b')).toBe('"a\\"b"');
    expect(canonicalizeJson("a\\b")).toBe('"a\\\\b"');
    // Control chars use short escapes where defined
    expect(canonicalizeJson("\n")).toBe('"\\n"');
    expect(canonicalizeJson("\t")).toBe('"\\t"');
    expect(canonicalizeJson("\r")).toBe('"\\r"');
    // Non-ASCII printable left as-is (UTF-8 in the output)
    expect(canonicalizeJson("é")).toBe('"é"');
  });

  it("rejects undefined", () => {
    expect(() => canonicalizeJson(undefined)).toThrow(/undefined/);
  });

  it("rejects functions", () => {
    expect(() => canonicalizeJson(() => 1)).toThrow(/function/);
  });

  it("rejects symbols", () => {
    expect(() => canonicalizeJson(Symbol("x"))).toThrow(/symbol/);
  });

  it("rejects BigInt", () => {
    expect(() => canonicalizeJson(BigInt(1))).toThrow(/BigInt/);
  });
});

describe("canonicalizeJson — arrays", () => {
  it("preserves array order", () => {
    expect(canonicalizeJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("handles nested arrays", () => {
    expect(canonicalizeJson([[1, 2], [3, [4, 5]]])).toBe("[[1,2],[3,[4,5]]]");
  });

  it("handles arrays of mixed primitives", () => {
    expect(canonicalizeJson([true, null, 1, "x"])).toBe('[true,null,1,"x"]');
  });

  it("handles empty array", () => {
    expect(canonicalizeJson([])).toBe("[]");
  });

  it("propagates errors from array elements", () => {
    expect(() => canonicalizeJson([1, undefined, 3])).toThrow(/undefined/);
  });
});

describe("canonicalizeJson — objects", () => {
  it("sorts keys lexicographically", () => {
    expect(canonicalizeJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts deeply nested keys", () => {
    expect(
      canonicalizeJson({
        outer: { z: 1, a: 2, m: { y: 3, b: 4 } },
        first: 0,
      }),
    ).toBe('{"first":0,"outer":{"a":2,"m":{"b":4,"y":3},"z":1}}');
  });

  it("handles empty object", () => {
    expect(canonicalizeJson({})).toBe("{}");
  });

  it("escapes JSON Pointer characters in error path", () => {
    try {
      canonicalizeJson({ "weird/key~name": undefined });
    } catch (err) {
      expect((err as CanonicalizationError).path).toContain("weird~1key~0name");
      return;
    }
    throw new Error("expected an error to be thrown");
  });

  it("rejects non-plain objects (Date)", () => {
    expect(() => canonicalizeJson(new Date(0))).toThrow(/plain JSON objects/);
  });

  it("rejects non-plain objects (Map)", () => {
    expect(() => canonicalizeJson(new Map())).toThrow(/plain JSON objects/);
  });

  it("rejects class instances", () => {
    class Foo { x = 1; }
    expect(() => canonicalizeJson(new Foo())).toThrow(/plain JSON objects/);
  });

  it("accepts objects with null prototype", () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.b = 1;
    o.a = 2;
    expect(canonicalizeJson(o)).toBe('{"a":2,"b":1}');
  });

  it("rejects undefined property values", () => {
    expect(() => canonicalizeJson({ a: undefined })).toThrow(/undefined/);
  });

  it("rejects function property values", () => {
    expect(() => canonicalizeJson({ a: () => 1 })).toThrow(/function/);
  });

  it("ignores symbol-keyed properties (matches JSON.stringify)", () => {
    const sym = Symbol("hidden");
    const o: Record<string | symbol, unknown> = { a: 1 };
    o[sym] = 2;
    expect(canonicalizeJson(o)).toBe('{"a":1}');
  });
});

describe("canonicalizeJson — determinism", () => {
  it("produces identical output for objects with different key insertion order", () => {
    const a = { foo: 1, bar: 2, baz: 3 };
    const b = { baz: 3, foo: 1, bar: 2 };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
  });

  it("produces identical output for deeply nested objects with reordered keys", () => {
    const a = {
      outer: { inner: { y: 1, x: 2 }, after: [{ b: 1, a: 2 }] },
      first: "f",
    };
    const b = {
      first: "f",
      outer: { after: [{ a: 2, b: 1 }], inner: { x: 2, y: 1 } },
    };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
  });

  it("canonicalizes a manifest-shaped object deterministically", () => {
    const m1 = {
      name: "Acme Orders",
      version: "1.4.2",
      baseUrl: "https://orders.acme.example",
      actions: [
        {
          name: "list_orders",
          title: "List Orders",
          description: "Returns all orders",
          method: "GET",
          endpoint: "/api/agentbridge/actions/list_orders",
          risk: "low",
          requiresConfirmation: false,
          inputSchema: { type: "object", properties: {} },
        },
      ],
    };
    const m2 = {
      // Same logical document, different key order.
      version: "1.4.2",
      actions: [
        {
          requiresConfirmation: false,
          name: "list_orders",
          inputSchema: { properties: {}, type: "object" },
          method: "GET",
          risk: "low",
          endpoint: "/api/agentbridge/actions/list_orders",
          title: "List Orders",
          description: "Returns all orders",
        },
      ],
      baseUrl: "https://orders.acme.example",
      name: "Acme Orders",
    };
    expect(canonicalizeJson(m1)).toBe(canonicalizeJson(m2));
  });
});

describe("canonicalizeJson — RFC 8785 sample vectors", () => {
  // A handful of vectors derived from RFC 8785 Appendix B examples and
  // common JCS reference suites. They aren't exhaustive — full
  // cross-language vectors land in `spec/signing/test-vectors.json`
  // alongside the verifier in a later PR — but they pin the most
  // commonly tripped behaviors.

  it("simple key-sort vector", () => {
    expect(canonicalizeJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("array-of-object vector", () => {
    expect(
      canonicalizeJson([{ b: 1, a: 2 }, { d: 3, c: 4 }]),
    ).toBe('[{"a":2,"b":1},{"c":4,"d":3}]');
  });

  it("control-char escape vector", () => {
    // Backslash + quote + backspace + formfeed + newline + CR + tab +
    // BEL (U+0007, no short escape — must come out as \\u0007).
    const s = "\\\"\b\f\n\r\t\u0007";
    expect(canonicalizeJson({ s })).toBe(
      `{"s":"\\\\\\"\\b\\f\\n\\r\\t\\u0007"}`,
    );
  });

  it("number canonical form vector", () => {
    expect(
      canonicalizeJson({
        zero: 0,
        negZero: -0,
        big: 1e21,
        small: 0.0000001,
        whole: 100,
      }),
    ).toBe('{"big":1e+21,"negZero":0,"small":1e-7,"whole":100,"zero":0}');
  });
});

describe("canonicalizeManifestForSigning", () => {
  const baseManifest = {
    name: "Acme",
    version: "1.0.0",
    baseUrl: "https://acme.example",
  };

  it("strips the signature field before canonicalizing", () => {
    const signed = {
      ...baseManifest,
      signature: {
        alg: "EdDSA",
        kid: "k1",
        iss: "https://acme.example",
        signedAt: "2026-04-28T12:00:00Z",
        expiresAt: "2026-04-29T12:00:00Z",
        value: "AAAA",
      },
    };
    const unsigned = { ...baseManifest };
    expect(canonicalizeManifestForSigning(signed)).toBe(
      canonicalizeManifestForSigning(unsigned),
    );
  });

  it("does not mutate the input manifest", () => {
    const signed = {
      ...baseManifest,
      signature: { alg: "EdDSA" as const, kid: "k1" },
    };
    const before = JSON.stringify(signed);
    canonicalizeManifestForSigning(signed);
    expect(JSON.stringify(signed)).toBe(before);
  });

  it("produces identical output for two equivalent signed manifests differing only in key order", () => {
    const a = {
      name: "Acme",
      version: "1.0.0",
      baseUrl: "https://acme.example",
      signature: { alg: "EdDSA", kid: "k1" },
    };
    const b = {
      signature: { kid: "k1", alg: "EdDSA" },
      version: "1.0.0",
      baseUrl: "https://acme.example",
      name: "Acme",
    };
    expect(canonicalizeManifestForSigning(a)).toBe(
      canonicalizeManifestForSigning(b),
    );
  });

  it("rejects non-object inputs", () => {
    expect(() =>
      canonicalizeManifestForSigning(null as unknown as Record<string, unknown>),
    ).toThrow(/manifest object/);
    expect(() =>
      canonicalizeManifestForSigning([] as unknown as Record<string, unknown>),
    ).toThrow(/manifest object/);
  });
});
