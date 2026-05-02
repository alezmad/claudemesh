/**
 * One-shot bootstrap for the new mesh.__cmh_migrations tracking table.
 *
 * Run this against an EXISTING prod DB exactly once before deploying
 * the new runtime migrator. It:
 *   1. Creates mesh.__cmh_migrations if it doesn't exist
 *   2. Hashes every .sql file in packages/db/migrations
 *   3. Inserts a row per file (filename + sha256) with applied_at = NOW()
 *   4. ON CONFLICT (filename) DO NOTHING — safe to re-run
 *
 * The script does NOT execute any migration SQL — it only seeds the
 * tracking table to reflect the schema state that was previously
 * applied by drizzle (or by hand). After this runs, the broker's
 * startup migrator will treat 0000..N as already-applied and only
 * apply truly new files going forward.
 *
 * Usage:
 *   DATABASE_URL=... bun apps/broker/scripts/bootstrap-cmh-migrations.ts
 *
 * Safe to run multiple times. Output prints per-file status.
 */

import postgres from "postgres";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(2);
  }

  const candidates = [
    join(process.cwd(), "..", "..", "packages", "db", "migrations"),
    join(process.cwd(), "packages", "db", "migrations"),
    "/app/migrations",
  ];
  const folder = candidates.find((p) => existsSync(p));
  if (!folder) {
    console.error("migrations folder not found");
    process.exit(2);
  }

  const files = readdirSync(folder).filter((f) => f.endsWith(".sql")).sort();
  console.log(`bootstrap · ${files.length} files at ${folder}`);

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS mesh;
      CREATE TABLE IF NOT EXISTS mesh.__cmh_migrations (
        filename   TEXT PRIMARY KEY,
        sha256     TEXT NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    let inserted = 0;
    let skipped = 0;
    for (const f of files) {
      const content = readFileSync(join(folder, f), "utf8");
      const sha = createHash("sha256").update(content).digest("hex");
      const result = await sql`
        INSERT INTO mesh.__cmh_migrations (filename, sha256)
        VALUES (${f}, ${sha})
        ON CONFLICT (filename) DO NOTHING
        RETURNING filename
      `;
      if (result.length > 0) {
        inserted += 1;
        console.log(`  + ${f}  ${sha.slice(0, 12)}…`);
      } else {
        skipped += 1;
      }
    }
    console.log(`bootstrap done · ${inserted} inserted, ${skipped} already tracked`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error("bootstrap failed:", e);
  process.exit(1);
});
