/**
 * `agentbridge keys generate` — local-dev helper for bootstrapping
 * a publisher key set. Generates an asymmetric keypair, writes the
 * public half to a complete `agentbridge-keys.json` document and
 * the private half to a separate file with mode 0o600.
 *
 * **This command is for local development only.** Production signing
 * keys should be generated inside a KMS / HSM and never written to
 * a developer's filesystem. The command exits with a clear stderr
 * warning that the on-disk private key is sensitive material.
 *
 * Output safety:
 *   - The private key is **never** written to stdout.
 *   - The private key file is created with mode 0o600 (owner-only).
 *   - Stdout / stderr never echoes the private `d` parameter, only
 *     the file paths and the kid/alg metadata.
 *   - `--out-private` is required; omitting it fails fast (we refuse
 *     to silently discard the freshly-generated key material).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import {
  validateKeySet,
  type SignatureAlgorithm,
} from "@marmarlabs/agentbridge-core";
import { c } from "../colors";

export interface KeysGenerateOptions {
  kid?: string;
  alg?: string;
  issuer?: string;
  outPublic?: string;
  outPrivate?: string;
  notBefore?: string;
  notAfter?: string;
}

export async function runKeysGenerate(opts: KeysGenerateOptions): Promise<number> {
  const errors: string[] = [];
  if (!opts.kid) errors.push("--kid <id> is required");
  if (!opts.issuer) errors.push("--issuer <canonical-origin> is required");
  if (!opts.outPublic) errors.push("--out-public <path> is required");
  if (!opts.outPrivate)
    errors.push(
      "--out-private <path> is required (the freshly-generated private key must be written somewhere; the CLI refuses to silently discard it)",
    );

  const alg: SignatureAlgorithm = (opts.alg ?? "EdDSA") as SignatureAlgorithm;
  if (alg !== "EdDSA" && alg !== "ES256") {
    errors.push(`unsupported algorithm "${opts.alg}" — supported: EdDSA, ES256`);
  }

  if (errors.length > 0) {
    process.stderr.write(
      `${c.red("error:")} usage: agentbridge keys generate --kid <id> --issuer <origin> --out-public <path> --out-private <path> [--alg EdDSA|ES256]\n`,
    );
    for (const e of errors) {
      process.stderr.write(`  ${c.red("·")} ${e}\n`);
    }
    return 2;
  }

  // ── Reject non-canonical issuer up front ────────────────────────
  const issuer = opts.issuer as string;
  try {
    if (new URL(issuer).origin !== issuer) {
      process.stderr.write(
        `${c.red("error:")} --issuer must be a canonical origin (got "${issuer}", expected "${new URL(issuer).origin}")\n`,
      );
      return 2;
    }
  } catch {
    process.stderr.write(
      `${c.red("error:")} --issuer "${issuer}" is not a valid URL\n`,
    );
    return 2;
  }

  // ── Generate keypair ────────────────────────────────────────────
  let publicKey: KeyObject;
  let privateKey: KeyObject;
  if (alg === "EdDSA") {
    ({ publicKey, privateKey } = generateKeyPairSync("ed25519"));
  } else {
    ({ publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" }));
  }

  const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  const privateJwk = privateKey.export({ format: "jwk" }) as Record<string, unknown>;

  // ── Build the public key set document ───────────────────────────
  const kid = opts.kid as string;
  const keySet = {
    issuer,
    version: "1" as const,
    keys: [
      {
        kid,
        alg,
        use: "manifest-sign" as const,
        publicKey: publicJwk,
        ...(opts.notBefore ? { notBefore: opts.notBefore } : {}),
        ...(opts.notAfter ? { notAfter: opts.notAfter } : {}),
      },
    ],
    revokedKids: [],
  };

  // Sanity-check the document we're about to write through the same
  // schema runtime callers will use. A failure here is a programmer
  // bug in this command, not user input — surface it explicitly.
  const validated = validateKeySet(keySet);
  if (!validated.ok) {
    process.stderr.write(
      `${c.red("internal error:")} generated key set failed schema validation:\n`,
    );
    for (const e of validated.errors) {
      process.stderr.write(`  ${c.red("·")} ${e}\n`);
    }
    return 1;
  }

  // ── Build the private key envelope ──────────────────────────────
  // We deliberately wrap the private JWK in a metadata envelope so
  // it is *never* mistaken for a public key set by `validateKeySet`.
  // The envelope's `_test_only` flag is an additional defensive
  // marker — a future verifier that accidentally accepts this
  // document still fails closed because there is no `keys` array.
  const privateEnvelope = {
    _comment:
      "AgentBridge signing private key. Treat as secret. Do NOT commit this file. Production keys belong in a KMS / HSM.",
    _test_only: true,
    kid,
    alg,
    privateKeyJwk: privateJwk,
  };

  // ── Write output files ──────────────────────────────────────────
  const outPublic = path.resolve(opts.outPublic as string);
  const outPrivate = path.resolve(opts.outPrivate as string);
  try {
    await fs.writeFile(outPublic, `${JSON.stringify(keySet, null, 2)}\n`, "utf8");
  } catch (err) {
    process.stderr.write(
      `${c.red("error:")} could not write public key set to ${outPublic}: ${(err as Error).message}\n`,
    );
    return 1;
  }
  try {
    // mode: 0o600 — owner-read/write only. POSIX-only; Windows
    // ignores the bits but the value still applies on Linux/macOS,
    // which is where most adopters will run this command.
    await fs.writeFile(
      outPrivate,
      `${JSON.stringify(privateEnvelope, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (err) {
    process.stderr.write(
      `${c.red("error:")} could not write private key to ${outPrivate}: ${(err as Error).message}\n`,
    );
    return 1;
  }

  // ── Summarize. The private JWK is **never** printed. ────────────
  process.stdout.write(
    `${c.green("✓")} generated ${alg} key  ${c.bold(`kid=${kid}`)}\n`,
  );
  process.stdout.write(`  ${c.dim("public key set:")} ${outPublic}\n`);
  process.stdout.write(`  ${c.dim("private key:")}    ${outPrivate}\n`);
  process.stderr.write(
    `\n${c.yellow("warning:")} the private key file is sensitive material.\n` +
      `  Do NOT commit it. Production signing keys belong in a KMS / HSM.\n` +
      `  This command is for local development and integration testing only.\n`,
  );
  return 0;
}
