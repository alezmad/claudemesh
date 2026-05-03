import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqlite, type SqliteDb } from "~/daemon/db/sqlite.js";
import { migrateOutbox } from "~/daemon/db/outbox.js";
import { acceptSend, type SendRequest } from "~/daemon/ipc/handlers/send.js";

// Shared base request — every test mutates a copy.
const baseReq = (over: Partial<SendRequest> = {}): SendRequest => ({
  to: "alice",
  message: "hello",
  destination_kind: "dm",
  destination_ref: "alice",
  priority: "next",
  client_message_id: "key-A",
  ...over,
});

describe("daemon acceptSend — §4.5.1 IPC duplicate lookup table", () => {
  let dir: string;
  let db: SqliteDb;
  let now = 0;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "claudemesh-accept-"));
    db = await openSqlite(join(dir, "outbox.db"));
    migrateOutbox(db);
    now = 1_730_000_000_000;
  });

  afterEach(() => {
    try { db.close(); } catch { /* */ }
    rmSync(dir, { recursive: true, force: true });
  });

  // No-row branch -------------------------------------------------------------
  it("first send → 202 accepted_pending and persists row", () => {
    const r = acceptSend(baseReq(), { db, now: () => now, newId: () => "row-1" });
    expect(r).toMatchObject({ kind: "accepted_pending", status: 202, client_message_id: "key-A" });

    const row = db.prepare(`SELECT id, client_message_id, status FROM outbox WHERE client_message_id = ?`)
      .get<{ id: string; client_message_id: string; status: string }>("key-A");
    expect(row).toMatchObject({ id: "row-1", client_message_id: "key-A", status: "pending" });
  });

  it("auto-mints client_message_id when caller omits", () => {
    let n = 0;
    const newId = () => `id-${++n}`;
    const r = acceptSend(baseReq({ client_message_id: undefined }), { db, now: () => now, newId });
    expect(r.kind).toBe("accepted_pending");
    if (r.kind !== "accepted_pending") return;
    expect(r.client_message_id).toBe("id-1"); // ulidLike returned the first id
  });

  // pending row ---------------------------------------------------------------
  it("pending + match → 202 accepted_pending without inserting a new row", () => {
    let calls = 0;
    const newId = () => `row-${++calls}`;
    acceptSend(baseReq(), { db, now: () => now, newId });
    const r = acceptSend(baseReq(), { db, now: () => now, newId });
    expect(r).toMatchObject({ kind: "accepted_pending", client_message_id: "key-A" });
    const count = db.prepare(`SELECT COUNT(*) AS c FROM outbox`).get<{ c: number }>()!.c;
    expect(Number(count)).toBe(1);
  });

  it("pending + mismatch → 409 with conflict reason and fingerprint prefix", () => {
    acceptSend(baseReq(), { db, now: () => now, newId: () => "row-1" });
    const r = acceptSend(baseReq({ message: "DIFFERENT BODY" }), { db, now: () => now, newId: () => "row-x" });
    expect(r.kind).toBe("conflict");
    if (r.kind !== "conflict") return;
    expect(r.status).toBe(409);
    expect(r.reason).toBe("outbox_pending_fingerprint_mismatch");
    expect(r.daemon_fingerprint_prefix).toMatch(/^[0-9a-f]{16}$/);
  });

  it("treats a different `to` / destination_ref as a fingerprint mismatch", () => {
    acceptSend(baseReq(), { db, now: () => now, newId: () => "row-1" });
    const r = acceptSend(baseReq({ to: "bob", destination_ref: "bob" }), {
      db, now: () => now, newId: () => "row-x",
    });
    expect(r.kind).toBe("conflict");
  });

  it("treats different priority as a fingerprint mismatch", () => {
    acceptSend(baseReq(), { db, now: () => now, newId: () => "row-1" });
    const r = acceptSend(baseReq({ priority: "now" }), { db, now: () => now, newId: () => "row-x" });
    expect(r.kind).toBe("conflict");
  });

  it("ignores meta key ordering when computing fingerprint", () => {
    acceptSend(baseReq({ meta: { z: 1, a: 2 } }), { db, now: () => now, newId: () => "row-1" });
    const r = acceptSend(baseReq({ meta: { a: 2, z: 1 } }), { db, now: () => now, newId: () => "row-x" });
    expect(r.kind).toBe("accepted_pending"); // same canonical JSON
  });

  // inflight ------------------------------------------------------------------
  it("inflight + match → 202 accepted_inflight", () => {
    acceptSend(baseReq(), { db, now: () => now, newId: () => "row-1" });
    db.prepare(`UPDATE outbox SET status = 'inflight' WHERE client_message_id = ?`).run("key-A");
    const r = acceptSend(baseReq(), { db, now: () => now, newId: () => "row-x" });
    expect(r.kind).toBe("accepted_inflight");
  });

  it("inflight + mismatch → 409 outbox_inflight_fingerprint_mismatch", () => {
    acceptSend(baseReq(), { db, now: () => now, newId: () => "row-1" });
    db.prepare(`UPDATE outbox SET status = 'inflight' WHERE client_message_id = ?`).run("key-A");
    const r = acceptSend(baseReq({ message: "X" }), { db, now: () => now, newId: () => "row-x" });
    expect(r).toMatchObject({ kind: "conflict", reason: "outbox_inflight_fingerprint_mismatch" });
  });

  // done ----------------------------------------------------------------------
  it("done + match → 200 with broker_message_id", () => {
    acceptSend(baseReq(), { db, now: () => now, newId: () => "row-1" });
    db.prepare(`UPDATE outbox SET status = 'done', broker_message_id = ? WHERE client_message_id = ?`)
      .run("bm-1", "key-A");
    const r = acceptSend(baseReq(), { db, now: () => now, newId: () => "row-x" });
    expect(r).toMatchObject({ kind: "accepted_done", status: 200, broker_message_id: "bm-1" });
  });

  it("done + mismatch → 409 outbox_done_fingerprint_mismatch with broker_message_id surfaced", () => {
    acceptSend(baseReq(), { db, now: () => now, newId: () => "row-1" });
    db.prepare(`UPDATE outbox SET status = 'done', broker_message_id = ? WHERE client_message_id = ?`)
      .run("bm-1", "key-A");
    const r = acceptSend(baseReq({ message: "X" }), { db, now: () => now, newId: () => "row-x" });
    expect(r).toMatchObject({
      kind: "conflict",
      reason: "outbox_done_fingerprint_mismatch",
      broker_message_id: "bm-1",
    });
  });

  // dead ----------------------------------------------------------------------
  it("dead + match → 409 outbox_dead_fingerprint_match (id never auto-retried)", () => {
    acceptSend(baseReq(), { db, now: () => now, newId: () => "row-1" });
    db.prepare(`UPDATE outbox SET status = 'dead', last_error = ? WHERE client_message_id = ?`)
      .run("payload too large", "key-A");
    const r = acceptSend(baseReq(), { db, now: () => now, newId: () => "row-x" });
    expect(r).toMatchObject({ kind: "conflict", reason: "outbox_dead_fingerprint_match" });
  });

  it("dead + mismatch → 409 outbox_dead_fingerprint_mismatch", () => {
    acceptSend(baseReq(), { db, now: () => now, newId: () => "row-1" });
    db.prepare(`UPDATE outbox SET status = 'dead' WHERE client_message_id = ?`).run("key-A");
    const r = acceptSend(baseReq({ message: "X" }), { db, now: () => now, newId: () => "row-x" });
    expect(r).toMatchObject({ kind: "conflict", reason: "outbox_dead_fingerprint_mismatch" });
  });

  // aborted -------------------------------------------------------------------
  it("aborted + match → 409 outbox_aborted_fingerprint_match (operator-retired id is permanently dead)", () => {
    acceptSend(baseReq(), { db, now: () => now, newId: () => "row-1" });
    db.prepare(`UPDATE outbox SET status = 'aborted', aborted_at = ?, aborted_by = ? WHERE client_message_id = ?`)
      .run(now, "operator", "key-A");
    const r = acceptSend(baseReq(), { db, now: () => now, newId: () => "row-x" });
    expect(r).toMatchObject({ kind: "conflict", reason: "outbox_aborted_fingerprint_match" });
  });

  it("aborted + mismatch → 409 outbox_aborted_fingerprint_mismatch", () => {
    acceptSend(baseReq(), { db, now: () => now, newId: () => "row-1" });
    db.prepare(`UPDATE outbox SET status = 'aborted', aborted_at = ?, aborted_by = ? WHERE client_message_id = ?`)
      .run(now, "operator", "key-A");
    const r = acceptSend(baseReq({ message: "X" }), { db, now: () => now, newId: () => "row-x" });
    expect(r).toMatchObject({ kind: "conflict", reason: "outbox_aborted_fingerprint_mismatch" });
  });
});
