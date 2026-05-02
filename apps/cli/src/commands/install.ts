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
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readConfig } from "~/services/config/facade.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim, yellow } from "~/ui/styles.js";

const MCP_NAME = "claudemesh";
const CLAUDE_CONFIG = join(homedir(), ".claude.json");
const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");
const HOOK_COMMAND_STOP = "claudemesh hook idle";
const HOOK_COMMAND_USER_PROMPT = "claudemesh hook working";
const HOOK_MARKER = "claudemesh hook ";

type McpEntry = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

interface HookCommand {
  type: "command";
  command: string;
}
interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}
type HooksConfig = Record<string, HookMatcher[]>;

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

/**
 * Create a timestamped backup of ~/.claude.json before any write.
 */
function backupClaudeConfig(): void {
  if (!existsSync(CLAUDE_CONFIG)) return;
  const backupDir = join(dirname(CLAUDE_CONFIG), ".claude", "backups");
  mkdirSync(backupDir, { recursive: true });
  const ts = Date.now();
  const dest = join(backupDir, `.claude.json.pre-claudemesh.${ts}`);
  copyFileSync(CLAUDE_CONFIG, dest);
}

/**
 * Atomic read-merge-write: re-reads ~/.claude.json at write time and
 * patches ONLY the `claudemesh` MCP entry. Never touches other keys.
 * Returns the action taken ("added" | "updated" | "unchanged").
 */
function patchMcpServer(entry: McpEntry): "added" | "updated" | "unchanged" {
  backupClaudeConfig();
  const cfg = readClaudeConfig();
  const servers =
    ((cfg.mcpServers as Record<string, McpEntry>) ?? {});
  if (!cfg.mcpServers) cfg.mcpServers = servers;

  const existing = servers[MCP_NAME];
  let action: "added" | "updated" | "unchanged";
  if (!existing) {
    servers[MCP_NAME] = entry;
    action = "added";
  } else if (entriesEqual(existing, entry)) {
    return "unchanged";
  } else {
    servers[MCP_NAME] = entry;
    action = "updated";
  }

  flushClaudeConfig(cfg);
  return action;
}

/**
 * Atomic read-merge-write: re-reads ~/.claude.json at write time and
 * removes ONLY the `claudemesh` MCP entry. Never touches other keys.
 * Returns true if an entry was removed.
 */
function removeMcpServer(): boolean {
  if (!existsSync(CLAUDE_CONFIG)) return false;
  backupClaudeConfig();
  const cfg = readClaudeConfig();
  const servers = cfg.mcpServers as Record<string, McpEntry> | undefined;
  if (!servers || !(MCP_NAME in servers)) return false;
  delete servers[MCP_NAME];
  cfg.mcpServers = servers;
  flushClaudeConfig(cfg);
  return true;
}

/** Low-level write — callers must backup + merge first. */
function flushClaudeConfig(obj: Record<string, unknown>): void {
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


/** Check `bun` is on PATH — OS-agnostic, node:child_process. */
function bunAvailable(): boolean {
  const res =
    platform() === "win32"
      ? spawnSync("where", ["bun"])
      : spawnSync("sh", ["-c", "command -v bun"]);
  return res.status === 0;
}

/** Is this file running from a bundled `dist/` directory? */
function isBundledFile(p: string): boolean {
  // Match any file under dist/ — e.g. dist/index.js or dist/entrypoints/cli.js.
  return /[/\\]dist[/\\]/.test(p);
}

/** Absolute path to this CLI's entry file. */
function resolveEntry(): string {
  const here = fileURLToPath(import.meta.url);
  // Bundled: this file IS reachable as the entry; return self.
  // Source: walk up to apps/cli/src/index.ts (legacy) or fall back.
  if (isBundledFile(here)) return here;
  return resolve(dirname(here), "..", "index.ts");
}

/** Find the bundled `skills/` directory at install time. Walks up from
 * the entry file: dist/entrypoints/cli.js → dist/ → package root → skills/. */
function resolveBundledSkillsDir(): string | null {
  const here = fileURLToPath(import.meta.url);
  // Bundled: <pkg>/dist/entrypoints/cli.js → walk up two levels to <pkg>
  // Source:  <pkg>/src/commands/install.ts → walk up two levels to <pkg>
  const pkgRoot = resolve(dirname(here), "..", "..");
  const skillsDir = join(pkgRoot, "skills");
  if (existsSync(skillsDir)) return skillsDir;
  return null;
}

/** ~/.claude/skills/ — where Claude Code looks for user-scoped skills. */
const CLAUDE_SKILLS_ROOT = join(homedir(), ".claude", "skills");

/**
 * Copy bundled skills into ~/.claude/skills/. Idempotent — overwrites
 * existing files (so updates flow through on `claudemesh install` re-run).
 * Returns the list of skill names installed.
 */
function installSkills(): string[] {
  const src = resolveBundledSkillsDir();
  if (!src) return [];
  // Each subdirectory of skills/ is one skill (matches Claude Code convention).
  const fs = require("node:fs") as typeof import("node:fs");
  const installed: string[] = [];
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const srcDir = join(src, entry.name);
    const dstDir = join(CLAUDE_SKILLS_ROOT, entry.name);
    mkdirSync(dstDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (!file.isFile()) continue;
      copyFileSync(join(srcDir, file.name), join(dstDir, file.name));
    }
    installed.push(entry.name);
  }
  return installed;
}

/** Remove claudemesh-shipped skills from ~/.claude/skills/. Returns names removed. */
function uninstallSkills(): string[] {
  const src = resolveBundledSkillsDir();
  if (!src) return [];
  const fs = require("node:fs") as typeof import("node:fs");
  const removed: string[] = [];
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dstDir = join(CLAUDE_SKILLS_ROOT, entry.name);
    if (existsSync(dstDir)) {
      try {
        fs.rmSync(dstDir, { recursive: true, force: true });
        removed.push(entry.name);
      } catch { /* best effort */ }
    }
  }
  return removed;
}

/**
 * Build the MCP server entry for Claude Code's config.
 *
 * Two modes:
 *   - Installed globally (npm i -g claudemesh-cli): use `claudemesh`
 *     as the command, relies on it being on PATH.
 *   - Local dev (bun apps/cli/src/index.ts): use `bun <absolute-path>`.
 */
function buildMcpEntry(entryPath: string): McpEntry {
  if (isBundledFile(entryPath)) {
    return {
      command: "claudemesh",
      args: ["mcp"],
    };
  }
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

function readClaudeSettings(): Record<string, unknown> {
  if (!existsSync(CLAUDE_SETTINGS)) return {};
  const text = readFileSync(CLAUDE_SETTINGS, "utf-8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `failed to parse ${CLAUDE_SETTINGS}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function writeClaudeSettings(obj: Record<string, unknown>): void {
  mkdirSync(dirname(CLAUDE_SETTINGS), { recursive: true });
  writeFileSync(
    CLAUDE_SETTINGS,
    JSON.stringify(obj, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * All claudemesh MCP tool names, prefixed for allowedTools.
 * These let Claude Code use claudemesh tools without --dangerously-skip-permissions.
 */
const CLAUDEMESH_TOOLS = [
  "mcp__claudemesh__cancel_scheduled",
  "mcp__claudemesh__check_messages",
  "mcp__claudemesh__claim_task",
  "mcp__claudemesh__complete_task",
  "mcp__claudemesh__create_stream",
  "mcp__claudemesh__create_task",
  "mcp__claudemesh__delete_file",
  "mcp__claudemesh__file_status",
  "mcp__claudemesh__forget",
  "mcp__claudemesh__get_context",
  "mcp__claudemesh__get_file",
  "mcp__claudemesh__get_state",
  "mcp__claudemesh__grant_file_access",
  "mcp__claudemesh__graph_execute",
  "mcp__claudemesh__graph_query",
  "mcp__claudemesh__join_group",
  "mcp__claudemesh__leave_group",
  "mcp__claudemesh__list_collections",
  "mcp__claudemesh__list_contexts",
  "mcp__claudemesh__list_files",
  "mcp__claudemesh__list_peers",
  "mcp__claudemesh__list_scheduled",
  "mcp__claudemesh__list_state",
  "mcp__claudemesh__list_streams",
  "mcp__claudemesh__list_tasks",
  "mcp__claudemesh__mesh_execute",
  "mcp__claudemesh__mesh_info",
  "mcp__claudemesh__mesh_query",
  "mcp__claudemesh__mesh_schema",
  "mcp__claudemesh__message_status",
  "mcp__claudemesh__ping_mesh",
  "mcp__claudemesh__publish",
  "mcp__claudemesh__recall",
  "mcp__claudemesh__remember",
  "mcp__claudemesh__schedule_reminder",
  "mcp__claudemesh__send_message",
  "mcp__claudemesh__set_state",
  "mcp__claudemesh__set_status",
  "mcp__claudemesh__set_summary",
  "mcp__claudemesh__share_context",
  "mcp__claudemesh__share_file",
  "mcp__claudemesh__subscribe",
  "mcp__claudemesh__vector_delete",
  "mcp__claudemesh__vector_search",
  "mcp__claudemesh__vector_store",
];

/**
 * Pre-approve all claudemesh MCP tools in allowedTools.
 * Merges into any existing list — never overwrites other entries.
 * Returns which tools were added vs already present.
 */
function installAllowedTools(): { added: string[]; unchanged: number } {
  const settings = readClaudeSettings();
  const existing = new Set<string>((settings.allowedTools as string[] | undefined) ?? []);
  const toAdd = CLAUDEMESH_TOOLS.filter((t) => !existing.has(t));
  if (toAdd.length > 0) {
    settings.allowedTools = [...Array.from(existing), ...toAdd];
    writeClaudeSettings(settings);
  }
  return { added: toAdd, unchanged: CLAUDEMESH_TOOLS.length - toAdd.length };
}

/**
 * Remove claudemesh tools from allowedTools.
 * Leaves all other entries intact. Returns count removed.
 */
function uninstallAllowedTools(): number {
  if (!existsSync(CLAUDE_SETTINGS)) return 0;
  const settings = readClaudeSettings();
  const existing = (settings.allowedTools as string[] | undefined) ?? [];
  const toolSet = new Set(CLAUDEMESH_TOOLS);
  const kept = existing.filter((t) => !toolSet.has(t));
  const removed = existing.length - kept.length;
  if (removed > 0) {
    settings.allowedTools = kept;
    writeClaudeSettings(settings);
  }
  return removed;
}

/**
 * Add a Stop + UserPromptSubmit hook entry to ~/.claude/settings.json,
 * idempotent on the command string. Returns counts for reporting.
 */
function installHooks(): { added: number; unchanged: number } {
  const settings = readClaudeSettings();
  const hooks = ((settings.hooks ??= {}) as HooksConfig) ?? {};
  let added = 0;
  let unchanged = 0;

  const ensure = (event: string, command: string): void => {
    const list = (hooks[event] ??= []);
    const alreadyPresent = list.some((entry) =>
      (entry.hooks ?? []).some((h) => h.command === command),
    );
    if (alreadyPresent) {
      unchanged += 1;
      return;
    }
    list.push({ hooks: [{ type: "command", command }] });
    added += 1;
  };
  ensure("Stop", HOOK_COMMAND_STOP);
  ensure("UserPromptSubmit", HOOK_COMMAND_USER_PROMPT);

  settings.hooks = hooks;
  writeClaudeSettings(settings);
  return { added, unchanged };
}

/**
 * Remove every hook entry whose command contains "claudemesh hook "
 * from ~/.claude/settings.json. Idempotent. Returns removed count.
 */
function uninstallHooks(): number {
  if (!existsSync(CLAUDE_SETTINGS)) return 0;
  const settings = readClaudeSettings();
  const hooks = settings.hooks as HooksConfig | undefined;
  if (!hooks) return 0;
  let removed = 0;
  for (const event of Object.keys(hooks)) {
    const kept: HookMatcher[] = [];
    for (const entry of hooks[event] ?? []) {
      const filtered = (entry.hooks ?? []).filter(
        (h) => !(h.command ?? "").includes(HOOK_MARKER),
      );
      removed += (entry.hooks ?? []).length - filtered.length;
      if (filtered.length > 0) kept.push({ ...entry, hooks: filtered });
    }
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  settings.hooks = hooks;
  writeClaudeSettings(settings);
  return removed;
}

function installStatusLine(): { installed: boolean } {
  const settings = readClaudeSettings();
  const cmd = `claudemesh status-line`;
  const current = (settings as { statusLine?: { command?: string } }).statusLine;
  // If the user has their own statusLine command, don't clobber it.
  if (current?.command && !current.command.includes("claudemesh status-line")) {
    return { installed: false };
  }
  (settings as { statusLine?: { type: string; command: string } }).statusLine = {
    type: "command",
    command: cmd,
  };
  writeClaudeSettings(settings);
  return { installed: true };
}

export function runInstall(args: string[] = []): void {
  const skipHooks = args.includes("--no-hooks");
  const skipSkill = args.includes("--no-skill");
  const wantStatusLine = args.includes("--status-line");
  render.section("claudemesh install");

  const entry = resolveEntry();
  const bundled = isBundledFile(entry);

  if (!bundled && !bunAvailable()) {
    render.err("`bun` is not on PATH.", "Install Bun first: https://bun.com");
    process.exit(1);
  }
  if (!existsSync(entry)) {
    render.err(`MCP entry not found at ${entry}`);
    process.exit(1);
  }

  const desired = buildMcpEntry(entry);
  const action = patchMcpServer(desired);

  const verify = readClaudeConfig();
  const verifyServers = (verify.mcpServers ?? {}) as Record<string, McpEntry>;
  const stored = verifyServers[MCP_NAME];
  if (!stored || !entriesEqual(stored, desired)) {
    render.err("post-write verification failed", `${CLAUDE_CONFIG} may be corrupt`);
    process.exit(1);
  }

  render.ok(`MCP server "${bold(MCP_NAME)}" ${action}`);
  render.kv([
    ["config", dim(CLAUDE_CONFIG)],
    ["command", dim(`${desired.command}${desired.args?.length ? " " + desired.args.join(" ") : ""}`)],
  ]);

  try {
    const { added, unchanged } = installAllowedTools();
    if (added.length > 0) {
      render.ok(
        `allowedTools: ${added.length} claudemesh tools pre-approved`,
        unchanged > 0 ? `${unchanged} already present` : undefined,
      );
      render.info(dim("This lets claudemesh tools run without --dangerously-skip-permissions."));
      render.info(dim("Your existing allowedTools entries were preserved."));
    } else {
      render.ok(`allowedTools: all ${unchanged} claudemesh tools already pre-approved`);
    }
    render.info(dim(`  config:  ${CLAUDE_SETTINGS}`));
  } catch (e) {
    render.warn(`allowedTools update failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!skipHooks) {
    try {
      const { added, unchanged } = installHooks();
      if (added > 0) {
        render.ok(
          `Hooks registered (Stop + UserPromptSubmit)`,
          `${added} added, ${unchanged} already present`,
        );
      } else {
        render.ok(`Hooks already registered`, `${unchanged} present`);
      }
      render.info(dim(`  config:  ${CLAUDE_SETTINGS}`));
    } catch (e) {
      render.warn(
        `hook registration failed: ${e instanceof Error ? e.message : String(e)}`,
        "MCP is still installed — hooks just skip. Retry with --no-hooks to suppress.",
      );
    }
  } else {
    render.info(dim("· Hooks skipped (--no-hooks)"));
  }

  // Claude skill — discoverability replacement for the (now-empty) MCP
  // tool surface. Claude reads ~/.claude/skills/claudemesh/SKILL.md on
  // demand, learns every CLI verb, JSON shape, and gotcha. See spec
  // 2026-05-02 commitment #6.
  if (!skipSkill) {
    try {
      const installed = installSkills();
      if (installed.length > 0) {
        render.ok(
          `Claude skill${installed.length === 1 ? "" : "s"} installed`,
          installed.join(", "),
        );
        render.info(dim(`  ${join(CLAUDE_SKILLS_ROOT, installed[0]!)}/SKILL.md`));
      }
    } catch (e) {
      render.warn(`skill install failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    render.info(dim("· Skill install skipped (--no-skill)"));
  }

  if (wantStatusLine) {
    try {
      const { installed } = installStatusLine();
      if (installed) {
        render.ok(`Claude Code statusLine → ${clay("claudemesh status-line")}`);
        render.info(dim("  Shows: ◇ <mesh> · <online>/<total> online · <you>"));
      } else {
        render.info(dim("· statusLine already set to a custom command — left alone"));
      }
    } catch (e) {
      render.warn(`statusLine install failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let hasMeshes = false;
  try {
    const meshConfig = readConfig();
    hasMeshes = meshConfig.meshes.length > 0;
  } catch {}

  render.blank();
  render.warn(`${bold("RESTART CLAUDE CODE")} ${yellow("for MCP tools to appear.")}`);

  if (!hasMeshes) {
    render.blank();
    render.info(`${yellow("No meshes joined.")} To connect with peers:`);
    render.info(`  ${bold("claudemesh <invite-url>")}${dim("   — joins + launches in one step")}`);
    render.info(`  ${dim("Create one at")} ${bold("https://claudemesh.com/dashboard")}`);
  } else {
    render.blank();
    render.info(`Next: ${bold("claudemesh")}${dim("   — launch with your joined mesh")}`);
  }

  render.blank();
  render.info(dim("Optional:"));
  render.info(dim(`  claudemesh url-handler install   # click-to-launch from email`));
  render.info(dim(`  claudemesh install --status-line # live peer count in Claude Code`));
  render.info(dim(`  claudemesh completions zsh       # shell completions`));
}

export function runUninstall(): void {
  render.section("claudemesh uninstall");

  if (removeMcpServer()) {
    render.ok(`MCP server "${bold(MCP_NAME)}" removed`);
  } else {
    render.info(dim(`· MCP server "${MCP_NAME}" not present`));
  }

  try {
    const removed = uninstallAllowedTools();
    if (removed > 0) {
      render.ok(`allowedTools: ${removed} claudemesh tools removed`);
    } else {
      render.info(dim("· No claudemesh allowedTools to remove"));
    }
  } catch (e) {
    render.warn(`allowedTools removal failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const removed = uninstallHooks();
    if (removed > 0) {
      render.ok(`Hooks removed`, `${removed} entries`);
    } else {
      render.info(dim("· No claudemesh hooks to remove"));
    }
  } catch (e) {
    render.warn(`hook removal failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const removed = uninstallSkills();
    if (removed.length > 0) {
      render.ok(`Skill${removed.length === 1 ? "" : "s"} removed`, removed.join(", "));
    } else {
      render.info(dim("· No claudemesh skills to remove"));
    }
  } catch (e) {
    render.warn(`skill removal failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  render.blank();
  render.info("Restart Claude Code to drop the MCP connection + hooks.");
}
