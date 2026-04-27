// Minimal arg parser — avoids pulling in commander/yargs. Supports:
//   - positional args
//   - --flag, --flag=value, --flag value
//   - boolean flags (no value)
// All unknown flags are kept in `flags` so commands can decide.

export interface ParsedArgs {
  command?: string;
  subcommand?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        const key = token.slice(2, eq);
        const value = token.slice(eq + 1);
        flags[key] = value;
        i += 1;
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i += 2;
        } else {
          flags[key] = true;
          i += 1;
        }
      }
    } else {
      positionals.push(token);
      i += 1;
    }
  }

  // Convention: first positional is `command`, second optional `subcommand`.
  const [command, subcommand, ...rest] = positionals;
  return {
    command,
    subcommand,
    positionals: rest,
    flags,
  };
}
