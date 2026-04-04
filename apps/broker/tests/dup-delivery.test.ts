/**
 * Concurrency regression: drainForMember must return DISJOINT row
 * sets when two callers race for the same member's queue.
 *
 * Before the FOR UPDATE SKIP LOCKED fix, both callers SELECTed the
 * same undelivered rows, both sent push notifications, and only
 * after did they race to UPDATE delivered_at. Receivers saw
 * duplicate pushes for the same message id.
 *
 * After the fix, the atomic UPDATE ... WHERE id IN (SELECT ... FOR
 * UPDATE SKIP LOCKED) lets each caller claim non-overlapping rows.
 */

import { afterAll, afterEach, describe, expect, test } from "vitest";
import { drainForMember, queueMessage } from "../src/broker";
import { cleanupAllTestMeshes, setupTestMesh, type TestMesh } from "./helpers";

afterAll(async () => {
  await cleanupAllTestMeshes();
});

describe("drainForMember — concurrent callers", () => {
  let m: TestMesh;
  afterEach(async () => m && (await m.cleanup()));

  test("two concurrent drains produce disjoint result sets", async () => {
    m = await setupTestMesh("dup-basic");
    // Queue 10 messages for peer-b.
    for (let i = 0; i < 10; i++) {
      await queueMessage({
        meshId: m.meshId,
        senderMemberId: m.peerA.memberId,
        targetSpec: m.peerB.pubkey,
        priority: "now",
        nonce: `n${i}`,
        ciphertext: `msg-${i}`,
      });
    }
    // Fire two drains in parallel.
    const [a, b] = await Promise.all([
      drainForMember(m.meshId, m.peerB.memberId, m.peerB.pubkey, "idle"),
      drainForMember(m.meshId, m.peerB.memberId, m.peerB.pubkey, "idle"),
    ]);
    const idsA = new Set(a.map((r) => r.id));
    const idsB = new Set(b.map((r) => r.id));
    // No overlap.
    for (const id of idsA) expect(idsB.has(id)).toBe(false);
    // Union covers all 10.
    expect(idsA.size + idsB.size).toBe(10);
  });

  test("six concurrent drains also partition cleanly", async () => {
    m = await setupTestMesh("dup-six");
    for (let i = 0; i < 20; i++) {
      await queueMessage({
        meshId: m.meshId,
        senderMemberId: m.peerA.memberId,
        targetSpec: m.peerB.pubkey,
        priority: "now",
        nonce: `n${i}`,
        ciphertext: `msg-${i}`,
      });
    }
    const drains = await Promise.all(
      Array.from({ length: 6 }).map(() =>
        drainForMember(m.meshId, m.peerB.memberId, m.peerB.pubkey, "idle"),
      ),
    );
    const allIds: string[] = [];
    for (const d of drains) for (const r of d) allIds.push(r.id);
    const unique = new Set(allIds);
    expect(allIds.length).toBe(20);
    expect(unique.size).toBe(20);
  });

  test("after drain, subsequent drain returns empty", async () => {
    m = await setupTestMesh("dup-drain-empty");
    for (let i = 0; i < 3; i++) {
      await queueMessage({
        meshId: m.meshId,
        senderMemberId: m.peerA.memberId,
        targetSpec: m.peerB.pubkey,
        priority: "now",
        nonce: `n${i}`,
        ciphertext: `msg-${i}`,
      });
    }
    const first = await drainForMember(
      m.meshId,
      m.peerB.memberId,
      m.peerB.pubkey,
      "idle",
    );
    expect(first).toHaveLength(3);
    const second = await drainForMember(
      m.meshId,
      m.peerB.memberId,
      m.peerB.pubkey,
      "idle",
    );
    expect(second).toHaveLength(0);
  });

  test("FIFO ordering preserved within a single drain", async () => {
    m = await setupTestMesh("dup-fifo");
    for (let i = 0; i < 5; i++) {
      await queueMessage({
        meshId: m.meshId,
        senderMemberId: m.peerA.memberId,
        targetSpec: m.peerB.pubkey,
        priority: "now",
        nonce: `n${i}`,
        ciphertext: `msg-${i}`,
      });
    }
    const drained = await drainForMember(
      m.meshId,
      m.peerB.memberId,
      m.peerB.pubkey,
      "idle",
    );
    for (let i = 0; i < 5; i++) {
      expect(drained[i]!.ciphertext).toBe(`msg-${i}`);
    }
  });
});
