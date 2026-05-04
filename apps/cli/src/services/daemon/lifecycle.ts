/**
 * Daemon lifecycle helper — probe, auto-spawn, retry, fall-through.
 *
 * Every daemon-routed CLI verb passes through `ensureDaemonReady()` before
 * its IPC call. The helper:
 *
 *   1. Probes the socket via a fast `/v1/version` IPC (~5-10 ms).
 *   2. If the socket is missing OR present-but-stale, attempts a detached
 *      `claudemesh daemon up` spawn under a file-lock.
 *   3. Polls for the new socket up to a budget (default 3s).
 *   4. Returns a state describing what happened, so the caller can either
 *      proceed warm or fall back to the cold path with a clear warning.
 *
 * State machine:
 *   - "up"               daemon was already running
 *   - "started"          daemon was down; we spawned it; it came up
 *   - "down"             daemon was down; auto-spawn skipped (e.g., recursion guard)
 *   - "spawn-failed"     spawn attempted but socket never appeared within budget
 *   - "spawn-suppressed" recently-failed marker is fresh; skipped retry
 *
 * Stale-socket handling: if the socket file exists but the IPC probe
 * fails (ECONNREFUSED / timeout), we treat the file as stale, remove
 * it, and proceed as if the daemon were down. This fixes the prior bug
 * where `existsSync(SOCK_FILE)` was a false positive after a daemon
 * crash.
 *
 * Recursion guard: when we spawn the daemon we set
 * `CLAUDEMESH_INTERNAL_NO_AUTOSPAWN=1` in its env so any nested CLI
 * calls inside the daemon skip the auto-spawn check and avoid a loop.
 */

import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ipc, IpcError } from "~/daemon/ipc/client.js";
import { DAEMON_PATHS } from "~/daemon/paths.js";

export type DaemonReadyState =
  | "up"
  | "started"
  | "down"
  | "spawn-failed"
  | "spawn-suppressed"
  /** 1.31.0+: launchd / systemd manages the daemon and it didn't respond
   *  within the service budget. Distinct from spawn-failed: the CLI did
   *  not attempt to spawn (the OS owns the lifecycle). */
  | "service-not-ready";

export interface EnsureDaemonResult {
  state: DaemonReadyState;
  /** Total ms spent in this call (probe ± spawn ± poll). */
  durationMs: number;
  /** When state is `spawn-failed` or `spawn-suppressed`, a one-line reason. */
  reason?: string;
}

export interface EnsureDaemonOpts {
  /** Total budget for socket-appearance polling after spawn. Default 3000ms. */
  budgetMs?: number;
  /** Skip auto-spawn entirely. Used by `--no-daemon` and the recursion guard. */
  noAutoSpawn?: boolean;
  /** When auto-spawning a legacy single-mesh daemon, pin a slug. Omit for multi-mesh (default). */
  mesh?: string;
}

const SPAWN_LOCK_FILE  = () => join(DAEMON_PATHS.DAEMON_DIR, ".spawn.lock");
const SPAWN_FAIL_FILE  = () => join(DAEMON_PATHS.DAEMON_DIR, ".spawn-failure");
const SPAWN_FAIL_TTL_MS = 30_000;
// 1.31.0: 800 ms was too tight — the daemon's first IPC after a launchd
// (re)start can take a beat while it migrates SQLite, opens broker WSes,
// and warms up the event loop. False "stale" probes triggered the
// pointless spawn → "socket did not appear" warning even on a perfectly
// healthy service-managed daemon. 2500 ms still bounds the worst case.
const PROBE_TIMEOUT_MS  = 2_500;
// When the daemon is service-managed (launchd/systemd) and KeepAlive=true,
// the OS guarantees a restart on death — the CLI must NOT race that with
// its own spawn. Just wait longer for the service unit to come up.
const SERVICE_BUDGET_MS = 8_000;

let lastResultThisProcess: EnsureDaemonResult | null = null;

/** Probe daemon and return what we know. Cached per-process so a script
 *  with 50 sends doesn't re-spawn 50 times. */
export async function ensureDaemonReady(opts: EnsureDaemonOpts = {}): Promise<EnsureDaemonResult> {
  if (lastResultThisProcess && (lastResultThisProcess.state === "up" || lastResultThisProcess.state === "started")) {
    return lastResultThisProcess;
  }
  if (process.env.CLAUDEMESH_INTERNAL_NO_AUTOSPAWN === "1") {
    opts = { ...opts, noAutoSpawn: true };
  }
  const result = await runEnsureDaemon(opts);
  lastResultThisProcess = result;
  return result;
}

/** Reset the per-process cache. Test helper. */
export function _resetDaemonReadyCache(): void {
  lastResultThisProcess = null;
}

async function runEnsureDaemon(opts: EnsureDaemonOpts): Promise<EnsureDaemonResult> {
  const t0 = Date.now();

  // Step 1 — probe.
  const probe = await probeDaemon();
  if (probe === "up") return { state: "up", durationMs: Date.now() - t0 };

  // Step 2 — service-managed shortcut. When launchd / systemd manages
  // the daemon and KeepAlive is set, the OS will restart a crashed
  // daemon on its own; the CLI must NOT race that with its own spawn
  // (would double-bind the singleton lock and trigger "daemon already
  // running" errors). Just wait quietly for the service to bring the
  // socket up.
  if (isServiceManaged()) {
    if (probe === "stale") cleanupStaleFiles();
    const polled = await pollForSocket(SERVICE_BUDGET_MS);
    if (polled.ok) return { state: "up", durationMs: Date.now() - t0 };
    const tool = process.platform === "darwin"
      ? `launchctl print gui/$(id -u)/${SERVICE_LABEL}`
      : `systemctl --user status ${SYSTEMD_UNIT}`;
    return {
      state: "service-not-ready",
      durationMs: Date.now() - t0,
      reason: `service-managed daemon not responding within ${SERVICE_BUDGET_MS}ms (run \`${tool}\`)`,
    };
  }

  if (probe === "stale") cleanupStaleFiles();

  // Step 3 — auto-spawn unless forbidden.
  if (opts.noAutoSpawn) {
    return { state: "down", durationMs: Date.now() - t0, reason: "auto-spawn disabled" };
  }
  if (recentSpawnFailureFresh()) {
    return {
      state: "spawn-suppressed",
      durationMs: Date.now() - t0,
      reason: `daemon failed to start within last ${Math.round(SPAWN_FAIL_TTL_MS / 1000)}s`,
    };
  }

  // Step 4 — spawn detached.
  const spawnRes = await spawnDaemon(opts);
  if (spawnRes.ok) {
    return { state: "started", durationMs: Date.now() - t0 };
  }

  // Step 5 — record failure for backoff and report.
  markSpawnFailure();
  return { state: "spawn-failed", durationMs: Date.now() - t0, reason: spawnRes.reason };
}

const SERVICE_LABEL = "com.claudemesh.daemon";
const SYSTEMD_UNIT = "claudemesh-daemon.service";

/**
 * Returns true when the user has installed the daemon as a launchd
 * agent (macOS) or systemd --user unit (Linux). We detect by file
 * presence rather than shelling out to launchctl/systemctl on every
 * CLI invocation — this stays cheap and avoids spurious permission
 * prompts on locked-down hosts.
 */
function isServiceManaged(): boolean {
  if (process.platform === "darwin") {
    return existsSync(join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`));
  }
  if (process.platform === "linux") {
    return existsSync(join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT));
  }
  return false;
}

async function probeDaemon(): Promise<"up" | "absent" | "stale"> {
  if (!existsSync(DAEMON_PATHS.SOCK_FILE)) return "absent";
  try {
    const res = await ipc<{ version?: string }>({ path: "/v1/version", timeoutMs: PROBE_TIMEOUT_MS });
    if (res.status === 200) return "up";
    return "stale";
  } catch (err) {
    if (err instanceof IpcError) return "stale";
    const msg = String(err);
    if (/ENOENT|ECONNREFUSED|ipc_timeout|EPIPE|ECONNRESET/.test(msg)) return "stale";
    return "stale";
  }
}

function cleanupStaleFiles(): void {
  for (const p of [DAEMON_PATHS.SOCK_FILE, DAEMON_PATHS.PID_FILE]) {
    try { unlinkSync(p); } catch { /* best-effort */ }
  }
}

function recentSpawnFailureFresh(): boolean {
  try {
    const st = statSync(SPAWN_FAIL_FILE());
    return Date.now() - st.mtimeMs < SPAWN_FAIL_TTL_MS;
  } catch {
    return false;
  }
}

function markSpawnFailure(): void {
  try { writeFileSync(SPAWN_FAIL_FILE(), String(Date.now()), { mode: 0o600 }); } catch { /* best-effort */ }
}

function clearSpawnFailure(): void {
  try { unlinkSync(SPAWN_FAIL_FILE()); } catch { /* best-effort */ }
}

interface SpawnResult { ok: boolean; reason?: string; }

async function spawnDaemon(opts: EnsureDaemonOpts): Promise<SpawnResult> {
  const lockResult = await acquireOrShareLock(opts);
  if (lockResult === "wait-existing") {
    // Another process is spawning; just wait for the socket to appear.
    return await pollForSocket(opts.budgetMs ?? 3_000);
  }

  try {
    const { spawn } = await import("node:child_process");
    const binary = await resolveCliBinary();
    // 1.34.12: pass --foreground because the lifecycle helper IS the
    // detacher in this path — it spawns with detached:true + stdio:
    // ignore. If we let the child re-detach (the new default), we'd
    // double-fork and orphan the grandchild. --mesh is dropped (1.34.10
    // deprecation; daemon attaches to every joined mesh).
    const args = ["daemon", "up", "--foreground"];

    const child = spawn(binary, args, {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, CLAUDEMESH_INTERNAL_NO_AUTOSPAWN: "1" },
    });
    child.unref();

    const polled = await pollForSocket(opts.budgetMs ?? 3_000);
    if (polled.ok) clearSpawnFailure();
    return polled;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    releaseLock();
  }
}

/** Acquire spawn lock. If another process holds it AND its pid is alive,
 *  return "wait-existing" so we share that spawn attempt. If the pid is
 *  dead, take over the lock. */
async function acquireOrShareLock(_opts: EnsureDaemonOpts): Promise<"acquired" | "wait-existing"> {
  const lockPath = SPAWN_LOCK_FILE();
  if (existsSync(lockPath)) {
    try {
      const pidStr = readFileSync(lockPath, "utf8").trim();
      const pid = Number.parseInt(pidStr, 10);
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, 0); // signal 0 = liveness probe
          return "wait-existing";
        } catch {
          // Holder is dead — fall through to take over.
        }
      }
    } catch { /* unreadable lock — take over */ }
  }
  try {
    writeFileSync(lockPath, String(process.pid), { mode: 0o600 });
  } catch { /* best-effort; lock is advisory */ }
  return "acquired";
}

function releaseLock(): void {
  try { unlinkSync(SPAWN_LOCK_FILE()); } catch { /* best-effort */ }
}

async function pollForSocket(budgetMs: number): Promise<SpawnResult> {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    if (existsSync(DAEMON_PATHS.SOCK_FILE)) {
      // Don't just trust file presence — confirm it answers.
      const probe = await probeDaemon();
      if (probe === "up") return { ok: true };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { ok: false, reason: `socket did not appear within ${budgetMs}ms` };
}

/** Resolve the absolute path to the `claudemesh` binary the user is running.
 *  When invoked via tsx/bun in dev, fall back to the system `claudemesh`. */
async function resolveCliBinary(): Promise<string> {
  const argv1 = process.argv[1] ?? "claudemesh";
  if (/\.ts$/.test(argv1) || /node_modules|src\/entrypoints/.test(argv1)) {
    try {
      const { execSync } = await import("node:child_process");
      return execSync("which claudemesh", { encoding: "utf8" }).trim() || "claudemesh";
    } catch {
      return "claudemesh";
    }
  }
  return argv1;
}
