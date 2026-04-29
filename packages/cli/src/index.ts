import { parseArgs } from "./args";
import { c } from "./colors";
import { getCliVersion } from "./version";
import { runScan } from "./commands/scan";
import { runValidate } from "./commands/validate";
import { runInit } from "./commands/init";
import { runGenerateOpenApi } from "./commands/generate-openapi";
import { runMcpConfig } from "./commands/mcp-config";
import { runVerify } from "./commands/verify";
import { runKeysGenerate } from "./commands/keys";

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
      return runValidate(args.subcommand, {
        json: args.flags.json === true,
        keys: typeof args.flags.keys === "string" ? args.flags.keys : undefined,
        requireSignature: args.flags["require-signature"] === true,
        expectedIssuer:
          typeof args.flags["expected-issuer"] === "string"
            ? (args.flags["expected-issuer"] as string)
            : undefined,
        now: typeof args.flags.now === "string" ? args.flags.now : undefined,
        clockSkewSeconds: parseSkew(args.flags["clock-skew-seconds"]),
      });
    case "verify":
      return runVerify(args.subcommand, {
        json: args.flags.json === true,
        keys: typeof args.flags.keys === "string" ? args.flags.keys : undefined,
        expectedIssuer:
          typeof args.flags["expected-issuer"] === "string"
            ? (args.flags["expected-issuer"] as string)
            : undefined,
        now: typeof args.flags.now === "string" ? args.flags.now : undefined,
        clockSkewSeconds: parseSkew(args.flags["clock-skew-seconds"]),
      });
    case "keys":
      return runKeys(args.subcommand, args.flags);
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

async function runKeys(
  sub: string | undefined,
  flags: Record<string, string | boolean>,
): Promise<number> {
  if (sub !== "generate") {
    process.stderr.write(
      `${c.red("error:")} usage: agentbridge keys generate --kid <id> --issuer <origin> --out-public <path> --out-private <path> [--alg EdDSA|ES256]\n`,
    );
    return 2;
  }
  return runKeysGenerate({
    kid: typeof flags.kid === "string" ? flags.kid : undefined,
    alg: typeof flags.alg === "string" ? flags.alg : undefined,
    issuer: typeof flags.issuer === "string" ? flags.issuer : undefined,
    outPublic: typeof flags["out-public"] === "string" ? (flags["out-public"] as string) : undefined,
    outPrivate: typeof flags["out-private"] === "string" ? (flags["out-private"] as string) : undefined,
    notBefore: typeof flags["not-before"] === "string" ? (flags["not-before"] as string) : undefined,
    notAfter: typeof flags["not-after"] === "string" ? (flags["not-after"] as string) : undefined,
  });
}

function parseSkew(input: string | boolean | undefined): number | undefined {
  if (typeof input !== "string") return undefined;
  const n = Number(input);
  return Number.isFinite(n) ? n : undefined;
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
  ${c.cyan("verify <file-or-url>")}          Verify a manifest signature against a publisher key set.
  ${c.cyan("keys generate")}                 Generate a local Ed25519 / ES256 signing keypair (dev only).
  ${c.cyan("init")}                          Scaffold an agentbridge.config and starter manifest.
  ${c.cyan("generate openapi <src>")}        Generate a manifest from an OpenAPI 3.x doc.
  ${c.cyan("mcp-config")}                    Print example MCP client config.
  ${c.cyan("version")}                       Print CLI version.

${c.bold("Options")}
  ${c.dim("--json")}                         Output raw JSON (scan, validate, verify, generate).
  ${c.dim("--keys PATH")}                    Publisher key set JSON for signature verification (validate, verify).
  ${c.dim("--require-signature")}            Reject unsigned manifests (validate).
  ${c.dim("--expected-issuer ORIGIN")}       Require signature.iss to equal this origin (validate, verify).
  ${c.dim("--now ISO")}                      Override "now" for freshness checks (validate, verify).
  ${c.dim("--clock-skew-seconds N")}         Allowed clock skew for signedAt/expiresAt (validate, verify).
  ${c.dim("--kid ID")}                       Key id (keys generate).
  ${c.dim("--alg EdDSA|ES256")}              Signature algorithm (keys generate; default EdDSA).
  ${c.dim("--issuer ORIGIN")}                Canonical publisher origin (keys generate).
  ${c.dim("--out-public PATH")}              Public key set output path (keys generate).
  ${c.dim("--out-private PATH")}             Private key output path; required (keys generate).
  ${c.dim("--force")}                        Overwrite existing files (init).
  ${c.dim("--format ts|json")}               Choose config file format (init).
  ${c.dim("--out PATH")}                     Output path (generate openapi).
  ${c.dim("--base-url URL")}                 Override manifest baseUrl (generate openapi).
  ${c.dim("--help")}                         Show this help.

${c.bold("Examples")}
  ${c.dim("$")} agentbridge scan http://localhost:3000
  ${c.dim("$")} agentbridge validate ./public/.well-known/agentbridge.json
  ${c.dim("$")} agentbridge validate ./manifest.json --keys ./agentbridge-keys.json
  ${c.dim("$")} agentbridge validate ./manifest.json --require-signature --keys ./agentbridge-keys.json
  ${c.dim("$")} agentbridge verify ./manifest.json --keys ./agentbridge-keys.json --json
  ${c.dim("$")} agentbridge keys generate --kid acme-2026-04 --issuer https://acme.example --out-public keys.json --out-private acme.priv.json
  ${c.dim("$")} agentbridge init --force
  ${c.dim("$")} agentbridge generate openapi ./openapi.json --base-url http://localhost:3000
  ${c.dim("$")} agentbridge mcp-config
`);
}

export {
  runScan,
  runValidate,
  runVerify,
  runKeysGenerate,
  runInit,
  runGenerateOpenApi,
  runMcpConfig,
};
