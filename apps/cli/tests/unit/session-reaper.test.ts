/**
 * Session reaper — PID-watcher autoclean (1.31.0).
 *
 * Verifies that registry entries are dropped when:
 *   1. their pid is no longer alive,
 *   2. their pid is alive but its start-time changed since register
 *      (PID reuse — original process gone, OS recycled the number).
 *
 * The reaper is the autoclean source-of-truth: process-exit IPC from
 * the launched session is best-effort (skipped on SIGKILL, OOM, hard
 * crash, kernel panic) so this sweep is what actually keeps the
 * broker presence honest. Both signals must work or stale "ghost"
 * sessions linger on the broker.
 */

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  _resetRegistry,
  _runReaperOnce,
  listSessions,
  registerSession,
  setRegistryHooks,
  type SessionInfo,
} from "../../src/daemon/session-registry.js";

afterEach(() => {
  _resetRegistry();
  vi.restoreAllMocks();
});

describe("session reaper", () => {
  test("drops entry when pid is dead", async () => {
    const onDeregister = vi.fn();
    setRegistryHooks({ onDeregister });

    // Use a high pid that is exceedingly unlikely to be alive on any
    // host — the alive check uses signal 0 which returns ESRCH for
    // unused pids.
    registerSession({
      token: "a".repeat(64),
      sessionId: "sess-dead",
      mesh: "m",
      displayName: "x",
      pid: 999_999,
      startTime: "Fri May  1 09:00:00 2026",
    });
    expect(listSessions()).toHaveLength(1);

    await _runReaperOnce();

    expect(listSessions()).toHaveLength(0);
    expect(onDeregister).toHaveBeenCalledTimes(1);
    const arg = onDeregister.mock.calls[0]![0] as SessionInfo;
    expect(arg.sessionId).toBe("sess-dead");
  });

  test("keeps entry when pid is alive and start-time matches", async () => {
    const onDeregister = vi.fn();
    setRegistryHooks({ onDeregister });

    // Use the test runner's own pid (process.pid is always alive here)
    // and capture its real start-time so the start-time guard sees a
    // match. Pre-seed startTime so registerSession's async ps probe
    // doesn't race the test.
    const { execFileSync } = require("node:child_process");
    const realStart = execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], {
      encoding: "utf8",
    }).trim();

    registerSession({
      token: "b".repeat(64),
      sessionId: "sess-live",
      mesh: "m",
      displayName: "x",
      pid: process.pid,
      startTime: realStart,
    });

    await _runReaperOnce();

    expect(listSessions()).toHaveLength(1);
    expect(onDeregister).not.toHaveBeenCalled();
  });

  test("drops entry when pid is alive but start-time mismatched (PID reuse)", async () => {
    const onDeregister = vi.fn();
    setRegistryHooks({ onDeregister });

    // Pid IS alive (process.pid) but we register a fake start-time
    // that won't match. Reaper must reap.
    registerSession({
      token: "c".repeat(64),
      sessionId: "sess-reused",
      mesh: "m",
      displayName: "x",
      pid: process.pid,
      startTime: "Sat Jan  1 00:00:00 1980",
    });

    await _runReaperOnce();

    expect(listSessions()).toHaveLength(0);
    expect(onDeregister).toHaveBeenCalledTimes(1);
  });

  test("keeps entry when start-time wasn't captured (best-effort fallback)", async () => {
    const onDeregister = vi.fn();
    setRegistryHooks({ onDeregister });

    // Register without startTime → reaper falls back to bare liveness.
    // process.pid is alive, so the entry must survive. (The fire-and-
    // forget capture inside registerSession will eventually populate
    // startTime, but it does so after a real fork — for this test we
    // rely on the synchronous reaper pass not seeing it yet.)
    registerSession({
      token: "d".repeat(64),
      sessionId: "sess-no-start-" + Math.random().toString(36).slice(2),
      mesh: "m",
      displayName: "x",
      pid: process.pid,
    });

    await _runReaperOnce();

    expect(listSessions()).toHaveLength(1);
    expect(onDeregister).not.toHaveBeenCalled();
  });
});
