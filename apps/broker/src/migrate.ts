/**
 * Runtime migrations on broker startup.
 *
 * Runs pending drizzle migrations against DATABASE_URL before the broker
 * listens. Uses pg_try_advisory_lock with retry+timeout so a stuck old
 * instance can't block new deploys indefinitely (the original
 * pg_advisory_lock version matched the "stuck 12h" symptom perfectly —
 * an old container held the lock and the new deploy waited forever).
 *
 * If migrations fail OR the lock can't be acquired within the timeout,
 * the process exits non-zero so the orchestrator (Coolify healthcheck)
 * sees the container as broken and doesn't route traffic to it.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";

const LOCK_ID = 74737_73831; // "cmsh" ascii — stable magic constant

/** Max total time to wait for the advisory lock before giving up. */
const LOCK_ACQUIRE_TIMEOUT_MS = 60_000;
/** Poll interval when lock is held by another instance. */
const LOCK_RETRY_INTERVAL_MS = 2_000;

export async function runMigrationsOnStartup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL not set — skipping auto-migrate");
    return;
  }

  const candidates = [
    "/app/migrations",
    "/app/node_modules/@turbostarter/db/migrations",
    join(process.cwd(), "..", "..", "packages", "db", "migrations"),
    join(process.cwd(), "packages", "db", "migrations"),
  ];
  const migrationsFolder = candidates.find((p) => existsSync(p));
  if (!migrationsFolder) {
    console.error("[migrate] migrations folder not found — skipping. Searched:", candidates);
    return;
  }
  const count = readdirSync(migrationsFolder).filter((f) => f.endsWith(".sql")).length;
  console.log(`[migrate] ${count} migration files at ${migrationsFolder}`);

  const sql = postgres(url, {
    max: 1,
    onnotice: () => { /* quiet */ },
    // Statement-level safety net in case a long ALTER holds row locks.
    // 5 min per statement is plenty for schema DDL.
    statement_timeout: 5 * 60 * 1000,
  });

  try {
    // Set a lock_timeout for this session — PG will refuse to block more
    // than N ms on any lock acquisition (we only hold one at a time).
    await sql`SET lock_timeout = ${LOCK_ACQUIRE_TIMEOUT_MS}`;

    // Try to grab the advisory lock; poll if someone else holds it.
    const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
    let locked = false;
    while (Date.now() < deadline) {
      const [row] = await sql<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${LOCK_ID}) AS locked
      `;
      if (row?.locked) {
        locked = true;
        break;
      }
      console.log("[migrate] advisory lock held — retrying in 2s");
      await new Promise((r) => setTimeout(r, LOCK_RETRY_INTERVAL_MS));
    }
    if (!locked) {
      console.error(`[migrate] could not acquire advisory lock within ${LOCK_ACQUIRE_TIMEOUT_MS}ms — aborting`);
      process.exit(1);
    }

    try {
      const db = drizzle(sql);
      const start = Date.now();
      await migrate(db, { migrationsFolder });
      console.log(`[migrate] ok (${Date.now() - start}ms)`);
    } finally {
      await sql`SELECT pg_advisory_unlock(${LOCK_ID})`;
    }
  } catch (e) {
    console.error("[migrate] FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
