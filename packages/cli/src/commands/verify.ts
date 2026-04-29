/**
 * `agentbridge verify <manifest> --keys <keyset.json>` — dedicated
 * signature-verification subcommand. Always runs the verifier (unlike
 * `validate`, which makes verification opt-in via `--keys`). Local
 * file or fetched URL for the manifest; **local file only** for the
 * key set.
 *
 * Exit codes:
 *   - 0 : signature verified
 *   - 1 : signature failed verification (any reason)
 *   - 2 : usage error (missing positional / required flag)
 */
import { promises as fs } from "node:fs";
import {
  verifyManifestSignature,
  type VerifyManifestSignatureResult,
} from "@marmarlabs/agentbridge-core";
import { c } from "../colors";
import { loadKeySetFromFile } from "./key-loader";
import { summarizeVerifyResult } from "./validate";

export interface VerifyOptions {
  keys?: string;
  expectedIssuer?: string;
  now?: string;
  clockSkewSeconds?: number;
  json?: boolean;
}

export async function runVerify(
  source: string | undefined,
  opts: VerifyOptions,
): Promise<number> {
  if (!source) {
    process.stderr.write(
      `${c.red("error:")} usage: agentbridge verify <file-or-url> --keys <keyset.json> [--expected-issuer <origin>] [--now <iso>] [--clock-skew-seconds <n>] [--json]\n`,
    );
    return 2;
  }
  if (!opts.keys) {
    process.stderr.write(
      `${c.red("error:")} agentbridge verify requires --keys <path-to-publisher-key-set.json>\n`,
    );
    return 2;
  }

  // ── Load manifest ─────────────────────────────────────────────────
  let raw: string;
  try {
    if (looksLikeUrl(source)) {
      const res = await fetch(source);
      if (!res.ok) {
        return failUsage(opts.json, `HTTP ${res.status} fetching ${source}`);
      }
      raw = await res.text();
    } else {
      raw = await fs.readFile(source, "utf8");
    }
  } catch (err) {
    return failUsage(opts.json, (err as Error).message);
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    return failUsage(opts.json, `manifest is not valid JSON: ${(err as Error).message}`);
  }

  // ── Load key set ──────────────────────────────────────────────────
  const ksLoad = await loadKeySetFromFile(opts.keys);
  if (!ksLoad.ok) {
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, reason: "malformed-key-set", message: ksLoad.errors.join("; ") }, null, 2)}\n`,
      );
    } else {
      process.stderr.write(
        `${c.red("✗")} key set "${opts.keys}" failed to load\n`,
      );
      for (const err of ksLoad.errors) {
        process.stderr.write(`  ${c.red("·")} ${err}\n`);
      }
    }
    return 1;
  }

  // ── Verify ────────────────────────────────────────────────────────
  const verifyOptions: Parameters<typeof verifyManifestSignature>[2] = {};
  if (opts.expectedIssuer !== undefined) verifyOptions.expectedIssuer = opts.expectedIssuer;
  if (opts.now !== undefined) verifyOptions.now = opts.now;
  if (opts.clockSkewSeconds !== undefined)
    verifyOptions.clockSkewSeconds = opts.clockSkewSeconds;

  const result: VerifyManifestSignatureResult = verifyManifestSignature(
    manifest,
    ksLoad.keySet,
    verifyOptions,
  );
  const outcome = summarizeVerifyResult(result);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(outcome.payload, null, 2)}\n`);
  } else {
    const sink: NodeJS.WritableStream = outcome.ok ? process.stdout : process.stderr;
    const marker = outcome.ok ? c.green("✓") : c.red("✗");
    sink.write(`${marker} ${outcome.summary}\n`);
    if (outcome.detailLines) {
      for (const line of outcome.detailLines) {
        sink.write(`  ${c.dim("·")} ${line}\n`);
      }
    }
  }

  return outcome.ok ? 0 : 1;
}

function looksLikeUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

function failUsage(json: boolean | undefined, message: string): number {
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, reason: "input-error", message }, null, 2)}\n`,
    );
  } else {
    process.stderr.write(`${c.red("error:")} ${message}\n`);
  }
  return 1;
}
