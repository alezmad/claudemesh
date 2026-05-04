// 1.34.8: TTL prune for inbox.db.
//
// The inbox grows monotonically — every received DM lands as a row and
// nothing removes it except an explicit `claudemesh inbox flush`. For
// chatty meshes that's tens of thousands of rows over a few weeks.
// SQLite handles that volume fine, but the rows are sitting there
// forever and `claudemesh inbox` queries get slower as the table grows.
//
// The pruner runs hourly inside the daemon process and deletes rows
// whose received_at is older than `retentionMs`. Default is 30 days,
// which is generous for the "I went on holiday and want to see what I
// missed" case but won't carry old rows into next year.
//
// Best-effort: a failure logs a warning and the pruner keeps trying on
// the next interval. There's no shared state to corrupt — pruneInboxBefore
// is a single DELETE statement.

import { pruneInboxBefore } from "./db/inbox.js";
import type { SqliteDb } from "./db/sqlite.js";

export interface InboxPrunerOptions {
  db: SqliteDb;
  /** Retention window in ms. Rows with received_at < (now - retentionMs)
   *  are deleted. Default: 30 days. */
  retentionMs?: number;
  /** How often to run the prune. Default: 1 hour. */
  intervalMs?: number;
  log?: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
}

export interface InboxPrunerHandle {
  stop: () => void;
}

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

export function startInboxPruner(opts: InboxPrunerOptions): InboxPrunerHandle {
  const retentionMs = opts.retentionMs ?? DEFAULT_RETENTION_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const log = opts.log ?? defaultLog;

  const tick = (): void => {
    try {
      const cutoff = Date.now() - retentionMs;
      const removed = pruneInboxBefore(opts.db, cutoff);
      if (removed > 0) {
        log("info", "inbox_prune_completed", {
          removed,
          retention_days: Math.round(retentionMs / (24 * 60 * 60 * 1000)),
        });
      }
    } catch (e) {
      log("warn", "inbox_prune_failed", { err: String(e) });
    }
  };

  // Run once at startup so a daemon that's been down for weeks reaps
  // immediately rather than waiting an hour.
  tick();

  const handle = setInterval(tick, intervalMs);
  // Don't let the pruner block daemon shutdown.
  if (typeof handle.unref === "function") handle.unref();

  return { stop: () => clearInterval(handle) };
}

function defaultLog(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() });
  if (level === "info") process.stdout.write(line + "\n");
  else process.stderr.write(line + "\n");
}
