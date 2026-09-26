/** Spec 2026-09-26 §3: a broadcast arriving on both the member-WS and a
 *  session-WS must reach every session exactly once, whatever lands first. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqlite, type SqliteDb } from "~/daemon/db/sqlite.js";
import { migrateInbox } from "~/daemon/db/inbox.js";
import { EventBus, shouldDeliver, type DaemonEvent } from "~/daemon/events.js";
import { handleBrokerPush } from "~/daemon/inbound.js";

const MEMBER = "a".repeat(64);
const S1 = "1".repeat(64);
const S2 = "2".repeat(64);
const push = { type: "push", messageId: "b1", client_message_id: "cid-1", ciphertext: Buffer.from("hola").toString("base64") };

describe("inbound: multicast convergence", () => {
  let dir: string;
  let db: SqliteDb;
  let events: DaemonEvent[];
  let bus: EventBus;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cmh-mc-"));
    db = await openSqlite(join(dir, "inbox.db"));
    migrateInbox(db);
    events = [];
    bus = new EventBus();
    bus.subscribe((e) => { if (e.kind === "message") events.push(e); });
  });
  afterEach(() => { try { db.close(); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); });

  const seenBy = (session: string) =>
    events.filter((e) => shouldDeliver(e, { sessionPubkey: session, memberPubkey: MEMBER, meshSlug: "m" })).length;

  it("session copy first, member copy second → every session sees it once", async () => {
    await handleBrokerPush(push, { db, bus, meshSlug: "m", recipientPubkey: S1, recipientKind: "session" });
    await handleBrokerPush(push, { db, bus, meshSlug: "m", recipientPubkey: MEMBER, recipientKind: "member" });
    expect(seenBy(S1)).toBe(1);
    expect(seenBy(S2)).toBe(1);
  });

  it("member copy first → the session copy is dropped", async () => {
    await handleBrokerPush(push, { db, bus, meshSlug: "m", recipientPubkey: MEMBER, recipientKind: "member" });
    await handleBrokerPush(push, { db, bus, meshSlug: "m", recipientPubkey: S1, recipientKind: "session" });
    expect(seenBy(S1)).toBe(1);
    expect(seenBy(S2)).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM inbox").get()).toEqual({ n: 1 });
  });
});
