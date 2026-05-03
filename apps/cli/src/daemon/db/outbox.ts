// Outbox schema + accessors. Schema is the v0.9.0 spec §4.5.2 shape:
// includes `aborted` status and audit columns from the v7 pull.

import type { SqliteDb } from "./sqlite.js";

export type OutboxStatus = "pending" | "inflight" | "done" | "dead" | "aborted";

export interface OutboxRow {
  id: string;
  client_message_id: string;
  request_fingerprint: Uint8Array;
  payload: Uint8Array;
  enqueued_at: number;
  attempts: number;
  next_attempt_at: number;
  status: OutboxStatus;
  last_error: string | null;
  delivered_at: number | null;
  broker_message_id: string | null;
  aborted_at: number | null;
  aborted_by: string | null;
  superseded_by: string | null;
}

export function migrateOutbox(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS outbox (
      id                  TEXT PRIMARY KEY,
      client_message_id   TEXT NOT NULL UNIQUE,
      request_fingerprint BLOB NOT NULL,
      payload             BLOB NOT NULL,
      enqueued_at         INTEGER NOT NULL,
      attempts            INTEGER NOT NULL DEFAULT 0,
      next_attempt_at     INTEGER NOT NULL,
      status              TEXT NOT NULL CHECK(status IN
                            ('pending','inflight','done','dead','aborted')),
      last_error          TEXT,
      delivered_at        INTEGER,
      broker_message_id   TEXT,
      aborted_at          INTEGER,
      aborted_by          TEXT,
      superseded_by       TEXT
    );
    CREATE INDEX IF NOT EXISTS outbox_pending
      ON outbox(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS outbox_aborted
      ON outbox(status, aborted_at) WHERE status = 'aborted';
  `);
}

export function findByClientId(db: SqliteDb, clientMessageId: string): OutboxRow | null {
  const row = db.prepare(`
    SELECT id, client_message_id, request_fingerprint, payload, enqueued_at,
           attempts, next_attempt_at, status, last_error, delivered_at,
           broker_message_id, aborted_at, aborted_by, superseded_by
      FROM outbox WHERE client_message_id = ?
  `).get<OutboxRow>(clientMessageId);
  return row ?? null;
}

export interface InsertPendingInput {
  id: string;
  client_message_id: string;
  request_fingerprint: Uint8Array;
  payload: Uint8Array;
  now: number;
}

export function insertPending(db: SqliteDb, input: InsertPendingInput): void {
  db.prepare(`
    INSERT INTO outbox (
      id, client_message_id, request_fingerprint, payload,
      enqueued_at, attempts, next_attempt_at, status
    ) VALUES (?, ?, ?, ?, ?, 0, ?, 'pending')
  `).run(
    input.id,
    input.client_message_id,
    input.request_fingerprint,
    input.payload,
    input.now,
    input.now,
  );
}

export function markAborted(db: SqliteDb, id: string, by: string, supersededBy: string | null, now: number): void {
  db.prepare(`
    UPDATE outbox SET status = 'aborted', aborted_at = ?, aborted_by = ?, superseded_by = ?
      WHERE id = ?
  `).run(now, by, supersededBy, id);
}

export function fingerprintsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i]! ^ b[i]!);
  return diff === 0;
}

export interface ListOutboxParams {
  status?: OutboxStatus;
  limit?: number;
}

export function listOutbox(db: SqliteDb, p: ListOutboxParams = {}): OutboxRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (p.status) { where.push("status = ?"); args.push(p.status); }
  const sql = `
    SELECT id, client_message_id, request_fingerprint, payload, enqueued_at,
           attempts, next_attempt_at, status, last_error, delivered_at,
           broker_message_id, aborted_at, aborted_by, superseded_by
      FROM outbox
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY enqueued_at DESC
     LIMIT ?
  `;
  args.push(Math.min(Math.max(p.limit ?? 50, 1), 500));
  return db.prepare(sql).all<OutboxRow>(...args);
}

export function findById(db: SqliteDb, id: string): OutboxRow | null {
  return db.prepare(`
    SELECT id, client_message_id, request_fingerprint, payload, enqueued_at,
           attempts, next_attempt_at, status, last_error, delivered_at,
           broker_message_id, aborted_at, aborted_by, superseded_by
      FROM outbox WHERE id = ?
  `).get<OutboxRow>(id) ?? null;
}

export interface RequeueResult {
  abortedRowId: string;
  newRowId: string;
  newClientMessageId: string;
}

/**
 * Operator recovery per spec §4.5.3 / §4.6.3. Atomically:
 *   1. Mark the existing row aborted (audit columns set, status flipped).
 *   2. Insert a fresh pending row reusing the same payload+fingerprint
 *      under a new client_message_id.
 *   3. Wire superseded_by on the old row to the new row id.
 *
 * Returns null if the requested id doesn't exist or is already aborted/done.
 */
export function requeueDeadOrPending(
  db: SqliteDb,
  args: { id: string; newClientMessageId: string; newRowId: string; now: number; abortedBy: string },
): RequeueResult | null {
  const existing = findById(db, args.id);
  if (!existing) return null;
  if (existing.status === "aborted" || existing.status === "done") return null;

  db.prepare(`
    UPDATE outbox
       SET status = 'aborted', aborted_at = ?, aborted_by = ?, superseded_by = ?
     WHERE id = ? AND status IN ('pending','inflight','dead')
  `).run(args.now, args.abortedBy, args.newRowId, args.id);

  db.prepare(`
    INSERT INTO outbox (
      id, client_message_id, request_fingerprint, payload,
      enqueued_at, attempts, next_attempt_at, status
    ) VALUES (?, ?, ?, ?, ?, 0, ?, 'pending')
  `).run(
    args.newRowId,
    args.newClientMessageId,
    existing.request_fingerprint,
    existing.payload,
    args.now,
    args.now,
  );

  return {
    abortedRowId: existing.id,
    newRowId: args.newRowId,
    newClientMessageId: args.newClientMessageId,
  };
}
