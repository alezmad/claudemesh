// Outbox drain worker. Walks `outbox.pending` rows, sends them to the
// broker via DaemonBrokerClient, and transitions row state per spec §4.6.1.
//
// Lifecycle per row:
//   pending  → inflight → done            (broker accepted)
//                       → pending+backoff (transient broker error)
//                       → dead            (permanent broker error or
//                                         attempt cap reached)
//
// Wakeable: insertPending in the IPC handler can call wake() to skip the
// idle interval. We use a simple promise-replacing pattern instead of a
// pollable signal.

import type { SqliteDb } from "./db/sqlite.js";
import type { DaemonBrokerClient } from "./broker.js";
import type { SessionBrokerClient } from "./session-broker.js";
import type { OutboxStatus } from "./db/outbox.js";

const POLL_INTERVAL_MS    = 500;
export const MAX_ATTEMPTS_PER_ROW = 25;
const BACKOFF_BASE_MS     = 500;
const BACKOFF_CAP_MS      = 30_000;
/**
 * 1.37.1 — outbox hygiene (spec 2026-09-08-daemon-restart-mesh-blackout §8).
 *
 * Before these caps, a row bound to a session WS that never came back
 * (stale session pubkey from a previous day) was retried forever: the
 * not-ready path neither counted attempts nor expired, and it logged
 * `drain_session_ws_not_ready` on EVERY tick. Four such rows reached
 * ~130k attempts each and grew daemon.log to 1 GB (disk at 95%).
 */
/** Any pending/inflight row older than this is dead (`expired`). */
export const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;
/** A session-attributed row whose session is no longer registered at all
 *  (not merely reconnecting) is dead after this age (`session_gone`). */
export const SESSION_GONE_TTL_MS = 10 * 60 * 1000;
/** `drain_session_ws_not_ready` is logged on attempt 1 and every Nth after. */
export const NOT_READY_LOG_EVERY = 60;

interface PendingRow {
  id: string;
  client_message_id: string;
  request_fingerprint: Uint8Array;
  payload: Uint8Array;
  attempts: number;
  enqueued_at: number;
  /** Sprint 4 routing fields. NULL on legacy v0.9.0 rows → broadcast fallback. */
  target_spec: string | null;
  nonce: string | null;
  ciphertext: string | null;
  priority: string | null;
  mesh: string | null;
  /** 1.34.0: hex pubkey of the originating session — drain prefers
   *  routing via that session's WS so broker fan-out attributes the
   *  push to the session pubkey. NULL on cold-path / pre-1.34.0 rows. */
  sender_session_pubkey: string | null;
}

export interface DrainOptions {
  db: SqliteDb;
  /** v1.26.0: per-mesh broker map. Drain dispatches each row to the
   *  broker keyed by its `mesh` column. Single-mesh daemons pass a
   *  Map of size 1; multi-mesh daemons pass one entry per joined mesh. */
  brokers: Map<string, DaemonBrokerClient>;
  /**
   * 1.34.0: lookup for the per-session WS keyed by hex session pubkey.
   * When an outbox row has `sender_session_pubkey` set and this lookup
   * returns an open client, the drain routes via the session-WS so the
   * broker fan-out attributes the push to the session pubkey instead
   * of the daemon's stable member pubkey.
   *
   * Returning `undefined` (or an unopened client) signals "no session
   * WS available" — the drain backs off and retries; it does NOT fall
   * back to the daemon-WS, because the row was encrypted with the
   * session secret and would fail to decrypt on the recipient side
   * if attribution silently changed mid-flight.
   */
  getSessionBrokerByPubkey?: (sessionPubkey: string) => SessionBrokerClient | undefined;
  log?: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
  /** Clock override for tests. Defaults to Date.now. */
  nowFn?: () => number;
}

export interface DrainHandle {
  wake(): void;
  close(): Promise<void>;
}

export function startDrainWorker(opts: DrainOptions): DrainHandle {
  const log = opts.log ?? defaultLog;
  let stopped = false;
  let wakeResolve: (() => void) | null = null;
  let wakePromise = new Promise<void>((r) => { wakeResolve = r; });

  const wake = () => {
    if (wakeResolve) {
      const r = wakeResolve;
      wakeResolve = null;
      r();
    }
  };

  const tick = async () => {
    while (!stopped) {
      try { await drainOnce(opts, log); }
      catch (e) { log("warn", "drain_tick_failed", { err: String(e) }); }
      // Sleep up to POLL_INTERVAL_MS, but wake immediately on signal.
      await Promise.race([
        wakePromise,
        new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS)),
      ]);
      // Reset wake promise after each loop.
      wakePromise = new Promise<void>((r) => { wakeResolve = r; });
    }
  };

  void tick();

  return {
    wake,
    close: async () => { stopped = true; wake(); },
  };
}

/** Exported for tests: one drain pass. */
export async function drainOnce(opts: DrainOptions, log: NonNullable<DrainOptions["log"]> = opts.log ?? defaultLog): Promise<void> {
  const now = (opts.nowFn ?? Date.now)();

  // TTL sweep: anything still undelivered after OUTBOX_TTL_MS is dead.
  // One UPDATE per tick; cheap on the (status, next_attempt_at) index.
  const expired = Number(opts.db.prepare(`
    UPDATE outbox
       SET status = 'dead', last_error = 'expired'
     WHERE status IN ('pending', 'inflight') AND enqueued_at < ?
  `).run(now - OUTBOX_TTL_MS).changes);
  if (expired > 0) log("warn", "drain_expired_rows", { count: expired, ttl_ms: OUTBOX_TTL_MS });

  const rows = opts.db.prepare(`
    SELECT id, client_message_id, request_fingerprint, payload, attempts, enqueued_at,
           target_spec, nonce, ciphertext, priority, mesh,
           sender_session_pubkey
      FROM outbox
     WHERE status = 'pending' AND next_attempt_at <= ?
     ORDER BY enqueued_at
     LIMIT 32
  `).all<PendingRow>(now);

  if (rows.length === 0) return;

  for (const row of rows) {
    if (markInflight(opts.db, row.id, now) === 0) continue; // raced with another drainer
    const fpHex = bufferToHex(row.request_fingerprint);

    // v1.26.0: pick the daemon-WS broker keyed by the row's mesh.
    // Legacy rows (mesh=NULL) fall back to the only broker if there's
    // exactly one; otherwise mark dead because we don't know where to
    // send them.
    let daemonBroker: DaemonBrokerClient | undefined;
    if (row.mesh) {
      daemonBroker = opts.brokers.get(row.mesh);
    } else if (opts.brokers.size === 1) {
      daemonBroker = opts.brokers.values().next().value;
    }
    if (!daemonBroker) {
      log("warn", "drain_no_broker_for_mesh", { id: row.id, mesh: row.mesh ?? "(null)" });
      markDead(opts.db, row.id, `no_broker_for_mesh:${row.mesh ?? "null"}`);
      continue;
    }

    // 1.34.0: when the row was written by an authenticated session,
    // dispatch via the matching SessionBrokerClient so broker fan-out
    // attributes the push to the session pubkey. Encryption is
    // session-secret based on those rows, so we MUST NOT silently fall
    // back to the daemon-WS — the recipient's decrypt would fail. If
    // the session-WS is closed (reconnecting / session terminated), we
    // back off and retry.
    let sessionBroker: SessionBrokerClient | undefined;
    if (row.sender_session_pubkey && opts.getSessionBrokerByPubkey) {
      sessionBroker = opts.getSessionBrokerByPubkey(row.sender_session_pubkey);
    }

    // Sprint 4: use the row's resolved target/ciphertext if present.
    // Legacy v0.9.0 rows (NULL on these columns) fall back to the
    // broadcast smoke-test shape so existing in-flight rows still drain.
    let targetSpec: string;
    let nonce:      string;
    let ciphertext: string;
    let priority:   "now" | "next" | "low";
    if (row.target_spec && row.nonce && row.ciphertext) {
      targetSpec = row.target_spec;
      nonce      = row.nonce;
      ciphertext = row.ciphertext;
      priority   = (row.priority === "now" || row.priority === "low") ? row.priority : "next";
    } else {
      targetSpec = "*";
      nonce      = await randomNonce();
      ciphertext = Buffer.from(row.payload).toString("base64");
      priority   = "next";
    }

    const sendArgs = {
      targetSpec,
      priority,
      nonce,
      ciphertext,
      client_message_id: row.client_message_id,
      request_fingerprint_hex: fpHex,
    };

    let res;
    try {
      if (row.sender_session_pubkey) {
        // Session-attributed row. Require an open session-WS — see comment
        // above on why we don't fall back to the daemon-WS.
        if (!sessionBroker || !sessionBroker.isOpen()) {
          const attempts = row.attempts + 1;
          // No registered session owns this pubkey at all (not merely a
          // reconnecting one) and the row has waited long enough: the
          // session is gone, nothing will ever send it. Dead, not retry.
          if (!sessionBroker && now - row.enqueued_at > SESSION_GONE_TTL_MS) {
            log("warn", "drain_session_gone", {
              id: row.id, session_pubkey: row.sender_session_pubkey.slice(0, 12), attempts,
            });
            markDead(opts.db, row.id, "session_gone");
            continue;
          }
          if (attempts === 1 || attempts % NOT_READY_LOG_EVERY === 0) {
            log("info", "drain_session_ws_not_ready", {
              id: row.id, session_pubkey: row.sender_session_pubkey.slice(0, 12), attempts,
              registered: !!sessionBroker,
            });
          }
          if (attempts >= MAX_ATTEMPTS_PER_ROW) {
            log("warn", "drain_max_attempts", { id: row.id, err: "session_ws_not_open" });
            markDead(opts.db, row.id, "max_attempts: session_ws_not_open");
            continue;
          }
          backoffPending(opts.db, row.id, attempts, "session_ws_not_open", "session_ws_not_open", now);
          continue;
        }
        res = await sessionBroker.send(sendArgs);
      } else {
        res = await daemonBroker.send(sendArgs);
      }
    } catch (e) {
      log("warn", "drain_send_threw", { id: row.id, err: String(e) });
      backoffPending(opts.db, row.id, row.attempts + 1, "exception", String(e), now);
      continue;
    }

    if (res.ok) {
      markDone(opts.db, row.id, res.messageId, Date.now());
    } else if (res.permanent) {
      log("warn", "drain_permanent_failure", { id: row.id, err: res.error });
      markDead(opts.db, row.id, res.error);
    } else if (row.attempts + 1 >= MAX_ATTEMPTS_PER_ROW) {
      log("warn", "drain_max_attempts", { id: row.id, err: res.error });
      markDead(opts.db, row.id, `max_attempts: ${res.error}`);
    } else {
      backoffPending(opts.db, row.id, row.attempts + 1, "retry", res.error, now);
    }
  }
}

function markInflight(db: SqliteDb, id: string, now: number): number {
  return Number(db.prepare(`
    UPDATE outbox
       SET status = 'inflight', attempts = attempts + 1, next_attempt_at = ?
     WHERE id = ? AND status = 'pending'
  `).run(now + BACKOFF_CAP_MS, id).changes);
}

function markDone(db: SqliteDb, id: string, brokerMessageId: string, now: number) {
  db.prepare(`
    UPDATE outbox
       SET status = 'done', delivered_at = ?, broker_message_id = ?, last_error = NULL
     WHERE id = ?
  `).run(now, brokerMessageId, id);
}

function markDead(db: SqliteDb, id: string, err: string) {
  db.prepare(`UPDATE outbox SET status = 'dead', last_error = ? WHERE id = ?`).run(err, id);
}

function backoffPending(db: SqliteDb, id: string, attempts: number, _kind: string, err: string, now: number = Date.now()) {
  const wait = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * (2 ** Math.min(attempts, 12)));
  const next = now + wait;
  db.prepare(`
    UPDATE outbox
       SET status = 'pending', attempts = ?, next_attempt_at = ?, last_error = ?
     WHERE id = ?
  `).run(attempts, next, err, id);
}

function bufferToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}

async function randomNonce(): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  return randomBytes(24).toString("base64");
}

function defaultLog(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() });
  if (level === "info") process.stdout.write(line + "\n");
  else process.stderr.write(line + "\n");
}

// Suppress unused-status warning under strict tsc:
const _statuses: OutboxStatus[] = ["pending", "inflight", "done", "dead", "aborted"];
void _statuses;
