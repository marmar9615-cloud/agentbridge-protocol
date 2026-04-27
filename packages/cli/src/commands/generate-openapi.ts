import { promises as fs } from "node:fs";
import path from "node:path";
import {
  parseOpenApiDocument,
  generateManifestFromOpenApi,
} from "@agentbridge/openapi";
import { c } from "../colors";

export interface GenerateOpenApiOptions {
  baseUrl?: string;
  out?: string;
  json?: boolean;
}

export async function runGenerateOpenApi(
  source: string | undefined,
  opts: GenerateOpenApiOptions,
): Promise<number> {
  if (!source) {
    process.stderr.write(
      `${c.red("error:")} usage: agentbridge generate openapi <file-or-url>\n`,
    );
    return 2;
  }

  let raw: string;
  try {
    if (source.startsWith("http://") || source.startsWith("https://")) {
      const res = await fetch(source);
      if (!res.ok) {
        process.stderr.write(`${c.red("error:")} HTTP ${res.status} fetching ${source}\n`);
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

  let parseResult;
  try {
    parseResult = parseOpenApiDocument(raw);
  } catch (err) {
    process.stderr.write(`${c.red("error:")} ${(err as Error).message}\n`);
    return 1;
  }

  const result = generateManifestFromOpenApi(parseResult.document, {
    baseUrl: opts.baseUrl,
  });

  const outPath = opts.out ?? path.join(process.cwd(), "agentbridge.generated.json");

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  await fs.writeFile(outPath, JSON.stringify(result.manifest, null, 2) + "\n", "utf8");

  process.stdout.write(
    `${c.green("✓")} generated manifest with ${c.bold(String(result.manifest.actions.length))} actions\n`,
  );
  process.stdout.write(`  ${c.dim("→")} ${path.relative(process.cwd(), outPath)}\n`);

  if (parseResult.warnings.length > 0) {
    process.stdout.write(`\n${c.bold(c.yellow("Parser warnings"))}\n`);
    for (const w of parseResult.warnings) process.stdout.write(`  ${c.yellow("!")} ${w}\n`);
  }
  if (result.warnings.length > 0) {
    process.stdout.write(`\n${c.bold(c.yellow("Generator warnings"))}\n`);
    for (const w of result.warnings) process.stdout.write(`  ${c.yellow("!")} ${w}\n`);
  }
  if (result.skipped.length > 0) {
    process.stdout.write(`\n${c.bold(c.dim("Skipped operations"))}\n`);
    for (const s of result.skipped) {
      process.stdout.write(`  ${c.gray("·")} ${s.method} ${s.path} — ${s.reason}\n`);
    }
  }

  process.stdout.write(
    `\n${c.bold("Next")}: review the generated manifest, then ${c.cyan(`agentbridge validate ${path.relative(process.cwd(), outPath)}`)}\n`,
  );
  return 0;
}
