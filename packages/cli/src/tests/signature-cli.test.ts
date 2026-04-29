/**
 * CLI signed-manifest command tests (v0.5.0 PR 5).
 *
 * Covers:
 *   - `agentbridge validate <m> --keys <ks>` and `--require-signature`.
 *   - `agentbridge verify <m> --keys <ks>` with --json,
 *     --expected-issuer, --now, --clock-skew-seconds.
 *   - `agentbridge keys generate` happy path + safety (no private key
 *     bytes on stdout, restrictive file mode).
 *
 * Uses `spec/signing/test-vectors.json` for the verified happy paths
 * so tests stay deterministic against the same vectors implementers
 * in other languages cross-check against.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs, statSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runCli } from "../index";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const vectorsPath = path.join(repoRoot, "spec", "signing", "test-vectors.json");

interface TestVectors {
  vectors: Array<{
    name: string;
    manifest?: Record<string, unknown>;
    keySet?: Record<string, unknown>;
  }>;
}
function loadVectors(): TestVectors {
  return JSON.parse(readFileSync(vectorsPath, "utf8")) as TestVectors;
}

function captureStdio(): {
  out: string[];
  err: string[];
  restore: () => void;
} {
  const out: string[] = [];
  const err: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    out,
    err,
    restore: () => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    },
  };
}

const NOW_INSIDE_WINDOW = "2026-04-28T18:00:00.000Z";

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentbridge-cli-sig-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeJson(filename: string, value: unknown): Promise<string> {
  const p = path.join(tmpDir, filename);
  await fs.writeFile(p, JSON.stringify(value, null, 2), "utf8");
  return p;
}

async function writeVectorPair(
  vectorName: "eddsa-valid" | "es256-valid",
): Promise<{ manifestPath: string; keySetPath: string; vector: TestVectors["vectors"][number] }> {
  const v = loadVectors().vectors.find((x) => x.name === vectorName);
  if (!v) throw new Error(`vector ${vectorName} missing from test-vectors.json`);
  const manifestPath = await writeJson("manifest.json", v.manifest);
  const keySetPath = await writeJson("keys.json", v.keySet);
  return { manifestPath, keySetPath, vector: v };
}

// ─── validate: backward-compat ───────────────────────────────────────

describe("validate command — backward compatibility", () => {
  it("default unsigned validation behavior unchanged", async () => {
    const manifest = {
      name: "Plain",
      version: "1.0.0",
      baseUrl: "https://example.com",
      actions: [
        {
          name: "list",
          title: "List",
          description: "Returns items.",
          inputSchema: { type: "object", properties: {} },
          method: "GET",
          endpoint: "/api/agentbridge/actions/list",
          risk: "low",
          requiresConfirmation: false,
        },
      ],
    };
    const file = await writeJson("plain.json", manifest);
    const cap = captureStdio();
    const code = await runCli({ argv: ["validate", file] });
    cap.restore();
    expect(code).toBe(0);
    expect(cap.out.join("")).toContain("valid manifest");
  });
});

// ─── validate: --require-signature ───────────────────────────────────

describe("validate --require-signature", () => {
  it("rejects an unsigned manifest with exit 1", async () => {
    const file = await writeJson("plain.json", {
      name: "Plain",
      version: "1.0.0",
      baseUrl: "https://example.com",
      actions: [],
    });
    const cap = captureStdio();
    const code = await runCli({ argv: ["validate", file, "--require-signature"] });
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("missing");
  });

  it("rejects a signed manifest when --require-signature is set without --keys (would falsely report verified)", async () => {
    const { manifestPath } = await writeVectorPair("eddsa-valid");
    const cap = captureStdio();
    const code = await runCli({ argv: ["validate", manifestPath, "--require-signature"] });
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("verification skipped");
  });
});

// ─── validate --keys ─────────────────────────────────────────────────

describe("validate --keys", () => {
  it("verifies a valid signed manifest (Ed25519) and exits 0", async () => {
    const { manifestPath, keySetPath } = await writeVectorPair("eddsa-valid");
    const cap = captureStdio();
    const code = await runCli({
      argv: ["validate", manifestPath, "--keys", keySetPath, "--now", NOW_INSIDE_WINDOW],
    });
    cap.restore();
    expect(code).toBe(0);
    expect(cap.out.join("")).toContain("signature verified");
  });

  it("verifies a valid signed manifest (ES256) and exits 0", async () => {
    const { manifestPath, keySetPath } = await writeVectorPair("es256-valid");
    const cap = captureStdio();
    const code = await runCli({
      argv: ["validate", manifestPath, "--keys", keySetPath, "--now", NOW_INSIDE_WINDOW],
    });
    cap.restore();
    expect(code).toBe(0);
    expect(cap.out.join("")).toContain("alg=ES256");
  });

  it("rejects a tampered signed manifest with exit 1 and signature-invalid", async () => {
    const { manifestPath, keySetPath, vector } = await writeVectorPair("eddsa-valid");
    const tampered = JSON.parse(JSON.stringify(vector.manifest));
    tampered.description = "MUTATED — must fail verification";
    await fs.writeFile(manifestPath, JSON.stringify(tampered, null, 2), "utf8");
    const cap = captureStdio();
    const code = await runCli({
      argv: ["validate", manifestPath, "--keys", keySetPath, "--now", NOW_INSIDE_WINDOW],
    });
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("signature-invalid");
  });

  it("rejects an unknown kid", async () => {
    const { manifestPath, keySetPath, vector } = await writeVectorPair("eddsa-valid");
    const m = JSON.parse(JSON.stringify(vector.manifest));
    (m.signature as { kid: string }).kid = "kid-that-does-not-exist";
    await fs.writeFile(manifestPath, JSON.stringify(m, null, 2), "utf8");
    const cap = captureStdio();
    const code = await runCli({
      argv: ["validate", manifestPath, "--keys", keySetPath, "--now", NOW_INSIDE_WINDOW],
    });
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("unknown-kid");
  });

  it("rejects an expired signature", async () => {
    const { manifestPath, keySetPath } = await writeVectorPair("eddsa-valid");
    const cap = captureStdio();
    const code = await runCli({
      argv: [
        "validate",
        manifestPath,
        "--keys",
        keySetPath,
        "--now",
        "2030-01-01T00:00:00Z",
        "--clock-skew-seconds",
        "60",
      ],
    });
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("expired");
  });

  it("emits a clean error for a missing key set path", async () => {
    const { manifestPath } = await writeVectorPair("eddsa-valid");
    const cap = captureStdio();
    const code = await runCli({
      argv: ["validate", manifestPath, "--keys", path.join(tmpDir, "no-such-keys.json")],
    });
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("could not read key set");
  });

  it("emits a clean error for a malformed key set", async () => {
    const { manifestPath } = await writeVectorPair("eddsa-valid");
    const badKeys = await writeJson("bad-keys.json", { wrong: "shape" });
    const cap = captureStdio();
    const code = await runCli({
      argv: ["validate", manifestPath, "--keys", badKeys],
    });
    cap.restore();
    expect(code).toBe(1);
    // Either malformed-key-set or schema validation surfaces.
    const stderr = cap.err.join("");
    expect(stderr).toMatch(/issuer|version|keys|malformed/);
  });
});

// ─── verify ──────────────────────────────────────────────────────────

describe("verify command", () => {
  it("verifies a valid signed manifest and exits 0", async () => {
    const { manifestPath, keySetPath } = await writeVectorPair("eddsa-valid");
    const cap = captureStdio();
    const code = await runCli({
      argv: ["verify", manifestPath, "--keys", keySetPath, "--now", NOW_INSIDE_WINDOW],
    });
    cap.restore();
    expect(code).toBe(0);
    expect(cap.out.join("")).toContain("signature verified");
  });

  it("returns exit 2 when neither --keys nor a manifest is supplied", async () => {
    const cap = captureStdio();
    const code = await runCli({ argv: ["verify"] });
    cap.restore();
    expect(code).toBe(2);
    expect(cap.err.join("")).toContain("usage: agentbridge verify");
  });

  it("returns exit 2 when --keys is missing", async () => {
    const { manifestPath } = await writeVectorPair("eddsa-valid");
    const cap = captureStdio();
    const code = await runCli({ argv: ["verify", manifestPath] });
    cap.restore();
    expect(code).toBe(2);
    expect(cap.err.join("")).toContain("--keys");
  });

  it("rejects a tampered manifest with reason=signature-invalid", async () => {
    const { manifestPath, keySetPath, vector } = await writeVectorPair("eddsa-valid");
    const tampered = JSON.parse(JSON.stringify(vector.manifest));
    tampered.description = "MUTATED";
    await fs.writeFile(manifestPath, JSON.stringify(tampered, null, 2), "utf8");
    const cap = captureStdio();
    const code = await runCli({
      argv: ["verify", manifestPath, "--keys", keySetPath, "--now", NOW_INSIDE_WINDOW],
    });
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("signature-invalid");
  });

  it("--json emits a parseable JSON object on stdout (no prose)", async () => {
    const { manifestPath, keySetPath } = await writeVectorPair("eddsa-valid");
    const cap = captureStdio();
    const code = await runCli({
      argv: [
        "verify",
        manifestPath,
        "--keys",
        keySetPath,
        "--now",
        NOW_INSIDE_WINDOW,
        "--json",
      ],
    });
    cap.restore();
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out.join(""));
    expect(parsed.ok).toBe(true);
    expect(parsed.alg).toBe("EdDSA");
    expect(parsed.kid).toBeDefined();
    expect(parsed.iss).toBeDefined();
    // No prose on stdout in JSON mode.
    expect(cap.out.join("")).not.toContain("verified —");
  });

  it("--json emits a parseable failure object", async () => {
    const { manifestPath, keySetPath, vector } = await writeVectorPair("eddsa-valid");
    const tampered = JSON.parse(JSON.stringify(vector.manifest));
    tampered.description = "MUTATED";
    await fs.writeFile(manifestPath, JSON.stringify(tampered, null, 2), "utf8");
    const cap = captureStdio();
    const code = await runCli({
      argv: [
        "verify",
        manifestPath,
        "--keys",
        keySetPath,
        "--now",
        NOW_INSIDE_WINDOW,
        "--json",
      ],
    });
    cap.restore();
    expect(code).toBe(1);
    const parsed = JSON.parse(cap.out.join(""));
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe("signature-invalid");
    expect(parsed.message).toBeDefined();
  });

  it("--expected-issuer mismatch exits 1 with reason issuer-mismatch", async () => {
    const { manifestPath, keySetPath } = await writeVectorPair("eddsa-valid");
    const cap = captureStdio();
    const code = await runCli({
      argv: [
        "verify",
        manifestPath,
        "--keys",
        keySetPath,
        "--now",
        NOW_INSIDE_WINDOW,
        "--expected-issuer",
        "https://different.example",
      ],
    });
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("issuer-mismatch");
  });

  it("rejects a malformed key set with exit 1", async () => {
    const { manifestPath } = await writeVectorPair("eddsa-valid");
    const badKeys = await writeJson("bad-keys.json", { not: "a key set" });
    const cap = captureStdio();
    const code = await runCli({
      argv: ["verify", manifestPath, "--keys", badKeys, "--now", NOW_INSIDE_WINDOW],
    });
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("failed to load");
  });

  it("error and success outputs never echo the public-key x or y bytes", async () => {
    // Verified path: stdout should mention kid/iss but never the
    // public-key x. Failure path: same.
    const { manifestPath, keySetPath, vector } = await writeVectorPair("eddsa-valid");
    const publicKeyX = (vector.keySet as { keys: Array<{ publicKey: { x: string } }> })
      .keys[0].publicKey.x;

    const cap1 = captureStdio();
    await runCli({ argv: ["verify", manifestPath, "--keys", keySetPath, "--now", NOW_INSIDE_WINDOW] });
    cap1.restore();
    const out1 = cap1.out.join("") + cap1.err.join("");
    expect(out1).not.toContain(publicKeyX);

    // Tamper for the failure path.
    const tampered = JSON.parse(JSON.stringify(vector.manifest));
    tampered.description = "MUTATED";
    await fs.writeFile(manifestPath, JSON.stringify(tampered, null, 2), "utf8");
    const cap2 = captureStdio();
    await runCli({ argv: ["verify", manifestPath, "--keys", keySetPath, "--now", NOW_INSIDE_WINDOW] });
    cap2.restore();
    const out2 = cap2.out.join("") + cap2.err.join("");
    expect(out2).not.toContain(publicKeyX);
  });
});

// ─── keys generate ───────────────────────────────────────────────────

describe("keys generate command", () => {
  it("generates a valid Ed25519 keypair and writes a schema-valid public key set", async () => {
    const outPublic = path.join(tmpDir, "keys.json");
    const outPrivate = path.join(tmpDir, "private.json");
    const cap = captureStdio();
    const code = await runCli({
      argv: [
        "keys",
        "generate",
        "--kid",
        "test-key-1",
        "--issuer",
        "https://example.com",
        "--out-public",
        outPublic,
        "--out-private",
        outPrivate,
      ],
    });
    cap.restore();
    expect(code).toBe(0);

    // Public key set was written and is schema-valid.
    const publicRaw = readFileSync(outPublic, "utf8");
    const publicJson = JSON.parse(publicRaw);
    expect(publicJson.issuer).toBe("https://example.com");
    expect(publicJson.version).toBe("1");
    expect(publicJson.keys).toHaveLength(1);
    expect(publicJson.keys[0].kid).toBe("test-key-1");
    expect(publicJson.keys[0].alg).toBe("EdDSA");
    expect(publicJson.keys[0].publicKey.kty).toBe("OKP");
    expect(publicJson.keys[0].publicKey.crv).toBe("Ed25519");
    // Public-key set must NOT contain the private scalar `d`.
    expect(publicJson.keys[0].publicKey.d).toBeUndefined();
  });

  it("private key file is owner-only on POSIX (mode 0o600)", async () => {
    const outPublic = path.join(tmpDir, "keys.json");
    const outPrivate = path.join(tmpDir, "private.json");
    await runCli({
      argv: [
        "keys",
        "generate",
        "--kid",
        "test-key-2",
        "--issuer",
        "https://example.com",
        "--out-public",
        outPublic,
        "--out-private",
        outPrivate,
      ],
    });
    if (process.platform !== "win32") {
      const stat = statSync(outPrivate);
      // Mask out type bits, keep permission bits.
      // eslint-disable-next-line no-bitwise
      const perms = stat.mode & 0o777;
      expect(perms).toBe(0o600);
    }
  });

  it("private key bytes never appear on stdout or stderr", async () => {
    const outPublic = path.join(tmpDir, "keys.json");
    const outPrivate = path.join(tmpDir, "private.json");
    const cap = captureStdio();
    await runCli({
      argv: [
        "keys",
        "generate",
        "--kid",
        "test-key-3",
        "--issuer",
        "https://example.com",
        "--out-public",
        outPublic,
        "--out-private",
        outPrivate,
      ],
    });
    cap.restore();
    const privateRaw = readFileSync(outPrivate, "utf8");
    const privateJson = JSON.parse(privateRaw);
    const dValue: string = privateJson.privateKeyJwk.d;
    expect(dValue).toBeTruthy();
    const stdout = cap.out.join("");
    const stderr = cap.err.join("");
    expect(stdout).not.toContain(dValue);
    expect(stderr).not.toContain(dValue);
    // Output must include a sensitivity warning so operators see it.
    expect(stderr).toContain("private key file is sensitive");
  });

  it("rejects when --out-private is omitted (refuses to silently discard private material)", async () => {
    const outPublic = path.join(tmpDir, "keys.json");
    const cap = captureStdio();
    const code = await runCli({
      argv: [
        "keys",
        "generate",
        "--kid",
        "test-key-4",
        "--issuer",
        "https://example.com",
        "--out-public",
        outPublic,
      ],
    });
    cap.restore();
    expect(code).toBe(2);
    expect(cap.err.join("")).toContain("--out-private");
  });

  it("rejects a non-canonical issuer (trailing slash)", async () => {
    const outPublic = path.join(tmpDir, "keys.json");
    const outPrivate = path.join(tmpDir, "private.json");
    const cap = captureStdio();
    const code = await runCli({
      argv: [
        "keys",
        "generate",
        "--kid",
        "test-key-5",
        "--issuer",
        "https://example.com/",
        "--out-public",
        outPublic,
        "--out-private",
        outPrivate,
      ],
    });
    cap.restore();
    expect(code).toBe(2);
    expect(cap.err.join("")).toContain("canonical origin");
  });

  it("the generated keypair can sign and verify a manifest end-to-end", async () => {
    const outPublic = path.join(tmpDir, "keys.json");
    const outPrivate = path.join(tmpDir, "private.json");
    const kid = "round-trip-key";
    const issuer = "https://acme.example";
    await runCli({
      argv: [
        "keys",
        "generate",
        "--kid",
        kid,
        "--issuer",
        issuer,
        "--out-public",
        outPublic,
        "--out-private",
        outPrivate,
      ],
    });

    // Sign a manifest using the freshly-generated private JWK.
    const { createPrivateKey, sign: cryptoSign } = await import("node:crypto");
    const { canonicalizeManifestForSigning } = await import("@marmarlabs/agentbridge-core");
    const privateJwk = JSON.parse(readFileSync(outPrivate, "utf8")).privateKeyJwk;
    const privateKey = createPrivateKey({ key: privateJwk, format: "jwk" });

    const manifest = {
      name: "Round-trip",
      version: "1.0.0",
      baseUrl: issuer,
      resources: [],
      actions: [
        {
          name: "noop",
          title: "Noop",
          description: "Returns the empty object.",
          method: "GET",
          endpoint: "/api/agentbridge/actions/noop",
          risk: "low",
          requiresConfirmation: false,
          inputSchema: { type: "object", properties: {} },
          permissions: [],
          examples: [],
        },
      ],
    } as Record<string, unknown>;
    const signedAt = "2026-04-28T12:00:00.000Z";
    const expiresAt = "2026-04-29T12:00:00.000Z";
    const canonical = canonicalizeManifestForSigning(manifest);
    const value = cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64url");
    manifest.signature = { alg: "EdDSA", kid, iss: issuer, signedAt, expiresAt, value };

    const manifestPath = path.join(tmpDir, "round-trip.json");
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    // Use the CLI's verify command against the freshly-generated public set.
    const cap = captureStdio();
    const code = await runCli({
      argv: ["verify", manifestPath, "--keys", outPublic, "--now", NOW_INSIDE_WINDOW],
    });
    cap.restore();
    expect(code).toBe(0);
    expect(cap.out.join("")).toContain("signature verified");
  });
});
