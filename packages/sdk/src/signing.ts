/**
 * SDK signing helpers for AgentBridge manifests (v0.5.0 PR 2).
 *
 * Builds on the core canonicalization + signature schemas
 * ([packages/core/src/signing](../../core/src/signing)) shipped in
 * PR #35. This module is the publisher-side signer; the verifier
 * (and runtime enforcement in the MCP server / scanner / CLI) ships
 * in subsequent v0.5.0 PRs.
 *
 * Design references:
 *   - [docs/designs/signed-manifests.md](../../../docs/designs/signed-manifests.md)
 *     §6 (algorithms / key formats), §13.4 (SDK impact).
 *   - [docs/adr/0002-signed-manifests.md](../../../docs/adr/0002-signed-manifests.md).
 *
 * What this module does:
 *   - `signManifest(manifest, opts)` — return a NEW manifest with an
 *     attached `signature` block. Input is never mutated.
 *   - `createSignedManifest(config, opts)` — sugar:
 *     `createAgentBridgeManifest(config)` followed by `signManifest()`.
 *
 * What this module does NOT do (deferred to later v0.5.0 PRs):
 *   - No verifier. (Tests verify with Node `crypto.verify` directly.)
 *   - No remote key-set fetch.
 *   - No scanner / MCP server / CLI signature enforcement.
 *   - No runtime `--require-signature` mode.
 *
 * Crypto choices:
 *   - **EdDSA / Ed25519** (default) — `crypto.sign(null, data, key)`
 *     produces a 64-byte raw signature, no nonce, deterministic.
 *   - **ES256 / ECDSA P-256** — `crypto.sign("sha256", data,
 *     { key, dsaEncoding: "ieee-p1363" })` produces a 64-byte raw
 *     `r||s` signature (matching JWS ES256, NOT DER-encoded).
 *   - Both signature blobs are base64url-encoded into
 *     `signature.value`.
 *
 * Private key handling:
 *   - Accepts `KeyObject` directly.
 *   - Accepts a PEM string (passed to `crypto.createPrivateKey`).
 *   - Accepts a `Buffer` containing PEM bytes (auto-detected by Node).
 *   - Raw 32-byte Ed25519 seeds are NOT supported in this PR — the
 *     PKCS#8 conversion path is non-trivial and would expand surface
 *     area. Adopters can wrap a seed with their own PKCS#8 / JWK
 *     adapter and pass the resulting `KeyObject`.
 *   - Private key material is **never** logged and **never** echoed
 *     in thrown error messages.
 */

import {
  createPrivateKey,
  sign as cryptoSign,
  KeyObject,
  type KeyObject as KeyObjectType,
} from "node:crypto";
import {
  type AgentBridgeManifest,
  ManifestSignatureSchema,
  canonicalizeManifestForSigning,
  type ManifestSignature,
} from "@marmarlabs/agentbridge-core";
import {
  createAgentBridgeManifest,
  type CreateAgentBridgeManifestConfig,
} from "./manifest";

/** Algorithm identifiers accepted by `signManifest`. Mirrors v0.5.0 design §6. */
export type SignManifestAlgorithm = "EdDSA" | "ES256";

export interface SignManifestOptions {
  /** Defaults to `"EdDSA"` (Ed25519). `"ES256"` requires a P-256 key. */
  alg?: SignManifestAlgorithm;
  /** Stable key identifier matching an entry in the publisher's key set. */
  kid: string;
  /**
   * Canonical publisher origin (`scheme://host[:port]`). Defaults to
   * `new URL(manifest.baseUrl).origin`. Throws if neither is a valid
   * canonical origin.
   */
  issuer?: string;
  /**
   * Private key. Accepts:
   *   - a Node `KeyObject` (recommended for production — created from
   *     a KMS / HSM-bound source out of band),
   *   - a PEM-encoded string,
   *   - a `Buffer` containing PEM bytes.
   *
   * Raw 32-byte Ed25519 seeds are not supported in this PR.
   */
  privateKey: KeyObject | string | Buffer;
  /**
   * Defaults to "now". Accepts a `Date` or an ISO 8601 string.
   * Stored as UTC ISO 8601 in `signature.signedAt`.
   */
  signedAt?: string | Date;
  /**
   * Explicit expiry. Takes precedence over `expiresInSeconds`. If
   * neither is given, defaults to `signedAt + 24h`.
   */
  expiresAt?: string | Date;
  /**
   * Convenience for `expiresAt = signedAt + N seconds`. Ignored when
   * `expiresAt` is also set. Must be a positive finite number.
   */
  expiresInSeconds?: number;
}

/**
 * Sign an existing manifest. Returns a new manifest object with a
 * `signature` block; the input manifest is **not** mutated. Any
 * pre-existing `signature` field is stripped before canonicalization
 * (re-signing produces a fresh, freshly-canonical signature).
 */
export function signManifest(
  manifest: AgentBridgeManifest,
  options: SignManifestOptions,
): AgentBridgeManifest {
  const alg: SignManifestAlgorithm = options.alg ?? "EdDSA";
  if (alg !== "EdDSA" && alg !== "ES256") {
    // Defensive — TypeScript should already prevent this, but guard at
    // runtime so a JS caller can't slip an unsupported alg through.
    throw new Error(
      `signManifest: unsupported algorithm "${String(alg)}". Supported: EdDSA, ES256.`,
    );
  }

  if (!options.kid || typeof options.kid !== "string") {
    throw new Error("signManifest: options.kid is required and must be a non-empty string");
  }

  const issuer = resolveIssuer(manifest, options.issuer);
  const signedAt = resolveSignedAt(options.signedAt);
  const expiresAt = resolveExpiresAt(signedAt, options.expiresAt, options.expiresInSeconds);

  const privateKey = toPrivateKey(options.privateKey, alg);

  const canonical = canonicalizeManifestForSigning(
    manifest as unknown as Record<string, unknown>,
  );
  const dataBuf = Buffer.from(canonical, "utf8");

  const sigBuf =
    alg === "EdDSA"
      ? cryptoSign(null, dataBuf, privateKey)
      : cryptoSign("sha256", dataBuf, { key: privateKey, dsaEncoding: "ieee-p1363" });

  const value = sigBuf.toString("base64url");

  // Build the signature object and validate it through the core schema
  // before attaching. This catches any drift between this signer and
  // the schema authoritative in @marmarlabs/agentbridge-core.
  const signatureCandidate: ManifestSignature = {
    alg,
    kid: options.kid,
    iss: issuer,
    signedAt: signedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    value,
  };

  const validated = ManifestSignatureSchema.safeParse(signatureCandidate);
  if (!validated.success) {
    const errors = validated.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(
      `signManifest: produced an invalid signature block — ${errors}`,
    );
  }

  // Build a NEW manifest object that is fully isolated from `manifest`.
  // A shallow `{ ...rest, signature }` would still share nested
  // references — `actions`, `resources`, `auth`, etc. — so a caller
  // who mutates `manifest.actions[0]` after signing would silently
  // mutate the returned signed manifest, and the signature would no
  // longer match the published bytes. Round-tripping through JSON is
  // the right shape here: it produces exactly the form a publisher
  // would serve and drops the same `undefined` / function / symbol
  // values that `canonicalizeManifestForSigning` already discarded
  // upstream, so the returned manifest matches the bytes the
  // signature covers.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature: _stripped, ...rest } = manifest as AgentBridgeManifest & {
    signature?: unknown;
  };
  const isolated = JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
  return { ...isolated, signature: validated.data } as AgentBridgeManifest;
}

/**
 * Build a manifest from `config` and immediately sign it. Equivalent to
 * `signManifest(createAgentBridgeManifest(config), options)`.
 *
 * Useful when an adopter's build pipeline produces a fresh manifest
 * each release and wants the output to land already signed.
 */
export function createSignedManifest(
  config: CreateAgentBridgeManifestConfig,
  options: SignManifestOptions,
): AgentBridgeManifest {
  const manifest = createAgentBridgeManifest(config);
  return signManifest(manifest, options);
}

// ─── helpers ─────────────────────────────────────────────────────────

function resolveIssuer(
  manifest: AgentBridgeManifest,
  override: string | undefined,
): string {
  if (override !== undefined) {
    return ensureCanonicalOrigin(override, "options.issuer");
  }
  let derived: string;
  try {
    derived = new URL(manifest.baseUrl).origin;
  } catch {
    throw new Error(
      `signManifest: cannot derive issuer from manifest.baseUrl ` +
        `(${JSON.stringify(manifest.baseUrl)}). Pass options.issuer explicitly.`,
    );
  }
  return ensureCanonicalOrigin(derived, "manifest.baseUrl origin");
}

function ensureCanonicalOrigin(input: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(
      `signManifest: ${label} (${JSON.stringify(input)}) is not a valid URL`,
    );
  }
  if (parsed.origin !== input) {
    throw new Error(
      `signManifest: ${label} must be a canonical origin (got ${JSON.stringify(input)}, ` +
        `expected ${JSON.stringify(parsed.origin)})`,
    );
  }
  return input;
}

function resolveSignedAt(input: string | Date | undefined): Date {
  if (input === undefined) return new Date();
  return parseDate(input, "options.signedAt");
}

function resolveExpiresAt(
  signedAt: Date,
  expiresAt: string | Date | undefined,
  expiresInSeconds: number | undefined,
): Date {
  let result: Date;
  if (expiresAt !== undefined) {
    result = parseDate(expiresAt, "options.expiresAt");
  } else if (expiresInSeconds !== undefined) {
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new Error(
        "signManifest: options.expiresInSeconds must be a positive finite number",
      );
    }
    // Use millisecond precision so sub-second values (e.g. 0.5) produce
    // a 500ms offset rather than truncating to 0 and producing an
    // already-expired signature. `Math.round` keeps the boundary
    // predictable; the post-check below catches any rounding that
    // collapses to zero.
    const offsetMs = Math.round(expiresInSeconds * 1000);
    result = new Date(signedAt.getTime() + offsetMs);
  } else {
    // Default: 24h validity window.
    return new Date(signedAt.getTime() + 24 * 60 * 60 * 1000);
  }
  if (result.getTime() <= signedAt.getTime()) {
    throw new Error(
      "signManifest: expiresAt must be strictly after signedAt",
    );
  }
  return result;
}

function parseDate(input: string | Date, label: string): Date {
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`signManifest: ${label} is not a valid date`);
  }
  return d;
}

/**
 * Normalize the user's `privateKey` input into a Node `KeyObject` and
 * verify it matches the requested algorithm. Errors here deliberately
 * do **not** echo the input, so a misformatted PEM cannot leak its
 * partial bytes into a stack trace.
 */
function toPrivateKey(
  input: KeyObject | string | Buffer,
  alg: SignManifestAlgorithm,
): KeyObjectType {
  let key: KeyObject;
  if (input instanceof KeyObject) {
    key = input;
  } else if (typeof input === "string" || Buffer.isBuffer(input)) {
    try {
      key = createPrivateKey(input);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      throw new Error(
        `signManifest: could not parse private key${code ? ` (${code})` : ""}. ` +
          `Provide a Node KeyObject or a PEM-encoded private key.`,
      );
    }
  } else {
    throw new Error(
      "signManifest: options.privateKey must be a Node KeyObject, a PEM string, or a Buffer of PEM bytes",
    );
  }

  if (key.type !== "private") {
    throw new Error(
      `signManifest: expected a private KeyObject, got type "${key.type}"`,
    );
  }

  if (alg === "EdDSA") {
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error(
        `signManifest: alg=EdDSA requires an Ed25519 key (asymmetricKeyType="ed25519"), ` +
          `got "${String(key.asymmetricKeyType)}"`,
      );
    }
  } else {
    // ES256
    if (key.asymmetricKeyType !== "ec") {
      throw new Error(
        `signManifest: alg=ES256 requires an EC key (asymmetricKeyType="ec"), ` +
          `got "${String(key.asymmetricKeyType)}"`,
      );
    }
    const curve = key.asymmetricKeyDetails?.namedCurve;
    if (curve !== "prime256v1") {
      throw new Error(
        `signManifest: alg=ES256 requires a P-256 key (curve "prime256v1"), ` +
          `got "${String(curve)}"`,
      );
    }
  }

  return key;
}
