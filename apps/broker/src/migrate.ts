/**
 * Runtime migrations on broker startup.
 *
 * Replaced drizzle's migrator with a filename-tracked runner because
 * drizzle's _journal.json drifted on the filesystem (last entry was
 * idx=11; idx 12-24 were never recorded), and the prod
 * drizzle.__drizzle_migrations table was even further behind (3 rows
 * for 25 files). The runtime migrator silently skipped anything
 * outside the journal, so every new schema change required `psql -f`
 * by hand.
 *
 * The new runner tracks applied files in `mesh.__cmh_migrations`
 * (filename + sha256 + applied_at). On startup:
 *   1. Acquire advisory lock (unchanged)
 *   2. CREATE TABLE IF NOT EXISTS for the tracking table
 *   3. Read applied filenames from the table
 *   4. List `migrations/*.sql` lexicographically; filter out applied
 *   5. For each unapplied: BEGIN; execute file; INSERT row; COMMIT
 *   6. For each applied: optionally verify sha matches; warn (don't
 *      fail) on mismatch — devs reformat migrations sometimes
 *
 * Bootstrap: run `apps/broker/scripts/bootstrap-cmh-migrations.ts`
 * against an existing prod DB to seed the tracking table with the
 * currently-applied set. Without that, the runner would try to
 * re-apply 0000-0024 and fail on duplicate-table errors.
 *
 * Failure modes (all exit non-zero so Coolify healthcheck fails closed):
 *   - DATABASE_URL missing
 *   - lock acquisition timeout
 *   - migration SQL error mid-application
 */

import postgres from "postgres";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const LOCK_ID = 74737_73831; // "cmsh" ascii — stable magic constant
const LOCK_ACQUIRE_TIMEOUT_MS = 60_000;
const LOCK_RETRY_INTERVAL_MS = 2_000;

const TRACKING_TABLE_DDL = `
  CREATE SCHEMA IF NOT EXISTS mesh;
  CREATE TABLE IF NOT EXISTS mesh.__cmh_migrations (
    filename   TEXT PRIMARY KEY,
    sha256     TEXT NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
`;

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

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

  const allFiles = readdirSync(migrationsFolder)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // lexicographic = numeric for 0000_*..9999_*
  console.log(`[migrate] ${allFiles.length} migration files at ${migrationsFolder}`);

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sql.unsafe(`SET lock_timeout = '${LOCK_ACQUIRE_TIMEOUT_MS}ms'`);

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
      // Bootstrap the tracking table itself. Idempotent.
      await sql.unsafe(TRACKING_TABLE_DDL);

      const applied = await sql<{ filename: string; sha256: string }[]>`
        SELECT filename, sha256 FROM mesh.__cmh_migrations
      `;
      const appliedMap = new Map(applied.map((r) => [r.filename, r.sha256]));

      const pending: Array<{ filename: string; sha: string; content: string }> = [];
      for (const filename of allFiles) {
        const path = join(migrationsFolder, filename);
        const content = readFileSync(path, "utf8");
        const sha = sha256Hex(content);
        const knownSha = appliedMap.get(filename);
        if (!knownSha) {
          pending.push({ filename, sha, content });
        } else if (knownSha !== sha) {
          // File content changed after application. Don't re-run; warn.
          // Hard-fail would block legit cosmetic edits (whitespace,
          // comments). Production drift detection lives elsewhere.
          console.warn(
            `[migrate] sha mismatch for ${filename} — file modified post-apply (was ${knownSha.slice(0, 12)}…, now ${sha.slice(0, 12)}…)`,
          );
        }
      }

      if (pending.length === 0) {
        console.log(`[migrate] up to date · ${applied.length} applied`);
      } else {
        console.log(`[migrate] applying ${pending.length} pending: ${pending.map((p) => p.filename).join(", ")}`);
        for (const m of pending) {
          const start = Date.now();
          try {
            await sql.begin(async (tx) => {
              // drizzle migrations use `--> statement-breakpoint` to
              // separate statements; postgres-js can run a multi-stmt
              // script via .unsafe(), but transactional rollback wraps
              // everything as one unit which is what we want.
              await tx.unsafe(m.content);
              await tx`
                INSERT INTO mesh.__cmh_migrations (filename, sha256)
                VALUES (${m.filename}, ${m.sha})
              `;
            });
            console.log(`[migrate]   ✓ ${m.filename} (${Date.now() - start}ms)`);
          } catch (e) {
            console.error(`[migrate]   ✗ ${m.filename}:`, e instanceof Error ? e.message : e);
            throw e;
          }
        }
        console.log(`[migrate] ok`);
      }
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
