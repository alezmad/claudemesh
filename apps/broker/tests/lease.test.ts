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
