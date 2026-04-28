/**
 * Local AgentBridge manifest signature verification (v0.5.0 PR 3).
 *
 * Builds on the canonicalization + Zod schemas from PR #35. Returns a
 * structured `VerifyManifestSignatureResult` for every in-scope outcome
 * — happy path or failure — so callers (the future scanner check, the
 * MCP server enforcement, the CLI `--require-signature` flag) can branch
 * on a stable enum without try/catch gymnastics.
 *
 * Design references:
 *   - [docs/designs/signed-manifests.md](../../../../docs/designs/signed-manifests.md)
 *     §6 (algorithms / key formats), §11 (freshness, expiry, replay),
 *     §12 (verification behavior and failure modes).
 *   - [docs/adr/0002-signed-manifests.md](../../../../docs/adr/0002-signed-manifests.md).
 *
 * What this module verifies (locally, with no network):
 *   - The manifest has a `signature` block (else `missing-signature`).
 *   - The block matches `ManifestSignatureSchema` (else
 *     `malformed-signature`).
 *   - The supplied key set matches `AgentBridgeKeySetSchema` (else
 *     `malformed-key-set`).
 *   - `signature.iss` equals `keySet.issuer` (else `issuer-mismatch`).
 *     Optionally, `signature.iss` equals `options.expectedIssuer`.
 *   - `signature.kid` is in `keySet.keys[]` (else `unknown-kid`) and
 *     not in `keySet.revokedKids[]` (else `revoked-kid`).
 *   - The matching key entry's `alg` equals `signature.alg`, and the
 *     JWK's `kty`/`crv` match the algorithm (else `key-type-mismatch`).
 *   - Now is within `[signedAt − skew, expiresAt + skew]` (else
 *     `before-signed-at` or `expired`).
 *   - Canonicalization succeeds (else `canonicalization-failed`).
 *   - The signature bytes verify under the public key (else
 *     `signature-invalid`).
 *
 * What this module deliberately does NOT verify (deferred to later
 * v0.5.0 PRs):
 *   - **No remote key-set fetch.** Callers fetch the key set
 *     themselves and pass it in. The runtime PR (MCP server) adds
 *     `key-set-fetch-failed` on the failure boundary.
 *   - **No fetch-origin comparison.** Callers that know the origin
 *     they fetched the manifest from pass `expectedIssuer` to enforce
 *     `signature.iss === fetched origin`. The scanner / MCP PRs
 *     surface `origin-mismatch` as a separate failure name when the
 *     fetch origin is part of their context.
 *   - **No scanner check IDs / MCP enforcement / CLI
 *     `--require-signature`.** This module is the pure verifier; the
 *     enforcement layers wrap it.
 *
 * Errors are *never* thrown for normal verification outcomes. The
 * function returns `{ ok: false, reason, message }` for every covered
 * failure. Programmer errors (bad TypeScript usage) may still throw.
 *
 * Private key material is never read by this module — only public
 * keys via `crypto.createPublicKey({ key: jwk, format: "jwk" })`.
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import {
  ManifestSignatureSchema,
  AgentBridgeKeySetSchema,
  type ManifestSignature,
  type AgentBridgeKey,
  type AgentBridgeKeySet,
  type SignatureAlgorithm,
} from "./schemas";
import {
  canonicalizeManifestForSigning,
  CanonicalizationError,
} from "./canonical";

/**
 * In-scope failure reasons for v0.5.0 local verification. Stable
 * identifiers — once shipped, renaming any of them is a major bump
 * per [v1 readiness §13](../../../../docs/v1-readiness.md#13-compatibility-guarantees).
 *
 * The design defines additional reasons (`key-set-fetch-failed`,
 * `origin-mismatch`) that depend on context this module does not
 * have. Those names are reserved by the scanner / MCP / CLI layers.
 */
export type VerifyManifestSignatureFailure =
  | "missing-signature"
  | "malformed-signature"
  | "malformed-key-set"
  | "unsupported-algorithm"
  | "unknown-kid"
  | "revoked-kid"
  | "issuer-mismatch"
  | "before-signed-at"
  | "expired"
  | "canonicalization-failed"
  | "signature-invalid"
  | "key-type-mismatch";

export type VerifyManifestSignatureResult =
  | {
      ok: true;
      kid: string;
      iss: string;
      alg: SignatureAlgorithm;
      signedAt: string;
      expiresAt: string;
    }
  | {
      ok: false;
      reason: VerifyManifestSignatureFailure;
      message: string;
    };

export interface VerifyManifestSignatureOptions {
  /**
   * Override "now" for freshness checks. Useful for testing and for
   * replay-the-past tooling. Defaults to `new Date()`.
   */
  now?: Date | string;
  /**
   * Allowed clock skew (in seconds) when comparing `now` against
   * `signedAt` and `expiresAt`. Default 60 seconds. Bounded to
   * 0–600 seconds; out-of-range values are clamped to the nearest
   * bound.
   */
  clockSkewSeconds?: number;
  /**
   * Optional strict-equality check on `signature.iss`. When set, the
   * verifier asserts `signature.iss === expectedIssuer` (the runtime
   * caller's view of "where did this manifest come from?"). When
   * unset, only the `signature.iss === keySet.issuer` invariant is
   * enforced.
   */
  expectedIssuer?: string;
}

/**
 * Verify an AgentBridge manifest signature against a publisher key
 * set. Pure, local, no network. See module docstring for the failure
 * matrix and what is intentionally deferred.
 */
export function verifyManifestSignature(
  manifest: unknown,
  keySet: unknown,
  options: VerifyManifestSignatureOptions = {},
): VerifyManifestSignatureResult {
  // ── Manifest shape gate ──────────────────────────────────────────
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return failure(
      "malformed-signature",
      "manifest must be a non-null object with a `signature` field",
    );
  }
  const manifestObj = manifest as Record<string, unknown>;
  const rawSignature = manifestObj.signature;

  // ── missing-signature ────────────────────────────────────────────
  if (rawSignature === undefined) {
    return failure(
      "missing-signature",
      "manifest does not carry a `signature` field",
    );
  }

  // ── malformed-signature ──────────────────────────────────────────
  const sigParse = ManifestSignatureSchema.safeParse(rawSignature);
  if (!sigParse.success) {
    return failure(
      "malformed-signature",
      `signature block failed schema validation: ${formatZodIssues(sigParse.error.issues)}`,
    );
  }
  const signature: ManifestSignature = sigParse.data;

  // ── malformed-key-set ────────────────────────────────────────────
  const ksParse = AgentBridgeKeySetSchema.safeParse(keySet);
  if (!ksParse.success) {
    return failure(
      "malformed-key-set",
      `key set failed schema validation: ${formatZodIssues(ksParse.error.issues)}`,
    );
  }
  const keys: AgentBridgeKeySet = ksParse.data;

  // ── unsupported-algorithm ────────────────────────────────────────
  // SignatureAlgorithm enum is { "EdDSA", "ES256" }. Anything outside
  // that is rejected by ManifestSignatureSchema upstream, so reaching
  // this branch implies the schema accepted an alg the verifier
  // doesn't support — kept as a defensive guard against future schema
  // additions that outpace verifier coverage.
  if (signature.alg !== "EdDSA" && signature.alg !== "ES256") {
    return failure(
      "unsupported-algorithm",
      `signature.alg "${String(signature.alg)}" is not supported by this verifier`,
    );
  }

  // ── revoked-kid ──────────────────────────────────────────────────
  // Check revocation BEFORE the active-set lookup. A `kid` listed in
  // `revokedKids` must fail closed even if it also appears (e.g.
  // accidentally) in `keys[]` — revocation always wins.
  if (keys.revokedKids.includes(signature.kid)) {
    return failure(
      "revoked-kid",
      `signature kid "${signature.kid}" is listed in keySet.revokedKids`,
    );
  }

  // ── unknown-kid ──────────────────────────────────────────────────
  const keyEntry = keys.keys.find((k) => k.kid === signature.kid);
  if (!keyEntry) {
    return failure(
      "unknown-kid",
      `signature kid "${signature.kid}" was not found in keySet.keys[]`,
    );
  }

  // ── issuer-mismatch ──────────────────────────────────────────────
  if (signature.iss !== keys.issuer) {
    return failure(
      "issuer-mismatch",
      `signature.iss (${signature.iss}) does not equal keySet.issuer (${keys.issuer})`,
    );
  }
  if (
    options.expectedIssuer !== undefined &&
    signature.iss !== options.expectedIssuer
  ) {
    return failure(
      "issuer-mismatch",
      `signature.iss (${signature.iss}) does not equal expectedIssuer (${options.expectedIssuer})`,
    );
  }

  // ── key-type-mismatch ────────────────────────────────────────────
  // Three internal-consistency checks combined under one reason:
  //   1. The key entry's declared alg must equal signature.alg.
  //   2. The JWK's kty/crv must match signature.alg.
  // The first catches a publisher who lists the wrong alg next to a
  // correct JWK; the second catches a malformed JWK paired with a
  // matching alg label.
  if (keyEntry.alg !== signature.alg) {
    return failure(
      "key-type-mismatch",
      `key entry alg "${keyEntry.alg}" does not match signature.alg "${signature.alg}"`,
    );
  }
  const jwkMismatch = jwkMatchesAlg(keyEntry, signature.alg);
  if (jwkMismatch !== undefined) {
    return failure("key-type-mismatch", jwkMismatch);
  }

  // ── before-signed-at / expired ───────────────────────────────────
  const skewSeconds = clampSkew(options.clockSkewSeconds);
  const now = resolveNow(options.now);
  const signedAtMs = Date.parse(signature.signedAt);
  const expiresAtMs = Date.parse(signature.expiresAt);
  const skewMs = skewSeconds * 1000;
  if (now.getTime() < signedAtMs - skewMs) {
    return failure(
      "before-signed-at",
      `current time is before signedAt (${signature.signedAt}) outside the ${skewSeconds}s skew window — clock skew likely`,
    );
  }
  if (now.getTime() > expiresAtMs + skewMs) {
    return failure(
      "expired",
      `current time is after expiresAt (${signature.expiresAt}) outside the ${skewSeconds}s skew window — ask the publisher to re-sign`,
    );
  }

  // ── canonicalization-failed ──────────────────────────────────────
  let canonical: string;
  try {
    canonical = canonicalizeManifestForSigning(manifestObj);
  } catch (err) {
    if (err instanceof CanonicalizationError) {
      return failure("canonicalization-failed", err.message);
    }
    return failure(
      "canonicalization-failed",
      `unexpected canonicalization error: ${(err as Error).message}`,
    );
  }

  // ── signature-invalid ────────────────────────────────────────────
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({ key: keyEntry.publicKey, format: "jwk" });
  } catch (err) {
    // A malformed JWK should already have been caught by
    // AgentBridgeKeySetSchema, so reaching here means a key that
    // schema-validated but Node refused to import. Treat it as a
    // key-type-mismatch — the bytes the publisher published cannot be
    // turned into a usable verification key.
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return failure(
      "key-type-mismatch",
      `could not construct public key from JWK${code ? ` (${code})` : ""}`,
    );
  }

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signature.value, "base64url");
  } catch {
    // ManifestSignatureSchema's regex prevents this in practice, but
    // keep the catch so a future schema relaxation cannot crash the
    // verifier.
    return failure(
      "malformed-signature",
      "signature.value is not a valid base64url string",
    );
  }

  let verified: boolean;
  try {
    verified =
      signature.alg === "EdDSA"
        ? cryptoVerify(null, Buffer.from(canonical, "utf8"), publicKey, signatureBytes)
        : cryptoVerify(
            "sha256",
            Buffer.from(canonical, "utf8"),
            { key: publicKey, dsaEncoding: "ieee-p1363" },
            signatureBytes,
          );
  } catch (err) {
    // Node throws on, e.g., signature length mismatch for ES256
    // (raw form expects exactly 64 bytes). Surface that as
    // signature-invalid — the bytes don't constitute a valid
    // signature for this key/algorithm.
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return failure(
      "signature-invalid",
      `signature could not be verified${code ? ` (${code})` : ""}`,
    );
  }

  if (!verified) {
    return failure(
      "signature-invalid",
      "signature did not verify against the supplied public key",
    );
  }

  // ── ok ───────────────────────────────────────────────────────────
  return {
    ok: true,
    kid: signature.kid,
    iss: signature.iss,
    alg: signature.alg,
    signedAt: signature.signedAt,
    expiresAt: signature.expiresAt,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────

function failure(
  reason: VerifyManifestSignatureFailure,
  message: string,
): VerifyManifestSignatureResult {
  return { ok: false, reason, message };
}

function formatZodIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
): string {
  return issues
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "<root>"}: ${i.message}`)
    .join("; ");
}

function clampSkew(input: number | undefined): number {
  if (input === undefined) return 60;
  if (!Number.isFinite(input) || input < 0) return 0;
  if (input > 600) return 600;
  return Math.floor(input);
}

function resolveNow(input: Date | string | undefined): Date {
  if (input === undefined) return new Date();
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  // Programmer error if `now` is unparseable — throw so the bug surfaces
  // up the call stack instead of silently coercing to "now".
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `verifyManifestSignature: options.now is not a valid date`,
    );
  }
  return d;
}

/**
 * Confirm the JWK shape matches the requested algorithm. Returns
 * `undefined` on a match, or a human-readable mismatch message that
 * will be wrapped in `{ ok: false, reason: "key-type-mismatch", … }`.
 */
function jwkMatchesAlg(
  keyEntry: AgentBridgeKey,
  alg: SignatureAlgorithm,
): string | undefined {
  const jwk = keyEntry.publicKey;
  if (alg === "EdDSA") {
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519") {
      return `alg=EdDSA requires an Ed25519 JWK (kty=OKP, crv=Ed25519); got kty="${jwk.kty}"`;
    }
  } else {
    // alg === "ES256"
    if (jwk.kty !== "EC" || jwk.crv !== "P-256") {
      return `alg=ES256 requires a P-256 JWK (kty=EC, crv=P-256); got kty="${jwk.kty}"`;
    }
  }
  return undefined;
}
