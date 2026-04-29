/**
 * Scanner signed-manifest check tests (v0.5.0 PR 4).
 *
 * Generates ephemeral test keypairs at runtime and reuses the
 * deterministic vectors at `spec/signing/test-vectors.json`. The
 * scanner package depends on `@marmarlabs/agentbridge-core` (which
 * owns `verifyManifestSignature`) and on Node `crypto` for the
 * ad-hoc signing the synthetic test cases need — no SDK dependency,
 * no new package dependency.
 */
import { describe, it, expect } from "vitest";
import {
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  canonicalizeManifestForSigning,
  type AgentBridgeKeySet,
  type AgentBridgeManifest,
  type SignatureAlgorithm,
} from "@marmarlabs/agentbridge-core";
import { scoreManifest } from "../score";
import { scanUrl } from "../scanner";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const vectorsPath = path.join(repoRoot, "spec", "signing", "test-vectors.json");

// ── Fixtures ─────────────────────────────────────────────────────────

const ISSUER = "https://orders.acme.example";
const SIGNED_AT = "2026-04-28T12:00:00.000Z";
const EXPIRES_AT = "2026-04-29T12:00:00.000Z";
const NOW_INSIDE_WINDOW = "2026-04-28T18:00:00.000Z";

const baseUnsignedManifest: AgentBridgeManifest = {
  name: "Acme Orders",
  version: "1.4.2",
  baseUrl: ISSUER,
  contact: "platform@acme.example",
  auth: { type: "none" },
  resources: [{ name: "orders", description: "Customer orders.", url: "/orders" }],
  actions: [
    {
      name: "list_orders",
      title: "List Orders",
      description: "Returns all orders, paginated.",
      method: "GET",
      endpoint: "/api/agentbridge/actions/list_orders",
      risk: "low",
      requiresConfirmation: false,
      inputSchema: { type: "object", properties: {} },
      outputSchema: {
        type: "object",
        properties: { orders: { type: "array" } },
      },
      permissions: [],
      examples: [{ description: "List", input: {} }],
      humanReadableSummaryTemplate: "List orders",
    },
  ],
};

function signEd25519(
  manifest: Record<string, unknown>,
  privateKey: KeyObject,
): string {
  return cryptoSign(
    null,
    Buffer.from(canonicalizeManifestForSigning(manifest), "utf8"),
    privateKey,
  ).toString("base64url");
}

function buildSignedManifest(
  alg: SignatureAlgorithm,
  publicKey: KeyObject,
  privateKey: KeyObject,
  kid: string,
  overrides: { signedAt?: string; expiresAt?: string; iss?: string } = {},
): { manifest: AgentBridgeManifest; keySet: AgentBridgeKeySet } {
  const signedAt = overrides.signedAt ?? SIGNED_AT;
  const expiresAt = overrides.expiresAt ?? EXPIRES_AT;
  const iss = overrides.iss ?? ISSUER;
  const manifest = JSON.parse(JSON.stringify(baseUnsignedManifest)) as Record<string, unknown>;
  const value =
    alg === "EdDSA"
      ? signEd25519(manifest, privateKey)
      : cryptoSign(
          "sha256",
          Buffer.from(canonicalizeManifestForSigning(manifest), "utf8"),
          { key: privateKey, dsaEncoding: "ieee-p1363" },
        ).toString("base64url");
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
  return { manifest: manifest as AgentBridgeManifest, keySet };
}

interface TestVectors {
  vectors: Array<{
    name: string;
    manifest?: Record<string, unknown>;
    keySet?: AgentBridgeKeySet;
    _test_only_private_key_jwk?: Record<string, unknown>;
  }>;
}
function loadVectors(): TestVectors {
  return JSON.parse(readFileSync(vectorsPath, "utf8")) as TestVectors;
}

// ── Default behavior — unsigned scanner output unchanged ─────────────

describe("scoreManifest — default behavior unchanged for unsigned manifests", () => {
  it("emits no signature checks when no signature options passed", () => {
    const r = scoreManifest(baseUnsignedManifest);
    const sig = [...r.checks, ...r.passed].filter((c) =>
      c.id.startsWith("manifest.signature."),
    );
    expect(sig.length).toBe(0);
  });

  it("does not mutate the existing check inventory or score", () => {
    const a = scoreManifest(baseUnsignedManifest);
    const b = scoreManifest(baseUnsignedManifest, {});
    expect(b.score).toBe(a.score);
    expect(b.checks.length).toBe(a.checks.length);
    expect(b.passed.length).toBe(a.passed.length);
  });
});

// ── requireSignature mode without a key set ──────────────────────────

describe("scoreManifest — requireSignature mode", () => {
  it("emits manifest.signature.missing as error when manifest is unsigned", () => {
    const r = scoreManifest(baseUnsignedManifest, {
      signature: { requireSignature: true },
    });
    const missing = r.checks.find((c) => c.id === "manifest.signature.missing");
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe("error");
    expect(missing!.deduction).toBe(15);
  });

  it("default mode (no requireSignature) emits manifest.signature.missing as info with no deduction", () => {
    const r = scoreManifest(baseUnsignedManifest, { signature: {} });
    const missing = r.checks.find((c) => c.id === "manifest.signature.missing");
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe("info");
    expect(missing!.deduction).toBe(0);
  });

  it("signed manifest without a key set emits unverified-no-key-set info, not missing", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest } = buildSignedManifest("EdDSA", publicKey, privateKey, "k1");
    const r = scoreManifest(manifest, { signature: {} });
    expect(r.checks.find((c) => c.id === "manifest.signature.missing")).toBeUndefined();
    const skipped = r.checks.find(
      (c) => c.id === "manifest.signature.unverified-no-key-set",
    );
    expect(skipped).toBeDefined();
    expect(skipped!.severity).toBe("info");
    expect(skipped!.deduction).toBe(0);
  });
});

// ── Verified happy paths ─────────────────────────────────────────────

describe("scoreManifest — verified signatures emit manifest.signature.verified", () => {
  it("Ed25519 signed manifest verifies via the scanner", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest(
      "EdDSA",
      publicKey,
      privateKey,
      "k1",
    );
    const r = scoreManifest(manifest, {
      signature: { keySet, now: NOW_INSIDE_WINDOW },
    });
    const verified = r.passed.find((c) => c.id === "manifest.signature.verified");
    expect(verified).toBeDefined();
    expect(verified!.severity).toBe("info");
    expect(verified!.deduction).toBe(0);
    expect(verified!.message).toContain("alg=EdDSA");
    expect(verified!.message).toContain("kid=k1");
  });

  it("ES256 signed manifest verifies via the scanner", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const { manifest, keySet } = buildSignedManifest(
      "ES256",
      publicKey,
      privateKey,
      "k1",
    );
    const r = scoreManifest(manifest, {
      signature: { keySet, now: NOW_INSIDE_WINDOW },
    });
    expect(r.passed.find((c) => c.id === "manifest.signature.verified")).toBeDefined();
  });

  it("verified signatures do not introduce new failed checks", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", publicKey, privateKey, "k1");
    const r = scoreManifest(manifest, {
      signature: { keySet, now: NOW_INSIDE_WINDOW },
    });
    const sigFailed = r.checks.filter((c) => c.id.startsWith("manifest.signature."));
    expect(sigFailed.length).toBe(0);
  });
});

// ── Failure-mode mappings ────────────────────────────────────────────

describe("scoreManifest — verifier failures map to scanner check IDs", () => {
  it("tampered manifest → manifest.signature.invalid (error, deduction 25)", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", publicKey, privateKey, "k1");
    (manifest as Record<string, unknown>).contact = "tampered@evil.example";
    const r = scoreManifest(manifest, {
      signature: { keySet, now: NOW_INSIDE_WINDOW },
    });
    const c = r.checks.find((c) => c.id === "manifest.signature.invalid");
    expect(c).toBeDefined();
    expect(c!.severity).toBe("error");
    expect(c!.deduction).toBe(25);
  });

  it("unknown kid → manifest.signature.unknown-kid", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", publicKey, privateKey, "k-active");
    (manifest.signature as { kid: string }).kid = "k-mystery";
    const r = scoreManifest(manifest, {
      signature: { keySet, now: NOW_INSIDE_WINDOW },
    });
    expect(r.checks.find((c) => c.id === "manifest.signature.unknown-kid")).toBeDefined();
  });

  it("revoked kid → manifest.signature.revoked-kid (deduction 30 — highest)", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", publicKey, privateKey, "k1");
    keySet.revokedKids = ["k1"];
    const r = scoreManifest(manifest, {
      signature: { keySet, now: NOW_INSIDE_WINDOW },
    });
    const c = r.checks.find((c) => c.id === "manifest.signature.revoked-kid");
    expect(c).toBeDefined();
    expect(c!.deduction).toBe(30);
  });

  it("expired signature → manifest.signature.expired", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", publicKey, privateKey, "k1");
    const r = scoreManifest(manifest, {
      signature: { keySet, now: "2030-01-01T00:00:00.000Z", clockSkewSeconds: 60 },
    });
    expect(r.checks.find((c) => c.id === "manifest.signature.expired")).toBeDefined();
  });

  it("issuer mismatch (signature.iss != manifest.baseUrl) → manifest.signature.issuer-mismatch", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    // Sign over a manifest where signature.iss differs from baseUrl.
    const manifest = JSON.parse(JSON.stringify(baseUnsignedManifest)) as Record<string, unknown>;
    const value = signEd25519(manifest, privateKey);
    manifest.signature = {
      alg: "EdDSA",
      kid: "k1",
      iss: "https://attacker.example",
      signedAt: SIGNED_AT,
      expiresAt: EXPIRES_AT,
      value,
    };
    const keySet: AgentBridgeKeySet = {
      issuer: "https://attacker.example",
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
    const r = scoreManifest(manifest as AgentBridgeManifest, {
      signature: { keySet, now: NOW_INSIDE_WINDOW },
    });
    expect(r.checks.find((c) => c.id === "manifest.signature.issuer-mismatch")).toBeDefined();
  });

  it("malformed key set → manifest.signature.key-set-malformed (warning, no deduction)", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest } = buildSignedManifest("EdDSA", publicKey, privateKey, "k1");
    const r = scoreManifest(manifest, {
      signature: { keySet: { wrong: "shape" }, now: NOW_INSIDE_WINDOW },
    });
    const c = r.checks.find((c) => c.id === "manifest.signature.key-set-malformed");
    expect(c).toBeDefined();
    expect(c!.severity).toBe("warning");
    expect(c!.deduction).toBe(0);
  });

  it("malformed signature block → manifest.signature.malformed", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", publicKey, privateKey, "k1");
    // Strip required fields.
    manifest.signature = { alg: "EdDSA", kid: "k1" } as never;
    const r = scoreManifest(manifest, {
      signature: { keySet, now: NOW_INSIDE_WINDOW },
    });
    expect(r.checks.find((c) => c.id === "manifest.signature.malformed")).toBeDefined();
  });

  it("inverted-window signature → manifest.signature.malformed", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", publicKey, privateKey, "k1");
    // ExpiresAt before signedAt — verifier rejects as malformed-signature.
    (manifest.signature as { expiresAt: string }).expiresAt = "2026-04-28T11:00:00.000Z";
    const r = scoreManifest(manifest, {
      signature: { keySet, now: NOW_INSIDE_WINDOW },
    });
    expect(r.checks.find((c) => c.id === "manifest.signature.malformed")).toBeDefined();
  });

  it("key-type mismatch (key entry alg vs signature alg) → manifest.signature.key-type-mismatch", () => {
    const ed = generateKeyPairSync("ed25519");
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const { manifest } = buildSignedManifest("EdDSA", ed.publicKey, ed.privateKey, "k1");
    // Key set advertises alg=ES256 with a P-256 JWK while the signature
    // claims alg=EdDSA.
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
    const r = scoreManifest(manifest, {
      signature: { keySet, now: NOW_INSIDE_WINDOW },
    });
    expect(r.checks.find((c) => c.id === "manifest.signature.key-type-mismatch")).toBeDefined();
  });
});

// ── Hygiene: no key material in scanner output ───────────────────────

describe("scanner output never includes private key material", () => {
  it("error messages and recommendations never echo public key x/y bytes", () => {
    const ed = generateKeyPairSync("ed25519");
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const ecJwk = ec.publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const { manifest } = buildSignedManifest("EdDSA", ed.publicKey, ed.privateKey, "k1");
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
    const r = scoreManifest(manifest, {
      signature: { keySet, now: NOW_INSIDE_WINDOW },
    });
    for (const check of r.checks) {
      expect(check.message).not.toContain(ecJwk.x);
      expect(check.message).not.toContain(ecJwk.y);
      if (check.recommendation) {
        expect(check.recommendation).not.toContain(ecJwk.x);
        expect(check.recommendation).not.toContain(ecJwk.y);
      }
    }
  });
});

// ── scanUrl integration — preserves existing network behavior ────────

describe("scanUrl — signature options route through to scoreManifest", () => {
  function makeFetch(handler: (url: string) => Response): typeof fetch {
    return ((url: RequestInfo | URL) =>
      Promise.resolve(handler(typeof url === "string" ? url : url.toString()))) as typeof fetch;
  }

  it("default scanUrl invocation does not introduce signature checks", async () => {
    const fetcher = makeFetch(() =>
      new Response(JSON.stringify(baseUnsignedManifest), { status: 200 }),
    );
    const r = await scanUrl(ISSUER, { fetcher, allowAnyUrl: true });
    const sig = [...r.checks, ...r.passed].filter((c) =>
      c.id.startsWith("manifest.signature."),
    );
    expect(sig.length).toBe(0);
  });

  it("scanUrl with signature.keySet runs the verifier", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const { manifest, keySet } = buildSignedManifest("EdDSA", publicKey, privateKey, "k1");
    const fetcher = makeFetch(() =>
      new Response(JSON.stringify(manifest), { status: 200 }),
    );
    const r = await scanUrl(ISSUER, {
      fetcher,
      allowAnyUrl: true,
      signature: { keySet, now: NOW_INSIDE_WINDOW },
    });
    expect(r.passed.find((c) => c.id === "manifest.signature.verified")).toBeDefined();
  });

  it("scanUrl with requireSignature=true on an unsigned manifest emits the missing-signature error", async () => {
    const fetcher = makeFetch(() =>
      new Response(JSON.stringify(baseUnsignedManifest), { status: 200 }),
    );
    const r = await scanUrl(ISSUER, {
      fetcher,
      allowAnyUrl: true,
      signature: { requireSignature: true },
    });
    const c = r.checks.find((c) => c.id === "manifest.signature.missing");
    expect(c).toBeDefined();
    expect(c!.severity).toBe("error");
    expect(c!.deduction).toBe(15);
  });
});

// ── spec/signing/test-vectors.json round-trip ────────────────────────

describe("scoreManifest — spec/signing/test-vectors.json", () => {
  const fixtures = loadVectors();

  it("verifies the eddsa-valid vector through the scanner", () => {
    const v = fixtures.vectors.find((x) => x.name === "eddsa-valid");
    expect(v).toBeDefined();
    const r = scoreManifest(v!.manifest as AgentBridgeManifest, {
      signature: { keySet: v!.keySet, now: NOW_INSIDE_WINDOW },
    });
    expect(r.passed.find((c) => c.id === "manifest.signature.verified")).toBeDefined();
  });

  it("verifies the es256-valid vector through the scanner", () => {
    const v = fixtures.vectors.find((x) => x.name === "es256-valid");
    expect(v).toBeDefined();
    const r = scoreManifest(v!.manifest as AgentBridgeManifest, {
      signature: { keySet: v!.keySet, now: NOW_INSIDE_WINDOW },
    });
    expect(r.passed.find((c) => c.id === "manifest.signature.verified")).toBeDefined();
  });

  it("tampered eddsa-valid vector emits manifest.signature.invalid via the scanner", () => {
    const v = fixtures.vectors.find((x) => x.name === "eddsa-valid");
    expect(v).toBeDefined();
    const tampered = JSON.parse(JSON.stringify(v!.manifest));
    tampered.description = "MUTATED";
    const r = scoreManifest(tampered, {
      signature: { keySet: v!.keySet, now: NOW_INSIDE_WINDOW },
    });
    expect(r.checks.find((c) => c.id === "manifest.signature.invalid")).toBeDefined();
  });
});
