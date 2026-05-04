import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();
const DEFAULT_CONFIG_DIR = join(home, ".claudemesh");

/**
 * Resolve `CONFIG_DIR` once, with stale-env detection.
 *
 * `claudemesh launch` exposes `CLAUDEMESH_CONFIG_DIR=<tmpdir>` to its
 * spawned `claude` so the per-session mesh selection is isolated from
 * `~/.claudemesh/config.json`. The tmpdir is rmSync'd on launch exit.
 *
 * Footgun: if a `claudemesh` invocation INHERITS that env from an
 * already-launched (or previously-launched) session — e.g. a Bash tool
 * call inside Claude Code, or a tmux pane that captured the env via
 * `update-environment` — the inherited path may point at a tmpdir that
 * no longer exists. Pre-1.34.14 we silently used the dead path,
 * `readConfig()` came back empty, and the user saw "No meshes joined"
 * from an otherwise-working install.
 *
 * Resolution rules:
 *   1. No env var       → `~/.claudemesh` (default).
 *   2. Env points at a dir containing `config.json` → trust it
 *      (the legitimate per-session-launch case).
 *   3. Env set but stale (dir missing or no `config.json`) → warn
 *      once on stderr (TTY-only) and fall back to `~/.claudemesh`.
 *
 * Memoized: resolves once on first access. Mid-process env mutations
 * are intentionally ignored — paths must stay stable across one CLI
 * invocation.
 */
let _resolvedConfigDir: string | null = null;
let _warnedStaleEnv = false;

function resolveConfigDir(): string {
  if (_resolvedConfigDir !== null) return _resolvedConfigDir;
  const envDir = process.env.CLAUDEMESH_CONFIG_DIR;
  if (!envDir) {
    _resolvedConfigDir = DEFAULT_CONFIG_DIR;
    return DEFAULT_CONFIG_DIR;
  }
  // Trust the env when it resolves to a real directory. We check
  // the DIR (not `config.json`) because the legitimate "fresh launch
  // before any write" case has the dir but no config.json yet.
  // The stale signature we want to catch is `rmSync(tmpDir,
  // {recursive: true})` from the outer launch's cleanup — that
  // removes the directory entirely, so a missing dir is the
  // unambiguous "stale" signal.
  if (existsSync(envDir)) {
    _resolvedConfigDir = envDir;
    return envDir;
  }
  // Stale: env set but the dir is gone. Most likely the outer
  // launch's cleanup ran and we inherited its (now-dead) tmpdir
  // path. Fall back to default and warn the user once on stderr —
  // only when attached to a TTY, so non-interactive callers (CI,
  // MCP boot, scripts piping stdout) stay quiet.
  if (!_warnedStaleEnv && process.stderr.isTTY) {
    _warnedStaleEnv = true;
    const unsetHint =
      process.env.SHELL?.endsWith("fish")
        ? "set -e CLAUDEMESH_CONFIG_DIR CLAUDEMESH_IPC_TOKEN_FILE"
        : "unset CLAUDEMESH_CONFIG_DIR CLAUDEMESH_IPC_TOKEN_FILE";
    process.stderr.write(
      `claudemesh: ignoring stale CLAUDEMESH_CONFIG_DIR=${envDir} (no config.json there); using ${DEFAULT_CONFIG_DIR}.\n`
        + `  Hint: this is usually a leftover env from a previous \`claudemesh launch\`. Clean it with:\n`
        + `    ${unsetHint}\n`,
    );
  }
  _resolvedConfigDir = DEFAULT_CONFIG_DIR;
  return DEFAULT_CONFIG_DIR;
}

export const PATHS = {
  get CONFIG_DIR() {
    return resolveConfigDir();
  },
  get CONFIG_FILE() {
    return join(this.CONFIG_DIR, "config.json");
  },
  get AUTH_FILE() {
    return join(this.CONFIG_DIR, "auth.json");
  },
  get KEYS_DIR() {
    return join(this.CONFIG_DIR, "keys");
  },
  get LAST_USED_FILE() {
    return join(this.CONFIG_DIR, "last-used.json");
  },
  CLAUDE_JSON: join(home, ".claude.json"),
  CLAUDE_SETTINGS: join(home, ".claude", "settings.json"),
} as const;

/**
 * Test-only: reset the memoized resolution. Not exported from the
 * package barrel; reach in via the relative path from a test file.
 */
export function _resetPathsForTest(): void {
  _resolvedConfigDir = null;
  _warnedStaleEnv = false;
}
