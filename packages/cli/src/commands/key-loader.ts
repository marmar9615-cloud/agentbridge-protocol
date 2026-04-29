/**
 * Tiny helper shared by `validate --keys` and `verify --keys`. Loads
 * a publisher key set from disk, parses JSON, runs `validateKeySet`
 * from `@marmarlabs/agentbridge-core`, and returns a structured
 * `{ ok, keySet | errors }` result so each command can fold it into
 * its own output / exit-code logic without duplicating boilerplate.
 *
 * Local-file-only — no remote fetch in this PR. Runtime fetch of
 * `/.well-known/agentbridge-keys.json` ships with the MCP server PR.
 */
import { promises as fs } from "node:fs";
import {
  validateKeySet,
  type AgentBridgeKeySet,
} from "@marmarlabs/agentbridge-core";

export type LoadKeySetResult =
  | { ok: true; keySet: AgentBridgeKeySet }
  | { ok: false; errors: string[] };

export async function loadKeySetFromFile(filePath: string): Promise<LoadKeySetResult> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    return {
      ok: false,
      errors: [`could not read key set "${filePath}": ${(err as Error).message}`],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      errors: [`key set "${filePath}" is not valid JSON: ${(err as Error).message}`],
    };
  }
  return validateKeySet(parsed);
}
