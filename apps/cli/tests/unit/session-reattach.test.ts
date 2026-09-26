/**
 * Spec 2026-09-26 §2/§4 (bug1 + bug3). A resumed claude re-attaches with
 * the same token + key: the registry must only move its pid anchor (no
 * WS churn), and the token must be findable after the launch tmpdir is
 * gone.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _resetRegistry, registerSession, resolveToken, setRegistryHooks } from "../../src/daemon/session-registry.js";
import { readSessionTokenFromEnv } from "../../src/services/session/token.js";
import { loadOrCreateSessionKeypair, sessionTokenPath } from "../../src/services/session/keypair-store.js";

const TOKEN = "e".repeat(64);
const PRESENCE = {
  sessionPubkey: "a".repeat(64),
  sessionSecretKey: "b".repeat(128),
  parentAttestation: {
    sessionPubkey: "a".repeat(64),
    parentMemberPubkey: "c".repeat(64),
    expiresAt: Date.now() + 3_600_000,
    signature: "d".repeat(128),
  },
};

describe("registry: same-session re-register", () => {
  afterEach(() => { _resetRegistry(); setRegistryHooks({}); });

  test("only moves the pid anchor — no deregister/register (no WS churn)", () => {
    const onRegister = vi.fn();
    const onDeregister = vi.fn();
    setRegistryHooks({ onRegister, onDeregister });
    const base = { token: TOKEN, sessionId: "s-1", mesh: "flexicar", displayName: "front", presence: PRESENCE };
    registerSession({ ...base, pid: 111, startTime: "a" });
    registerSession({ ...base, pid: 222, startTime: "b" });
    expect(onRegister).toHaveBeenCalledTimes(1);
    expect(onDeregister).not.toHaveBeenCalled();
    expect(resolveToken(TOKEN)?.pid).toBe(222);
  });

  test("a different session key under the same token still replaces", () => {
    const onRegister = vi.fn();
    setRegistryHooks({ onRegister });
    const base = { token: TOKEN, sessionId: "s-1", mesh: "flexicar", displayName: "front", pid: 1, startTime: "a" };
    registerSession({ ...base, presence: PRESENCE });
    registerSession({ ...base, presence: { ...PRESENCE, sessionPubkey: "f".repeat(64) } });
    expect(onRegister).toHaveBeenCalledTimes(2);
  });

  test("no absolute TTL: an old entry still resolves", () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    registerSession({ token: TOKEN, sessionId: "s-1", mesh: "m", displayName: "x", pid: 1, startTime: "a" });
    vi.setSystemTime(now + 3 * 24 * 3_600_000);
    expect(resolveToken(TOKEN)).not.toBeNull();
    vi.useRealTimers();
  });
});

describe("token: stable fallback", () => {
  let dir: string;
  const UUID = "11111111-2222-3333-4444-555555555555";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cmh-sessions-"));
    process.env.CLAUDEMESH_SESSIONS_DIR = dir;
  });
  afterEach(() => {
    delete process.env.CLAUDEMESH_SESSIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  test("the launch tmpdir token is gone → the stable token next to the keypair is used", async () => {
    await loadOrCreateSessionKeypair("flexicar", UUID);
    const stable = sessionTokenPath("flexicar", UUID)!;
    mkdirSync(join(dir, "flexicar"), { recursive: true });
    writeFileSync(stable, TOKEN);
    const env = {
      CLAUDEMESH_IPC_TOKEN_FILE: join(dir, "gone-tmpdir", "session-token"),
      CLAUDEMESH_SESSION_ID: UUID,
    } as NodeJS.ProcessEnv;
    // mesh discovered from the persisted keypair (1.37 launches set no CLAUDEMESH_MESH_SLUG)
    expect(readSessionTokenFromEnv(env)).toBe(TOKEN);
  });

  test("no session id → no fallback", () => {
    expect(readSessionTokenFromEnv({ CLAUDEMESH_IPC_TOKEN_FILE: "/nope" } as NodeJS.ProcessEnv)).toBeNull();
  });
});
