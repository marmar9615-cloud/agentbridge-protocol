import { promises as fs } from "node:fs";
import { validateManifest } from "@agentbridge/core";
import { c } from "../colors";

export interface ValidateOptions {
  json?: boolean;
}

export async function runValidate(
  source: string | undefined,
  opts: ValidateOptions,
): Promise<number> {
  if (!source) {
    process.stderr.write(`${c.red("error:")} usage: agentbridge validate <file-or-url>\n`);
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
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }

  if (result.ok) {
    const m = result.manifest;
    process.stdout.write(
      `${c.green("✓")} valid manifest  ${c.bold(m.name)} v${m.version}\n`,
    );
    process.stdout.write(
      `  ${c.dim("baseUrl:")} ${m.baseUrl}\n  ${c.dim("actions:")} ${m.actions.length}  ${c.dim("resources:")} ${m.resources.length}\n`,
    );
    return 0;
  }

  process.stderr.write(`${c.red("✗")} manifest failed validation\n`);
  for (const e of result.errors) {
    process.stderr.write(`  ${c.red("·")} ${e}\n`);
  }
  return 1;
}

function looksLikeUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}
