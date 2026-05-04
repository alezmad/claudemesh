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
 * timestamp ("Sun May  4 09:14:00 2026"). Equality is the only
 * operation the reaper needs, so we keep the value as an opaque string.
 *
 * IMPORTANT (1.31.1): every fork / execFile blocks the daemon's event
 * loop until ps completes (~30-80 ms per call on macOS). The first
 * 1.31.0 implementation called execFileSync once per registered
 * session every 5 s, and with 10+ sessions that stalled IPC for hundreds
 * of milliseconds at a time — long enough that probes against
 * /v1/version were declared "stale" and the CLI fell back to the cold
 * path with the misleading "service-managed daemon not responding"
 * warning. This module now exposes:
 *
 *   - `getProcessStartTime(pid)`: async, single-pid, used at register.
 *   - `getProcessStartTimes(pids)`: async, batched, used by the reaper.
 *     One ps invocation handles N pids, so the per-sweep cost is fixed
 *     and tiny regardless of how many sessions are registered.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Returns a stable process-start identifier for `pid`, or null if the
 * process is dead or unreachable. Async — never blocks the event loop.
 */
export async function getProcessStartTime(pid: number): Promise<string | null> {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 1_000,
    });
    const out = stdout.trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Batched form: returns a Map<pid, lstart> for every pid that is still
 * alive. Pids that ps doesn't return (i.e. dead) are absent from the
 * map. One ps fork handles all pids — O(1) sweep cost regardless of
 * session count.
 */
export async function getProcessStartTimes(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const valid = pids.filter((p) => Number.isFinite(p) && p > 0);
  if (valid.length === 0) return result;
  // ps -o pid,lstart= -p p1,p2,...  emits one row per live pid:
  //   "  12345 Sun May  4 09:14:00 2026"
  // Dead pids are silently omitted.
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-o", "pid=,lstart=", "-p", valid.join(",")],
      { encoding: "utf8", timeout: 2_000 },
    );
    for (const raw of stdout.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const m = /^(\d+)\s+(.+)$/.exec(line);
      if (!m) continue;
      const pid = Number.parseInt(m[1]!, 10);
      const lstart = m[2]!.trim();
      if (Number.isFinite(pid) && lstart.length > 0) result.set(pid, lstart);
    }
  } catch {
    // ps failure (timeout, ENOENT) — treat as "no info available" and
    // let the reaper fall back to bare liveness for these pids. Better
    // to keep entries than to nuke them on a transient ps error.
  }
  return result;
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
