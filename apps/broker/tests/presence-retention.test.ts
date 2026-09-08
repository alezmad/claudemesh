/**
 * Presence retention + orphan-message sweep — 2026-09-08 blackout RC-B
 * (spec Addendum 5, items 5-6). Integration test against the test DB
 * (same setup as dup-delivery.test.ts).
 */

import { afterAll, afterEach, describe, expect, test } from "vitest";
import { eq, and, isNull } from "drizzle-orm";

import { db } from "../src/db";
import { messageQueue, presence } from "@turbostarter/db/schema/mesh";
import {
  connectPresence,
  disconnectPresence,
  listPeersInMesh,
  sweepOldPresenceRows,
  sweepOrphanMessages,
  PRESENCE_RETENTION_MS,
} from "../src/broker";
import { cleanupAllTestMeshes, setupTestMesh, type TestMesh } from "./helpers";

afterAll(async () => {
  await cleanupAllTestMeshes();
});

describe("sweepOldPresenceRows", () => {
  let m: TestMesh;
  afterEach(async () => { await m?.cleanup(); });

  test("deletes rows disconnected > 30d ago, keeps recent + online rows", async () => {
    m = await setupTestMesh("presence-retention");
    const mk = () => connectPresence({
      memberId: m.peerA.memberId, sessionId: `s-${Math.random()}`, pid: 1, cwd: "/tmp",
    });
    const online = await mk();
    const recentlyGone = await mk();
    const longGone1 = await mk();
    const longGone2 = await mk();
    await disconnectPresence(recentlyGone);
    await disconnectPresence(longGone1);
    await disconnectPresence(longGone2);
    const old = new Date(Date.now() - PRESENCE_RETENTION_MS - 60_000);
    await db.update(presence).set({ disconnectedAt: old }).where(eq(presence.id, longGone1));
    await db.update(presence).set({ disconnectedAt: old }).where(eq(presence.id, longGone2));

    const deleted = await sweepOldPresenceRows();
    expect(deleted).toBeGreaterThanOrEqual(2);

    const remaining = await db.select({ id: presence.id }).from(presence)
      .where(eq(presence.memberId, m.peerA.memberId));
    const ids = remaining.map((r) => r.id).sort();
    expect(ids).toEqual([online, recentlyGone].sort());

    // Online row still discoverable (the partial indexes must not change results).
    const peers = await listPeersInMesh(m.meshId);
    expect(peers.map((p) => p.sessionId)).toHaveLength(1);
  });
});

describe("sweepOrphanMessages (Date param regression)", () => {
  let m: TestMesh;
  afterEach(async () => { await m?.cleanup(); });

  test("deletes undelivered rows older than 7d and does not throw on the Date cutoff", async () => {
    m = await setupTestMesh("orphan-sweep");
    const base = {
      meshId: m.meshId, senderMemberId: m.peerA.memberId, targetSpec: m.peerB.pubkey,
      nonce: "n", ciphertext: "c",
    };
    const [fresh] = await db.insert(messageQueue).values({ ...base }).returning({ id: messageQueue.id });
    const [stale] = await db.insert(messageQueue).values({
      ...base, createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    }).returning({ id: messageQueue.id });
    const [staleDelivered] = await db.insert(messageQueue).values({
      ...base, createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), deliveredAt: new Date(),
    }).returning({ id: messageQueue.id });

    const n = await sweepOrphanMessages();
    expect(n).toBeGreaterThanOrEqual(1);

    const left = await db.select({ id: messageQueue.id }).from(messageQueue)
      .where(eq(messageQueue.meshId, m.meshId));
    const ids = left.map((r) => r.id).sort();
    expect(ids).toEqual([fresh!.id, staleDelivered!.id].sort());
    expect(ids).not.toContain(stale!.id);
    // Sanity: undelivered fresh row still pending.
    const pending = await db.select({ id: messageQueue.id }).from(messageQueue)
      .where(and(eq(messageQueue.meshId, m.meshId), isNull(messageQueue.deliveredAt)));
    expect(pending.map((r) => r.id)).toEqual([fresh!.id]);
  });
});
