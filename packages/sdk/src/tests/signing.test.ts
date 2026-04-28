/**
 * SDK signing tests. Generates ephemeral test keypairs at runtime
 * (NEVER commits real keys). Round-trips signatures through Node
 * `crypto.verify` to prove the bytes the SDK produces are real, valid
 * signatures over the canonicalized manifest.
 *
 * These tests deliberately do NOT exercise a verifier from
 * @marmarlabs/agentbridge-sdk — the verifier ships in a later v0.5.0
 * PR. Verification here uses Node `crypto.verify` directly so the test
 * proves end-to-end correctness without expanding the SDK surface.
 */
import { describe, it, expect } from "vitest";
import {
  generateKeyPairSync,
  verify as cryptoVerify,
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import {
  validateManifest,
  canonicalizeManifestForSigning,
  ManifestSignatureSchema,
} from "@marmarlabs/agentbridge-core";
import {
  defineAgentAction,
  createAgentBridgeManifest,
  signManifest,
  createSignedManifest,
  z,
} from "../index";

// ─── Test fixtures ───────────────────────────────────────────────────

function genEd25519(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync("ed25519");
}

function genEs256(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync("ec", { namedCurve: "P-256" });
}

const baseAction = defineAgentAction({
  name: "list_orders",
  title: "List Orders",
  description: "Returns all orders, paginated.",
  method: "GET",
  endpoint: "/api/agentbridge/actions/list_orders",
  risk: "low",
  requiresConfirmation: false,
  inputSchema: z.object({}),
  outputSchema: z.object({ orders: z.array(z.unknown()) }),
});

const baseManifestConfig = {
  name: "Acme Orders",
  version: "1.4.2",
  baseUrl: "https://orders.acme.example",
  contact: "platform@acme.example",
  actions: [baseAction],
};

function buildManifest() {
  return createAgentBridgeManifest(baseManifestConfig);
}

function verifyEd25519(
  signedManifest: ReturnType<typeof signManifest>,
  publicKey: KeyObject,
): boolean {
  const { signature, ...rest } = signedManifest as typeof signedManifest & {
    signature?: { value: string };
  };
  if (!signature) return false;
  const canonical = canonicalizeManifestForSigning(rest as Record<string, unknown>);
  return cryptoVerify(
    null,
    Buffer.from(canonical, "utf8"),
    publicKey,
    Buffer.from(signature.value, "base64url"),
  );
}

function verifyEs256(
  signedManifest: ReturnType<typeof signManifest>,
  publicKey: KeyObject,
): boolean {
  const { signature, ...rest } = signedManifest as typeof signedManifest & {
    signature?: { value: string };
  };
  if (!signature) return false;
  const canonical = canonicalizeManifestForSigning(rest as Record<string, unknown>);
  return cryptoVerify(
    "sha256",
    Buffer.from(canonical, "utf8"),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature.value, "base64url"),
  );
}

// ─── Mutation, defaults, schema ─────────────────────────────────────

describe("signManifest — does not mutate input", () => {
  it("returns a new object; input manifest is unchanged", () => {
    const { privateKey } = genEd25519();
    const manifest = buildManifest();
    const before = JSON.stringify(manifest);
    const signed = signManifest(manifest, { kid: "k1", privateKey });
    expect(JSON.stringify(manifest)).toBe(before);
    expect(signed).not.toBe(manifest);
  });

  it("does not attach a signature to the input even when one is present", () => {
    const { privateKey } = genEd25519();
    const manifest = buildManifest();
    const stale = {
      ...manifest,
      signature: {
        alg: "EdDSA" as const,
        kid: "stale",
        iss: "https://orders.acme.example",
        signedAt: "2020-01-01T00:00:00Z",
        expiresAt: "2020-01-02T00:00:00Z",
        value: "AAAA",
      },
    };
    const before = JSON.stringify(stale);
    const signed = signManifest(stale, { kid: "fresh", privateKey });
    expect(JSON.stringify(stale)).toBe(before);
    expect(signed.signature?.kid).toBe("fresh");
  });
});

describe("signManifest — attached signature shape", () => {
  it("attaches a signature block matching ManifestSignatureSchema", () => {
    const { privateKey } = genEd25519();
    const signed = signManifest(buildManifest(), { kid: "k1", privateKey });
    const sig = signed.signature;
    expect(sig).toBeDefined();
    const result = ManifestSignatureSchema.safeParse(sig);
    expect(result.success).toBe(true);
  });

  it("defaults alg to EdDSA", () => {
    const { privateKey } = genEd25519();
    const signed = signManifest(buildManifest(), { kid: "k1", privateKey });
    expect(signed.signature?.alg).toBe("EdDSA");
  });

  it("defaults iss to manifest.baseUrl origin", () => {
    const { privateKey } = genEd25519();
    const m = createAgentBridgeManifest({
      ...baseManifestConfig,
      baseUrl: "https://orders.acme.example/api/v1",
    });
    const signed = signManifest(m, { kid: "k1", privateKey });
    // Origin strips path/query; canonical-origin form is the result.
    expect(signed.signature?.iss).toBe("https://orders.acme.example");
  });

  it("respects an explicit canonical-origin issuer", () => {
    const { privateKey } = genEd25519();
    const signed = signManifest(buildManifest(), {
      kid: "k1",
      privateKey,
      issuer: "https://signing.acme.example",
    });
    expect(signed.signature?.iss).toBe("https://signing.acme.example");
  });

  it("rejects a non-canonical issuer", () => {
    const { privateKey } = genEd25519();
    expect(() =>
      signManifest(buildManifest(), {
        kid: "k1",
        privateKey,
        issuer: "https://signing.acme.example/",
      }),
    ).toThrow(/canonical origin/);
  });

  it("rejects an unparseable issuer", () => {
    const { privateKey } = genEd25519();
    expect(() =>
      signManifest(buildManifest(), {
        kid: "k1",
        privateKey,
        issuer: "not-a-url",
      }),
    ).toThrow(/not a valid URL/);
  });
});

describe("signManifest — signedAt / expiresAt resolution", () => {
  it("accepts signedAt as Date", () => {
    const { privateKey } = genEd25519();
    const signedAt = new Date("2026-04-28T12:00:00Z");
    const signed = signManifest(buildManifest(), { kid: "k1", privateKey, signedAt });
    expect(signed.signature?.signedAt).toBe("2026-04-28T12:00:00.000Z");
  });

  it("accepts signedAt as ISO string", () => {
    const { privateKey } = genEd25519();
    const signed = signManifest(buildManifest(), {
      kid: "k1",
      privateKey,
      signedAt: "2026-04-28T12:00:00Z",
    });
    expect(signed.signature?.signedAt).toBe("2026-04-28T12:00:00.000Z");
  });

  it("accepts expiresAt as Date", () => {
    const { privateKey } = genEd25519();
    const signedAt = new Date("2026-04-28T12:00:00Z");
    const expiresAt = new Date("2026-04-29T12:00:00Z");
    const signed = signManifest(buildManifest(), {
      kid: "k1",
      privateKey,
      signedAt,
      expiresAt,
    });
    expect(signed.signature?.expiresAt).toBe("2026-04-29T12:00:00.000Z");
  });

  it("expiresInSeconds sets expiresAt = signedAt + N seconds", () => {
    const { privateKey } = genEd25519();
    const signedAt = new Date("2026-04-28T12:00:00Z");
    const signed = signManifest(buildManifest(), {
      kid: "k1",
      privateKey,
      signedAt,
      expiresInSeconds: 3600,
    });
    expect(signed.signature?.expiresAt).toBe("2026-04-28T13:00:00.000Z");
  });

  it("default expiresAt is signedAt + 24h", () => {
    const { privateKey } = genEd25519();
    const signedAt = new Date("2026-04-28T12:00:00Z");
    const signed = signManifest(buildManifest(), { kid: "k1", privateKey, signedAt });
    expect(signed.signature?.expiresAt).toBe("2026-04-29T12:00:00.000Z");
  });

  it("rejects expiresAt earlier than signedAt", () => {
    const { privateKey } = genEd25519();
    expect(() =>
      signManifest(buildManifest(), {
        kid: "k1",
        privateKey,
        signedAt: "2026-04-28T12:00:00Z",
        expiresAt: "2026-04-28T11:00:00Z",
      }),
    ).toThrow(/strictly after signedAt/);
  });

  it("rejects expiresInSeconds <= 0", () => {
    const { privateKey } = genEd25519();
    expect(() =>
      signManifest(buildManifest(), {
        kid: "k1",
        privateKey,
        expiresInSeconds: 0,
      }),
    ).toThrow(/positive finite/);
  });

  it("rejects malformed signedAt strings", () => {
    const { privateKey } = genEd25519();
    expect(() =>
      signManifest(buildManifest(), {
        kid: "k1",
        privateKey,
        signedAt: "not-a-date",
      }),
    ).toThrow(/valid date/);
  });
});

// ─── Crypto round-trips ──────────────────────────────────────────────

describe("signManifest — Ed25519 round-trip", () => {
  it("produces a signature crypto.verify accepts (KeyObject input)", () => {
    const { publicKey, privateKey } = genEd25519();
    const signed = signManifest(buildManifest(), { kid: "k1", privateKey });
    expect(verifyEd25519(signed, publicKey)).toBe(true);
  });

  it("produces a signature crypto.verify accepts (PEM string input)", () => {
    const { publicKey, privateKey } = genEd25519();
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const signed = signManifest(buildManifest(), { kid: "k1", privateKey: pem });
    expect(verifyEd25519(signed, publicKey)).toBe(true);
  });

  it("produces a signature crypto.verify accepts (PEM Buffer input)", () => {
    const { publicKey, privateKey } = genEd25519();
    const pemBuf = privateKey.export({ format: "pem", type: "pkcs8" }) as Buffer;
    const signed = signManifest(buildManifest(), { kid: "k1", privateKey: pemBuf });
    expect(verifyEd25519(signed, publicKey)).toBe(true);
  });

  it("verification fails when a non-signature manifest field is tampered with", () => {
    const { publicKey, privateKey } = genEd25519();
    const signed = signManifest(buildManifest(), { kid: "k1", privateKey });
    // Mutate a field other than `signature` and re-verify — should fail.
    const tampered = {
      ...signed,
      contact: "attacker@evil.example",
    };
    expect(verifyEd25519(tampered, publicKey)).toBe(false);
  });

  it("verification fails with a different public key", () => {
    const { privateKey } = genEd25519();
    const { publicKey: otherPublicKey } = genEd25519();
    const signed = signManifest(buildManifest(), { kid: "k1", privateKey });
    expect(verifyEd25519(signed, otherPublicKey)).toBe(false);
  });
});

describe("signManifest — ES256 round-trip", () => {
  it("produces a signature crypto.verify accepts (KeyObject input)", () => {
    const { publicKey, privateKey } = genEs256();
    const signed = signManifest(buildManifest(), {
      alg: "ES256",
      kid: "k1",
      privateKey,
    });
    expect(signed.signature?.alg).toBe("ES256");
    expect(verifyEs256(signed, publicKey)).toBe(true);
  });

  it("produces a signature crypto.verify accepts (PEM string input)", () => {
    const { publicKey, privateKey } = genEs256();
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const signed = signManifest(buildManifest(), {
      alg: "ES256",
      kid: "k1",
      privateKey: pem,
    });
    expect(verifyEs256(signed, publicKey)).toBe(true);
  });

  it("produces a 64-byte (r||s) raw signature, not DER", () => {
    const { privateKey } = genEs256();
    const signed = signManifest(buildManifest(), {
      alg: "ES256",
      kid: "k1",
      privateKey,
    });
    // ES256 raw r||s is exactly 64 bytes.
    const sigBytes = Buffer.from(signed.signature!.value, "base64url");
    expect(sigBytes.length).toBe(64);
  });
});

// ─── Algorithm / key validation ──────────────────────────────────────

describe("signManifest — algorithm and key validation", () => {
  it("rejects an unsupported alg", () => {
    const { privateKey } = genEd25519();
    expect(() =>
      // @ts-expect-error — purposefully passing an out-of-enum alg.
      signManifest(buildManifest(), { alg: "RS256", kid: "k1", privateKey }),
    ).toThrow(/unsupported algorithm/);
  });

  it("rejects an Ed25519 key when alg=ES256", () => {
    const { privateKey } = genEd25519();
    expect(() =>
      signManifest(buildManifest(), { alg: "ES256", kid: "k1", privateKey }),
    ).toThrow(/ES256 requires/);
  });

  it("rejects an EC key when alg=EdDSA", () => {
    const { privateKey } = genEs256();
    expect(() =>
      signManifest(buildManifest(), { kid: "k1", privateKey }),
    ).toThrow(/EdDSA requires/);
  });

  it("rejects a public KeyObject (must be private)", () => {
    const { publicKey } = genEd25519();
    expect(() =>
      signManifest(buildManifest(), { kid: "k1", privateKey: publicKey }),
    ).toThrow(/expected a private/);
  });

  it("rejects an unparseable PEM and does not echo the input", () => {
    const garbage = "-----BEGIN PRIVATE KEY-----\nNOT-VALID-base64!!\n-----END PRIVATE KEY-----";
    let captured: string | undefined;
    try {
      signManifest(buildManifest(), { kid: "k1", privateKey: garbage });
    } catch (err) {
      captured = (err as Error).message;
    }
    expect(captured).toMatch(/could not parse private key/);
    expect(captured).not.toContain("NOT-VALID-base64");
  });

  it("rejects a non-Buffer / non-string / non-KeyObject privateKey", () => {
    expect(() =>
      signManifest(buildManifest(), {
        kid: "k1",
        // @ts-expect-error — purposefully passing the wrong type.
        privateKey: 42,
      }),
    ).toThrow(/KeyObject, a PEM string, or a Buffer/);
  });

  it("rejects an empty kid", () => {
    const { privateKey } = genEd25519();
    expect(() =>
      signManifest(buildManifest(), { kid: "", privateKey }),
    ).toThrow(/kid is required/);
  });
});

describe("signManifest — issuer derivation", () => {
  it("fails clearly when manifest.baseUrl cannot derive a canonical origin", () => {
    const { privateKey } = genEd25519();
    // We sneak past the schema to simulate a malformed baseUrl that
    // somehow reached signManifest. Real callers can't construct this
    // through createAgentBridgeManifest, but signManifest is exposed
    // on a typed manifest input and we want a clear error if they do.
    const malformed = {
      name: "x",
      version: "1.0.0",
      baseUrl: "not://a real::url",
      resources: [],
      actions: [baseAction.definition],
    } as unknown as Parameters<typeof signManifest>[0];
    expect(() => signManifest(malformed, { kid: "k1", privateKey })).toThrow(
      /cannot derive issuer/,
    );
  });
});

// ─── Integration: validateManifest, createSignedManifest ────────────

describe("signed manifest validates through @marmarlabs/agentbridge-core", () => {
  it("validateManifest accepts the signed result", () => {
    const { privateKey } = genEd25519();
    const signed = signManifest(buildManifest(), { kid: "k1", privateKey });
    const result = validateManifest(signed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.signature?.kid).toBe("k1");
      expect(result.manifest.signature?.alg).toBe("EdDSA");
    }
  });
});

describe("createSignedManifest", () => {
  it("creates and signs a manifest in one call", () => {
    const { publicKey, privateKey } = genEd25519();
    const signed = createSignedManifest(baseManifestConfig, {
      kid: "k1",
      privateKey,
    });
    expect(signed.signature?.kid).toBe("k1");
    expect(signed.actions).toHaveLength(1);
    expect(verifyEd25519(signed, publicKey)).toBe(true);
  });

  it("the resulting manifest validates through core", () => {
    const { privateKey } = genEd25519();
    const signed = createSignedManifest(baseManifestConfig, {
      kid: "k1",
      privateKey,
    });
    expect(validateManifest(signed).ok).toBe(true);
  });

  it("propagates signing failures (bad alg/key combo)", () => {
    const { privateKey } = genEs256();
    expect(() =>
      createSignedManifest(baseManifestConfig, {
        kid: "k1",
        // alg defaults to EdDSA, but key is EC → must reject before signing.
        privateKey,
      }),
    ).toThrow(/EdDSA requires/);
  });
});

// ─── Determinism / canonicalization sanity ──────────────────────────

describe("signManifest — canonicalization sanity", () => {
  it("re-signing the same manifest with the same Ed25519 key yields identical bytes", () => {
    // Ed25519 is deterministic — same key + same payload + same `value`.
    const { privateKey } = genEd25519();
    const signedAt = new Date("2026-04-28T12:00:00Z");
    const a = signManifest(buildManifest(), { kid: "k1", privateKey, signedAt });
    const b = signManifest(buildManifest(), { kid: "k1", privateKey, signedAt });
    expect(a.signature?.value).toBe(b.signature?.value);
  });

  it("verifies via createPublicKey(privateKey) — Ed25519", () => {
    // Sanity check that we can derive the public key from the private and
    // still verify. Useful for adopters who only carry a private key around.
    const { privateKey } = genEd25519();
    const signed = signManifest(buildManifest(), { kid: "k1", privateKey });
    const pub = createPublicKey(privateKey);
    expect(verifyEd25519(signed, pub)).toBe(true);
  });
});

// ─── Backward-compat: unsigned SDK behavior unchanged ───────────────

describe("unsigned SDK behavior unchanged", () => {
  it("createAgentBridgeManifest still produces an unsigned manifest", () => {
    const m = createAgentBridgeManifest(baseManifestConfig);
    expect(m.signature).toBeUndefined();
    expect(validateManifest(m).ok).toBe(true);
  });
});
