/**
 * Outbox drain hygiene (1.37.1, spec 2026-09-08-daemon-restart-mesh-blackout §8).
 *
 * Before: a session-attributed row whose session WS never came back was
 * retried forever (~130k attempts/row observed), never counted against the
 * attempt cap, never expired, and logged `drain_session_ws_not_ready` on
 * EVERY tick — the 1 GB daemon.log. These tests pin the new caps.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqlite, type SqliteDb } from "~/daemon/db/sqlite.js";
import { insertPending, migrateOutbox, findById } from "~/daemon/db/outbox.js";
import {
  drainOnce,
  MAX_ATTEMPTS_PER_ROW,
  NOT_READY_LOG_EVERY,
  OUTBOX_TTL_MS,
  SESSION_GONE_TTL_MS,
  type DrainOptions,
} from "~/daemon/drain.js";
import type { DaemonBrokerClient } from "~/daemon/broker.js";
import type { SessionBrokerClient } from "~/daemon/session-broker.js";

const SESSION_PK = "ab".repeat(32);

function row(db: SqliteDb, id: string, now: number, extra: Partial<Parameters<typeof insertPending>[1]> = {}) {
  insertPending(db, {
    id,
    client_message_id: `cid-${id}`,
    request_fingerprint: new Uint8Array(32),
    payload: new Uint8Array([1]),
    now,
    mesh: "test",
    target_spec: "peer",
    nonce: "n",
    ciphertext: "c",
    priority: "next",
    ...extra,
  });
}

/** Advance a pending row's next_attempt_at so the next tick picks it up. */
function makeDue(db: SqliteDb, id: string, now: number) {
  db.prepare(`UPDATE outbox SET next_attempt_at = ? WHERE id = ?`).run(now, id);
}

describe("drain hygiene", () => {
  let dir: string;
  let db: SqliteDb;
  let logs: Array<{ level: string; msg: string; meta?: Record<string, unknown> }>;
  let clock: number;
  /** A "daemon broker" that is never open — rows routed to it back off. */
  const fakeDaemonBroker = {
    send: async () => ({ ok: false as const, error: "broker_not_open", permanent: false }),
  } as unknown as DaemonBrokerClient;

  const opts = (getSession: DrainOptions["getSessionBrokerByPubkey"]): DrainOptions => ({
    db,
    brokers: new Map([["test", fakeDaemonBroker]]),
    getSessionBrokerByPubkey: getSession,
    log: (level, msg, meta) => logs.push({ level, msg, meta }),
    nowFn: () => clock,
  });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cmh-drain-"));
    db = await openSqlite(join(dir, "outbox.db"));
    migrateOutbox(db);
    logs = [];
    clock = 1_700_000_000_000;
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it("pending rows older than OUTBOX_TTL_MS are marked dead/expired in one sweep", async () => {
    row(db, "old", clock - OUTBOX_TTL_MS - 1);
    row(db, "fresh", clock);
    db.prepare(`UPDATE outbox SET status = 'inflight' WHERE id = 'old'`).run();

    await drainOnce(opts(() => undefined));

    expect(findById(db, "old")?.status).toBe("dead");
    expect(findById(db, "old")?.last_error).toBe("expired");
    expect(findById(db, "fresh")?.status).not.toBe("dead");
    const warn = logs.find((l) => l.msg === "drain_expired_rows");
    expect(warn?.meta?.count).toBe(1);
  });

  it("session-attributed row with NO registered session → dead session_gone after SESSION_GONE_TTL_MS", async () => {
    row(db, "gone", clock, { sender_session_pubkey: SESSION_PK });

    // Young row: still retried (backoff), not dead.
    await drainOnce(opts(() => undefined));
    expect(findById(db, "gone")?.status).toBe("pending");
    expect(findById(db, "gone")?.last_error).toBe("session_ws_not_open");

    // Past the grace: dead.
    clock += SESSION_GONE_TTL_MS + 1;
    makeDue(db, "gone", clock);
    await drainOnce(opts(() => undefined));
    expect(findById(db, "gone")?.status).toBe("dead");
    expect(findById(db, "gone")?.last_error).toBe("session_gone");
    expect(logs.some((l) => l.msg === "drain_session_gone")).toBe(true);
  });

  it("registered-but-reconnecting session: not-ready is rate-limited and capped by MAX_ATTEMPTS", async () => {
    row(db, "wait", clock, { sender_session_pubkey: SESSION_PK });
    const reconnecting = { isOpen: () => false } as unknown as SessionBrokerClient;
    const o = opts(() => reconnecting);

    for (let i = 0; i < MAX_ATTEMPTS_PER_ROW; i++) {
      makeDue(db, "wait", clock);
      await drainOnce(o);
      // A registered session is never "gone", however long it reconnects.
      expect(findById(db, "wait")?.last_error).not.toBe("session_gone");
    }

    const r = findById(db, "wait")!;
    expect(r.status).toBe("dead");
    expect(r.last_error).toBe("max_attempts: session_ws_not_open");
    expect(r.attempts).toBe(MAX_ATTEMPTS_PER_ROW);

    // Logged on attempt 1 only (MAX_ATTEMPTS_PER_ROW < NOT_READY_LOG_EVERY),
    // not once per tick.
    const notReady = logs.filter((l) => l.msg === "drain_session_ws_not_ready");
    expect(MAX_ATTEMPTS_PER_ROW).toBeLessThan(NOT_READY_LOG_EVERY);
    expect(notReady).toHaveLength(1);
    expect(notReady[0]!.meta?.attempts).toBe(1);
    expect(notReady[0]!.meta?.registered).toBe(true);
    expect(logs.filter((l) => l.msg === "drain_max_attempts")).toHaveLength(1);
  });
});
