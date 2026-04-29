import { promises as fs } from "node:fs";
import {
  validateManifest,
  verifyManifestSignature,
  type VerifyManifestSignatureResult,
} from "@marmarlabs/agentbridge-core";
import { c } from "../colors";
import { loadKeySetFromFile } from "./key-loader";

export interface ValidateOptions {
  json?: boolean;
  /** Path to a publisher key set JSON file. When set, the verifier runs. */
  keys?: string;
  /**
   * When true, an unsigned manifest is rejected (exit 1) and a signed
   * manifest with no `--keys` supplied is also rejected. Always
   * additive: unsigned manifests still validate by default.
   */
  requireSignature?: boolean;
  expectedIssuer?: string;
  /** ISO datetime / Date used for freshness checks. Defaults to "now". */
  now?: string;
  /** Allowed clock skew (seconds) for `signedAt`/`expiresAt`. */
  clockSkewSeconds?: number;
}

export async function runValidate(
  source: string | undefined,
  opts: ValidateOptions,
): Promise<number> {
  if (!source) {
    process.stderr.write(`${c.red("error:")} usage: agentbridge validate <file-or-url> [--keys <keyset.json>] [--require-signature]\n`);
    return 2;
  }

  let raw: string;
  try {
    if (looksLikeUrl(source)) {
      // Direct manifest fetch — caller can paste a /.well-known URL or any URL
      // returning a manifest JSON.
      const res = await fetch(source);
      if (!res.ok) {
        process.stderr.write(
          `${c.red("error:")} HTTP ${res.status} fetching ${source}\n`,
        );
        return 1;
      }
      raw = await res.text();
    } else {
      raw = await fs.readFile(source, "utf8");
    }
  } catch (err) {
    process.stderr.write(`${c.red("error:")} ${(err as Error).message}\n`);
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, errors: [`invalid JSON: ${(err as Error).message}`] }, null, 2)}\n`,
      );
    } else {
      process.stderr.write(
        `${c.red("✗")} not valid JSON: ${(err as Error).message}\n`,
      );
    }
    return 1;
  }

  const result = validateManifest(parsed);

  // ── Signature verification (opt-in via --keys / --require-signature) ──
  let signatureOutcome: SignatureOutcome | undefined;
  if (opts.keys || opts.requireSignature) {
    signatureOutcome = await runSignaturePhase(parsed, opts);
  }

  if (opts.json) {
    const out: Record<string, unknown> = { ...result };
    if (signatureOutcome) out.signature = signatureOutcome.payload;
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    if (!result.ok) return 1;
    if (signatureOutcome && !signatureOutcome.ok) return 1;
    return 0;
  }

  if (result.ok) {
    const m = result.manifest;
    process.stdout.write(
      `${c.green("✓")} valid manifest  ${c.bold(m.name)} v${m.version}\n`,
    );
    process.stdout.write(
      `  ${c.dim("baseUrl:")} ${m.baseUrl}\n  ${c.dim("actions:")} ${m.actions.length}  ${c.dim("resources:")} ${m.resources.length}\n`,
    );
  } else {
    process.stderr.write(`${c.red("✗")} manifest failed validation\n`);
    for (const e of result.errors) {
      process.stderr.write(`  ${c.red("·")} ${e}\n`);
    }
  }

  if (signatureOutcome) {
    printSignatureOutcomeHuman(signatureOutcome);
  }

  if (!result.ok) return 1;
  if (signatureOutcome && !signatureOutcome.ok) return 1;
  return 0;
}

function looksLikeUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

// ─── Signature phase ────────────────────────────────────────────────

interface SignatureOutcome {
  ok: boolean;
  /** Stable JSON payload for `--json` mode and downstream tooling. */
  payload: Record<string, unknown>;
  /** Human-friendly summary line. */
  summary: string;
  /** Optional details printed after the summary in human mode. */
  detailLines?: string[];
}

async function runSignaturePhase(
  parsedManifest: unknown,
  opts: ValidateOptions,
): Promise<SignatureOutcome> {
  // requireSignature without --keys: only the missing-signature gate
  // is meaningful — verification cannot run without a key set.
  if (!opts.keys) {
    const hasSignature =
      parsedManifest !== null &&
      typeof parsedManifest === "object" &&
      !Array.isArray(parsedManifest) &&
      (parsedManifest as Record<string, unknown>).signature !== undefined;
    if (!hasSignature) {
      return {
        ok: false,
        payload: {
          ok: false,
          reason: "missing-signature",
          message:
            "manifest carries no signature, and --require-signature was set",
        },
        summary:
          "manifest signature missing (require-signature mode, no key set supplied)",
      };
    }
    // Signature present but no key set — surface as an explicit
    // skipped-verification outcome with non-zero exit (the operator
    // asked for require-signature; producing a "verified" outcome
    // without verifying would be misleading).
    return {
      ok: false,
      payload: {
        ok: false,
        reason: "no-key-set-supplied",
        message:
          "manifest carries a signature, but --keys was not supplied — verification was skipped",
      },
      summary:
        "signature present but verification skipped (no --keys); pass the publisher's key set to verify",
    };
  }

  const ksLoad = await loadKeySetFromFile(opts.keys);
  if (!ksLoad.ok) {
    return {
      ok: false,
      payload: {
        ok: false,
        reason: "malformed-key-set",
        message: ksLoad.errors.join("; "),
      },
      summary: "supplied key set could not be loaded",
      detailLines: ksLoad.errors,
    };
  }

  const verifyOptions: Parameters<typeof verifyManifestSignature>[2] = {};
  if (opts.expectedIssuer !== undefined) verifyOptions.expectedIssuer = opts.expectedIssuer;
  if (opts.now !== undefined) verifyOptions.now = opts.now;
  if (opts.clockSkewSeconds !== undefined)
    verifyOptions.clockSkewSeconds = opts.clockSkewSeconds;

  const result = verifyManifestSignature(parsedManifest, ksLoad.keySet, verifyOptions);
  return summarizeVerifyResult(result);
}

export function summarizeVerifyResult(
  result: VerifyManifestSignatureResult,
): SignatureOutcome {
  if (result.ok) {
    return {
      ok: true,
      payload: {
        ok: true,
        kid: result.kid,
        iss: result.iss,
        alg: result.alg,
        signedAt: result.signedAt,
        expiresAt: result.expiresAt,
      },
      summary: `signature verified — alg=${result.alg} kid=${result.kid} iss=${result.iss}`,
      detailLines: [
        `signedAt:  ${result.signedAt}`,
        `expiresAt: ${result.expiresAt}`,
      ],
    };
  }
  return {
    ok: false,
    payload: { ok: false, reason: result.reason, message: result.message },
    summary: `signature verification failed — ${result.reason}`,
    detailLines: [result.message],
  };
}

function printSignatureOutcomeHuman(outcome: SignatureOutcome): void {
  const sink: NodeJS.WritableStream = outcome.ok ? process.stdout : process.stderr;
  const marker = outcome.ok ? c.green("✓") : c.red("✗");
  sink.write(`${marker} ${outcome.summary}\n`);
  if (outcome.detailLines) {
    for (const line of outcome.detailLines) {
      sink.write(`  ${c.dim("·")} ${line}\n`);
    }
  }
}
