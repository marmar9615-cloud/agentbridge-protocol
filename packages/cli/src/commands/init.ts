import { promises as fs } from "node:fs";
import path from "node:path";
import { c } from "../colors";

export interface InitOptions {
  force?: boolean;
  format?: "ts" | "json";
}

const STARTER_MANIFEST = {
  name: "My App",
  description: "Replace this with a one-paragraph description of what your app does.",
  version: "0.1.0",
  baseUrl: "http://localhost:3000",
  contact: "you@example.com",
  auth: { type: "none", description: "Replace with your real auth surface." },
  resources: [],
  actions: [
    {
      name: "ping",
      title: "Ping",
      description: "Returns a heartbeat. Useful for connectivity checks.",
      method: "GET",
      endpoint: "/api/agentbridge/actions/ping",
      risk: "low",
      requiresConfirmation: false,
      inputSchema: { type: "object", properties: {} },
      outputSchema: {
        type: "object",
        properties: { ok: { type: "boolean" }, ts: { type: "string" } },
      },
      permissions: [],
      examples: [{ input: {} }],
      humanReadableSummaryTemplate: "Ping the API",
    },
    {
      name: "create_thing",
      title: "Create a thing",
      description: "Creates a new thing. Replace with a real action from your app.",
      method: "POST",
      endpoint: "/api/agentbridge/actions/create_thing",
      risk: "medium",
      requiresConfirmation: true,
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          notes: { type: "string" },
        },
      },
      outputSchema: { type: "object", properties: { id: { type: "string" } } },
      permissions: [{ scope: "things:write" }],
      examples: [{ input: { name: "First thing" } }],
      humanReadableSummaryTemplate: 'Create a thing named "{{name}}"',
    },
  ],
};

const TS_CONFIG_TEMPLATE = `// AgentBridge config — edit to declare your app's actions, then run:
//   npx @marmarlabs/agentbridge-cli validate ./agentbridge.config.ts
//
// In a Next.js app, generate /.well-known/agentbridge.json from this:
//   import { defineAgentAction, createAgentBridgeManifest, z } from "@marmarlabs/agentbridge-sdk";

import { defineAgentAction, createAgentBridgeManifest, z } from "@marmarlabs/agentbridge-sdk";

export const ping = defineAgentAction({
  name: "ping",
  title: "Ping",
  description: "Returns a heartbeat. Useful for connectivity checks.",
  method: "GET",
  endpoint: "/api/agentbridge/actions/ping",
  risk: "low",
  requiresConfirmation: false,
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean(), ts: z.string() }),
  examples: [{ input: {} }],
  humanReadableSummaryTemplate: "Ping the API",
});

export const createThing = defineAgentAction({
  name: "create_thing",
  title: "Create a thing",
  description: "Creates a new thing. Replace with a real action from your app.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/create_thing",
  risk: "medium",
  requiresConfirmation: true,
  inputSchema: z.object({
    name: z.string().min(1),
    notes: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
  permissions: [{ scope: "things:write" }],
  examples: [{ input: { name: "First thing" } }],
  humanReadableSummaryTemplate: 'Create a thing named "{{name}}"',
});

export default createAgentBridgeManifest({
  name: "My App",
  description: "Replace this with a one-paragraph description of what your app does.",
  version: "0.1.0",
  baseUrl: "http://localhost:3000",
  contact: "you@example.com",
  actions: [ping, createThing],
});
`;

export async function runInit(opts: InitOptions): Promise<number> {
  const cwd = process.cwd();
  const format = opts.format ?? "ts";

  const configPath = path.join(
    cwd,
    format === "ts" ? "agentbridge.config.ts" : "agentbridge.config.json",
  );
  const manifestPath = path.join(cwd, "public", ".well-known", "agentbridge.json");

  let wrote = 0;
  let skipped = 0;

  // Config file
  if (!opts.force && (await exists(configPath))) {
    process.stderr.write(
      `${c.yellow("skip")} ${path.relative(cwd, configPath)} (already exists; use --force to overwrite)\n`,
    );
    skipped += 1;
  } else {
    const content =
      format === "ts" ? TS_CONFIG_TEMPLATE : JSON.stringify(STARTER_MANIFEST, null, 2) + "\n";
    await fs.writeFile(configPath, content, "utf8");
    process.stdout.write(`${c.green("create")} ${path.relative(cwd, configPath)}\n`);
    wrote += 1;
  }

  // Starter manifest under public/.well-known/ — handy for static-served apps.
  if (!opts.force && (await exists(manifestPath))) {
    process.stderr.write(
      `${c.yellow("skip")} ${path.relative(cwd, manifestPath)} (already exists; use --force to overwrite)\n`,
    );
    skipped += 1;
  } else {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(STARTER_MANIFEST, null, 2) + "\n", "utf8");
    process.stdout.write(`${c.green("create")} ${path.relative(cwd, manifestPath)}\n`);
    wrote += 1;
  }

  process.stdout.write(
    `\n${c.bold("Next steps")}\n  1. Edit ${path.relative(cwd, configPath)} to declare your real actions.\n  2. ${c.cyan("npx @marmarlabs/agentbridge-cli validate ./public/.well-known/agentbridge.json")}\n  3. ${c.cyan("npx @marmarlabs/agentbridge-cli scan http://localhost:3000")}\n`,
  );

  return wrote === 0 && skipped > 0 ? 1 : 0;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
