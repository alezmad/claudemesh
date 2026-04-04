/**
 * Postgres connection health check with backoff retry.
 *
 * We don't tear down the broker on a transient DB blip — the
 * surrounding HTTP/WS layer keeps serving, /health flips to 503,
 * and the metrics gauge reflects reality. New queries will naturally
 * fail while the DB is down; connectors that have retry logic of
 * their own (postgres.js does) will recover transparently.
 */

import { sql } from "drizzle-orm";
import { db } from "./db";
import { log } from "./logger";
import { metrics } from "./metrics";

let healthy = false;
let consecutiveFailures = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function isDbHealthy(): boolean {
  return healthy;
}

export async function pingDb(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    if (!healthy) {
      log.info("db healthy", { prior_failures: consecutiveFailures });
    }
    healthy = true;
    consecutiveFailures = 0;
    metrics.dbHealthy.set(1);
    return true;
  } catch (e) {
    consecutiveFailures += 1;
    if (healthy || consecutiveFailures === 1) {
      log.error("db ping failed", {
        consecutive_failures: consecutiveFailures,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    healthy = false;
    metrics.dbHealthy.set(0);
    return false;
  }
}

/**
 * Poll the DB on a backoff schedule while unhealthy, steady-state
 * 30s interval while healthy. Runs in background; call stopDbHealth
 * on shutdown.
 */
export function startDbHealth(): void {
  if (pollTimer) return;
  const tick = async (): Promise<void> => {
    await pingDb();
    const next = healthy
      ? 30_000
      : Math.min(30_000, 500 * Math.pow(2, Math.min(consecutiveFailures, 6)));
    pollTimer = setTimeout(() => {
      void tick();
    }, next);
  };
  void tick();
}

export function stopDbHealth(): void {
  if (pollTimer) clearTimeout(pollTimer as unknown as number);
  pollTimer = null;
}
