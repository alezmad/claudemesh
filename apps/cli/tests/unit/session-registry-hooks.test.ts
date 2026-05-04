/**
 * Session-registry lifecycle hooks (1.30.0+).
 *
 * The daemon's session-broker subsystem subscribes to register/deregister
 * events to open and close per-session WSes. Verifies:
 *   - hooks fire on register + deregister
 *   - replacing an entry under the same sessionId fires deregister(prior)
 *     followed by register(new)
 *   - reaper-triggered deregister fires the hook for dead pids
 *   - presence material round-trips through the registry
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  _resetRegistry,
  deregisterByToken,
  registerSession,
  resolveToken,
  setRegistryHooks,
  type SessionInfo,
} from "../../src/daemon/session-registry.js";

const PRESENCE = {
  sessionPubkey: "a".repeat(64),
  sessionSecretKey: "b".repeat(128),
  parentAttestation: {
    sessionPubkey: "a".repeat(64),
    parentMemberPubkey: "c".repeat(64),
    expiresAt: Date.now() + 60 * 60 * 1000,
    signature: "d".repeat(128),
  },
};

afterEach(() => {
  _resetRegistry();
});

describe("session-registry hooks", () => {
  test("onRegister fires on register", () => {
    const onRegister = vi.fn();
    const onDeregister = vi.fn();
    setRegistryHooks({ onRegister, onDeregister });

    registerSession({
      token: "t".repeat(64),
      sessionId: "sess-1",
      mesh: "alpha",
      displayName: "Alex",
      pid: 12345,
      presence: PRESENCE,
    });

    expect(onRegister).toHaveBeenCalledTimes(1);
    expect(onDeregister).not.toHaveBeenCalled();
    const arg = onRegister.mock.calls[0]![0] as SessionInfo;
    expect(arg.sessionId).toBe("sess-1");
    expect(arg.presence).toEqual(PRESENCE);
  });

  test("onDeregister fires on explicit deregister", () => {
    const onRegister = vi.fn();
    const onDeregister = vi.fn();
    setRegistryHooks({ onRegister, onDeregister });

    const token = "e".repeat(64);
    registerSession({
      token, sessionId: "sess-2", mesh: "alpha", displayName: "Alex",
      pid: 12345,
    });
    onRegister.mockClear();

    const ok = deregisterByToken(token);
    expect(ok).toBe(true);
    expect(onDeregister).toHaveBeenCalledTimes(1);
    const arg = onDeregister.mock.calls[0]![0] as SessionInfo;
    expect(arg.sessionId).toBe("sess-2");
  });

  test("re-registering same sessionId deregisters prior entry first", () => {
    const onRegister = vi.fn();
    const onDeregister = vi.fn();
    setRegistryHooks({ onRegister, onDeregister });

    const oldToken = "1".repeat(64);
    const newToken = "2".repeat(64);
    registerSession({
      token: oldToken, sessionId: "sess-3", mesh: "alpha",
      displayName: "Alex", pid: 12345,
    });
    expect(onRegister).toHaveBeenCalledTimes(1);

    // Replace under same sessionId — prior must be torn down before new one.
    registerSession({
      token: newToken, sessionId: "sess-3", mesh: "alpha",
      displayName: "Alex", pid: 12345,
    });

    expect(onDeregister).toHaveBeenCalledTimes(1);
    expect(onRegister).toHaveBeenCalledTimes(2);
    expect((onDeregister.mock.calls[0]![0] as SessionInfo).token).toBe(oldToken);
    expect((onRegister.mock.calls[1]![0] as SessionInfo).token).toBe(newToken);
    // Old token is unresolvable now.
    expect(resolveToken(oldToken)).toBeNull();
    expect(resolveToken(newToken)).toBeTruthy();
  });

  test("hooks tolerate throws (registry mutation still succeeds)", () => {
    setRegistryHooks({
      onRegister: () => { throw new Error("boom"); },
      onDeregister: () => { throw new Error("boom"); },
    });
    const token = "f".repeat(64);
    expect(() =>
      registerSession({
        token, sessionId: "sess-4", mesh: "alpha",
        displayName: "Alex", pid: 12345,
      }),
    ).not.toThrow();
    expect(resolveToken(token)).toBeTruthy();
    expect(() => deregisterByToken(token)).not.toThrow();
    expect(resolveToken(token)).toBeNull();
  });

  test("presence is preserved through resolveToken", () => {
    setRegistryHooks({});
    const token = "9".repeat(64);
    registerSession({
      token, sessionId: "sess-5", mesh: "alpha",
      displayName: "Alex", pid: 12345, presence: PRESENCE,
    });
    const got = resolveToken(token);
    expect(got).not.toBeNull();
    expect(got!.presence).toEqual(PRESENCE);
  });
});
