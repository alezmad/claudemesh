/**
 * `claudemesh install` / `uninstall` — manage Claude Code MCP registration.
 *
 * install:
 *   1. Preflight: bun is on PATH, this package's MCP entry is on disk.
 *   2. Read ~/.claude.json (or empty object if absent).
 *   3. Add/update `mcpServers.claudemesh` with the resolved entry path.
 *   4. Write back with 0600 perms.
 *   5. Verify via read-back, print success.
 *
 * uninstall:
 *   1. Read ~/.claude.json (bail if missing).
 *   2. Delete `mcpServers.claudemesh` if present.
 *   3. Write back.
 *
 * Both are idempotent — re-running install is a no-op if the entry is
 * already correct, and uninstall is a no-op if no entry exists.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MCP_NAME = "claudemesh";
const CLAUDE_CONFIG = join(homedir(), ".claude.json");

type McpEntry = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

function readClaudeConfig(): Record<string, unknown> {
  if (!existsSync(CLAUDE_CONFIG)) return {};
  const text = readFileSync(CLAUDE_CONFIG, "utf-8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `failed to parse ${CLAUDE_CONFIG}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function writeClaudeConfig(obj: Record<string, unknown>): void {
  mkdirSync(dirname(CLAUDE_CONFIG), { recursive: true });
  writeFileSync(
    CLAUDE_CONFIG,
    JSON.stringify(obj, null, 2) + "\n",
    "utf-8",
  );
  try {
    chmodSync(CLAUDE_CONFIG, 0o600);
  } catch {
    /* windows has no chmod */
  }
}

/** Check `bun` is on PATH — OS-agnostic. */
function bunAvailable(): boolean {
  const which =
    platform() === "win32"
      ? Bun.spawnSync(["where", "bun"])
      : Bun.spawnSync(["sh", "-c", "command -v bun"]);
  return which.exitCode === 0;
}

/** Absolute path to this CLI's entry file. */
function resolveEntry(): string {
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), "..", "index.ts");
}

function buildMcpEntry(entryPath: string): McpEntry {
  return {
    command: "bun",
    args: [entryPath, "mcp"],
  };
}

function entriesEqual(a: McpEntry, b: McpEntry): boolean {
  return (
    a.command === b.command &&
    JSON.stringify(a.args ?? []) === JSON.stringify(b.args ?? [])
  );
}

export function runInstall(): void {
  console.log("claudemesh install");
  console.log("------------------");

  if (!bunAvailable()) {
    console.error(
      "✗ `bun` is not on PATH. Install Bun first: https://bun.com",
    );
    process.exit(1);
  }

  const entry = resolveEntry();
  if (!existsSync(entry)) {
    console.error(`✗ MCP entry not found at ${entry}`);
    process.exit(1);
  }

  const cfg = readClaudeConfig();
  const servers =
    ((cfg.mcpServers ??= {}) as Record<string, McpEntry>) ?? {};
  const desired = buildMcpEntry(entry);
  const existing = servers[MCP_NAME];
  let action: "added" | "updated" | "unchanged";
  if (!existing) {
    servers[MCP_NAME] = desired;
    action = "added";
  } else if (entriesEqual(existing, desired)) {
    action = "unchanged";
  } else {
    servers[MCP_NAME] = desired;
    action = "updated";
  }
  cfg.mcpServers = servers;

  writeClaudeConfig(cfg);

  // Read-back verification.
  const verify = readClaudeConfig();
  const verifyServers = (verify.mcpServers ?? {}) as Record<string, McpEntry>;
  const stored = verifyServers[MCP_NAME];
  if (!stored || !entriesEqual(stored, desired)) {
    console.error(
      `✗ post-write verification failed — ${CLAUDE_CONFIG} may be corrupt`,
    );
    process.exit(1);
  }

  console.log(`✓ MCP server "${MCP_NAME}" ${action}`);
  console.log(`  config:  ${CLAUDE_CONFIG}`);
  console.log(`  command: bun ${entry} mcp`);
  console.log("");
  console.log("Restart Claude Code to load the MCP server.");
  console.log("Then join a mesh:");
  console.log("");
  console.log("  claudemesh join <invite-link>");
}

export function runUninstall(): void {
  console.log("claudemesh uninstall");
  console.log("--------------------");
  if (!existsSync(CLAUDE_CONFIG)) {
    console.log(`· no ${CLAUDE_CONFIG} — nothing to remove`);
    return;
  }
  const cfg = readClaudeConfig();
  const servers = cfg.mcpServers as
    | Record<string, McpEntry>
    | undefined;
  if (!servers || !(MCP_NAME in servers)) {
    console.log(`· MCP server "${MCP_NAME}" not present — nothing to remove`);
    return;
  }
  delete servers[MCP_NAME];
  cfg.mcpServers = servers;
  writeClaudeConfig(cfg);
  console.log(`✓ MCP server "${MCP_NAME}" removed`);
  console.log("Restart Claude Code to drop the MCP connection.");
}
