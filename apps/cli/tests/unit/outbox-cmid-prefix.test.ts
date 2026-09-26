/** bug8 (2026-09-26): the 8-char id `send` prints must resolve. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqlite, type SqliteDb } from "~/daemon/db/sqlite.js";
import { insertPending, listOutbox, migrateOutbox } from "~/daemon/db/outbox.js";

describe("listOutbox by client_message_id prefix", () => {
  let dir: string;
  let db: SqliteDb;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cmh-outbox-"));
    db = await openSqlite(join(dir, "outbox.db"));
    migrateOutbox(db);
    for (const [id, cmid] of [["a", "5b8526af-1111-4222-8333-444455556666"], ["b", "5b8599aa-1111-4222-8333-444455556666"]] as const) {
      insertPending(db, {
        id, client_message_id: cmid, request_fingerprint: new Uint8Array(32), payload: new Uint8Array([1]),
        now: Date.now(), mesh: "m", target_spec: "t", nonce: "n", ciphertext: "c", priority: "next",
      });
    }
  });
  afterEach(() => { try { db.close(); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); });

  it("matches the 8 chars send printed", () => {
    expect(listOutbox(db, { clientMessageIdPrefix: "5b8526af" }).map((r) => r.id)).toEqual(["a"]);
  });
  it("ignores hyphens either way", () => {
    expect(listOutbox(db, { clientMessageIdPrefix: "5b8526af1111" }).map((r) => r.id)).toEqual(["a"]);
    expect(listOutbox(db, { clientMessageIdPrefix: "5b8526af-1111-4222" }).map((r) => r.id)).toEqual(["a"]);
  });
  it("a shared prefix returns both (caller reports ambiguity)", () => {
    expect(listOutbox(db, { clientMessageIdPrefix: "5b85" }).length).toBe(2);
  });
});
