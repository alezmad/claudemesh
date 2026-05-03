import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { DAEMON_PATHS } from "./paths.js";

/**
 * Single-instance lock via PID file. Returns:
 *   - 'acquired'      — we hold the lock now, file written.
 *   - 'already-running' — another live process owns it.
 *   - 'stale'         — file existed but the recorded PID is dead;
 *                       caller should treat as acquired (we overwrote it).
 */
export type LockResult = "acquired" | "already-running" | "stale";

export function acquireSingletonLock(): { result: LockResult; pid: number } {
  mkdirSync(dirname(DAEMON_PATHS.PID_FILE), { recursive: true, mode: 0o700 });

  if (existsSync(DAEMON_PATHS.PID_FILE)) {
    const raw = readFileSync(DAEMON_PATHS.PID_FILE, "utf8").trim();
    const oldPid = Number.parseInt(raw, 10);
    if (Number.isFinite(oldPid) && oldPid > 0 && isProcessAlive(oldPid)) {
      return { result: "already-running", pid: oldPid };
    }
    // stale → unlink and re-acquire
    try { unlinkSync(DAEMON_PATHS.PID_FILE); } catch { /* race with another acquirer; tolerate */ }
    writeFileSync(DAEMON_PATHS.PID_FILE, String(process.pid), { mode: 0o600 });
    return { result: "stale", pid: process.pid };
  }

  writeFileSync(DAEMON_PATHS.PID_FILE, String(process.pid), { mode: 0o600 });
  return { result: "acquired", pid: process.pid };
}

export function releaseSingletonLock(): void {
  try {
    const raw = readFileSync(DAEMON_PATHS.PID_FILE, "utf8").trim();
    if (Number.parseInt(raw, 10) === process.pid) unlinkSync(DAEMON_PATHS.PID_FILE);
  } catch { /* file already gone, fine */ }
}

export function readRunningPid(): number | null {
  try {
    const raw = readFileSync(DAEMON_PATHS.PID_FILE, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    if (Number.isFinite(pid) && pid > 0 && isProcessAlive(pid)) return pid;
  } catch { /* no pid file */ }
  return null;
}

function isProcessAlive(pid: number): boolean {
  try {
    // signal 0: no-op; throws if process doesn't exist or we lack permission.
    // EPERM means it does exist (just not ours), so treat as alive.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
