// Inbox schema + accessors. Schema is the v0.9.0 spec §4.10 / v3 §4.5
// content table; FTS5 index is deferred to the followups doc.

import type { SqliteDb } from "./sqlite.js";

export interface InboxRow {
  id: string;
  client_message_id: string;
  broker_message_id: string | null;
  mesh: string;
  topic: string | null;
  sender_pubkey: string;
  sender_name: string;
  body: string | null;
  meta: string | null;
  received_at: number;
  reply_to_id: string | null;
}

export function migrateInbox(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbox (
      id                  TEXT PRIMARY KEY,
      client_message_id   TEXT NOT NULL UNIQUE,
      broker_message_id   TEXT,
      mesh                TEXT NOT NULL,
      topic               TEXT,
      sender_pubkey       TEXT NOT NULL,
      sender_name         TEXT NOT NULL,
      body                TEXT,
      meta                TEXT,
      received_at         INTEGER NOT NULL,
      reply_to_id         TEXT
    );
    CREATE INDEX IF NOT EXISTS inbox_received_at ON inbox(received_at);
    CREATE INDEX IF NOT EXISTS inbox_topic       ON inbox(topic);
    CREATE INDEX IF NOT EXISTS inbox_sender      ON inbox(sender_pubkey);
  `);
}

/**
 * Spec §4.5 insert path:
 *   INSERT ... ON CONFLICT(client_message_id) DO NOTHING RETURNING id
 *
 * Returns the new row id when this was a fresh insert, or null when the
 * message id was already known (idempotent receive).
 */
export function insertIfNew(db: SqliteDb, row: Omit<InboxRow, "id"> & { id: string }): string | null {
  // node:sqlite does support RETURNING. bun:sqlite does too. We branch on
  // the row count instead so it works on both.
  const before = db.prepare(`SELECT id FROM inbox WHERE client_message_id = ?`).get<{ id: string }>(row.client_message_id);
  if (before) return null;
  db.prepare(`
    INSERT INTO inbox (
      id, client_message_id, broker_message_id, mesh, topic,
      sender_pubkey, sender_name, body, meta, received_at, reply_to_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_message_id) DO NOTHING
  `).run(
    row.id, row.client_message_id, row.broker_message_id, row.mesh, row.topic,
    row.sender_pubkey, row.sender_name, row.body, row.meta, row.received_at, row.reply_to_id,
  );
  // Confirm the insert landed (handles the conflict-noop race).
  const after = db.prepare(`SELECT id FROM inbox WHERE client_message_id = ?`).get<{ id: string }>(row.client_message_id);
  return after?.id === row.id ? row.id : null;
}

export interface ListInboxParams {
  since?: number;        // received_at >= since
  topic?: string;
  fromPubkey?: string;
  limit?: number;
}

export function listInbox(db: SqliteDb, p: ListInboxParams): InboxRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (p.since !== undefined)     { where.push("received_at >= ?"); args.push(p.since); }
  if (p.topic !== undefined)     { where.push("topic = ?");        args.push(p.topic); }
  if (p.fromPubkey !== undefined){ where.push("sender_pubkey = ?"); args.push(p.fromPubkey); }
  const sql = `
    SELECT id, client_message_id, broker_message_id, mesh, topic,
           sender_pubkey, sender_name, body, meta, received_at, reply_to_id
      FROM inbox
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY received_at DESC
     LIMIT ?
  `;
  args.push(Math.min(Math.max(p.limit ?? 100, 1), 1000));
  return db.prepare(sql).all<InboxRow>(...args);
}
