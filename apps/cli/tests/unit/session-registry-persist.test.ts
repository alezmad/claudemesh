/**
 * Session-registry persistence (1.36.0) — durable session→mesh bindings.
 *
 * A daemon restart used to wipe the in-memory registry, orphaning every
 * live session's mesh context. Persistence lets the daemon rehydrate on
 * boot. Verifies:
 *   - register writes a slim record to disk; readPersistedSessions reads it;
 *   - the session SECRET KEY is never written to disk;
 *   - deregister removes the record;
 *   - persistence is off by default (no disk writes until enabled).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  _resetRegistry,
  deregisterByToken,
  readPersistedSessions,
  registerSession,
  setRegistryPersistence,
} from "../../src/daemon/session-registry.js";

const SECRET = "b".repeat(128);
const PRESENCE = {
  sessionPubkey: "a".repeat(64),
  sessionSecretKey: SECRET,
  parentAttestation: {
    sessionPubkey: "a".repeat(64),
    parentMemberPubkey: "c".repeat(64),
    expiresAt: 9_999_999_999,
    signature: "d".repeat(128),
  },
};

let dir: string;
let file: string;

beforeEach(() => {
  _resetRegistry();
  dir = mkdtempSync(join(tmpdir(), "cm-reg-"));
  file = join(dir, "sessions.json");
});

afterEach(() => {
  _resetRegistry();
  rmSync(dir, { recursive: true, force: true });
});

describe("registry persistence", () => {
  test("off by default — no disk writes until enabled", () => {
    registerSession({ token: "t1", sessionId: "s1", mesh: "flexicar", displayName: "a", pid: process.pid, startTime: "x" });
    expect(existsSync(file)).toBe(false);
  });

  test("register persists a slim record; readPersistedSessions round-trips", () => {
    setRegistryPersistence(file);
    registerSession({
      token: "t1", sessionId: "11111111-2222-3333-4444-555555555555",
      mesh: "flexicar", displayName: "intra-back", pid: process.pid,
      cwd: "/tmp/x", role: "dev", startTime: "x", presence: PRESENCE,
    });
    const rows = readPersistedSessions(file);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      token: "t1", mesh: "flexicar", displayName: "intra-back", cwd: "/tmp/x", role: "dev",
    });
  });

  test("session secret key is NEVER written to disk", () => {
    setRegistryPersistence(file);
    registerSession({ token: "t1", sessionId: "s1", mesh: "flexicar", displayName: "a", pid: process.pid, startTime: "x", presence: PRESENCE });
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain("sessionSecretKey");
    expect(raw).not.toContain("parentAttestation");
    // And the parsed record carries no presence material.
    expect(readPersistedSessions(file)[0]).not.toHaveProperty("presence");
  });

  test("deregister removes the record from disk", () => {
    setRegistryPersistence(file);
    registerSession({ token: "t1", sessionId: "s1", mesh: "flexicar", displayName: "a", pid: process.pid, startTime: "x" });
    registerSession({ token: "t2", sessionId: "s2", mesh: "nedas", displayName: "b", pid: process.pid, startTime: "x" });
    expect(readPersistedSessions(file)).toHaveLength(2);
    deregisterByToken("t1");
    const rows = readPersistedSessions(file);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token).toBe("t2");
  });

  test("readPersistedSessions tolerates a missing/corrupt file", () => {
    expect(readPersistedSessions(join(dir, "nope.json"))).toEqual([]);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    expect(readPersistedSessions(bad)).toEqual([]);
  });
});
