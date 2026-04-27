import { parseArgs } from "./args";
import { c } from "./colors";
import { getCliVersion } from "./version";
import { runScan } from "./commands/scan";
import { runValidate } from "./commands/validate";
import { runInit } from "./commands/init";
import { runGenerateOpenApi } from "./commands/generate-openapi";
import { runMcpConfig } from "./commands/mcp-config";

export interface RunCliOptions {
  argv?: string[];
}

export async function runCli(opts: RunCliOptions = {}): Promise<number> {
  const argv = opts.argv ?? process.argv.slice(2);
  const args = parseArgs(argv);

  if (!args.command || args.flags.help === true || args.flags.h === true) {
    printHelp();
    return args.command ? 0 : 1;
  }

  switch (args.command) {
    case "version":
    case "--version":
    case "-v":
      process.stdout.write(`${getCliVersion()}\n`);
      return 0;
    case "scan":
      return runScan(args.subcommand, { json: args.flags.json === true });
    case "validate":
      return runValidate(args.subcommand, { json: args.flags.json === true });
    case "init":
      return runInit({
        force: args.flags.force === true,
        format: args.flags.format === "json" ? "json" : "ts",
      });
    case "generate":
      return runGenerate(args.subcommand, args.positionals, args.flags);
    case "mcp-config":
      return runMcpConfig();
    default:
      process.stderr.write(`${c.red("error:")} unknown command: ${args.command}\n\n`);
      printHelp();
      return 2;
  }
}

async function runGenerate(
  sub: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  if (sub !== "openapi") {
    process.stderr.write(
      `${c.red("error:")} usage: agentbridge generate openapi <file-or-url> [--out PATH] [--base-url URL] [--json]\n`,
    );
    return 2;
  }
  const source = positionals[0];
  return runGenerateOpenApi(source, {
    baseUrl: typeof flags["base-url"] === "string" ? (flags["base-url"] as string) : undefined,
    out: typeof flags.out === "string" ? (flags.out as string) : undefined,
    json: flags.json === true,
  });
}

function printHelp(): void {
  process.stdout.write(`${c.bold("agentbridge")} ${c.dim(`v${getCliVersion()}`)}

${c.bold("Usage")}
  agentbridge <command> [options]

${c.bold("Commands")}
  ${c.cyan("scan <url>")}                    Score a URL's AgentBridge readiness.
  ${c.cyan("validate <file-or-url>")}        Validate a manifest from disk or URL.
  ${c.cyan("init")}                          Scaffold an agentbridge.config and starter manifest.
  ${c.cyan("generate openapi <src>")}        Generate a manifest from an OpenAPI 3.x doc.
  ${c.cyan("mcp-config")}                    Print example MCP client config.
  ${c.cyan("version")}                       Print CLI version.

${c.bold("Options")}
  ${c.dim("--json")}                         Output raw JSON (scan, validate, generate).
  ${c.dim("--force")}                        Overwrite existing files (init).
  ${c.dim("--format ts|json")}               Choose config file format (init).
  ${c.dim("--out PATH")}                     Output path (generate openapi).
  ${c.dim("--base-url URL")}                 Override manifest baseUrl (generate openapi).
  ${c.dim("--help")}                         Show this help.

${c.bold("Examples")}
  ${c.dim("$")} agentbridge scan http://localhost:3000
  ${c.dim("$")} agentbridge validate ./public/.well-known/agentbridge.json
  ${c.dim("$")} agentbridge init --force
  ${c.dim("$")} agentbridge generate openapi ./openapi.json --base-url http://localhost:3000
  ${c.dim("$")} agentbridge mcp-config
`);
}

export { runScan, runValidate, runInit, runGenerateOpenApi, runMcpConfig };
