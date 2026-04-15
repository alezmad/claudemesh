/**
 * Signed audit log with hash-chain integrity.
 *
 * Every significant mesh event is recorded as an append-only entry.
 * Each entry's SHA-256 hash includes the previous entry's hash,
 * forming a tamper-evident chain per mesh. If any row is modified
 * or deleted, all subsequent hashes will fail verification.
 *
 * NEVER logs message content (ciphertext or plaintext) — only metadata.
 */

import { createHash } from "node:crypto";
import { asc, desc, eq, sql, and } from "drizzle-orm";
import { db } from "./db";
import { auditLog } from "@turbostarter/db/schema/mesh";
import { log } from "./logger";

// ---------------------------------------------------------------------------
// In-memory last-hash cache (one entry per mesh, loaded from DB on startup)
// ---------------------------------------------------------------------------

const lastHash = new Map<string, string>();

// ---------------------------------------------------------------------------
// Core audit logging
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON serialization: keys sorted recursively. The store
 * is JSONB, which does NOT preserve key order, so hashing a naive
 * JSON.stringify(row.payload) on verify can yield a different string
 * from insert-time — false tamper reports. Canonical form guarantees
 * both sides agree.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]))
      .join(",") +
    "}"
  );
}

function computeHash(
  prevHash: string,
  meshId: string,
  eventType: string,
  actorMemberId: string | null,
  payload: Record<string, unknown>,
  createdAt: Date,
): string {
  const input = `${prevHash}|${meshId}|${eventType}|${actorMemberId}|${canonicalJson(payload)}|${createdAt.toISOString()}`;
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Append an audit entry for a mesh event.
 *
 * Fire-and-forget safe — callers should `void audit(...)` or
 * `.catch(log.warn)` to avoid blocking the hot path.
 */
export async function audit(
  meshId: string,
  eventType: string,
  actorMemberId: string | null,
  actorDisplayName: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  const prevHash = lastHash.get(meshId) ?? "genesis";
  const createdAt = new Date();
  const hash = computeHash(prevHash, meshId, eventType, actorMemberId, payload, createdAt);

  try {
    await db.insert(auditLog).values({
      meshId,
      eventType,
      actorMemberId,
      actorDisplayName,
      payload,
      prevHash,
      hash,
      createdAt,
    });
    lastHash.set(meshId, hash);
  } catch (e) {
    log.warn("audit log insert failed", {
      mesh_id: meshId,
      event_type: eventType,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// Startup: load last hash per mesh from DB
// ---------------------------------------------------------------------------

export async function loadLastHashes(): Promise<void> {
  try {
    // For each mesh, find the most recent audit entry by id (serial).
    // DISTINCT ON (mesh_id) ORDER BY id DESC gives us one row per mesh.
    const rows = await db.execute<{ mesh_id: string; hash: string }>(sql`
      SELECT DISTINCT ON (mesh_id) mesh_id, hash
      FROM mesh.audit_log
      ORDER BY mesh_id, id DESC
    `);

    for (const row of rows) {
      lastHash.set(row.mesh_id, row.hash);
    }
    log.info("audit: loaded last hashes", { meshes: lastHash.size });
  } catch (e) {
    // Table may not exist yet on first boot — that's fine.
    log.warn("audit: loadLastHashes failed (table may not exist yet)", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// Chain verification
// ---------------------------------------------------------------------------

export async function verifyChain(
  meshId: string,
): Promise<{ valid: boolean; entries: number; brokenAt?: number }> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.meshId, meshId))
    .orderBy(asc(auditLog.id));

  if (rows.length === 0) {
    return { valid: true, entries: 0 };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const expectedPrevHash = i === 0 ? "genesis" : rows[i - 1]!.hash;

    // Verify prevHash linkage
    if (row.prevHash !== expectedPrevHash) {
      return { valid: false, entries: rows.length, brokenAt: row.id };
    }

    // Recompute hash and verify
    const recomputed = computeHash(
      row.prevHash,
      row.meshId,
      row.eventType,
      row.actorMemberId,
      row.payload as Record<string, unknown>,
      row.createdAt,
    );
    if (recomputed !== row.hash) {
      return { valid: false, entries: rows.length, brokenAt: row.id };
    }
  }

  return { valid: true, entries: rows.length };
}

// ---------------------------------------------------------------------------
// Query: paginated audit entries
// ---------------------------------------------------------------------------

export async function queryAuditLog(
  meshId: string,
  options?: { limit?: number; offset?: number; eventType?: string },
): Promise<{ entries: Array<{ id: number; eventType: string; actor: string; payload: Record<string, unknown>; hash: string; createdAt: string }>; total: number }> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const conditions = [eq(auditLog.meshId, meshId)];
  if (options?.eventType) {
    conditions.push(eq(auditLog.eventType, options.eventType));
  }
  const where = conditions.length === 1 ? conditions[0]! : and(...conditions);

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(auditLog)
      .where(where),
  ]);

  return {
    entries: rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      actor: r.actorDisplayName ?? r.actorMemberId ?? "system",
      payload: r.payload as Record<string, unknown>,
      hash: r.hash,
      createdAt: r.createdAt.toISOString(),
    })),
    total: Number(countResult[0]?.count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Ensure table exists (raw DDL for first-boot before migrations run)
// ---------------------------------------------------------------------------

export async function ensureAuditLogTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mesh.audit_log (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        mesh_id TEXT NOT NULL REFERENCES mesh.mesh(id) ON DELETE CASCADE ON UPDATE CASCADE,
        event_type TEXT NOT NULL,
        actor_member_id TEXT,
        actor_display_name TEXT,
        payload JSONB NOT NULL DEFAULT '{}',
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
  } catch (e) {
    log.warn("audit: ensureAuditLogTable failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
