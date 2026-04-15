/**
 * Runtime migrations on broker startup.
 *
 * Runs pending drizzle migrations against DATABASE_URL before the broker
 * listens. Uses pg_advisory_lock so a multi-instance deploy doesn't race.
 * If migrations fail, the process exits non-zero so the orchestrator (Coolify
 * healthcheck) sees the container as broken and doesn't route traffic.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { dirname, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";

const LOCK_ID = 74737_73831; // "cmsh" ascii — stable magic constant

export async function runMigrationsOnStartup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL not set — skipping auto-migrate");
    return;
  }

  // Resolve the migrations folder — it's shipped inside @turbostarter/db's
  // deploy subset in the runtime image. Dev path also works.
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

  const sql = postgres(url, { max: 1, onnotice: () => { /* quiet */ } });
  try {
    // Advisory lock so parallel instances serialise.
    await sql`SELECT pg_advisory_lock(${LOCK_ID})`;
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
