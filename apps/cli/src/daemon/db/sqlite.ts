// SQLite shim. The daemon runs under Node 22.5+ in production (node:sqlite).
// During local dev (bun src/entrypoints/cli.ts daemon up) we fall back to
// bun:sqlite, which has a near-identical API surface for what we use.

export type SqliteDb = {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get<T = unknown>(...params: unknown[]): T | undefined;
    all<T = unknown>(...params: unknown[]): T[];
  };
  exec(sql: string): void;
  close(): void;
};

interface DatabaseCtor {
  new (path: string): SqliteDb;
}

let cached: DatabaseCtor | null = null;

async function loadSqlite(): Promise<DatabaseCtor> {
  if (cached) return cached;

  // Prefer node:sqlite (production runtime).
  try {
    const mod = (await import("node:sqlite")) as { DatabaseSync: DatabaseCtor };
    cached = mod.DatabaseSync;
    return cached;
  } catch (nodeErr) {
    // Dev path: bun:sqlite. Bun's Database has prepare/exec/close already.
    try {
      const bunMod = (await import("bun:sqlite")) as { Database: DatabaseCtor };
      cached = bunMod.Database;
      return cached;
    } catch {
      const msg = `claudemesh daemon requires Node.js 22.5+ for the embedded SQLite store ` +
                  `(node:sqlite), or Bun (bun:sqlite) for dev. ` +
                  `Current: ${process.version}. Original error: ${String(nodeErr)}`;
      throw new Error(msg);
    }
  }
}

export async function openSqlite(path: string): Promise<SqliteDb> {
  const Database = await loadSqlite();
  const db = new Database(path);
  // Default pragmas for daemon use:
  //   journal_mode WAL — concurrent reads while one writer is in BEGIN IMMEDIATE.
  //   synchronous NORMAL — balance durability/throughput; daemon is the only writer.
  //   foreign_keys ON — enforce constraints if any are added later.
  //   busy_timeout — let BEGIN IMMEDIATE wait briefly for a contending writer.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  return db;
}

/**
 * Run `fn` inside a `BEGIN IMMEDIATE` transaction. Per spec §4.5.1, this is
 * what serializes IPC accept against concurrent same-id requests; SQLite has
 * no row-level lock and `SELECT FOR UPDATE` is not supported.
 */
export function inImmediateTx<T>(db: SqliteDb, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  }
}
