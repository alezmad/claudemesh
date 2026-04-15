import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";

export function findClaudeBinary(): string | null {
  const candidates = [
    process.env.CLAUDE_BIN,
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`,
    `${process.env.HOME}/.npm/bin/claude`,
  ].filter(Boolean) as string[];

  for (const bin of candidates) {
    if (existsSync(bin)) return bin;
  }

  const which = spawnSync("which", ["claude"], { encoding: "utf-8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();

  return null;
}

export interface SpawnClaudeOpts {
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export function spawnClaude(opts: SpawnClaudeOpts): SpawnSyncReturns<Buffer> {
  const bin = findClaudeBinary();
  if (!bin) throw new Error("Claude binary not found. Install with: npm i -g @anthropic-ai/claude-code");

  return spawnSync(bin, opts.args, {
    stdio: "inherit",
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd,
  });
}
