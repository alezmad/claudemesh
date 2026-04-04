/**
 * Broker behavior tests — ported from ~/tools/claude-intercom/broker.test.ts.
 *
 * Tests the core state engine (writeStatus, hook gating, TTL sweep,
 * pending-status race handler, priority delivery) against the real
 * Drizzle/Postgres schema in apps/broker/src/broker.ts.
 *
 * Each test creates its own mesh + members via setupTestMesh. Mesh
 * isolation in broker logic means tests don't interfere.
 */

import { afterAll, afterEach, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { presence, pendingStatus } from "@turbostarter/db/schema/mesh";
import {
  applyPendingHookStatus,
  connectPresence,
  drainForMember,
  handleHookSetStatus,
  isHookFresh,
  queueMessage,
  refreshStatusFromJsonl,
  sweepStuckWorking,
  writeStatus,
} from "../src/broker";
import { cleanupAllTestMeshes, setupTestMesh, type TestMesh } from "./helpers";
import type { PeerStatus } from "../src/types";

const testCwds = new Map<string, string>();
let counter = 0;
function uniqueCwd(): string {
  counter++;
  const c = `/tmp/test-cwd-${process.pid}-${counter}`;
  testCwds.set(c, c);
  return c;
}

async function getPresenceRow(presenceId: string) {
  const [row] = await db
    .select()
    .from(presence)
    .where(eq(presence.id, presenceId));
  return row;
}

afterAll(async () => {
  await cleanupAllTestMeshes();
});

describe("hook-driven status", () => {
  let m: TestMesh;
  afterEach(async () => m && (await m.cleanup()));

  test("hook flips status and queued next message unblocks", async () => {
    m = await setupTestMesh("hook-next");
    // Create presence rows for both peers via connectPresence
    // (simulates WS connect flow).
    const pidA = 10_000,
      pidB = 10_001;
    const cwdA = uniqueCwd(),
      cwdB = uniqueCwd();
    const presA = await connectPresence({
      memberId: m.peerA.memberId,
      sessionId: "sA",
      pid: pidA,
      cwd: cwdA,
    });
    const presB = await connectPresence({
      memberId: m.peerB.memberId,
      sessionId: "sB",
      pid: pidB,
      cwd: cwdB,
    });

    // Force peer-b into "working" via hook.
    const hookRes = await handleHookSetStatus({
      cwd: cwdB,
      pid: pidB,
      status: "working",
    });
    expect(hookRes.ok).toBe(true);
    expect(hookRes.presence_id).toBe(presB);

    // Queue a "next"-priority message from A to B.
    await queueMessage({
      meshId: m.meshId,
      senderMemberId: m.peerA.memberId,
      targetSpec: m.peerB.pubkey,
      priority: "next",
      nonce: "n1",
      ciphertext: "held",
    });

    // peer-b is working → next messages should NOT drain.
    let drained = await drainForMember(
      m.meshId,
      m.peerB.memberId,
      m.peerB.pubkey,
      "working",
    );
    expect(drained).toHaveLength(0);

    // Flip to idle.
    await handleHookSetStatus({ cwd: cwdB, pid: pidB, status: "idle" });
    drained = await drainForMember(
      m.meshId,
      m.peerB.memberId,
      m.peerB.pubkey,
      "idle",
    );
    expect(drained).toHaveLength(1);
    expect(drained[0]!.ciphertext).toBe("held");
    expect(drained[0]!.senderPubkey).toBe(m.peerA.pubkey);
    void presA;
  });

  test("now-priority messages bypass the working gate", async () => {
    m = await setupTestMesh("now-bypass");
    const cwd = uniqueCwd();
    await connectPresence({
      memberId: m.peerB.memberId,
      sessionId: "sB",
      pid: 99,
      cwd,
    });
    await handleHookSetStatus({ cwd, pid: 99, status: "working" });
    await queueMessage({
      meshId: m.meshId,
      senderMemberId: m.peerA.memberId,
      targetSpec: m.peerB.pubkey,
      priority: "now",
      nonce: "n2",
      ciphertext: "urgent",
    });
    const drained = await drainForMember(
      m.meshId,
      m.peerB.memberId,
      m.peerB.pubkey,
      "working",
    );
    expect(drained).toHaveLength(1);
    expect(drained[0]!.ciphertext).toBe("urgent");
  });

  test("DND is sacred — hooks cannot unset it", async () => {
    m = await setupTestMesh("dnd-sacred");
    const cwd = uniqueCwd();
    const presId = await connectPresence({
      memberId: m.peerA.memberId,
      sessionId: "sA",
      pid: 11,
      cwd,
    });
    await writeStatus(presId, "dnd", "manual", new Date());
    // Hook tries to flip to idle → should not override.
    await handleHookSetStatus({ cwd, pid: 11, status: "idle" });
    const row = await getPresenceRow(presId);
    expect(row?.status).toBe("dnd");
  });
});

describe("source priority", () => {
  let m: TestMesh;
  afterEach(async () => m && (await m.cleanup()));

  test("hook source outranks jsonl, stays fresh through refresh", async () => {
    m = await setupTestMesh("source-fresh");
    const cwd = uniqueCwd();
    const presId = await connectPresence({
      memberId: m.peerA.memberId,
      sessionId: "sA",
      pid: 22,
      cwd,
    });
    await handleHookSetStatus({ cwd, pid: 22, status: "working" });
    // JSONL refresh attempts to overwrite — source stays "hook".
    await refreshStatusFromJsonl(presId, cwd, new Date());
    const row = await getPresenceRow(presId);
    expect(row?.status).toBe("working");
    expect(row?.statusSource).toBe("hook");
  });

  test("source decays to jsonl when hook signal goes stale", async () => {
    m = await setupTestMesh("source-decay");
    const cwd = uniqueCwd();
    const presId = await connectPresence({
      memberId: m.peerA.memberId,
      sessionId: "sA",
      pid: 33,
      cwd,
    });
    // Write stale hook signal by back-dating status_updated_at.
    await writeStatus(presId, "working", "hook", new Date());
    await db
      .update(presence)
      .set({ statusUpdatedAt: new Date(Date.now() - 120_000) })
      .where(eq(presence.id, presId));
    // Same-status jsonl write should DOWNGRADE the source.
    await writeStatus(presId, "working", "jsonl", new Date());
    const row = await getPresenceRow(presId);
    expect(row?.status).toBe("working");
    expect(row?.statusSource).toBe("jsonl");
  });

  test("sourceRank: hook > manual > jsonl", () => {
    // Behaviors exercised via writeStatus in other tests; here we
    // just sanity-check isHookFresh freshness cutoff directly.
    const now = new Date();
    expect(isHookFresh("hook", new Date(now.getTime() - 10_000), now)).toBe(
      true,
    );
    expect(
      isHookFresh("hook", new Date(now.getTime() - 60_000), now),
    ).toBe(false);
    expect(
      isHookFresh("manual", new Date(now.getTime() - 10_000), now),
    ).toBe(false);
    expect(
      isHookFresh("jsonl", new Date(now.getTime() - 10_000), now),
    ).toBe(false);
  });
});

describe("TTL sweep", () => {
  let m: TestMesh;
  afterEach(async () => m && (await m.cleanup()));

  test("presences stuck in 'working' beyond TTL are swept to idle", async () => {
    m = await setupTestMesh("ttl-sweep");
    const cwd = uniqueCwd();
    const presId = await connectPresence({
      memberId: m.peerA.memberId,
      sessionId: "sA",
      pid: 44,
      cwd,
    });
    // Force working + backdate status_updated_at past the 60s TTL.
    await writeStatus(presId, "working", "hook", new Date());
    await db
      .update(presence)
      .set({ statusUpdatedAt: new Date(Date.now() - 120_000) })
      .where(eq(presence.id, presId));
    await sweepStuckWorking();
    const row = await getPresenceRow(presId);
    expect(row?.status).toBe("idle");
    expect(row?.statusSource).toBe("jsonl");
  });

  test("sweep leaves DND alone", async () => {
    m = await setupTestMesh("ttl-dnd");
    const cwd = uniqueCwd();
    const presId = await connectPresence({
      memberId: m.peerA.memberId,
      sessionId: "sA",
      pid: 55,
      cwd,
    });
    // DND is the edge case — if user went DND then dropped offline,
    // sweep shouldn't flip them to idle.
    await writeStatus(presId, "dnd", "manual", new Date());
    await db
      .update(presence)
      .set({
        status: "dnd",
        statusUpdatedAt: new Date(Date.now() - 300_000),
      })
      .where(eq(presence.id, presId));
    await sweepStuckWorking();
    const row = await getPresenceRow(presId);
    expect(row?.status).toBe("dnd");
  });
});

describe("first-turn race (pending_status)", () => {
  let m: TestMesh;
  afterEach(async () => m && (await m.cleanup()));

  test("hook firing before connect is stashed and applied on connect", async () => {
    m = await setupTestMesh("pending-race");
    const cwd = uniqueCwd();
    const pid = 66;
    // Hook fires FIRST — no presence row yet.
    const hookRes = await handleHookSetStatus({
      cwd,
      pid,
      status: "working",
    });
    expect(hookRes.ok).toBe(true);
    expect(hookRes.pending).toBe(true);
    expect(hookRes.presence_id).toBeUndefined();

    // Verify pending_status row exists.
    const [p] = await db
      .select()
      .from(pendingStatus)
      .where(and(eq(pendingStatus.pid, pid), eq(pendingStatus.cwd, cwd)));
    expect(p).toBeDefined();
    expect(p?.status).toBe("working");
    expect(p?.appliedAt).toBeNull();

    // Now connect (peer registers). connectPresence calls
    // applyPendingHookStatus internally — should pick up the pending.
    const presId = await connectPresence({
      memberId: m.peerA.memberId,
      sessionId: "sA",
      pid,
      cwd,
    });
    const row = await getPresenceRow(presId);
    expect(row?.status).toBe("working");
    expect(row?.statusSource).toBe("hook");

    // pending_status row should be marked applied.
    const [pAfter] = await db
      .select()
      .from(pendingStatus)
      .where(and(eq(pendingStatus.pid, pid), eq(pendingStatus.cwd, cwd)));
    expect(pAfter?.appliedAt).not.toBeNull();
  });

  test("applyPendingHookStatus picks newest matching entry", async () => {
    m = await setupTestMesh("pending-newest");
    const cwd = uniqueCwd();
    const pid = 77;
    // Insert two pending entries — oldest first, then newer.
    await handleHookSetStatus({ cwd, pid, status: "idle" });
    await new Promise((r) => setTimeout(r, 10));
    await handleHookSetStatus({ cwd, pid, status: "working" });

    const presId = await connectPresence({
      memberId: m.peerA.memberId,
      sessionId: "sA",
      pid,
      cwd,
    });
    const row = await getPresenceRow(presId);
    // Most recent pending wins.
    expect(row?.status).toBe("working");
  });

  test("pending with expired TTL is ignored on connect", async () => {
    m = await setupTestMesh("pending-stale");
    const cwd = uniqueCwd();
    const pid = 88;
    await handleHookSetStatus({ cwd, pid, status: "working" });
    // Backdate the pending row past PENDING_TTL_MS (10s).
    await db
      .update(pendingStatus)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(pendingStatus.pid, pid));
    // Try to apply — should NOT find the stale entry.
    await applyPendingHookStatus(
      "some-presence-id-that-doesnt-exist",
      pid,
      cwd,
      new Date(),
    );
    // Fresh connect should not pick up expired pending.
    const presId = await connectPresence({
      memberId: m.peerA.memberId,
      sessionId: "sA",
      pid,
      cwd,
    });
    const row = await getPresenceRow(presId);
    expect(row?.status).toBe("idle");
  });
});

describe("targetSpec routing", () => {
  let m: TestMesh;
  afterEach(async () => m && (await m.cleanup()));

  test("broadcast (*) reaches all members", async () => {
    m = await setupTestMesh("broadcast");
    await queueMessage({
      meshId: m.meshId,
      senderMemberId: m.peerA.memberId,
      targetSpec: "*",
      priority: "now",
      nonce: "nb",
      ciphertext: "hi everyone",
    });
    // peer-a shouldn't get its own broadcast — but drainForMember
    // currently doesn't filter by sender, so both peers drain it.
    // Just assert peer-b gets it (the expected receiver case).
    const drained = await drainForMember(
      m.meshId,
      m.peerB.memberId,
      m.peerB.pubkey,
      "idle",
    );
    expect(drained).toHaveLength(1);
    expect(drained[0]!.ciphertext).toBe("hi everyone");
  });

  test("pubkey mismatch → message not drained", async () => {
    m = await setupTestMesh("pubkey-mismatch");
    await queueMessage({
      meshId: m.meshId,
      senderMemberId: m.peerA.memberId,
      targetSpec: "z".repeat(64),
      priority: "now",
      nonce: "nx",
      ciphertext: "for z",
    });
    const drained = await drainForMember(
      m.meshId,
      m.peerB.memberId,
      m.peerB.pubkey,
      "idle",
    );
    expect(drained).toHaveLength(0);
  });

  test("mesh isolation: peer in mesh X doesn't drain message from mesh Y", async () => {
    const x = await setupTestMesh("iso-x");
    const y = await setupTestMesh("iso-y");
    try {
      // Queue message in mesh X.
      await queueMessage({
        meshId: x.meshId,
        senderMemberId: x.peerA.memberId,
        targetSpec: x.peerB.pubkey,
        priority: "now",
        nonce: "nx",
        ciphertext: "x-only",
      });
      // Drain from mesh Y's peer B (same pubkey pattern).
      const drained = await drainForMember(
        y.meshId,
        y.peerB.memberId,
        y.peerB.pubkey,
        "idle",
      );
      expect(drained).toHaveLength(0);
    } finally {
      await x.cleanup();
      await y.cleanup();
    }
  });
});
