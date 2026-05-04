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
  /** 1.34.8: Unix ms of when this row was first surfaced to the user
   *  (returned by an interactive `inbox` listing or pushed via channel
   *  reminder). NULL = never seen. Welcome filters on `seen_at IS NULL`
   *  so freshly-launched sessions only see what they actually missed. */
  seen_at: number | null;
  /** 1.34.11: pubkey of the WS that received this push. Either the
   *  daemon's member pubkey for member-keyed broadcasts, or one of
   *  our session pubkeys for session-targeted DMs. Without this, two
   *  sessions on the same daemon shared one inbox table and each saw
   *  every other session's messages — same bug shape the 1.34.10 SSE
   *  demux fixed for the live event path, just at the storage layer.
   *  Pre-1.34.11 rows have NULL here and are visible to every session
   *  on the same mesh (best-effort back-compat for already-stored
   *  history). */
  recipient_pubkey: string | null;
  /** 1.34.11: matches `recipient_kind` on the bus event. "session" =
   *  scoped to one session pubkey; "member" = visible to every
   *  session of that member on the mesh. NULL on legacy rows. */
  recipient_kind: string | null;
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
  // 1.34.8: read-state tracking. Pre-1.34.8 rows land with seen_at=NULL
  // (treated as unread); welcome surfaces them once and the listing
  // marks them seen. Indexed because welcome queries WHERE seen_at IS
  // NULL on every launch.
  const cols = db.prepare(`PRAGMA table_info(inbox)`).all<{ name: string }>();
  if (!cols.some((c) => c.name === "seen_at")) {
    db.exec(`ALTER TABLE inbox ADD COLUMN seen_at INTEGER`);
    db.exec(`CREATE INDEX IF NOT EXISTS inbox_seen_at ON inbox(seen_at)`);
  }
  // 1.34.11: per-recipient scoping. Two sessions on the same daemon
  // share one inbox table; without this column, listInbox returns
  // every row regardless of which session is asking. Indexed
  // because every interactive listing + welcome path filters by it.
  if (!cols.some((c) => c.name === "recipient_pubkey")) {
    db.exec(`ALTER TABLE inbox ADD COLUMN recipient_pubkey TEXT`);
    db.exec(`ALTER TABLE inbox ADD COLUMN recipient_kind TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS inbox_recipient ON inbox(recipient_pubkey)`);
  }
}

/**
 * Spec §4.5 insert path:
 *   INSERT ... ON CONFLICT(client_message_id) DO NOTHING RETURNING id
 *
 * Returns the new row id when this was a fresh insert, or null when the
 * message id was already known (idempotent receive).
 */
export function insertIfNew(
  db: SqliteDb,
  // 1.34.8: callers don't pass `seen_at` — it's always NULL on insert
  // (a freshly-received row is by definition unread). Stripping the
  // field from the input type keeps inbound.ts callers from having to
  // construct it.
  row: Omit<InboxRow, "id" | "seen_at"> & { id: string },
): string | null {
  // node:sqlite does support RETURNING. bun:sqlite does too. We branch on
  // the row count instead so it works on both.
  const before = db.prepare(`SELECT id FROM inbox WHERE client_message_id = ?`).get<{ id: string }>(row.client_message_id);
  if (before) return null;
  db.prepare(`
    INSERT INTO inbox (
      id, client_message_id, broker_message_id, mesh, topic,
      sender_pubkey, sender_name, body, meta, received_at, reply_to_id,
      recipient_pubkey, recipient_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_message_id) DO NOTHING
  `).run(
    row.id, row.client_message_id, row.broker_message_id, row.mesh, row.topic,
    row.sender_pubkey, row.sender_name, row.body, row.meta, row.received_at, row.reply_to_id,
    row.recipient_pubkey, row.recipient_kind,
  );
  // Confirm the insert landed (handles the conflict-noop race).
  const after = db.prepare(`SELECT id FROM inbox WHERE client_message_id = ?`).get<{ id: string }>(row.client_message_id);
  return after?.id === row.id ? row.id : null;
}

export interface ListInboxParams {
  since?: number;        // received_at >= since
  topic?: string;
  fromPubkey?: string;
  /** 1.34.0: filter by mesh slug. Omit to return rows across all meshes. */
  mesh?: string;
  /** 1.34.8: only rows with `seen_at IS NULL`. Used by the welcome
   *  push so a freshly-launched session surfaces what it actually
   *  missed instead of every row from the last 24h. */
  unreadOnly?: boolean;
  /** 1.34.11: scope to rows whose recipient is this session pubkey,
   *  PLUS member-keyed rows for the same member, PLUS legacy rows
   *  with a NULL recipient (best-effort back-compat with pre-1.34.11
   *  history). Set by the IPC `/v1/inbox` route from the bearer
   *  session token; without it the listing returns everything.
   *  `recipientMemberPubkey` widens the match to include broadcasts
   *  / member DMs that should reach every session of this member. */
  recipientPubkey?: string;
  recipientMemberPubkey?: string;
  limit?: number;
}

export function listInbox(db: SqliteDb, p: ListInboxParams): InboxRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (p.since !== undefined)     { where.push("received_at >= ?"); args.push(p.since); }
  if (p.topic !== undefined)     { where.push("topic = ?");        args.push(p.topic); }
  if (p.fromPubkey !== undefined){ where.push("sender_pubkey = ?"); args.push(p.fromPubkey); }
  if (p.mesh !== undefined)      { where.push("mesh = ?");          args.push(p.mesh); }
  if (p.unreadOnly === true)     { where.push("seen_at IS NULL"); }
  // 1.34.11: recipient scoping. A session sees:
  //   - rows whose recipient_pubkey === its session pubkey (its DMs),
  //   - rows whose recipient_pubkey === the daemon's member pubkey
  //     (broadcasts / member-keyed DMs to anyone in this member's
  //     identity — every sibling session sees them),
  //   - legacy rows where recipient_pubkey IS NULL (pre-1.34.11
  //     history; we can't tell who they were for, so surface to all).
  if (p.recipientPubkey) {
    const ors: string[] = ["recipient_pubkey IS NULL", "recipient_pubkey = ?"];
    args.push(p.recipientPubkey);
    if (p.recipientMemberPubkey) {
      ors.push("recipient_pubkey = ?");
      args.push(p.recipientMemberPubkey);
    }
    where.push(`(${ors.join(" OR ")})`);
  }
  const sql = `
    SELECT id, client_message_id, broker_message_id, mesh, topic,
           sender_pubkey, sender_name, body, meta, received_at, reply_to_id, seen_at,
           recipient_pubkey, recipient_kind
      FROM inbox
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY received_at DESC
     LIMIT ?
  `;
  args.push(Math.min(Math.max(p.limit ?? 100, 1), 1000));
  return db.prepare(sql).all<InboxRow>(...args);
}

/** 1.34.8: stamp `seen_at = now` on every row whose id is in `ids`,
 *  but only when `seen_at IS NULL` so re-marking doesn't bump the
 *  timestamp on a row the user already knew about. Returns the number
 *  of rows that flipped from unread → seen. Used by:
 *    - the IPC `/v1/inbox` route when called by an interactive
 *      listing (the daemon stamps after returning rows so the human
 *      who just looked at their inbox doesn't see the same rows
 *      flagged "unread" on next launch);
 *    - the MCP server when the SSE message event surfaces a live
 *      `<channel>` reminder (Claude Code already saw the row inline,
 *      no need to surface it again on welcome). */
export function markInboxSeen(db: SqliteDb, ids: readonly string[], now = Date.now()): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const r = db.prepare(
    `UPDATE inbox SET seen_at = ? WHERE seen_at IS NULL AND id IN (${placeholders})`,
  ).run(now, ...ids);
  return Number(r.changes);
}

/** 1.34.8: TTL prune. Removes inbox rows older than `cutoffMs`
 *  (received_at < cutoffMs). Daemon schedules this hourly with a 30-day
 *  default retention (see startInboxPruner). Returns the number of
 *  rows removed so the caller can log the volume. */
export function pruneInboxBefore(db: SqliteDb, cutoffMs: number): number {
  const r = db.prepare(`DELETE FROM inbox WHERE received_at < ?`).run(cutoffMs);
  return Number(r.changes);
}

/** 1.34.7: delete a single inbox row by id. Returns true iff a row was
 *  removed. The CLI exposes this as `claudemesh inbox delete <id>`. */
export function deleteInboxRow(db: SqliteDb, id: string): boolean {
  const r = db.prepare(`DELETE FROM inbox WHERE id = ?`).run(id);
  return Number(r.changes) > 0;
}

/** 1.34.7: bulk delete with mesh / age filters. Returns the number of
 *  rows removed. With no filter, deletes ALL rows on ALL meshes —
 *  caller is expected to gate this behind a `--all` confirmation. */
export interface FlushInboxParams {
  mesh?: string;
  /** Unix ms — delete rows received_at < before. */
  before?: number;
}
export function flushInbox(db: SqliteDb, p: FlushInboxParams): number {
  const where: string[] = [];
  const args: unknown[] = [];
  if (p.mesh   !== undefined) { where.push("mesh = ?");        args.push(p.mesh); }
  if (p.before !== undefined) { where.push("received_at < ?"); args.push(p.before); }
  const sql = `DELETE FROM inbox ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const r = db.prepare(sql).run(...args);
  return Number(r.changes);
}
