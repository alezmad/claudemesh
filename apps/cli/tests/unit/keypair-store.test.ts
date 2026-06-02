/**
 * Persisted, UUID-anchored session keypairs (delivery-reliability fix).
 *
 * The keystore is what makes a peer's sessionPubkey stable across
 * relaunch/--resume, so queued DMs (sealed to that pubkey) both route to
 * and decrypt on the returning session. Verifies:
 *   - the same (mesh, uuid) returns the SAME keypair across calls and
 *     across a fresh module read (persisted to disk);
 *   - distinct uuids / meshes get distinct keypairs;
 *   - malformed identifiers fall back to an ephemeral keypair and never
 *     escape the sessions dir;
 *   - a corrupt on-disk file is transparently rewritten.
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  loadOrCreateSessionKeypair,
  sessionsDir,
} from "../../src/services/session/keypair-store.js";

const UUID_A = "11111111-2222-3333-4444-555555555555";
const UUID_B = "66666666-7777-8888-9999-aaaaaaaaaaaa";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cm-keystore-"));
  process.env.CLAUDEMESH_SESSIONS_DIR = dir;
});

afterEach(() => {
  delete process.env.CLAUDEMESH_SESSIONS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("loadOrCreateSessionKeypair", () => {
  test("same (mesh, uuid) is stable across calls", async () => {
    const a = await loadOrCreateSessionKeypair("flexicar", UUID_A);
    const b = await loadOrCreateSessionKeypair("flexicar", UUID_A);
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.secretKey).toBe(b.secretKey);
    expect(a.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(a.secretKey).toMatch(/^[0-9a-f]{128}$/);
  });

  test("persists to disk under sessionsDir/<mesh>/<uuid>.json", async () => {
    await loadOrCreateSessionKeypair("flexicar", UUID_A);
    const file = join(sessionsDir(), "flexicar", `${UUID_A}.json`);
    expect(existsSync(file)).toBe(true);
  });

  test("distinct uuids get distinct keys", async () => {
    const a = await loadOrCreateSessionKeypair("flexicar", UUID_A);
    const b = await loadOrCreateSessionKeypair("flexicar", UUID_B);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  test("distinct meshes get distinct keys for the same uuid", async () => {
    const a = await loadOrCreateSessionKeypair("flexicar", UUID_A);
    const b = await loadOrCreateSessionKeypair("other-mesh", UUID_A);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  test("malformed uuid falls back to ephemeral, writes nothing", async () => {
    const a = await loadOrCreateSessionKeypair("flexicar", "not-a-uuid");
    const b = await loadOrCreateSessionKeypair("flexicar", "not-a-uuid");
    expect(a.publicKey).toMatch(/^[0-9a-f]{64}$/);
    // Ephemeral → not persisted → each call is fresh.
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(existsSync(join(dir, "flexicar"))).toBe(false);
  });

  test("path-traversal slug is rejected (ephemeral, no escape)", async () => {
    const a = await loadOrCreateSessionKeypair("../../etc", UUID_A);
    expect(a.publicKey).toMatch(/^[0-9a-f]{64}$/);
    // Nothing written under the sessions dir for a rejected slug.
    expect(readdirSync(dir)).toHaveLength(0);
  });

  test("corrupt on-disk file is rewritten and yields a valid key", async () => {
    const a = await loadOrCreateSessionKeypair("flexicar", UUID_A);
    const file = join(sessionsDir(), "flexicar", `${UUID_A}.json`);
    writeFileSync(file, "{ this is not valid json", "utf8");
    const b = await loadOrCreateSessionKeypair("flexicar", UUID_A);
    expect(b.publicKey).toMatch(/^[0-9a-f]{64}$/);
    // Rewritten to a fresh, internally-consistent keypair (distinct from
    // the now-clobbered original).
    expect(b.publicKey).not.toBe(a.publicKey);
    const c = await loadOrCreateSessionKeypair("flexicar", UUID_A);
    expect(c.publicKey).toBe(b.publicKey);
  });
});
