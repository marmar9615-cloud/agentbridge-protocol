import { describe, it, expect } from "vitest";
import {
  ManifestSignatureSchema,
  PublicKeyJwkSchema,
  AgentBridgeKeySchema,
  AgentBridgeKeySetSchema,
  validateKeySet,
} from "../signing/schemas";
import { validateManifest } from "../manifest";

const validEdDsaSignature = {
  alg: "EdDSA" as const,
  kid: "acme-orders-2026-04",
  iss: "https://orders.acme.example",
  signedAt: "2026-04-28T12:00:00Z",
  expiresAt: "2026-04-29T12:00:00Z",
  // 64-byte Ed25519 signature, base64url-encoded (86 chars, no pad).
  value: "A".repeat(86),
};

const validEs256Signature = {
  ...validEdDsaSignature,
  alg: "ES256" as const,
};

const validEd25519Jwk = {
  kty: "OKP",
  crv: "Ed25519",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
};

const validEcP256Jwk = {
  kty: "EC",
  crv: "P-256",
  x: "MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4",
  y: "4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM",
};

const validKey = {
  kid: "acme-orders-2026-04",
  alg: "EdDSA" as const,
  use: "manifest-sign" as const,
  publicKey: validEd25519Jwk,
  notBefore: "2026-04-01T00:00:00Z",
  notAfter: "2026-10-01T00:00:00Z",
};

const validKeySet = {
  issuer: "https://orders.acme.example",
  version: "1" as const,
  keys: [validKey],
  revokedKids: ["acme-orders-2025-10"],
};

const validManifest = {
  name: "Test App",
  version: "1.0.0",
  baseUrl: "http://localhost:3000",
  actions: [
    {
      name: "list_orders",
      title: "List Orders",
      description: "Returns all orders",
      inputSchema: { type: "object", properties: {} },
      method: "GET",
      endpoint: "/api/agentbridge/actions/list_orders",
      risk: "low",
      requiresConfirmation: false,
    },
  ],
};

// ─── ManifestSignatureSchema ─────────────────────────────────────────

describe("ManifestSignatureSchema", () => {
  it("accepts a valid EdDSA signature", () => {
    const r = ManifestSignatureSchema.safeParse(validEdDsaSignature);
    expect(r.success).toBe(true);
  });

  it("accepts a valid ES256 signature", () => {
    const r = ManifestSignatureSchema.safeParse(validEs256Signature);
    expect(r.success).toBe(true);
  });

  it("rejects an unsupported algorithm", () => {
    const r = ManifestSignatureSchema.safeParse({
      ...validEdDsaSignature,
      alg: "RS256",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty kid", () => {
    const r = ManifestSignatureSchema.safeParse({
      ...validEdDsaSignature,
      kid: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing kid", () => {
    const { kid, ...rest } = validEdDsaSignature;
    const r = ManifestSignatureSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects a malformed signedAt", () => {
    const r = ManifestSignatureSchema.safeParse({
      ...validEdDsaSignature,
      signedAt: "not-a-date",
    });
    expect(r.success).toBe(false);
  });

  it("accepts ISO datetime with timezone offset", () => {
    const r = ManifestSignatureSchema.safeParse({
      ...validEdDsaSignature,
      signedAt: "2026-04-28T14:00:00+02:00",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-base64url signature value (standard base64 + chars)", () => {
    const r = ManifestSignatureSchema.safeParse({
      ...validEdDsaSignature,
      value: "abc+def/=",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-base64url signature value (whitespace)", () => {
    const r = ManifestSignatureSchema.safeParse({
      ...validEdDsaSignature,
      value: "abc def",
    });
    expect(r.success).toBe(false);
  });

  it("accepts base64url with padding", () => {
    const r = ManifestSignatureSchema.safeParse({
      ...validEdDsaSignature,
      value: "abc-_AA==",
    });
    expect(r.success).toBe(true);
  });

  it("rejects iss with a path component", () => {
    const r = ManifestSignatureSchema.safeParse({
      ...validEdDsaSignature,
      iss: "https://orders.acme.example/api",
    });
    expect(r.success).toBe(false);
  });

  it("rejects iss with a trailing slash", () => {
    const r = ManifestSignatureSchema.safeParse({
      ...validEdDsaSignature,
      iss: "https://orders.acme.example/",
    });
    expect(r.success).toBe(false);
  });

  it("rejects iss that is not a URL", () => {
    const r = ManifestSignatureSchema.safeParse({
      ...validEdDsaSignature,
      iss: "orders.acme.example",
    });
    expect(r.success).toBe(false);
  });
});

// ─── PublicKeyJwkSchema ──────────────────────────────────────────────

describe("PublicKeyJwkSchema", () => {
  it("accepts a valid Ed25519 JWK", () => {
    const r = PublicKeyJwkSchema.safeParse(validEd25519Jwk);
    expect(r.success).toBe(true);
  });

  it("accepts a valid P-256 JWK", () => {
    const r = PublicKeyJwkSchema.safeParse(validEcP256Jwk);
    expect(r.success).toBe(true);
  });

  it("rejects a JWK that includes the private scalar `d` (Ed25519)", () => {
    const r = PublicKeyJwkSchema.safeParse({
      ...validEd25519Jwk,
      d: "private-key-material-MUST-be-rejected",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a JWK that includes the private scalar `d` (P-256)", () => {
    const r = PublicKeyJwkSchema.safeParse({
      ...validEcP256Jwk,
      d: "private-key-material-MUST-be-rejected",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown kty", () => {
    const r = PublicKeyJwkSchema.safeParse({
      ...validEd25519Jwk,
      kty: "RSA",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an Ed25519 JWK missing `x`", () => {
    const { x, ...rest } = validEd25519Jwk;
    const r = PublicKeyJwkSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects a non-base64url `x`", () => {
    const r = PublicKeyJwkSchema.safeParse({
      ...validEd25519Jwk,
      x: "abc+/==",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown extra field on Ed25519", () => {
    const r = PublicKeyJwkSchema.safeParse({
      ...validEd25519Jwk,
      mystery: 1,
    });
    expect(r.success).toBe(false);
  });
});

// ─── AgentBridgeKeySchema ────────────────────────────────────────────

describe("AgentBridgeKeySchema", () => {
  it("accepts a valid key entry", () => {
    const r = AgentBridgeKeySchema.safeParse(validKey);
    expect(r.success).toBe(true);
  });

  it("rejects a key missing kid", () => {
    const { kid, ...rest } = validKey;
    const r = AgentBridgeKeySchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects a key with use !== manifest-sign", () => {
    const r = AgentBridgeKeySchema.safeParse({ ...validKey, use: "sig" });
    expect(r.success).toBe(false);
  });

  it("rejects a key whose publicKey carries a private scalar", () => {
    const r = AgentBridgeKeySchema.safeParse({
      ...validKey,
      publicKey: { ...validEd25519Jwk, d: "secret" },
    });
    expect(r.success).toBe(false);
  });

  it("treats notBefore / notAfter as optional", () => {
    const { notBefore, notAfter, ...rest } = validKey;
    const r = AgentBridgeKeySchema.safeParse(rest);
    expect(r.success).toBe(true);
  });
});

// ─── AgentBridgeKeySetSchema + validateKeySet ────────────────────────

describe("AgentBridgeKeySetSchema / validateKeySet", () => {
  it("accepts a valid key set", () => {
    const r = validateKeySet(validKeySet);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.keySet.keys).toHaveLength(1);
      expect(r.keySet.revokedKids).toEqual(["acme-orders-2025-10"]);
    }
  });

  it("defaults revokedKids to []", () => {
    const { revokedKids, ...rest } = validKeySet;
    const r = validateKeySet(rest);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.keySet.revokedKids).toEqual([]);
  });

  it("rejects an empty keys array", () => {
    const r = validateKeySet({ ...validKeySet, keys: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-canonical issuer", () => {
    const r = validateKeySet({
      ...validKeySet,
      issuer: "https://orders.acme.example/",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an unsupported version", () => {
    const r = validateKeySet({ ...validKeySet, version: "2" });
    expect(r.ok).toBe(false);
  });

  it("returns the same shape as validateManifest on failure", () => {
    const r = validateKeySet({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Array.isArray(r.errors)).toBe(true);
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  it("reports field paths in error messages", () => {
    const r = validateKeySet({ ...validKeySet, issuer: "not-a-url" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith("issuer:"))).toBe(true);
    }
  });

  it("accepts an empty revokedKids array explicitly", () => {
    const r = validateKeySet({ ...validKeySet, revokedKids: [] });
    expect(r.ok).toBe(true);
  });

  it("rejects revokedKids containing an empty string", () => {
    const r = validateKeySet({ ...validKeySet, revokedKids: [""] });
    expect(r.ok).toBe(false);
  });
});

// ─── Manifest schema integration ─────────────────────────────────────

describe("validateManifest with optional signature", () => {
  it("accepts an unsigned manifest (regression — v0.4.x behavior preserved)", () => {
    const r = validateManifest(validManifest);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.signature).toBeUndefined();
  });

  it("accepts a manifest with a valid signature", () => {
    const r = validateManifest({
      ...validManifest,
      signature: validEdDsaSignature,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.signature?.kid).toBe("acme-orders-2026-04");
      expect(r.manifest.signature?.alg).toBe("EdDSA");
    }
  });

  it("rejects a manifest with a malformed signature block", () => {
    const r = validateManifest({
      ...validManifest,
      signature: { ...validEdDsaSignature, alg: "RS256" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith("signature."))).toBe(true);
    }
  });

  it("rejects a manifest whose signature has malformed expiresAt", () => {
    const r = validateManifest({
      ...validManifest,
      signature: { ...validEdDsaSignature, expiresAt: "yesterday" },
    });
    expect(r.ok).toBe(false);
  });
});
