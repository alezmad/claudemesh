/**
 * Lease lifecycle decisions — regression tests for the 2026-09-08
 * daemon-restart mesh blackout (spec Addendum 5, RC-A + items 2-4).
 *
 * Pure-logic tests over `src/lease.ts`, same pattern as
 * kick-control-plane-skip.test.ts: no broker boot, no DB.
 */

import { describe, expect, test } from "vitest";

import {
  decideCloseAction,
  shouldEvictOnGraceExpiry,
  dedupTargets,
  findZombieSockets,
  reattachLease,
  liveLeasePresenceIds,
  reconcileFlippedPresences,
  STALE_PONG_THRESHOLD_MS,
  type DedupConnView,
} from "../src/lease";

const sockA = { id: "A" };
const sockB = { id: "B" };

describe("decideCloseAction (RC-A: stale close after reattach)", () => {
  test("no connections entry → no_conn", () => {
    expect(decideCloseAction(undefined, sockA)).toBe("no_conn");
  });

  test("online lease, its own socket closes → enter_grace", () => {
    expect(decideCloseAction({ ws: sockA, leaseState: "online" }, sockA)).toBe("enter_grace");
  });

  test("offline lease (already in grace), its socket closes again → evict_now", () => {
    expect(decideCloseAction({ ws: sockA, leaseState: "offline" }, sockA)).toBe("evict_now");
  });

  test("THE INCIDENT: dead daemon's socket closes late, lease already reattached to a new socket → ignore_replaced", () => {
    // 19:28:08 reattach swapped conn.ws = B; 19:28:17 the close event of
    // the old socket A finally ran. The old handler evicted/graced the
    // healthy lease; the decision must ignore it.
    const conn = { ws: sockB, leaseState: "online" as const };
    expect(decideCloseAction(conn, sockA)).toBe("ignore_replaced");
  });

  test("stale close on an offline lease whose socket differs → still ignore_replaced (never evict on a foreign socket)", () => {
    const conn = { ws: sockB, leaseState: "offline" as const };
    expect(decideCloseAction(conn, sockA)).toBe("ignore_replaced");
  });
});

describe("shouldEvictOnGraceExpiry", () => {
  test("offline lease → evict", () => {
    expect(shouldEvictOnGraceExpiry({ ws: sockA, leaseState: "offline" })).toBe(true);
  });
  test("lease reattached (online) before the timer fired → do NOT evict", () => {
    expect(shouldEvictOnGraceExpiry({ ws: sockB, leaseState: "online" })).toBe(false);
  });
  test("entry gone → nothing to evict", () => {
    expect(shouldEvictOnGraceExpiry(undefined)).toBe(false);
  });
});

describe("dedupTargets (role-scoped session-id dedup)", () => {
  const conns: Array<[string, DedupConnView]> = [
    ["cp1", { meshId: "m1", sessionId: "uuid-1", peerRole: "control-plane" }],
    ["s1", { meshId: "m1", sessionId: "uuid-1", peerRole: "session" }],
    ["s2", { meshId: "m1", sessionId: "uuid-2", peerRole: "session" }],
    ["s1-other-mesh", { meshId: "m2", sessionId: "uuid-1", peerRole: "session" }],
    ["svc", { meshId: "m1", sessionId: "uuid-1", peerRole: "service" }],
  ];
  const hello = { meshId: "m1", sessionId: "uuid-1" };

  test("member hello dedups only the control-plane presence with the same session_id", () => {
    expect(dedupTargets(conns, hello, "control-plane")).toEqual(["cp1"]);
  });

  test("session_hello dedups only the session presence with the same session_id", () => {
    expect(dedupTargets(conns, hello, "session")).toEqual(["s1"]);
  });

  test("never crosses meshes or session ids", () => {
    expect(dedupTargets(conns, { meshId: "m1", sessionId: "uuid-9" }, "session")).toEqual([]);
    expect(dedupTargets(conns, { meshId: "m3", sessionId: "uuid-1" }, "session")).toEqual([]);
  });

  test("Addendum 2 chain: wrapper hello + daemon session_hello for one session coexist", () => {
    // The wrapper's control-plane hello must not kick the session, and the
    // session_hello must not kick the wrapper.
    const kickedByWrapper = dedupTargets(conns, hello, "control-plane");
    const kickedBySession = dedupTargets(conns, hello, "session");
    expect(kickedByWrapper).not.toContain("s1");
    expect(kickedBySession).not.toContain("cp1");
  });
});

describe("findZombieSockets", () => {
  const OPEN = 1;
  const CLOSED = 3;
  const mk = (readyState: number) => ({ readyState, OPEN });
  const now = 1_000_000;

  test("open socket with no lease, older than minAge → zombie", () => {
    const z = mk(OPEN);
    const opened = new Map<object, number>([[z, now - 120_000]]);
    expect(findZombieSockets([z], new Set(), (s) => opened.get(s), now, 60_000)).toEqual([z]);
  });

  test("open socket referenced by a lease → not a zombie", () => {
    const live = mk(OPEN);
    const opened = new Map<object, number>([[live, now - 120_000]]);
    expect(findZombieSockets([live], new Set([live]), (s) => opened.get(s), now, 60_000)).toEqual([]);
  });

  test("young socket (mid-hello) → skipped", () => {
    const young = mk(OPEN);
    const opened = new Map<object, number>([[young, now - 5_000]]);
    expect(findZombieSockets([young], new Set(), (s) => opened.get(s), now, 60_000)).toEqual([]);
  });

  test("non-open socket → skipped", () => {
    const closed = mk(CLOSED);
    const opened = new Map<object, number>([[closed, now - 120_000]]);
    expect(findZombieSockets([closed], new Set(), (s) => opened.get(s), now, 60_000)).toEqual([]);
  });

  test("socket with unknown open time (pre-existing) → treated as old", () => {
    const z = mk(OPEN);
    expect(findZombieSockets([z], new Set(), () => undefined, now, 60_000)).toEqual([z]);
  });
});

describe("reattachLease (RC-C ordering: swap before close)", () => {
  const OPEN = 1;
  type Sock = { id: string; readyState: number; OPEN: number };
  const mk = (id: string): Sock => ({ id, readyState: OPEN, OPEN });

  test("a close handler that fires SYNCHRONOUSLY inside closeOld() sees the NEW socket and an online lease", () => {
    const oldWs = mk("old");
    const newWs = mk("new");
    const conn = { ws: oldWs, leaseState: "online" as const, leaseUntil: 0, evictionTimer: null as ReturnType<typeof setTimeout> | null, lastPongAt: 0 };
    let seenAction: string | null = null;
    // Emulate Bun: closing the old socket runs its close handler right away.
    const closeOld = (ws: Sock) => {
      seenAction = decideCloseAction(conn, ws);
      if (seenAction === "enter_grace") {
        // what the real handler would do if the ordering were wrong
        conn.leaseState = "offline";
        conn.evictionTimer = setTimeout(() => { /* would evict */ }, 90_000);
      }
    };
    const was = reattachLease(conn, newWs, closeOld, 123);
    expect(was).toBe("online");
    expect(seenAction).toBe("ignore_replaced");
    expect(conn.ws).toBe(newWs);
    expect(conn.leaseState).toBe("online");
    expect(conn.evictionTimer).toBeNull();
    expect(conn.lastPongAt).toBe(123);
  });

  test("even if a handler wrongly arms a grace timer during closeOld(), the lease ends online with no timer (the prod 20:40Z recurrence)", () => {
    const oldWs = mk("old");
    const newWs = mk("new");
    const conn = { ws: oldWs, leaseState: "online" as const, leaseUntil: 0, evictionTimer: null as ReturnType<typeof setTimeout> | null, lastPongAt: 0 };
    let fired = false;
    reattachLease(conn, newWs, () => {
      conn.leaseState = "offline";
      conn.leaseUntil = Date.now() + 90_000;
      conn.evictionTimer = setTimeout(() => { fired = true; }, 5);
    });
    expect(conn.leaseState).toBe("online");
    expect(conn.leaseUntil).toBe(0);
    expect(conn.evictionTimer).toBeNull();
    return new Promise<void>((r) => setTimeout(() => { expect(fired).toBe(false); r(); }, 20));
  });

  test("reattach of an offline (grace) lease clears its eviction timer and never calls closeOld on the same socket", () => {
    const ws = mk("same");
    let closed = 0;
    const conn = { ws, leaseState: "offline" as const, leaseUntil: 99, evictionTimer: setTimeout(() => {}, 90_000), lastPongAt: 0 };
    const was = reattachLease(conn, ws, () => { closed++; });
    expect(was).toBe("offline");
    expect(closed).toBe(0);
    expect(conn.evictionTimer).toBeNull();
    expect(conn.leaseState).toBe("online");
  });
});

describe("DB stale-sweep reconciliation (Addendum 5 follow-up: sweeper vs in-memory lease)", () => {
  const OPEN = 1, CLOSED = 3;
  const sock = (readyState: number) => ({ readyState, OPEN });
  const now = 1_000_000;

  test("liveLeasePresenceIds keeps only online + OPEN + recently-ponged leases", () => {
    const conns: Array<[string, { ws: { readyState: number; OPEN: number }; leaseState: "online" | "offline"; lastPongAt: number }]> = [
      ["alive",      { ws: sock(OPEN),   leaseState: "online",  lastPongAt: now - 10_000 }],
      ["in-grace",   { ws: sock(CLOSED), leaseState: "offline", lastPongAt: now - 10_000 }],
      ["half-dead",  { ws: sock(OPEN),   leaseState: "online",  lastPongAt: now - STALE_PONG_THRESHOLD_MS - 1 }],
      ["closed-sock",{ ws: sock(CLOSED), leaseState: "online",  lastPongAt: now - 1_000 }],
      ["edge",       { ws: sock(OPEN),   leaseState: "online",  lastPongAt: now - STALE_PONG_THRESHOLD_MS }],
    ];
    const keep = liveLeasePresenceIds(conns, now);
    expect([...keep].sort()).toEqual(["alive", "edge"]);
  });

  test("THE GHOST: sweeper flips a row whose lease is online → reconcile returns it so the caller evicts (closes the socket)", () => {
    // Prod 2026-09-08 22:05Z: presence rows flipped to disconnected while
    // the daemon's socket stayed OPEN and nobody told it. list_peers hid
    // the session; pushes still reached it; it never reconnected.
    const conns = new Map<string, { ws: object; leaseState: "online" | "offline" }>([
      ["ghost",   { ws: {}, leaseState: "online" }],
      ["graced",  { ws: {}, leaseState: "offline" }],
    ]);
    const out = reconcileFlippedPresences(["ghost", "graced", "already-gone"], (id) => conns.get(id));
    expect(out).toEqual(["ghost"]);
  });

  test("offline (in-grace) leases are left to their grace timer, never evicted by the sweeper", () => {
    const conns = new Map([["g", { ws: {}, leaseState: "offline" as const }]]);
    expect(reconcileFlippedPresences(["g"], (id) => conns.get(id))).toEqual([]);
  });

  test("nothing flipped → nothing to reconcile", () => {
    expect(reconcileFlippedPresences([], () => undefined)).toEqual([]);
  });
});
