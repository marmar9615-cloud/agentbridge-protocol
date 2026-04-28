/**
 * RFC 8785 (JSON Canonicalization Scheme, "JCS") canonicalizer.
 *
 * Produces a deterministic, byte-identical UTF-8 string for any
 * JSON-representable JS value. The output is what the signed-manifest
 * design ([docs/designs/signed-manifests.md](../../../../docs/designs/signed-manifests.md))
 * runs through `crypto.sign` for `signManifest()` and through
 * `crypto.verify` on the verifier path.
 *
 * Why JCS:
 *   - Standardized (RFC 8785). Multiple language implementations
 *     exist, so non-JS publishers can build a compatible signer.
 *   - Deterministic. Same logical document → same bytes, on every
 *     platform, every Node version.
 *
 * What this implementation does:
 *   - Object keys sorted lexicographically by UTF-16 code units
 *     (matches `Array.prototype.sort` default compare in V8).
 *   - Arrays preserve order.
 *   - Strings serialized via `JSON.stringify`, which matches RFC 8259
 *     minimal-escaping (and therefore RFC 8785 §3.2.2.2).
 *   - Numbers serialized via the JS Number-to-String algorithm
 *     (ECMA-262 7.1.12.1), which is exactly the JCS spec
 *     (RFC 8785 §3.2.2.3). `-0` is normalized to `"0"` per JCS.
 *   - `null`, `true`, `false` map to the obvious literals.
 *
 * What this implementation rejects (throws):
 *   - `undefined`, `function`, `symbol`, `bigint` values.
 *   - `NaN`, `Infinity`, `-Infinity` (no JSON representation).
 *   - Non-plain objects (`Date`, `Map`, `Set`, class instances). Pre-
 *     serialize them to plain JSON values before calling. This keeps
 *     behavior predictable across runtimes — JCS is a JSON
 *     canonicalizer, not a JS-value canonicalizer.
 *
 * No external dependencies. Pure JS, ~150 lines, easy to audit.
 */

export class CanonicalizationError extends Error {
  /** JSON-Pointer-ish path to the offending value (e.g. `/foo/0/bar`). */
  readonly path: string;
  constructor(message: string, path: string) {
    super(`canonicalizeJson: ${message}${path ? ` at ${path}` : ""}`);
    this.name = "CanonicalizationError";
    this.path = path;
  }
}

/**
 * Canonicalize `value` to RFC 8785 (JCS) JSON.
 * Returns the canonical bytes as a UTF-8 string.
 */
export function canonicalizeJson(value: unknown): string {
  return canon(value, "");
}

function canon(value: unknown, path: string): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";

  switch (typeof value) {
    case "string":
      return canonString(value);
    case "number":
      return canonNumber(value, path);
    case "bigint":
      throw new CanonicalizationError(
        "BigInt is not representable in canonical JSON",
        path,
      );
    case "function":
    case "symbol":
      throw new CanonicalizationError(
        `${typeof value} is not representable in canonical JSON`,
        path,
      );
    case "undefined":
      throw new CanonicalizationError(
        "undefined is not representable in canonical JSON",
        path,
      );
    case "object": {
      // null already handled above; here `value` is a non-null object.
      if (Array.isArray(value)) return canonArray(value as unknown[], path);
      if (!isPlainObject(value)) {
        const ctorName =
          (value as { constructor?: { name?: string } }).constructor?.name ??
          "object";
        throw new CanonicalizationError(
          `only plain JSON objects are supported (got ${ctorName})`,
          path,
        );
      }
      return canonObject(value as Record<string, unknown>, path);
    }
    default:
      // Defensive: typeof returns one of the cases above on every modern engine.
      throw new CanonicalizationError(`unsupported type ${typeof value}`, path);
  }
}

/**
 * Per RFC 8785 §3.2.2.2 strings use RFC 8259 minimal escaping.
 * `JSON.stringify(s)` is exactly that: it escapes only `\"`, `\\`,
 * `\b`, `\f`, `\n`, `\r`, `\t`, and U+0000–U+001F as `\uXXXX`. It
 * leaves other Unicode code points as-is (UTF-8 in the resulting
 * UTF-8 string).
 */
function canonString(s: string): string {
  return JSON.stringify(s);
}

/**
 * Per RFC 8785 §3.2.2.3 numbers use the ECMA-262 Number-to-String
 * algorithm. JS `String(n)` (and the default `Number.prototype.toString`)
 * implements that exact algorithm in every conforming engine, so we
 * defer to it.
 *
 * Edge cases:
 *   - `-0` → `"0"` (JCS §3.2.2.3 rule for negative zero).
 *   - `NaN` / `Infinity` / `-Infinity` → throw (no JSON representation).
 */
function canonNumber(n: number, path: string): string {
  if (!Number.isFinite(n)) {
    throw new CanonicalizationError(
      `non-finite number (${String(n)}) is not representable in canonical JSON`,
      path,
    );
  }
  if (Object.is(n, -0)) return "0";
  return String(n);
}

function canonArray(arr: unknown[], path: string): string {
  const parts: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    parts.push(canon(arr[i], `${path}/${i}`));
  }
  return `[${parts.join(",")}]`;
}

function canonObject(obj: Record<string, unknown>, path: string): string {
  // Object.keys returns own enumerable string-keyed properties in
  // insertion order. We sort those keys lexicographically — JS string
  // sort uses UTF-16 code unit order by default, which matches
  // RFC 8785 §3.2.3 ("binary code points of the UTF-16 representation").
  // Symbol-keyed properties are intentionally ignored (mirrors JSON.stringify).
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) {
      // JCS rejects undefined values inside an object — they have no JSON
      // representation. JSON.stringify would silently drop them; we throw to
      // preserve the canonicalization invariant (every input either produces
      // bytes or surfaces an error).
      throw new CanonicalizationError(
        "undefined property values are not representable in canonical JSON",
        `${path}/${jsonPointerEscape(k)}`,
      );
    }
    parts.push(`${canonString(k)}:${canon(v, `${path}/${jsonPointerEscape(k)}`)}`);
  }
  return `{${parts.join(",")}}`;
}

/** True for `{}`, `Object.create(null)` — false for `Date`, `Map`, class instances. */
function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function jsonPointerEscape(token: string): string {
  // Per RFC 6901: ~ → ~0, / → ~1.
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * The signed payload is the manifest **with the `signature` field
 * stripped**. This helper produces the canonical bytes the signer
 * (and verifier) operate on.
 *
 * It does not mutate the input. `signature` is dropped via shallow
 * copy because the field always lives at the top level (per the
 * v0.5.0 design).
 */
export function canonicalizeManifestForSigning(
  manifest: Record<string, unknown>,
): string {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new CanonicalizationError(
      "expected a manifest object",
      "",
    );
  }
  // Shallow copy, drop signature. We don't deep-clone — `canon` doesn't
  // mutate input, and the canonicalization process re-walks the tree.
  const copy: Record<string, unknown> = {};
  for (const k of Object.keys(manifest)) {
    if (k === "signature") continue;
    copy[k] = manifest[k];
  }
  return canonicalizeJson(copy);
}
