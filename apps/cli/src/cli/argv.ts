import { defineCommand, runMain } from "citty";

export interface ParsedArgs { command: string; positionals: string[]; flags: Record<string, string | boolean | undefined>; }

/**
 * Flags that NEVER take a value. The parser's default behavior is greedy
 * (any `--flag` consumes the next non-`-` arg as its value), which is
 * fine for `--mesh foo` and `--priority now` but breaks for booleans:
 * `claudemesh send --self <pubkey> "msg"` was eating the pubkey as the
 * value of --self, leaving zero positionals and triggering Usage errors.
 *
 * Adding to this set: any new boolean / no-arg switch.
 */
const BOOLEAN_FLAGS = new Set([
  "self",
  "json",            // also accepts --json=a,b,c form below
  "all",
  "yes", "y",
  "help", "h",
  "version", "v",
  "quiet",
  "strict",
  "continue",
  "no-daemon",
  "no-color",
  "debug",
  "allow-ci-persistent",
  "force",
  "dry-run",
  "verbose",
  "skip-service",
  // 1.34.8: `--unread` filters `claudemesh inbox` to rows whose
  // seen_at is NULL. No value — pure switch.
  "unread",
  // 1.34.12: `--foreground` keeps `claudemesh daemon up` attached
  // to the terminal (pre-1.34.12 behavior). Default is detached now.
  "foreground",
  "no-tcp",
  "public-health",
]);

export function parseArgv(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean | undefined> = {};
  const positionals: string[] = [];
  let command = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    // --flag=value (always parsed as a value, regardless of boolean set)
    if (arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      const key = arg.slice(2, eq);
      flags[key] = arg.slice(eq + 1);
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      // Known boolean → never consume the next token as a value.
      if (BOOLEAN_FLAGS.has(key)) { flags[key] = true; continue; }
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) { flags[key] = next; i++; }
      else flags[key] = true;
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      if (BOOLEAN_FLAGS.has(key)) { flags[key] = true; continue; }
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) { flags[key] = next; i++; }
      else flags[key] = true;
    } else if (!command) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }
  return { command, positionals, flags };
}

export { defineCommand, runMain };
