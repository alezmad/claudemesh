/**
 * Process-info helpers used by the session reaper to detect dead-pid AND
 * pid-reuse safely.
 *
 * `process.kill(pid, 0)` alone is insufficient: a recently-recycled pid
 * passes the liveness check even though the process registered under it
 * is long gone. To avoid mistakenly trusting a recycled pid, we capture
 * a stable per-process start-time at register, and compare it on each
 * sweep — if it changed, treat the original process as dead.
 *
 * macOS + Linux both expose `ps -o lstart=` returning a fixed-format
 * timestamp ("Sun May  4 09:14:00 2026"). Equality is the only operation
 * the reaper needs, so we keep the value as an opaque string.
 */

import { execFileSync } from "node:child_process";

/**
 * Returns a stable process-start identifier for `pid`, or null if the
 * process is dead or unreachable. Cheap (~1 ms per call) — safe to use
 * inside the 5-second reaper sweep.
 */
export function getProcessStartTime(pid: number): string | null {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 1_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Liveness-only probe (signal 0). Use together with start-time guard. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
