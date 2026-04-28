/**
 * Zod schemas for the v0.5.0 signed-manifest surface.
 *
 * What this module owns:
 *   - `ManifestSignatureSchema` — the optional `signature` block on a
 *     manifest. Added to `AgentBridgeManifestSchema` as
 *     `signature: ManifestSignatureSchema.optional()`. Unsigned
 *     manifests continue to validate exactly as in v0.4.x.
 *   - `PublicKeyJwkSchema` — the JWK shape for the publisher's
 *     **public** key. The JWK schemas are `.strict()` so private-key
 *     fields (`d`) are rejected, not silently stripped.
 *   - `AgentBridgeKeySchema` / `AgentBridgeKeySetSchema` — the shape
 *     of `/.well-known/agentbridge-keys.json`.
 *   - `validateKeySet(input)` — discriminated-union validator
 *     mirroring `validateManifest` from
 *     [`packages/core/src/manifest.ts`](../manifest.ts).
 *
 * What this module does NOT do (and won't until subsequent v0.5.0 PRs):
 *   - No `signManifest()` / `verifyManifestSignature()` — those land
 *     in the SDK with a Node `crypto` dependency.
 *   - No remote key-set fetch.
 *   - No scanner / MCP server / CLI signature enforcement.
 *
 * Design references:
 *   - [docs/designs/signed-manifests.md](../../../../docs/designs/signed-manifests.md)
 *     §6 (algorithms / key formats), §13.1 (manifest schema),
 *     §13.3 (key-set schema).
 *   - [docs/adr/0002-signed-manifests.md](../../../../docs/adr/0002-signed-manifests.md).
 */

import { z } from "zod";

/**
 * Permitted signature algorithms for v0.5.0.
 *
 * - `EdDSA` — Ed25519 per RFC 8037. Default. Built into Node `crypto`.
 * - `ES256` — ECDSA on P-256 with SHA-256 per RFC 7518. For HSM/KMS-
 *   bound publishers that don't expose Ed25519.
 *
 * Per the design, RSA-family algorithms (`RS256`, `PS256`, …) are
 * intentionally excluded — they are larger and slower with no
 * advantage for this use case. Adding one in a later release is a
 * non-breaking enum extension.
 */
export const SignatureAlgorithm = z.enum(["EdDSA", "ES256"]);
export type SignatureAlgorithm = z.infer<typeof SignatureAlgorithm>;

/**
 * Base64url alphabet per RFC 4648 §5 with optional 0–2 `=` padding.
 * The signed-manifest design uses unpadded base64url for the signature
 * value (matching JWS §3.1), but accepting padding here is harmless
 * and lets non-JS publishers that emit padded output interoperate.
 */
const Base64UrlRegex = /^[A-Za-z0-9_-]+={0,2}$/;
const Base64UrlString = (label: string) =>
  z
    .string()
    .min(1, `${label} must not be empty`)
    .regex(Base64UrlRegex, `${label} must be base64url-encoded (RFC 4648 §5)`);

/**
 * RFC 8601 datetime (`Z` or numeric offset). The design recommends UTC
 * (`Z`) but offsets are accepted to interoperate with publishers whose
 * tooling emits them.
 */
const IsoDateTime = z
  .string()
  .datetime({ offset: true, message: "must be an ISO 8601 datetime" });

/**
 * `iss` is the canonical publisher origin (`scheme://host[:port]`).
 *
 * The verifier (later PR) will check `iss === manifest.baseUrl` origin
 * **and** `iss === fetched URL's origin`. To make those checks
 * deterministic, we require the value here to already be in canonical
 * form: `new URL(iss).origin === iss`. That rejects trailing slashes,
 * paths, queries, and fragments, plus normalizes default-port quirks
 * (`https://x:443` becomes `https://x`).
 */
const CanonicalOrigin = z
  .string()
  .url("must be a valid URL")
  .refine(
    (s) => {
      try {
        return new URL(s).origin === s;
      } catch {
        return false;
      }
    },
    {
      message:
        "must be a canonical origin (scheme://host[:port], no path, query, fragment, or trailing slash)",
    },
  );

/**
 * Inline `signature` block on a manifest. The signed payload is the
 * manifest with this field stripped, run through `canonicalizeJson`.
 *
 * Note: this schema is the **default Zod object** (unknown keys
 * stripped, not rejected), so a future minor release that adds a new
 * field to the signature does not break v0.5.0 readers. We rely on the
 * verifier — not the schema — to react to suspicious extra fields.
 */
export const ManifestSignatureSchema = z.object({
  alg: SignatureAlgorithm,
  kid: z.string().min(1, "kid must not be empty"),
  iss: CanonicalOrigin,
  signedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  value: Base64UrlString("signature value"),
});
export type ManifestSignature = z.infer<typeof ManifestSignatureSchema>;

/**
 * JWK for an Ed25519 public key (RFC 8037).
 * `.strict()` — any extra field, including the private scalar `d`, is
 * an explicit validation error.
 */
const OkpEd25519PublicKeyJwkSchema = z
  .object({
    kty: z.literal("OKP"),
    crv: z.literal("Ed25519"),
    x: Base64UrlString("public key x"),
  })
  .strict();

/**
 * JWK for an ECDSA P-256 public key (RFC 7518 §6.2).
 * `.strict()` — any extra field, including the private scalar `d`, is
 * an explicit validation error.
 */
const EcP256PublicKeyJwkSchema = z
  .object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: Base64UrlString("public key x"),
    y: Base64UrlString("public key y"),
  })
  .strict();

/**
 * JWK for a manifest-signing public key. Discriminated by `kty` so a
 * malformed JWK fails with a useful error.
 */
export const PublicKeyJwkSchema = z.discriminatedUnion("kty", [
  OkpEd25519PublicKeyJwkSchema,
  EcP256PublicKeyJwkSchema,
]);
export type PublicKeyJwk = z.infer<typeof PublicKeyJwkSchema>;

/**
 * One entry in the publisher's key set.
 *
 * `notBefore` / `notAfter` are advisory verification windows. The
 * authoritative freshness signal is the manifest's `signedAt` /
 * `expiresAt`.
 */
export const AgentBridgeKeySchema = z.object({
  kid: z.string().min(1, "kid must not be empty"),
  alg: SignatureAlgorithm,
  use: z.literal("manifest-sign"),
  publicKey: PublicKeyJwkSchema,
  notBefore: IsoDateTime.optional(),
  notAfter: IsoDateTime.optional(),
});
export type AgentBridgeKey = z.infer<typeof AgentBridgeKeySchema>;

/**
 * Shape of `/.well-known/agentbridge-keys.json`.
 *
 * - `issuer` — canonical publisher origin. Must equal the manifest's
 *   `signature.iss` (verifier-enforced in a later PR).
 * - `version` — currently `"1"`. Reserved for backward-compatibility
 *   shifts in the key-set format itself.
 * - `keys[]` — active keys. A `kid` not in `keys[]` is treated as
 *   unknown by the verifier.
 * - `revokedKids[]` — explicit revocation list. A `kid` listed here
 *   fails verification *even if* the verifier has it cached.
 */
export const AgentBridgeKeySetSchema = z.object({
  issuer: CanonicalOrigin,
  version: z.literal("1"),
  keys: z.array(AgentBridgeKeySchema).min(1, "keys must contain at least one entry"),
  revokedKids: z.array(z.string().min(1, "kid must not be empty")).default([]),
});
export type AgentBridgeKeySet = z.infer<typeof AgentBridgeKeySetSchema>;

/**
 * Discriminated-union validator for a key set. Mirrors the shape of
 * [`validateManifest`](../manifest.ts) from this package so callers can
 * use the same `if (result.ok)` branch pattern.
 */
export type ValidateKeySetResult =
  | { ok: true; keySet: AgentBridgeKeySet }
  | { ok: false; errors: string[] };

export function validateKeySet(input: unknown): ValidateKeySetResult {
  const parsed = AgentBridgeKeySetSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, keySet: parsed.data };
  }
  const errors = parsed.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
  return { ok: false, errors };
}
