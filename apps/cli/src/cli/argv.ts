import { defineCommand, runMain } from "citty";

export interface ParsedArgs { command: string; positionals: string[]; flags: Record<string, string | boolean | undefined>; }

export function parseArgv(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean | undefined> = {};
  const positionals: string[] = [];
  let command = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) { flags[key] = next; i++; } else flags[key] = true;
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) { flags[key] = next; i++; } else flags[key] = true;
    } else if (!command) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }
  return { command, positionals, flags };
}

export { defineCommand, runMain };
