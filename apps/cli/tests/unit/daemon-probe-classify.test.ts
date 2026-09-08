/**
 * 1.37.1 — `classifyProbeFailure`: a slow-but-live daemon must never be
 * classified "stale" (which unlinks its socket + pid file and lets the
 * CLI auto-spawn a second daemon). Spec Addendum 6.
 */
import { describe, expect, test } from "vitest";
import { classifyProbeFailure } from "~/services/daemon/lifecycle.js";

describe("classifyProbeFailure", () => {
  test("connection refused → stale regardless of pid", () => {
    expect(classifyProbeFailure("Error: connect ECONNREFUSED", true)).toBe("stale");
    expect(classifyProbeFailure("Error: connect ECONNREFUSED", false)).toBe("stale");
  });
  test("socket path vanished (ENOENT) → stale", () => {
    expect(classifyProbeFailure("Error: connect ENOENT /x/daemon.sock", true)).toBe("stale");
  });
  test("timeout with a live pid → busy (files must be left alone)", () => {
    expect(classifyProbeFailure("ipc_timeout", true)).toBe("busy");
  });
  test("timeout with a dead/missing pid → stale", () => {
    expect(classifyProbeFailure("ipc_timeout", false)).toBe("stale");
  });
  test("non-200 answer from a live daemon → busy", () => {
    expect(classifyProbeFailure("ipc_error_500", true)).toBe("busy");
  });
  test("EPIPE/ECONNRESET with live pid → busy, without → stale", () => {
    expect(classifyProbeFailure("read ECONNRESET", true)).toBe("busy");
    expect(classifyProbeFailure("write EPIPE", false)).toBe("stale");
  });
});
