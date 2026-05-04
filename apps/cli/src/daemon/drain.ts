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
import type { OutboxStatus } from "./db/outbox.js";

const POLL_INTERVAL_MS    = 500;
const MAX_ATTEMPTS_PER_ROW = 25;
const BACKOFF_BASE_MS     = 500;
const BACKOFF_CAP_MS      = 30_000;

interface PendingRow {
  id: string;
  client_message_id: string;
  request_fingerprint: Uint8Array;
  payload: Uint8Array;
  attempts: number;
  /** Sprint 4 routing fields. NULL on legacy v0.9.0 rows → broadcast fallback. */
  target_spec: string | null;
  nonce: string | null;
  ciphertext: string | null;
  priority: string | null;
  mesh: string | null;
}

export interface DrainOptions {
  db: SqliteDb;
  /** v1.26.0: per-mesh broker map. Drain dispatches each row to the
   *  broker keyed by its `mesh` column. Single-mesh daemons pass a
   *  Map of size 1; multi-mesh daemons pass one entry per joined mesh. */
  brokers: Map<string, DaemonBrokerClient>;
  log?: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
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

async function drainOnce(opts: DrainOptions, log: NonNullable<DrainOptions["log"]>): Promise<void> {
  const now = Date.now();
  const rows = opts.db.prepare(`
    SELECT id, client_message_id, request_fingerprint, payload, attempts,
           target_spec, nonce, ciphertext, priority, mesh
      FROM outbox
     WHERE status = 'pending' AND next_attempt_at <= ?
     ORDER BY enqueued_at
     LIMIT 32
  `).all<PendingRow>(now);

  if (rows.length === 0) return;

  for (const row of rows) {
    if (markInflight(opts.db, row.id, now) === 0) continue; // raced with another drainer
    const fpHex = bufferToHex(row.request_fingerprint);

    // v1.26.0: pick the broker keyed by the row's mesh. Legacy rows
    // (mesh=NULL) fall back to the only broker if there's exactly one;
    // otherwise mark dead because we don't know where to send them.
    let broker: DaemonBrokerClient | undefined;
    if (row.mesh) {
      broker = opts.brokers.get(row.mesh);
    } else if (opts.brokers.size === 1) {
      broker = opts.brokers.values().next().value;
    }
    if (!broker) {
      log("warn", "drain_no_broker_for_mesh", { id: row.id, mesh: row.mesh ?? "(null)" });
      markDead(opts.db, row.id, `no_broker_for_mesh:${row.mesh ?? "null"}`);
      continue;
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

    let res;
    try {
      res = await broker.send({
        targetSpec,
        priority,
        nonce,
        ciphertext,
        client_message_id: row.client_message_id,
        request_fingerprint_hex: fpHex,
      });
    } catch (e) {
      log("warn", "drain_send_threw", { id: row.id, err: String(e) });
      backoffPending(opts.db, row.id, row.attempts + 1, "exception", String(e));
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
      backoffPending(opts.db, row.id, row.attempts + 1, "retry", res.error);
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

function backoffPending(db: SqliteDb, id: string, attempts: number, _kind: string, err: string) {
  const wait = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * (2 ** Math.min(attempts, 12)));
  const next = Date.now() + wait;
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
