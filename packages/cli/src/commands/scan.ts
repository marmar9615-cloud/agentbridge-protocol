import { scanUrl } from "@marmarlabs/agentbridge-scanner";
import { c } from "../colors";

export interface ScanOptions {
  json?: boolean;
}

export async function runScan(url: string | undefined, opts: ScanOptions): Promise<number> {
  if (!url) {
    process.stderr.write(`${c.red("error:")} usage: agentbridge scan <url>\n`);
    return 2;
  }

  let result;
  try {
    result = await scanUrl(url);
  } catch (err) {
    process.stderr.write(`${c.red("error:")} ${(err as Error).message}\n`);
    return 1;
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.score === 0 ? 1 : 0;
  }

  printReport(result);
  return result.checks.some((c) => c.severity === "error") ? 1 : 0;
}

function printReport(result: Awaited<ReturnType<typeof scanUrl>>): void {
  const scoreColor =
    result.score >= 80 ? c.green : result.score >= 50 ? c.yellow : c.red;
  process.stdout.write("\n");
  process.stdout.write(`${c.bold("AgentBridge scan")}  ${c.dim(result.url)}\n`);
  process.stdout.write(`${c.dim("manifest:")} ${result.manifestUrl}\n`);
  process.stdout.write("\n");
  process.stdout.write(
    `${c.bold("Score")}      ${scoreColor(`${result.score}/100`)}\n`,
  );
  process.stdout.write(
    `${c.bold("Manifest")}   ${
      result.manifestFound
        ? result.validManifest
          ? c.green("found and valid")
          : c.yellow("found but invalid")
        : c.red("not found")
    }\n`,
  );
  process.stdout.write(
    `${c.bold("Actions")}    ${result.actionCount}  ${c.dim(
      `(${result.riskyActionCount} risky, ${result.missingConfirmationCount} missing confirmation)`,
    )}\n`,
  );
  process.stdout.write("\n");

  if (result.notes.length > 0) {
    process.stdout.write(`${c.bold("Notes")}\n`);
    for (const n of result.notes) process.stdout.write(`  ${c.gray("·")} ${n}\n`);
    process.stdout.write("\n");
  }

  if (result.validationErrors && result.validationErrors.length > 0) {
    process.stdout.write(`${c.bold("Validation errors")}\n`);
    for (const e of result.validationErrors) process.stdout.write(`  ${c.red("✗")} ${e}\n`);
    process.stdout.write("\n");
  }

  const errors = result.checks.filter((c) => c.severity === "error");
  const warnings = result.checks.filter((c) => c.severity === "warning");
  const infos = result.checks.filter((c) => c.severity === "info");

  if (errors.length > 0) {
    process.stdout.write(`${c.bold(c.red(`Errors (${errors.length})`))}\n`);
    for (const e of errors) process.stdout.write(`  ${c.red("✗")} ${e.path}: ${e.message}\n`);
    process.stdout.write("\n");
  }
  if (warnings.length > 0) {
    process.stdout.write(`${c.bold(c.yellow(`Warnings (${warnings.length})`))}\n`);
    for (const w of warnings) process.stdout.write(`  ${c.yellow("!")} ${w.path}: ${w.message}\n`);
    process.stdout.write("\n");
  }
  if (infos.length > 0) {
    process.stdout.write(`${c.bold(c.dim(`Info (${infos.length})`))}\n`);
    for (const w of infos) process.stdout.write(`  ${c.gray("·")} ${w.path}: ${w.message}\n`);
    process.stdout.write("\n");
  }

  for (const [cat, items] of Object.entries(result.recommendationGroups)) {
    if (items.length === 0) continue;
    process.stdout.write(`${c.bold("Recommendations")} ${c.dim(`(${cat})`)}\n`);
    for (const r of items) process.stdout.write(`  ${c.cyan("→")} ${r}\n`);
    process.stdout.write("\n");
  }

  if (result.passed.length > 0) {
    process.stdout.write(
      `${c.dim(`(${result.passed.length} checks passed)`)}\n\n`,
    );
  }
}
