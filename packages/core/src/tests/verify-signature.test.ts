/**
 * Verifier tests. Generates ephemeral keypairs at runtime; never
 * commits real private keys. Cross-checks against the deterministic
 * test vectors at `spec/signing/test-vectors.json`.
 *
 * Core does NOT depend on @marmarlabs/agentbridge-sdk; these tests
 * sign manifests using Node `crypto` directly so the verifier can
 * stand alone without a circular import.
 */
import { describe, it, expect } from "vitest";
import {
  generateKeyPairSync,
  createPublicKey,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  verifyManifestSignature,
  canonicalizeManifestForSigning,
  type AgentBridgeKeySet,
  type SignatureAlgorithm,
} from "../signing";
import { validateManifest } from "../manifest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const vectorsPath = path.join(repoRoot, "spec", "signing", "test-vectors.json");

// ─── Test fixtures ───────────────────────────────────────────────────

const ISSUER = "https://orders.acme.example";
const SIGNED_AT = "2026-04-28T12:00:00.000Z";
const EXPIRES_AT = "2026-04-29T12:00:00.000Z";
const NOW_INSIDE_WINDOW = "2026-04-28T18:00:00.000Z";

const baseManifest = {
  name: "Acme Orders",
  version: "1.4.2",
  baseUrl: ISSUER,
  resources: [],
  actions: [
    {
      name: "list_orders",
      title: "List Orders",
      description: "Returns all orders.",
      method: "GET",
      endpoint: "/api/agentbridge/actions/list_orders",
      risk: "low",
      requiresConfirmation: false,
      inputSchema: { type: "object", properties: {} },
      permissions: [],
      examples: [],
    },
  ],
};

interface TestVectors {
  vectors: Array<{
    name: string;
    alg?: SignatureAlgorithm;
    manifest?: Record<string, unknown>;
    keySet?: AgentBridgeKeySet;
    expectedVerifyResult: { ok: boolean; reason?: string };
    derivedFrom?: string;
  }>;
}

function loadVectors(): TestVectors {
  return JSON.parse(readFileSync(vectorsPath, "utf8")) as TestVectors;
}

function sign(
  alg: SignatureAlgorithm,
  privateKey: KeyObject,
  manifest: Record<string, unknown>,
): string {
  const canonical = canonicalizeManifestForSigning(manifest);
  const buf =
    alg === "EdDSA"
      ? cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey)
      : cryptoSign(
          "sha256",
          Buffer.from(canonical, "utf8"),
          { key: privateKey, dsaEncoding: "ieee-p1363" },
        );
  return buf.toString("base64url");
}

function buildSignedManifest(
  alg: SignatureAlgorithm,
  privateKey: KeyObject,
  publicKey: KeyObject,
  kid: string,
  overrides: { signedAt?: string; expiresAt?: string; iss?: string } = {},
): { manifest: Record<string, unknown>; keySet: AgentBridgeKeySet } {
  const signedAt = overrides.signedAt ?? SIGNED_AT;
  const expiresAt = overrides.expiresAt ?? EXPIRES_AT;
  const iss = overrides.iss ?? ISSUER;

  // Deep-clone the manifest so tests can mutate the result without
  // contaminating other tests that share `baseManifest`. A spread
  // would only shallow-copy, leaving `actions` and other arrays
  // shared by reference.
  const manifest = JSON.parse(JSON.stringify(baseManifest)) as Record<string, unknown>;
  // We sign first, then attach the signature block. The signed bytes
  // are over canonicalize(manifest minus signature), which is what
  // canonicalizeManifestForSigning produces.
  const value = sign(alg, privateKey, manifest);
  manifest.signature = { alg, kid, iss, signedAt, expiresAt, value };

  const keySet: AgentBridgeKeySet = {
    issuer: ISSUER,
    version: "1",
    keys: [
      {
        kid,
        alg,
        use: "manifest-sign",
        publicKey: publicKey.export({ format: "jwk" }) as never,
      },
    ],
    revokedKids: [],
  };
  return { manifest, keySet };
}

// ─── Happy paths ────────────────────────────────────────────────────

describe("verifyManifestSignature — valid signatures", () => {
  it("verifies an Ed25519 signed manifest", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest(
      "EdDSA",
      privateKey,
      publicKey,
      "k1",
    );
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.alg).toBe("EdDSA");
      expect(r.kid).toBe("k1");
      expect(r.iss).toBe(ISSUER);
      expect(r.signedAt).toBe(SIGNED_AT);
      expect(r.expiresAt).toBe(EXPIRES_AT);
    }
  });

  it("verifies an ES256 signed manifest", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const { manifest, keySet } = buildSignedManifest(
      "ES256",
      privateKey,
      publicKey,
      "k1",
    );
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.alg).toBe("ES256");
  });
});

// ─── Failure: signature presence + shape ────────────────────────────

describe("verifyManifestSignature — signature presence & shape", () => {
  it("returns missing-signature when the manifest carries no signature", () => {
    const r = verifyManifestSignature(baseManifest, fakeKeySet());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-signature");
  });

  it("returns malformed-signature for a non-object manifest", () => {
    const r = verifyManifestSignature(null, fakeKeySet());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-signature");
  });

  it("returns malformed-signature when the signature block fails schema validation", () => {
    const bad = {
      ...baseManifest,
      signature: { alg: "EdDSA", kid: "k1" }, // missing iss/signedAt/expiresAt/value
    };
    const r = verifyManifestSignature(bad, fakeKeySet());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-signature");
  });

  it("returns malformed-signature when signature.expiresAt is not strictly after signedAt", () => {
    // Inverted window — without an explicit guard this can pass the
    // freshness check (e.g. expiresAt 30s before signedAt with 60s
    // skew satisfies both inequalities). Reject up front.
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    (manifest.signature as { expiresAt: string }).expiresAt = "2026-04-28T11:59:30.000Z"; // 30s before signedAt
    const r = verifyManifestSignature(manifest, keySet, {
      now: NOW_INSIDE_WINDOW,
      clockSkewSeconds: 60,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-signature");
  });

  it("returns malformed-signature when signature.expiresAt equals signedAt", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    (manifest.signature as { expiresAt: string }).expiresAt = SIGNED_AT;
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-signature");
  });

  it("returns malformed-signature when signature.value is not base64url", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    (manifest.signature as { value: string }).value = "abc def!!"; // illegal chars
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-signature");
  });
});

// ─── Failure: key set ───────────────────────────────────────────────

describe("verifyManifestSignature — key set validation", () => {
  it("returns malformed-key-set when the keySet fails schema validation", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    const r = verifyManifestSignature(manifest, { wrong: "shape" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-key-set");
  });

  it("returns malformed-key-set when keys[] is empty", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    const empty = { issuer: ISSUER, version: "1", keys: [], revokedKids: [] };
    const r = verifyManifestSignature(manifest, empty);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-key-set");
  });

  it("returns unknown-kid when the signature kid is absent from keys[]", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k-active");
    (manifest.signature as { kid: string }).kid = "k-mystery";
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-kid");
  });

  it("returns revoked-kid when the kid is listed in revokedKids", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    keySet.revokedKids = ["k1"];
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("revoked-kid");
  });

  it("revoked-kid wins even when the kid is also in keys[]", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    keySet.revokedKids = ["k1"];
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("revoked-kid");
  });
});

// ─── Failure: issuer ────────────────────────────────────────────────

describe("verifyManifestSignature — issuer enforcement", () => {
  it("returns issuer-mismatch when signature.iss != keySet.issuer", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    (manifest.signature as { iss: string }).iss = "https://attacker.example";
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("issuer-mismatch");
  });

  it("returns issuer-mismatch when expectedIssuer is supplied and differs", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    const r = verifyManifestSignature(manifest, keySet, {
      now: NOW_INSIDE_WINDOW,
      expectedIssuer: "https://different.example",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("issuer-mismatch");
  });

  it("returns issuer-mismatch when signature.iss differs from manifest.baseUrl origin", () => {
    // Bind signature.iss to manifest.baseUrl. A signature whose
    // issuer points elsewhere — even when paired with a key set
    // whose own `issuer` matches the signature — does not authorize
    // actions on the manifest's declared origin.
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const attackerOrigin = "https://attacker.example";
    const attackerKeySet: AgentBridgeKeySet = {
      issuer: attackerOrigin,
      version: "1",
      keys: [
        {
          kid: "k1",
          alg: "EdDSA",
          use: "manifest-sign",
          publicKey: publicKey.export({ format: "jwk" }) as never,
        },
      ],
      revokedKids: [],
    };
    // Sign a fresh manifest payload that claims attackerOrigin as its
    // signature.iss while keeping baseUrl=ISSUER. Self-consistent on
    // signature.iss vs keySet.issuer; inconsistent vs manifest.baseUrl.
    const manifest = JSON.parse(JSON.stringify(baseManifest)) as Record<string, unknown>;
    const value = sign("EdDSA", privateKey, manifest);
    manifest.signature = {
      alg: "EdDSA",
      kid: "k1",
      iss: attackerOrigin,
      signedAt: SIGNED_AT,
      expiresAt: EXPIRES_AT,
      value,
    };
    const r = verifyManifestSignature(manifest, attackerKeySet, {
      now: NOW_INSIDE_WINDOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("issuer-mismatch");
  });

  it("returns issuer-mismatch when manifest.baseUrl is unparseable", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    // Replace baseUrl with something URL() refuses.
    (manifest as Record<string, unknown>).baseUrl = "::not a url::";
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("issuer-mismatch");
  });

  it("accepts a matching expectedIssuer", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    const r = verifyManifestSignature(manifest, keySet, {
      now: NOW_INSIDE_WINDOW,
      expectedIssuer: ISSUER,
    });
    expect(r.ok).toBe(true);
  });
});

// ─── Failure: key/algorithm mismatch ────────────────────────────────

describe("verifyManifestSignature — key-type-mismatch", () => {
  it("rejects an EdDSA signature against an ES256 key entry", () => {
    const ed = generateKeyPairSync("ed25519");
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const { manifest } = buildSignedManifest("EdDSA", ed.privateKey, ed.publicKey, "k1");
    // Build a key set whose entry says alg=ES256 with a P-256 JWK,
    // even though the signature claims alg=EdDSA.
    const keySet: AgentBridgeKeySet = {
      issuer: ISSUER,
      version: "1",
      keys: [
        {
          kid: "k1",
          alg: "ES256",
          use: "manifest-sign",
          publicKey: ec.publicKey.export({ format: "jwk" }) as never,
        },
      ],
      revokedKids: [],
    };
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("key-type-mismatch");
  });

  it("rejects a key entry whose JWK kty/crv contradict its alg", () => {
    const ed = generateKeyPairSync("ed25519");
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const { manifest } = buildSignedManifest("ES256", ec.privateKey, ec.publicKey, "k1");
    // Key entry claims alg=ES256 but pairs an Ed25519 JWK.
    const keySet: AgentBridgeKeySet = {
      issuer: ISSUER,
      version: "1",
      keys: [
        {
          kid: "k1",
          alg: "ES256",
          use: "manifest-sign",
          publicKey: ed.publicKey.export({ format: "jwk" }) as never,
        },
      ],
      revokedKids: [],
    };
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("key-type-mismatch");
  });
});

// ─── Failure: time / freshness ──────────────────────────────────────

describe("verifyManifestSignature — freshness", () => {
  it("returns before-signed-at when now is before signedAt outside the skew window", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    // 1 hour before signedAt, with 60s skew → outside.
    const r = verifyManifestSignature(manifest, keySet, {
      now: "2026-04-28T11:00:00.000Z",
      clockSkewSeconds: 60,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("before-signed-at");
  });

  it("passes when now is before signedAt but within the skew window", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    // 30s before signedAt, with 60s skew → inside.
    const r = verifyManifestSignature(manifest, keySet, {
      now: "2026-04-28T11:59:30.000Z",
      clockSkewSeconds: 60,
    });
    expect(r.ok).toBe(true);
  });

  it("returns expired when now is after expiresAt outside the skew window", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    const r = verifyManifestSignature(manifest, keySet, {
      now: "2026-04-29T13:00:00.000Z",
      clockSkewSeconds: 60,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("passes when now is after expiresAt but within the skew window", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    // 30s after expiresAt, with 60s skew → inside.
    const r = verifyManifestSignature(manifest, keySet, {
      now: "2026-04-29T12:00:30.000Z",
      clockSkewSeconds: 60,
    });
    expect(r.ok).toBe(true);
  });

  it("clamps clockSkewSeconds to a sane range (negative → 0)", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    // 30s before signedAt, but we ask for negative skew (clamped to 0).
    const r = verifyManifestSignature(manifest, keySet, {
      now: "2026-04-28T11:59:30.000Z",
      clockSkewSeconds: -5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("before-signed-at");
  });

  it("throws for an unparseable options.now (programmer error)", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    expect(() =>
      verifyManifestSignature(manifest, keySet, { now: "not-a-date" }),
    ).toThrow(/options\.now is not a valid date/);
  });
});

// ─── Failure: tamper / signature-invalid ────────────────────────────

describe("verifyManifestSignature — signature-invalid", () => {
  it("returns signature-invalid when a non-signature manifest field is mutated", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    (manifest as Record<string, unknown>).description = "tampered after signing";
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature-invalid");
  });

  it("returns signature-invalid when verifying with the wrong public key", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const otherPair = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest(
      "EdDSA",
      privateKey,
      otherPair.publicKey, // mismatched public key
      "k1",
    );
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature-invalid");
  });

  it("returns signature-invalid for an ES256 signature of the wrong byte length", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const { manifest, keySet } = buildSignedManifest("ES256", ec.privateKey, ec.publicKey, "k1");
    // Truncate the signature to 32 bytes (raw r||s expects 64).
    const truncated = Buffer.from(
      (manifest.signature as { value: string }).value,
      "base64url",
    ).subarray(0, 32);
    (manifest.signature as { value: string }).value = truncated.toString("base64url");
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature-invalid");
  });
});

// ─── Failure: canonicalization ──────────────────────────────────────

describe("verifyManifestSignature — canonicalization-failed", () => {
  it("returns canonicalization-failed when the manifest contains a circular reference", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    // Inject a circular reference in actions[0].
    (manifest.actions as Array<Record<string, unknown>>)[0].self =
      manifest.actions as unknown as Record<string, unknown>;
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("canonicalization-failed");
  });
});

// ─── Mutation, hygiene, integration ─────────────────────────────────

describe("verifyManifestSignature — hygiene & integration", () => {
  it("does not mutate the manifest or the keySet", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", privateKey, publicKey, "k1");
    const beforeManifest = JSON.stringify(manifest);
    const beforeKeySet = JSON.stringify(keySet);
    verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(JSON.stringify(manifest)).toBe(beforeManifest);
    expect(JSON.stringify(keySet)).toBe(beforeKeySet);
  });

  it("error messages never include the public key x parameter", () => {
    // The verifier should not echo public-key bytes in error
    // messages. Public keys aren't secret, but echoing key material
    // makes diagnosing harder and risks leaking other key fields if
    // the error formatting changes later. This pins the contract.
    const ed = generateKeyPairSync("ed25519");
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const { manifest } = buildSignedManifest("EdDSA", ed.privateKey, ed.publicKey, "k1");
    const ecJwk = ec.publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const keySet: AgentBridgeKeySet = {
      issuer: ISSUER,
      version: "1",
      keys: [
        {
          kid: "k1",
          alg: "ES256",
          use: "manifest-sign",
          publicKey: ecJwk as never,
        },
      ],
      revokedKids: [],
    };
    const r = verifyManifestSignature(manifest, keySet, { now: NOW_INSIDE_WINDOW });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toContain(ecJwk.x);
      expect(r.message).not.toContain(ecJwk.y);
    }
  });

  it("returns missing-signature for an unsigned manifest, while validateManifest still accepts it", () => {
    const r = verifyManifestSignature(baseManifest, fakeKeySet());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-signature");
    // Regression: unsigned validation path is unchanged.
    expect(validateManifest(baseManifest).ok).toBe(true);
  });
});

// ─── spec/signing/test-vectors.json round-trip ──────────────────────

describe("spec/signing/test-vectors.json — verifier round-trip", () => {
  const fixtures = loadVectors();

  it("file declares a stable format header", () => {
    const obj = JSON.parse(readFileSync(vectorsPath, "utf8"));
    expect(obj.format).toBe("agentbridge-signed-manifest-test-vectors");
    expect(obj.version).toBe("1");
    expect(Array.isArray(obj.vectors)).toBe(true);
    expect(obj.vectors.length).toBeGreaterThanOrEqual(2);
  });

  it("verifies the eddsa-valid vector", () => {
    const v = fixtures.vectors.find((x) => x.name === "eddsa-valid");
    expect(v).toBeDefined();
    const r = verifyManifestSignature(v!.manifest!, v!.keySet!, {
      now: NOW_INSIDE_WINDOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.alg).toBe("EdDSA");
  });

  it("verifies the es256-valid vector", () => {
    const v = fixtures.vectors.find((x) => x.name === "es256-valid");
    expect(v).toBeDefined();
    const r = verifyManifestSignature(v!.manifest!, v!.keySet!, {
      now: NOW_INSIDE_WINDOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.alg).toBe("ES256");
  });

  it("the tampered-manifest vector documents a signature-invalid expectation", () => {
    // The fixture itself doesn't ship the tampered manifest object —
    // the convention is "take eddsa-valid, mutate one field, verify
    // returns signature-invalid". We exercise that here so the
    // documented expectation is enforced by tests.
    const v = fixtures.vectors.find((x) => x.name === "eddsa-valid");
    expect(v).toBeDefined();
    const tampered = JSON.parse(JSON.stringify(v!.manifest));
    tampered.description = "MUTATED — must fail verification";
    const r = verifyManifestSignature(tampered, v!.keySet!, {
      now: NOW_INSIDE_WINDOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature-invalid");
  });

  it("public key sets in the vectors do not include private `d` material", () => {
    for (const v of fixtures.vectors) {
      if (!v.keySet) continue;
      for (const key of v.keySet.keys) {
        expect((key.publicKey as Record<string, unknown>).d).toBeUndefined();
      }
    }
  });
});

// ─── helpers ─────────────────────────────────────────────────────────

function fakeKeySet(): AgentBridgeKeySet {
  // Trivial valid key set used for "signature missing" / "manifest
  // shape" tests where the key set is irrelevant. Generated once per
  // call so tests don't share state.
  const { publicKey } = generateKeyPairSync("ed25519");
  return {
    issuer: ISSUER,
    version: "1",
    keys: [
      {
        kid: "ignored",
        alg: "EdDSA",
        use: "manifest-sign",
        publicKey: publicKey.export({ format: "jwk" }) as never,
      },
    ],
    revokedKids: [],
  };
}
