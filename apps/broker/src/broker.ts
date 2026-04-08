/**
 * MeshBroker — core state engine for claudemesh.
 *
 * Ported from ~/tools/claude-intercom/broker.ts with the SQLite layer
 * translated to Drizzle/Postgres against the `mesh` pgSchema. The
 * status model (hook > manual > jsonl priority, fresh-gating, TTL
 * sweeper) and priority delivery logic are kept verbatim — they're the
 * battle-tested pieces.
 *
 * Differences from claude-intercom:
 *   - Peer identity is split: mesh.member (stable, mesh-scoped) vs
 *     mesh.presence (ephemeral, one per WS connection).
 *   - Every query/mutation is scoped by meshId.
 *   - Message envelopes are opaque ciphertext (client-side crypto).
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { db } from "./db";
import {
  invite as inviteTable,
  mesh,
  meshFile,
  meshFileAccess,
  meshFileKey,
  meshContext,
  meshMember as memberTable,
  meshMemory,
  meshState,
  meshService,
  meshSkill,
  meshStream,
  meshVaultEntry,
  meshTask,
  messageQueue,
  pendingStatus,
  presence,
} from "@turbostarter/db/schema/mesh";
import {
  canonicalInvite,
  verifyEd25519,
} from "./crypto";
import { env } from "./env";
import { metrics } from "./metrics";
import { inferStatusFromJsonl } from "./paths";
import type {
  HookSetStatusRequest,
  HookSetStatusResponse,
  PeerStatus,
  Priority,
  StatusSource,
} from "./types";

// --- Config (seconds → ms) ---

const WORKING_TTL_MS = env.STATUS_TTL_SECONDS * 1000;
const HOOK_FRESHNESS_MS = env.HOOK_FRESH_WINDOW_SECONDS * 1000;
const PENDING_TTL_MS = 10_000;
const TTL_SWEEP_INTERVAL_MS = 15_000;
const PENDING_SWEEP_INTERVAL_MS = PENDING_TTL_MS;

// --- Source priority rules (ported verbatim) ---

function sourceRank(source: StatusSource): number {
  return source === "hook" ? 3 : source === "manual" ? 2 : 1;
}

function isSourceFresh(updatedAt: Date | null, now: Date): boolean {
  if (!updatedAt) return false;
  const age = now.getTime() - updatedAt.getTime();
  return age >= 0 && age <= HOOK_FRESHNESS_MS;
}

export function isHookFresh(
  source: StatusSource,
  updatedAt: Date | null,
  now: Date,
): boolean {
  if (source !== "hook") return false;
  return isSourceFresh(updatedAt, now);
}

// --- Core status write (ported verbatim, translated to Drizzle) ---

/**
 * Write a status update for a presence row, honoring source priority.
 *
 * Rules (identical to claude-intercom):
 *   - Status changed → bump everything, record new source.
 *   - Status unchanged, incoming source ≥ recorded source → upgrade.
 *   - Status unchanged, incoming source < recorded source:
 *       - Recorded source still fresh → keep it (just bump timestamp).
 *       - Recorded source stale → downgrade to honest attribution.
 */
export async function writeStatus(
  presenceId: string,
  status: PeerStatus,
  source: StatusSource,
  now: Date,
): Promise<void> {
  const [prev] = await db
    .select({
      status: presence.status,
      statusSource: presence.statusSource,
      statusUpdatedAt: presence.statusUpdatedAt,
    })
    .from(presence)
    .where(eq(presence.id, presenceId));
  if (!prev) return;

  if (prev.status !== status) {
    await db
      .update(presence)
      .set({ status, statusSource: source, statusUpdatedAt: now })
      .where(eq(presence.id, presenceId));
    return;
  }

  if (sourceRank(source) >= sourceRank(prev.statusSource as StatusSource)) {
    await db
      .update(presence)
      .set({ statusSource: source, statusUpdatedAt: now })
      .where(eq(presence.id, presenceId));
    return;
  }

  // Lower-rank source. Keep recorded source if fresh, else downgrade.
  if (isSourceFresh(prev.statusUpdatedAt, now)) {
    await db
      .update(presence)
      .set({ statusUpdatedAt: now })
      .where(eq(presence.id, presenceId));
  } else {
    await db
      .update(presence)
      .set({ statusSource: source, statusUpdatedAt: now })
      .where(eq(presence.id, presenceId));
  }
}

// --- Hook-driven status updates ---

/**
 * HTTP POST /hook/set-status handler. Resolves (pid, cwd) to an active
 * presence row; if none exists (first-turn race), stashes the signal
 * in pending_status to be applied on next presence connect.
 */
export async function handleHookSetStatus(
  body: HookSetStatusRequest,
): Promise<HookSetStatusResponse> {
  if (!body.cwd || !body.status) {
    return { ok: false, error: "cwd and status required" };
  }
  const now = new Date();

  // Find active presence row. Prefer (pid, cwd) match; fall back to
  // most-recent cwd match only.
  const activeFilter = and(
    eq(presence.cwd, body.cwd),
    isNull(presence.disconnectedAt),
  );
  let row: { id: string; status: PeerStatus } | undefined;
  if (body.pid) {
    const [r] = await db
      .select({ id: presence.id, status: presence.status })
      .from(presence)
      .where(and(activeFilter, eq(presence.pid, body.pid)))
      .limit(1);
    row = r as { id: string; status: PeerStatus } | undefined;
  }
  if (!row) {
    const [r] = await db
      .select({ id: presence.id, status: presence.status })
      .from(presence)
      .where(activeFilter)
      .orderBy(desc(presence.connectedAt))
      .limit(1);
    row = r as { id: string; status: PeerStatus } | undefined;
  }

  if (!row) {
    // No active presence — stash signal for future apply-on-register.
    await db.insert(pendingStatus).values({
      pid: body.pid ?? 0,
      cwd: body.cwd,
      status: body.status,
      statusSource: "hook",
      createdAt: now,
    });
    return { ok: true, pending: true };
  }

  // DND is sacred — hooks cannot unset it.
  if (row.status === "dnd") return { ok: true, presence_id: row.id };

  await writeStatus(row.id, body.status, "hook", now);
  return { ok: true, presence_id: row.id };
}

/**
 * When a new presence row is created, check pending_status for queued
 * hook signals for this (pid, cwd) and apply the newest one.
 */
export async function applyPendingHookStatus(
  presenceId: string,
  pid: number,
  cwd: string,
  now: Date,
): Promise<void> {
  const cutoff = new Date(now.getTime() - PENDING_TTL_MS);
  const [row] = await db
    .select({ id: pendingStatus.id, status: pendingStatus.status })
    .from(pendingStatus)
    .where(
      and(
        eq(pendingStatus.pid, pid),
        eq(pendingStatus.cwd, cwd),
        isNull(pendingStatus.appliedAt),
        gte(pendingStatus.createdAt, cutoff),
      ),
    )
    .orderBy(desc(pendingStatus.createdAt))
    .limit(1);
  if (!row) return;
  await writeStatus(presenceId, row.status as PeerStatus, "hook", now);
  await db
    .update(pendingStatus)
    .set({ appliedAt: now })
    .where(eq(pendingStatus.id, row.id));
}

// --- Sweepers ---

/**
 * TTL sweep: flip presences stuck in "working" > WORKING_TTL_MS back
 * to idle. DND preserved. Source set to jsonl so a fresh hook can
 * reclaim immediately.
 */
export async function sweepStuckWorking(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - WORKING_TTL_MS);
  const stuck = await db
    .select({ id: presence.id })
    .from(presence)
    .where(
      and(
        eq(presence.status, "working"),
        lt(presence.statusUpdatedAt, cutoff),
        isNull(presence.disconnectedAt),
      ),
    );
  for (const row of stuck) {
    await writeStatus(row.id, "idle", "jsonl", now);
  }
  metrics.ttlSweepsTotal.inc({ flipped: String(stuck.length) });
}

/** Update the queue_depth gauge from a single COUNT query. */
export async function refreshQueueDepth(): Promise<void> {
  const [row] = await db
    .select({ n: count() })
    .from(messageQueue)
    .where(isNull(messageQueue.deliveredAt));
  metrics.queueDepth.set(Number(row?.n ?? 0));
}

/**
 * Sweep stale presences: mark as disconnected if last_ping_at is older
 * than 90s (3 missed pings at the 30s interval = dead session).
 */
export async function sweepStalePresences(): Promise<void> {
  const cutoff = new Date(Date.now() - 90_000); // 3 missed pings
  await db
    .update(presence)
    .set({ disconnectedAt: new Date() })
    .where(
      and(
        isNull(presence.disconnectedAt),
        lt(presence.lastPingAt, cutoff),
      ),
    );
}

/** Sweep expired pending_status entries. */
export async function sweepPendingStatuses(): Promise<void> {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS);
  await db
    .delete(pendingStatus)
    .where(
      or(lt(pendingStatus.createdAt, cutoff), isNotNull(pendingStatus.appliedAt))!,
    );
}

/**
 * JSONL fallback refresh for a presence row. Called from heartbeat +
 * delivery paths. No-op if a fresh hook signal is still recorded.
 */
export async function refreshStatusFromJsonl(
  presenceId: string,
  cwd: string,
  now: Date,
): Promise<PeerStatus> {
  const [row] = await db
    .select({
      status: presence.status,
      statusSource: presence.statusSource,
      statusUpdatedAt: presence.statusUpdatedAt,
    })
    .from(presence)
    .where(eq(presence.id, presenceId));
  if (!row) return "idle";
  if (row.status === "dnd") return "dnd";
  if (isHookFresh(row.statusSource as StatusSource, row.statusUpdatedAt, now)) {
    return row.status as PeerStatus;
  }
  const inferred = inferStatusFromJsonl(cwd);
  await writeStatus(presenceId, inferred, "jsonl", now);
  return inferred;
}

// --- Presence lifecycle ---

export interface ConnectParams {
  memberId: string;
  sessionId: string;
  sessionPubkey?: string;
  displayName?: string;
  pid: number;
  cwd: string;
  groups?: Array<{ name: string; role?: string }>;
}

/** Create a presence row for a new WS connection. */
export async function connectPresence(
  params: ConnectParams,
): Promise<string> {
  const now = new Date();
  const [row] = await db
    .insert(presence)
    .values({
      memberId: params.memberId,
      sessionId: params.sessionId,
      sessionPubkey: params.sessionPubkey ?? null,
      displayName: params.displayName ?? null,
      pid: params.pid,
      cwd: params.cwd,
      status: "idle",
      statusSource: "jsonl",
      statusUpdatedAt: now,
      groups: params.groups ?? [],
      connectedAt: now,
      lastPingAt: now,
    })
    .returning({ id: presence.id });
  if (!row) throw new Error("failed to create presence row");
  await applyPendingHookStatus(row.id, params.pid, params.cwd, now);
  return row.id;
}

/** Mark presence disconnected (idempotent). */
export async function disconnectPresence(presenceId: string): Promise<void> {
  const now = new Date();
  await db
    .update(presence)
    .set({ disconnectedAt: now })
    .where(and(eq(presence.id, presenceId), isNull(presence.disconnectedAt)));
}

/** Bump lastPingAt on a heartbeat from client. */
export async function heartbeat(presenceId: string): Promise<void> {
  await db
    .update(presence)
    .set({ lastPingAt: new Date() })
    .where(eq(presence.id, presenceId));
}

// --- Peer discovery ---

/** Return all active (connected) presences in a mesh, joined with member info. */
export async function listPeersInMesh(
  meshId: string,
): Promise<
  Array<{
    pubkey: string;
    displayName: string;
    status: string;
    summary: string | null;
    groups: Array<{ name: string; role?: string }>;
    sessionId: string;
    cwd: string;
    connectedAt: Date;
  }>
> {
  const rows = await db
    .select({
      memberPubkey: memberTable.peerPubkey,
      sessionPubkey: presence.sessionPubkey,
      memberDisplayName: memberTable.displayName,
      presenceDisplayName: presence.displayName,
      status: presence.status,
      summary: presence.summary,
      groups: presence.groups,
      sessionId: presence.sessionId,
      cwd: presence.cwd,
      connectedAt: presence.connectedAt,
    })
    .from(presence)
    .innerJoin(memberTable, eq(presence.memberId, memberTable.id))
    .where(
      and(
        eq(memberTable.meshId, meshId),
        isNull(presence.disconnectedAt),
      ),
    )
    .orderBy(asc(presence.connectedAt));
  // Prefer session pubkey for routing, session displayName for display.
  return rows.map((r) => ({
    pubkey: r.sessionPubkey || r.memberPubkey,
    displayName: r.presenceDisplayName || r.memberDisplayName,
    status: r.status,
    summary: r.summary,
    groups: (r.groups ?? []) as Array<{ name: string; role?: string }>,
    sessionId: r.sessionId,
    cwd: r.cwd,
    connectedAt: r.connectedAt,
  }));
}

/** Update the summary text on a presence row. */
export async function setSummary(
  presenceId: string,
  summary: string,
): Promise<void> {
  await db
    .update(presence)
    .set({ summary })
    .where(eq(presence.id, presenceId));
}

// --- Group management ---

/**
 * Join a group (upsert). If the peer is already in the group, update the role.
 * Returns the updated groups array.
 */
export async function joinGroup(
  presenceId: string,
  name: string,
  role?: string,
): Promise<Array<{ name: string; role?: string }>> {
  const [row] = await db
    .select({ groups: presence.groups })
    .from(presence)
    .where(eq(presence.id, presenceId));
  if (!row) return [];
  const groups = ((row.groups ?? []) as Array<{ name: string; role?: string }>).slice();
  const idx = groups.findIndex((g) => g.name === name);
  const entry: { name: string; role?: string } = { name };
  if (role) entry.role = role;
  if (idx >= 0) {
    groups[idx] = entry;
  } else {
    groups.push(entry);
  }
  await db
    .update(presence)
    .set({ groups })
    .where(eq(presence.id, presenceId));
  return groups;
}

/**
 * Leave a group. Returns the updated groups array.
 */
export async function leaveGroup(
  presenceId: string,
  name: string,
): Promise<Array<{ name: string; role?: string }>> {
  const [row] = await db
    .select({ groups: presence.groups })
    .from(presence)
    .where(eq(presence.id, presenceId));
  if (!row) return [];
  const groups = ((row.groups ?? []) as Array<{ name: string; role?: string }>).filter(
    (g) => g.name !== name,
  );
  await db
    .update(presence)
    .set({ groups })
    .where(eq(presence.id, presenceId));
  return groups;
}

// --- Shared state ---

/**
 * Upsert a key-value pair in the mesh's shared state.
 * Returns the upserted row.
 */
export async function setState(
  meshId: string,
  key: string,
  value: unknown,
  presenceId?: string,
  presenceName?: string,
): Promise<{
  key: string;
  value: unknown;
  updatedBy: string;
  updatedAt: Date;
}> {
  const now = new Date();
  const [row] = await db
    .insert(meshState)
    .values({
      meshId,
      key,
      value,
      updatedByPresence: presenceId ?? null,
      updatedByName: presenceName ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [meshState.meshId, meshState.key],
      set: {
        value,
        updatedByPresence: presenceId ?? null,
        updatedByName: presenceName ?? null,
        updatedAt: now,
      },
    })
    .returning({
      key: meshState.key,
      value: meshState.value,
      updatedByName: meshState.updatedByName,
      updatedAt: meshState.updatedAt,
    });
  return {
    key: row!.key,
    value: row!.value,
    updatedBy: row!.updatedByName ?? "unknown",
    updatedAt: row!.updatedAt,
  };
}

/**
 * Read a single state key for a mesh. Returns null if not found.
 */
export async function getState(
  meshId: string,
  key: string,
): Promise<{
  key: string;
  value: unknown;
  updatedBy: string;
  updatedAt: Date;
} | null> {
  const [row] = await db
    .select({
      key: meshState.key,
      value: meshState.value,
      updatedByName: meshState.updatedByName,
      updatedAt: meshState.updatedAt,
    })
    .from(meshState)
    .where(and(eq(meshState.meshId, meshId), eq(meshState.key, key)))
    .limit(1);
  if (!row) return null;
  return {
    key: row.key,
    value: row.value,
    updatedBy: row.updatedByName ?? "unknown",
    updatedAt: row.updatedAt,
  };
}

/**
 * List all state entries for a mesh.
 */
export async function listState(
  meshId: string,
): Promise<
  Array<{ key: string; value: unknown; updatedBy: string; updatedAt: Date }>
> {
  const rows = await db
    .select({
      key: meshState.key,
      value: meshState.value,
      updatedByName: meshState.updatedByName,
      updatedAt: meshState.updatedAt,
    })
    .from(meshState)
    .where(eq(meshState.meshId, meshId))
    .orderBy(asc(meshState.key));
  return rows.map((r) => ({
    key: r.key,
    value: r.value,
    updatedBy: r.updatedByName ?? "unknown",
    updatedAt: r.updatedAt,
  }));
}

// --- Memory ---

/**
 * Store a new memory for a mesh. Returns the generated id.
 */
export async function rememberMemory(
  meshId: string,
  content: string,
  tags: string[],
  memberId?: string,
  memberName?: string,
): Promise<string> {
  const [row] = await db
    .insert(meshMemory)
    .values({
      meshId,
      content,
      tags,
      rememberedBy: memberId ?? null,
      rememberedByName: memberName ?? null,
    })
    .returning({ id: meshMemory.id });
  if (!row) throw new Error("failed to insert memory");
  return row.id;
}

/**
 * Full-text search memories in a mesh. Uses the search_vector tsvector
 * column with plainto_tsquery for ranked results.
 */
export async function recallMemory(
  meshId: string,
  query: string,
): Promise<
  Array<{
    id: string;
    content: string;
    tags: string[];
    rememberedBy: string;
    rememberedAt: Date;
  }>
> {
  const result = await db.execute<{
    id: string;
    content: string;
    tags: string[];
    remembered_by_name: string | null;
    remembered_at: string | Date;
  }>(sql`
    SELECT id, content, tags, remembered_by_name, remembered_at
    FROM mesh.memory
    WHERE mesh_id = ${meshId}
      AND forgotten_at IS NULL
      AND search_vector @@ plainto_tsquery('english', ${query})
    ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${query})) DESC
    LIMIT 20
  `);
  const rows = (result.rows ?? result) as Array<{
    id: string;
    content: string;
    tags: string[];
    remembered_by_name: string | null;
    remembered_at: string | Date;
  }>;
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    tags: r.tags ?? [],
    rememberedBy: r.remembered_by_name ?? "unknown",
    rememberedAt:
      r.remembered_at instanceof Date
        ? r.remembered_at
        : new Date(r.remembered_at),
  }));
}

/**
 * Soft-delete a memory by setting forgotten_at.
 */
export async function forgetMemory(
  meshId: string,
  memoryId: string,
): Promise<void> {
  await db
    .update(meshMemory)
    .set({ forgottenAt: new Date() })
    .where(
      and(
        eq(meshMemory.id, memoryId),
        eq(meshMemory.meshId, meshId),
        isNull(meshMemory.forgottenAt),
      ),
    );
}

// --- Skills ---

/**
 * Upsert a skill in a mesh. If a skill with the same name exists, it is updated.
 */
export async function shareSkill(
  meshId: string,
  name: string,
  description: string,
  instructions: string,
  tags: string[],
  memberId?: string,
  memberName?: string,
): Promise<string> {
  const existing = await db
    .select({ id: meshSkill.id })
    .from(meshSkill)
    .where(and(eq(meshSkill.meshId, meshId), eq(meshSkill.name, name)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(meshSkill)
      .set({
        description,
        instructions,
        tags,
        authorMemberId: memberId ?? null,
        authorName: memberName ?? null,
        updatedAt: new Date(),
      })
      .where(eq(meshSkill.id, existing[0]!.id));
    return existing[0]!.id;
  }

  const [row] = await db
    .insert(meshSkill)
    .values({
      meshId,
      name,
      description,
      instructions,
      tags,
      authorMemberId: memberId ?? null,
      authorName: memberName ?? null,
    })
    .returning({ id: meshSkill.id });
  if (!row) throw new Error("failed to insert skill");
  return row.id;
}

/**
 * Get a skill by name in a mesh.
 */
export async function getSkill(
  meshId: string,
  name: string,
): Promise<{
  name: string;
  description: string;
  instructions: string;
  tags: string[];
  author: string;
  createdAt: Date;
} | null> {
  const rows = await db
    .select({
      name: meshSkill.name,
      description: meshSkill.description,
      instructions: meshSkill.instructions,
      tags: meshSkill.tags,
      authorName: meshSkill.authorName,
      createdAt: meshSkill.createdAt,
    })
    .from(meshSkill)
    .where(and(eq(meshSkill.meshId, meshId), eq(meshSkill.name, name)))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    tags: r.tags ?? [],
    author: r.authorName ?? "unknown",
    createdAt: r.createdAt,
  };
}

/**
 * List skills in a mesh, optionally filtering by keyword across name, description, and tags.
 */
export async function listSkills(
  meshId: string,
  query?: string,
): Promise<
  Array<{
    name: string;
    description: string;
    tags: string[];
    author: string;
    createdAt: Date;
  }>
> {
  if (query) {
    const pattern = `%${query}%`;
    const rows = await db
      .select({
        name: meshSkill.name,
        description: meshSkill.description,
        tags: meshSkill.tags,
        authorName: meshSkill.authorName,
        createdAt: meshSkill.createdAt,
      })
      .from(meshSkill)
      .where(
        and(
          eq(meshSkill.meshId, meshId),
          or(
            sql`${meshSkill.name} ILIKE ${pattern}`,
            sql`${meshSkill.description} ILIKE ${pattern}`,
            sql`EXISTS (SELECT 1 FROM unnest(${meshSkill.tags}) AS t WHERE t ILIKE ${pattern})`,
          ),
        ),
      )
      .orderBy(asc(meshSkill.name));
    return rows.map((r) => ({
      name: r.name,
      description: r.description,
      tags: r.tags ?? [],
      author: r.authorName ?? "unknown",
      createdAt: r.createdAt,
    }));
  }

  const rows = await db
    .select({
      name: meshSkill.name,
      description: meshSkill.description,
      tags: meshSkill.tags,
      authorName: meshSkill.authorName,
      createdAt: meshSkill.createdAt,
    })
    .from(meshSkill)
    .where(eq(meshSkill.meshId, meshId))
    .orderBy(asc(meshSkill.name));
  return rows.map((r) => ({
    name: r.name,
    description: r.description,
    tags: r.tags ?? [],
    author: r.authorName ?? "unknown",
    createdAt: r.createdAt,
  }));
}

/**
 * Remove a skill by name in a mesh. Returns true if a row was deleted.
 */
export async function removeSkill(
  meshId: string,
  name: string,
): Promise<boolean> {
  const result = await db
    .delete(meshSkill)
    .where(and(eq(meshSkill.meshId, meshId), eq(meshSkill.name, name)))
    .returning({ id: meshSkill.id });
  return result.length > 0;
}

// --- File sharing ---

/**
 * Insert a file metadata row after upload to MinIO.
 */
export async function uploadFile(args: {
  meshId: string;
  name: string;
  sizeBytes: number;
  mimeType?: string;
  minioKey: string;
  tags?: string[];
  persistent?: boolean;
  uploadedByName?: string;
  uploadedByMember?: string;
  targetSpec?: string;
  expiresAt?: Date;
  encrypted?: boolean;
  ownerPubkey?: string;
}): Promise<string> {
  const [row] = await db
    .insert(meshFile)
    .values({
      meshId: args.meshId,
      name: args.name,
      sizeBytes: args.sizeBytes,
      mimeType: args.mimeType ?? null,
      minioKey: args.minioKey,
      tags: args.tags ?? [],
      persistent: args.persistent ?? true,
      uploadedByName: args.uploadedByName ?? null,
      uploadedByMember: args.uploadedByMember ?? null,
      targetSpec: args.targetSpec ?? null,
      expiresAt: args.expiresAt ?? null,
      encrypted: args.encrypted ?? false,
      ownerPubkey: args.ownerPubkey ?? null,
    })
    .returning({ id: meshFile.id });
  if (!row) throw new Error("failed to insert file row");
  return row.id;
}

/**
 * Get a single file by id, check it belongs to the mesh and is not deleted.
 */
export async function getFile(
  meshId: string,
  fileId: string,
): Promise<{
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string | null;
  minioKey: string;
  tags: string[];
  persistent: boolean;
  uploadedByName: string | null;
  targetSpec: string | null;
  uploadedAt: Date;
  encrypted: boolean;
  ownerPubkey: string | null;
} | null> {
  const [row] = await db
    .select({
      id: meshFile.id,
      name: meshFile.name,
      sizeBytes: meshFile.sizeBytes,
      mimeType: meshFile.mimeType,
      minioKey: meshFile.minioKey,
      tags: meshFile.tags,
      persistent: meshFile.persistent,
      uploadedByName: meshFile.uploadedByName,
      targetSpec: meshFile.targetSpec,
      uploadedAt: meshFile.uploadedAt,
      encrypted: meshFile.encrypted,
      ownerPubkey: meshFile.ownerPubkey,
    })
    .from(meshFile)
    .where(
      and(
        eq(meshFile.id, fileId),
        eq(meshFile.meshId, meshId),
        isNull(meshFile.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    tags: (row.tags ?? []) as string[],
    encrypted: row.encrypted,
    ownerPubkey: row.ownerPubkey,
  };
}

/**
 * List files in a mesh. Optionally filter by query (name ILIKE) or uploader.
 */
export async function listFiles(
  meshId: string,
  query?: string,
  from?: string,
): Promise<
  Array<{
    id: string;
    name: string;
    sizeBytes: number;
    tags: string[];
    uploadedBy: string;
    uploadedAt: Date;
    persistent: boolean;
    encrypted: boolean;
  }>
> {
  const conditions = [
    eq(meshFile.meshId, meshId),
    isNull(meshFile.deletedAt),
  ];
  if (query) {
    conditions.push(sql`${meshFile.name} ILIKE ${"%" + query + "%"}`);
  }
  if (from) {
    conditions.push(eq(meshFile.uploadedByName, from));
  }
  const rows = await db
    .select({
      id: meshFile.id,
      name: meshFile.name,
      sizeBytes: meshFile.sizeBytes,
      tags: meshFile.tags,
      uploadedByName: meshFile.uploadedByName,
      uploadedAt: meshFile.uploadedAt,
      persistent: meshFile.persistent,
      encrypted: meshFile.encrypted,
    })
    .from(meshFile)
    .where(and(...conditions))
    .orderBy(desc(meshFile.uploadedAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sizeBytes: r.sizeBytes,
    tags: (r.tags ?? []) as string[],
    uploadedBy: r.uploadedByName ?? "unknown",
    uploadedAt: r.uploadedAt,
    persistent: r.persistent,
    encrypted: r.encrypted,
  }));
}

/**
 * Record a file access event (download/presigned URL generation).
 */
export async function recordFileAccess(
  fileId: string,
  sessionPubkey?: string,
  peerName?: string,
): Promise<void> {
  await db.insert(meshFileAccess).values({
    fileId,
    peerSessionPubkey: sessionPubkey ?? null,
    peerName: peerName ?? null,
  });
}

/**
 * Get access log for a file.
 */
export async function getFileStatus(
  fileId: string,
): Promise<Array<{ peerName: string; accessedAt: Date }>> {
  const rows = await db
    .select({
      peerName: meshFileAccess.peerName,
      accessedAt: meshFileAccess.accessedAt,
    })
    .from(meshFileAccess)
    .where(eq(meshFileAccess.fileId, fileId))
    .orderBy(desc(meshFileAccess.accessedAt));
  return rows.map((r) => ({
    peerName: r.peerName ?? "unknown",
    accessedAt: r.accessedAt,
  }));
}

/**
 * Soft-delete a file by setting deleted_at.
 */
export async function deleteFile(
  meshId: string,
  fileId: string,
): Promise<void> {
  await db
    .update(meshFile)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(meshFile.id, fileId),
        eq(meshFile.meshId, meshId),
        isNull(meshFile.deletedAt),
      ),
    );
}

/** Insert encrypted key blobs for a newly uploaded E2E file. */
export async function insertFileKeys(
  fileId: string,
  keys: Array<{ peerPubkey: string; sealedKey: string; grantedByPubkey?: string }>,
): Promise<void> {
  if (keys.length === 0) return;
  await db.insert(meshFileKey).values(
    keys.map((k) => ({
      fileId,
      peerPubkey: k.peerPubkey,
      sealedKey: k.sealedKey,
      grantedByPubkey: k.grantedByPubkey ?? null,
    })),
  );
}

/** Get the sealed key for a specific peer, or null if not authorized. */
export async function getFileKey(
  fileId: string,
  peerPubkey: string,
): Promise<string | null> {
  const [row] = await db
    .select({ sealedKey: meshFileKey.sealedKey })
    .from(meshFileKey)
    .where(
      and(eq(meshFileKey.fileId, fileId), eq(meshFileKey.peerPubkey, peerPubkey)),
    );
  return row?.sealedKey ?? null;
}

/** Grant a peer access to an encrypted file (upsert their key blob). */
export async function grantFileKey(
  fileId: string,
  peerPubkey: string,
  sealedKey: string,
  grantedByPubkey: string,
): Promise<void> {
  await db
    .insert(meshFileKey)
    .values({ fileId, peerPubkey, sealedKey, grantedByPubkey })
    .onConflictDoUpdate({
      target: [meshFileKey.fileId, meshFileKey.peerPubkey],
      set: { sealedKey, grantedByPubkey, grantedAt: new Date() },
    });
}

// --- Context sharing ---

/**
 * Upsert a context snapshot for a peer. When `memberId` is provided the
 * row is keyed on (meshId, memberId) — a stable identifier that survives
 * reconnects. This prevents stale rows from accumulating every time a
 * session reconnects with a fresh ephemeral presenceId.
 *
 * Falls back to (meshId, presenceId) lookup when memberId is absent
 * (e.g. legacy callers or anonymous connections).
 */
export async function shareContext(
  meshId: string,
  presenceId: string,
  peerName: string | undefined,
  summary: string,
  filesRead?: string[],
  keyFindings?: string[],
  tags?: string[],
  memberId?: string,
): Promise<string> {
  const now = new Date();

  // Build the WHERE clause: prefer stable memberId, fall back to presenceId.
  const lookupWhere = memberId
    ? and(eq(meshContext.meshId, meshId), eq(meshContext.memberId, memberId))
    : and(eq(meshContext.meshId, meshId), eq(meshContext.presenceId, presenceId));

  const [existing] = await db
    .select({ id: meshContext.id })
    .from(meshContext)
    .where(lookupWhere)
    .limit(1);

  if (existing) {
    await db
      .update(meshContext)
      .set({
        // Keep presenceId current so it reflects the latest connection.
        presenceId,
        peerName: peerName ?? null,
        summary,
        filesRead: filesRead ?? [],
        keyFindings: keyFindings ?? [],
        tags: tags ?? [],
        updatedAt: now,
      })
      .where(eq(meshContext.id, existing.id));
    return existing.id;
  }

  const [row] = await db
    .insert(meshContext)
    .values({
      meshId,
      memberId: memberId ?? null,
      presenceId,
      peerName: peerName ?? null,
      summary,
      filesRead: filesRead ?? [],
      keyFindings: keyFindings ?? [],
      tags: tags ?? [],
      updatedAt: now,
    })
    .returning({ id: meshContext.id });
  if (!row) throw new Error("failed to insert context");
  return row.id;
}

/**
 * Search contexts by tag match or summary ILIKE.
 */
export async function getContext(
  meshId: string,
  query: string,
): Promise<
  Array<{
    peerName: string;
    summary: string;
    filesRead: string[];
    keyFindings: string[];
    tags: string[];
    updatedAt: Date;
  }>
> {
  const result = await db.execute<{
    peer_name: string | null;
    summary: string;
    files_read: string[] | null;
    key_findings: string[] | null;
    tags: string[] | null;
    updated_at: string | Date;
  }>(sql`
    SELECT peer_name, summary, files_read, key_findings, tags, updated_at
    FROM mesh.context
    WHERE mesh_id = ${meshId}
      AND (
        summary ILIKE ${"%" + query + "%"}
        OR ${query} = ANY(tags)
      )
    ORDER BY updated_at DESC
    LIMIT 20
  `);
  const rows = (result.rows ?? result) as Array<{
    peer_name: string | null;
    summary: string;
    files_read: string[] | null;
    key_findings: string[] | null;
    tags: string[] | null;
    updated_at: string | Date;
  }>;
  return rows.map((r) => ({
    peerName: r.peer_name ?? "unknown",
    summary: r.summary,
    filesRead: r.files_read ?? [],
    keyFindings: r.key_findings ?? [],
    tags: r.tags ?? [],
    updatedAt:
      r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at),
  }));
}

/**
 * List all contexts for a mesh, ordered by most recently updated.
 */
export async function listContexts(
  meshId: string,
): Promise<
  Array<{
    peerName: string;
    summary: string;
    tags: string[];
    updatedAt: Date;
  }>
> {
  const rows = await db
    .select({
      peerName: meshContext.peerName,
      summary: meshContext.summary,
      tags: meshContext.tags,
      updatedAt: meshContext.updatedAt,
    })
    .from(meshContext)
    .where(eq(meshContext.meshId, meshId))
    .orderBy(desc(meshContext.updatedAt));
  return rows.map((r) => ({
    peerName: r.peerName ?? "unknown",
    summary: r.summary,
    tags: (r.tags ?? []) as string[],
    updatedAt: r.updatedAt,
  }));
}

// --- Tasks ---

/**
 * Create a new task in a mesh. Returns the generated id.
 */
export async function createTask(
  meshId: string,
  title: string,
  assignee?: string,
  priority?: string,
  tags?: string[],
  createdByName?: string,
): Promise<string> {
  const [row] = await db
    .insert(meshTask)
    .values({
      meshId,
      title,
      assignee: assignee ?? null,
      priority: priority ?? "normal",
      status: "open",
      tags: tags ?? [],
      createdByName: createdByName ?? null,
    })
    .returning({ id: meshTask.id });
  if (!row) throw new Error("failed to insert task");
  return row.id;
}

/**
 * Claim an open task. Sets status to 'claimed' and records who claimed it.
 * Only succeeds if the task is currently 'open'.
 */
export async function claimTask(
  meshId: string,
  taskId: string,
  presenceId: string,
  peerName?: string,
): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(meshTask)
    .set({
      status: "claimed",
      claimedByPresence: presenceId,
      claimedByName: peerName ?? null,
      claimedAt: now,
    })
    .where(
      and(
        eq(meshTask.id, taskId),
        eq(meshTask.meshId, meshId),
        eq(meshTask.status, "open"),
      ),
    )
    .returning({ id: meshTask.id });
  return result.length > 0;
}

/**
 * Complete a task. Sets status to 'done', records the result and timestamp.
 */
export async function completeTask(
  meshId: string,
  taskId: string,
  result?: string,
): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(meshTask)
    .set({
      status: "done",
      result: result ?? null,
      completedAt: now,
    })
    .where(
      and(
        eq(meshTask.id, taskId),
        eq(meshTask.meshId, meshId),
      ),
    )
    .returning({ id: meshTask.id });
  return rows.length > 0;
}

/**
 * List tasks in a mesh with optional status and assignee filters.
 */
export async function listTasks(
  meshId: string,
  status?: string,
  assignee?: string,
): Promise<
  Array<{
    id: string;
    title: string;
    assignee: string | null;
    claimedBy: string | null;
    status: string;
    priority: string;
    createdBy: string | null;
    tags: string[];
    createdAt: Date;
  }>
> {
  const conditions = [eq(meshTask.meshId, meshId)];
  if (status) {
    conditions.push(eq(meshTask.status, status));
  }
  if (assignee) {
    conditions.push(eq(meshTask.assignee, assignee));
  }
  const rows = await db
    .select({
      id: meshTask.id,
      title: meshTask.title,
      assignee: meshTask.assignee,
      claimedByName: meshTask.claimedByName,
      status: meshTask.status,
      priority: meshTask.priority,
      createdByName: meshTask.createdByName,
      tags: meshTask.tags,
      createdAt: meshTask.createdAt,
    })
    .from(meshTask)
    .where(and(...conditions))
    .orderBy(desc(meshTask.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    assignee: r.assignee,
    claimedBy: r.claimedByName,
    status: r.status,
    priority: r.priority,
    createdBy: r.createdByName,
    tags: (r.tags ?? []) as string[],
    createdAt: r.createdAt,
  }));
}

// --- Streams ---

/**
 * Create a named real-time stream in a mesh. Upsert semantics: if a
 * stream with the same (meshId, name) already exists, return its id.
 */
export async function createStream(
  meshId: string,
  name: string,
  createdByName: string,
): Promise<string> {
  // Atomic upsert: INSERT ... ON CONFLICT DO NOTHING to avoid TOCTOU race
  // when two callers concurrently attempt to create the same stream.
  const [inserted] = await db
    .insert(meshStream)
    .values({ meshId, name, createdByName })
    .onConflictDoNothing()
    .returning({ id: meshStream.id });

  if (inserted) return inserted.id;

  // Row already existed — fetch the id.
  const [existing] = await db
    .select({ id: meshStream.id })
    .from(meshStream)
    .where(and(eq(meshStream.meshId, meshId), eq(meshStream.name, name)));
  return existing!.id;
}

/**
 * List all streams in a mesh, ordered by creation time.
 */
export async function listStreams(
  meshId: string,
): Promise<
  Array<{ id: string; name: string; createdBy: string | null; createdAt: Date }>
> {
  return db
    .select({
      id: meshStream.id,
      name: meshStream.name,
      createdBy: meshStream.createdByName,
      createdAt: meshStream.createdAt,
    })
    .from(meshStream)
    .where(eq(meshStream.meshId, meshId))
    .orderBy(asc(meshStream.createdAt));
}

// --- Message queueing + delivery ---

export interface QueueParams {
  meshId: string;
  senderMemberId: string;
  senderSessionPubkey?: string;
  targetSpec: string;
  priority: Priority;
  nonce: string;
  ciphertext: string;
  expiresAt?: Date;
}

/** Insert an E2E envelope into the mesh's message queue. */
export async function queueMessage(params: QueueParams): Promise<string> {
  const [row] = await db
    .insert(messageQueue)
    .values({
      meshId: params.meshId,
      senderMemberId: params.senderMemberId,
      senderSessionPubkey: params.senderSessionPubkey ?? null,
      targetSpec: params.targetSpec,
      priority: params.priority,
      nonce: params.nonce,
      ciphertext: params.ciphertext,
      expiresAt: params.expiresAt,
    })
    .returning({ id: messageQueue.id });
  if (!row) throw new Error("failed to queue message");
  return row.id;
}

/**
 * Resolve which priorities to deliver to a peer in a given status.
 * Ported verbatim:
 *   - idle → all (now + next + low)
 *   - dnd  → now only
 *   - working → now only (next/low held until idle)
 */
function deliverablePriorities(status: PeerStatus): Priority[] {
  if (status === "idle") return ["now", "next", "low"];
  return ["now"];
}

/**
 * Drain deliverable messages addressed to a specific member in a mesh.
 * Atomically claims rows via UPDATE ... WHERE id IN (SELECT ... FOR
 * UPDATE SKIP LOCKED) — concurrent callers each claim DISJOINT sets,
 * so the same message can never be pushed twice (even under fan-out
 * racing with handleHello's own drain).
 *
 * Joins mesh.member so each envelope carries the sender's pubkey.
 * targetSpec routing: matches either the member's pubkey directly or
 * the broadcast wildcard ("*"). Channel/tag resolution is per-mesh
 * config that lives outside this function.
 */
export async function drainForMember(
  meshId: string,
  _memberId: string,
  memberPubkey: string,
  status: PeerStatus,
  sessionPubkey?: string,
  excludeSenderSessionPubkey?: string,
  memberGroups?: string[],
): Promise<
  Array<{
    id: string;
    priority: Priority;
    nonce: string;
    ciphertext: string;
    createdAt: Date;
    senderMemberId: string;
    senderPubkey: string;
  }>
> {
  const priorities = deliverablePriorities(status);
  if (priorities.length === 0) return [];
  const priorityList = sql.raw(
    priorities.map((p) => `'${p}'`).join(","),
  );

  // Build group target matching: @all (broadcast alias) + @<groupname>
  // for each group the peer belongs to, expanded to all ancestor paths.
  //
  // Hierarchical routing (downward propagation):
  //   A peer in "flexicar/core" also matches messages sent to "@flexicar".
  //   A peer in "flexicar/core/backend" matches "@flexicar/core" and "@flexicar".
  //   This lets leads send to a parent group and reach all sub-teams.
  //
  // Resolution happens at drain time (pull model) — no duplicates stored,
  // no schema changes, fully backward-compatible.
  const groupTargets = ["@all"];
  if (memberGroups) {
    const seen = new Set<string>();
    for (const g of memberGroups) {
      const parts = g.split("/");
      // Add the group itself + every ancestor prefix.
      for (let depth = parts.length; depth > 0; depth--) {
        const ancestor = parts.slice(0, depth).join("/");
        if (!seen.has(ancestor)) {
          seen.add(ancestor);
          groupTargets.push(`@${ancestor}`);
        }
      }
    }
  }
  const groupTargetList = sql.raw(
    groupTargets.map((t) => `'${t}'`).join(","),
  );

  // Atomic claim with SQL-side ordering. The CTE claims rows via
  // UPDATE...RETURNING; the outer SELECT re-orders by created_at
  // (with id as tiebreaker so equal-timestamp rows stay deterministic).
  // Sorting in SQL avoids JS Date's millisecond-precision collapse of
  // Postgres microsecond timestamps.
  const result = await db.execute<{
    id: string;
    priority: string;
    nonce: string;
    ciphertext: string;
    created_at: string | Date;
    sender_member_id: string;
    sender_pubkey: string;
  }>(sql`
    WITH claimed AS (
      UPDATE mesh.message_queue AS mq
      SET delivered_at = NOW()
      FROM mesh.member AS m
      WHERE mq.id IN (
        SELECT id FROM mesh.message_queue
        WHERE mesh_id = ${meshId}
          AND delivered_at IS NULL
          AND priority::text IN (${priorityList})
          AND (target_spec = ${memberPubkey} OR target_spec = '*'${sessionPubkey ? sql` OR target_spec = ${sessionPubkey}` : sql``} OR target_spec IN (${groupTargetList}))
          ${excludeSenderSessionPubkey ? sql`AND NOT (target_spec IN ('*') AND sender_session_pubkey = ${excludeSenderSessionPubkey})` : sql``}
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
      )
      AND m.id = mq.sender_member_id
      RETURNING mq.id, mq.priority, mq.nonce, mq.ciphertext,
               mq.created_at, mq.sender_member_id,
               COALESCE(mq.sender_session_pubkey, m.peer_pubkey) AS sender_pubkey
    )
    SELECT * FROM claimed ORDER BY created_at ASC, id ASC
  `);

  const rows = (result.rows ?? result) as Array<{
    id: string;
    priority: string;
    nonce: string;
    ciphertext: string;
    created_at: string | Date;
    sender_member_id: string;
    sender_pubkey: string;
  }>;
  if (!rows || rows.length === 0) return [];
  return rows.map((r) => ({
    id: r.id,
    priority: r.priority as Priority,
    nonce: r.nonce,
    ciphertext: r.ciphertext,
    createdAt:
      r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    senderMemberId: r.sender_member_id,
    senderPubkey: r.sender_pubkey,
  }));
}

// --- Lifecycle ---

let ttlTimer: ReturnType<typeof setInterval> | null = null;
let pendingTimer: ReturnType<typeof setInterval> | null = null;
let staleTimer: ReturnType<typeof setInterval> | null = null;

/** Start background sweepers. Idempotent. */
export function startSweepers(): void {
  if (ttlTimer) return;
  ttlTimer = setInterval(() => {
    sweepStuckWorking().catch((e) => console.error("[broker] ttl sweep:", e));
  }, TTL_SWEEP_INTERVAL_MS);
  pendingTimer = setInterval(() => {
    sweepPendingStatuses().catch((e) =>
      console.error("[broker] pending sweep:", e),
    );
  }, PENDING_SWEEP_INTERVAL_MS);
  staleTimer = setInterval(() => {
    sweepStalePresences().catch((e) =>
      console.error("[broker] stale presence sweep:", e),
    );
  }, 30_000);
}

/** Stop background sweepers and mark all active presences disconnected. */
export async function stopSweepers(): Promise<void> {
  if (ttlTimer) clearInterval(ttlTimer);
  if (pendingTimer) clearInterval(pendingTimer);
  if (staleTimer) clearInterval(staleTimer);
  ttlTimer = null;
  pendingTimer = null;
  staleTimer = null;
  await db
    .update(presence)
    .set({ disconnectedAt: new Date() })
    .where(isNull(presence.disconnectedAt));
}

export type JoinError =
  | "mesh_not_found"
  | "mesh_missing_owner_key"
  | "invite_not_found"
  | "invite_expired"
  | "invite_exhausted"
  | "invite_revoked"
  | "invite_bad_signature"
  | "invite_mesh_mismatch"
  | "invite_owner_mismatch"
  | "member_insert_failed";

export interface InvitePayload {
  v: number;
  mesh_id: string;
  mesh_slug: string;
  broker_url: string;
  expires_at: number;
  mesh_root_key: string;
  role: "admin" | "member";
  owner_pubkey: string;
  signature: string;
}

/**
 * Enroll a new member in an existing mesh.
 *
 * Requires a signed invite payload. Verifies:
 *   - invite row exists (looked up by token = base64 link payload)
 *   - not expired, not revoked, used_count < max_uses
 *   - payload's signature matches payload's owner_pubkey
 *   - payload's owner_pubkey matches mesh.owner_pubkey (prevents a
 *     malicious admin from substituting their own owner key)
 *   - payload's mesh_id matches the row's mesh_id (belt + braces)
 *
 * Then atomically increments used_count (CAS guarded by max_uses) and
 * inserts the member. Idempotent: same pubkey enrolling twice returns
 * the existing memberId WITHOUT burning an invite use.
 */
export async function joinMesh(args: {
  inviteToken: string;
  invitePayload: InvitePayload;
  peerPubkey: string;
  displayName: string;
}): Promise<
  | { ok: true; memberId: string; alreadyMember?: boolean }
  | { ok: false; error: JoinError }
> {
  const { inviteToken, invitePayload, peerPubkey, displayName } = args;

  // 1. Verify invite signature.
  const canonical = canonicalInvite({
    v: invitePayload.v,
    mesh_id: invitePayload.mesh_id,
    mesh_slug: invitePayload.mesh_slug,
    broker_url: invitePayload.broker_url,
    expires_at: invitePayload.expires_at,
    mesh_root_key: invitePayload.mesh_root_key,
    role: invitePayload.role,
    owner_pubkey: invitePayload.owner_pubkey,
  });
  const sigValid = await verifyEd25519(
    canonical,
    invitePayload.signature,
    invitePayload.owner_pubkey,
  );
  if (!sigValid) return { ok: false, error: "invite_bad_signature" };

  // 2. Load the mesh. Require owner_pubkey is set and matches payload.
  const [m] = await db
    .select({ id: mesh.id, ownerPubkey: mesh.ownerPubkey })
    .from(mesh)
    .where(and(eq(mesh.id, invitePayload.mesh_id), isNull(mesh.archivedAt)));
  if (!m) return { ok: false, error: "mesh_not_found" };
  if (!m.ownerPubkey) return { ok: false, error: "mesh_missing_owner_key" };
  if (m.ownerPubkey !== invitePayload.owner_pubkey) {
    return { ok: false, error: "invite_owner_mismatch" };
  }

  // 3. Load the invite row. Must belong to this mesh.
  const [inv] = await db
    .select()
    .from(inviteTable)
    .where(eq(inviteTable.token, inviteToken));
  if (!inv) return { ok: false, error: "invite_not_found" };
  if (inv.meshId !== invitePayload.mesh_id) {
    return { ok: false, error: "invite_mesh_mismatch" };
  }
  if (inv.revokedAt) return { ok: false, error: "invite_revoked" };
  if (inv.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "invite_expired" };
  }

  // 4. Idempotency: if this pubkey is already a member, short-circuit
  //    without consuming an invite use.
  const [existing] = await db
    .select({ id: memberTable.id })
    .from(memberTable)
    .where(
      and(
        eq(memberTable.meshId, invitePayload.mesh_id),
        eq(memberTable.peerPubkey, peerPubkey),
        isNull(memberTable.revokedAt),
      ),
    );
  if (existing) {
    return { ok: true, memberId: existing.id, alreadyMember: true };
  }

  // 5. Atomic claim: increment used_count iff under max_uses.
  const [claimed] = await db
    .update(inviteTable)
    .set({ usedCount: sql`${inviteTable.usedCount} + 1` })
    .where(
      and(
        eq(inviteTable.id, inv.id),
        lt(inviteTable.usedCount, inv.maxUses),
      ),
    )
    .returning({ id: inviteTable.id, usedCount: inviteTable.usedCount });
  if (!claimed) return { ok: false, error: "invite_exhausted" };

  // 6. Insert the member with the role from the payload.
  const [row] = await db
    .insert(memberTable)
    .values({
      meshId: invitePayload.mesh_id,
      peerPubkey,
      displayName,
      role: invitePayload.role,
    })
    .returning({ id: memberTable.id });
  if (!row) return { ok: false, error: "member_insert_failed" };
  return { ok: true, memberId: row.id };
}

/**
 * Look up a member row by pubkey within a mesh. Used at WS handshake
 * to authenticate an incoming hello.
 */
export async function findMemberByPubkey(
  meshId: string,
  pubkey: string,
): Promise<{ id: string; displayName: string; role: string } | null> {
  const [row] = await db
    .select({
      id: memberTable.id,
      displayName: memberTable.displayName,
      role: memberTable.role,
    })
    .from(memberTable)
    .where(
      and(
        eq(memberTable.meshId, meshId),
        eq(memberTable.peerPubkey, pubkey),
        isNull(memberTable.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

// --- Mesh databases (per-mesh PostgreSQL schemas) ---

function meshSchemaName(meshId: string): string {
  return `meshdb_${meshId.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}

/** Validate that user-provided SQL doesn't contain dangerous operations. */
function validateMeshSql(userSql: string): void {
  const upper = userSql.toUpperCase();
  const forbidden = [
    "DROP SCHEMA",
    "CREATE SCHEMA",
    "SET SEARCH_PATH",
    "SET ROLE",
    "SET SESSION",
    "SET LOCAL",
    "GRANT",
    "REVOKE",
  ];
  for (const f of forbidden) {
    if (upper.includes(f))
      throw new Error(`Forbidden SQL operation: ${f}`);
  }
}

/** Ensure the per-mesh schema exists. */
export async function ensureMeshSchema(meshId: string): Promise<string> {
  const schema = meshSchemaName(meshId);
  await db.execute(
    sql`CREATE SCHEMA IF NOT EXISTS ${sql.raw('"' + schema + '"')}`,
  );
  return schema;
}

/** Run a SELECT query in the mesh's schema. */
export async function meshQuery(
  meshId: string,
  query: string,
): Promise<{
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}> {
  validateMeshSql(query);
  const schema = await ensureMeshSchema(meshId);
  // Use a transaction so SET LOCAL is scoped and automatically reset.
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(`SET LOCAL search_path TO "${schema}"`)
    );
    const result = await tx.execute(sql.raw(query));
    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
    const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
    return { columns, rows, rowCount: rows.length };
  });
}

/** Run a DDL/DML statement in the mesh's schema. */
export async function meshExecute(
  meshId: string,
  statement: string,
): Promise<{ rowCount: number }> {
  validateMeshSql(statement);
  const schema = await ensureMeshSchema(meshId);
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(`SET LOCAL search_path TO "${schema}"`)
    );
    const result = await tx.execute(sql.raw(statement));
    return { rowCount: (result as any).rowCount ?? 0 };
  });
}

/** List tables and columns in the mesh's schema. */
export async function meshSchema(
  meshId: string,
): Promise<
  Array<{
    name: string;
    columns: Array<{ name: string; type: string; nullable: boolean }>;
  }>
> {
  const schema = meshSchemaName(meshId);
  const result = await db.execute<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(sql`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = ${schema}
    ORDER BY table_name, ordinal_position
  `);
  const rows = (result.rows ?? result) as Array<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>;
  const tables = new Map<
    string,
    Array<{ name: string; type: string; nullable: boolean }>
  >();
  for (const r of rows) {
    if (!tables.has(r.table_name)) tables.set(r.table_name, []);
    tables.get(r.table_name)!.push({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === "YES",
    });
  }
  return [...tables.entries()].map(([name, columns]) => ({ name, columns }));
}

// ---------------------------------------------------------------------------
// Vault operations
// ---------------------------------------------------------------------------

export async function vaultSet(meshId: string, memberId: string, key: string, ciphertext: string, nonce: string, sealedKey: string, entryType: "env" | "file", mountPath?: string, description?: string): Promise<string> {
  const existing = await db.select({ id: meshVaultEntry.id }).from(meshVaultEntry).where(and(eq(meshVaultEntry.meshId, meshId), eq(meshVaultEntry.memberId, memberId), eq(meshVaultEntry.key, key))).limit(1);
  if (existing.length > 0) {
    await db.update(meshVaultEntry).set({ ciphertext, nonce, sealedKey, entryType, mountPath: mountPath ?? null, description: description ?? null, updatedAt: new Date() }).where(eq(meshVaultEntry.id, existing[0]!.id));
    return existing[0]!.id;
  }
  const [row] = await db.insert(meshVaultEntry).values({ meshId, memberId, key, ciphertext, nonce, sealedKey, entryType, mountPath: mountPath ?? null, description: description ?? null }).returning({ id: meshVaultEntry.id });
  return row!.id;
}

export async function vaultList(meshId: string, memberId: string) {
  return db.select({ key: meshVaultEntry.key, entryType: meshVaultEntry.entryType, mountPath: meshVaultEntry.mountPath, description: meshVaultEntry.description, updatedAt: meshVaultEntry.updatedAt }).from(meshVaultEntry).where(and(eq(meshVaultEntry.meshId, meshId), eq(meshVaultEntry.memberId, memberId)));
}

export async function vaultDelete(meshId: string, memberId: string, key: string): Promise<boolean> {
  const deleted = await db.delete(meshVaultEntry).where(and(eq(meshVaultEntry.meshId, meshId), eq(meshVaultEntry.memberId, memberId), eq(meshVaultEntry.key, key))).returning({ id: meshVaultEntry.id });
  return deleted.length > 0;
}

export async function vaultGetEntries(meshId: string, memberId: string, keys: string[]) {
  if (keys.length === 0) return [];
  return db.select({ key: meshVaultEntry.key, ciphertext: meshVaultEntry.ciphertext, nonce: meshVaultEntry.nonce, sealedKey: meshVaultEntry.sealedKey, entryType: meshVaultEntry.entryType, mountPath: meshVaultEntry.mountPath }).from(meshVaultEntry).where(and(eq(meshVaultEntry.meshId, meshId), eq(meshVaultEntry.memberId, memberId), inArray(meshVaultEntry.key, keys)));
}

// ---------------------------------------------------------------------------
// Service catalog operations
// ---------------------------------------------------------------------------

export async function upsertService(meshId: string, name: string, data: { type: "mcp" | "skill"; sourceType: string; description: string; sourceFileId?: string; sourceGitUrl?: string; sourceGitBranch?: string; sourceGitSha?: string; instructions?: string; toolsSchema?: unknown; manifest?: unknown; runtime?: string; status?: string; config?: unknown; scope?: unknown; deployedBy?: string; deployedByName?: string }): Promise<string> {
  // Whitelist allowed fields — prevent mass-assignment of id, meshId, createdAt, etc.
  const fields: Record<string, unknown> = {
    type: data.type,
    sourceType: data.sourceType,
    description: data.description,
    ...(data.sourceFileId !== undefined && { sourceFileId: data.sourceFileId }),
    ...(data.sourceGitUrl !== undefined && { sourceGitUrl: data.sourceGitUrl }),
    ...(data.sourceGitBranch !== undefined && { sourceGitBranch: data.sourceGitBranch }),
    ...(data.sourceGitSha !== undefined && { sourceGitSha: data.sourceGitSha }),
    ...(data.instructions !== undefined && { instructions: data.instructions }),
    ...(data.toolsSchema !== undefined && { toolsSchema: data.toolsSchema }),
    ...(data.manifest !== undefined && { manifest: data.manifest }),
    ...(data.runtime !== undefined && { runtime: data.runtime }),
    ...(data.status !== undefined && { status: data.status }),
    ...(data.config !== undefined && { config: data.config }),
    ...(data.scope !== undefined && { scope: data.scope }),
    ...(data.deployedBy !== undefined && { deployedBy: data.deployedBy }),
    ...(data.deployedByName !== undefined && { deployedByName: data.deployedByName }),
  };

  const existing = await db.select({ id: meshService.id }).from(meshService).where(and(eq(meshService.meshId, meshId), eq(meshService.name, name))).limit(1);
  if (existing.length > 0) {
    await db.update(meshService).set({ ...fields, updatedAt: new Date() } as any).where(eq(meshService.id, existing[0]!.id));
    return existing[0]!.id;
  }
  const [row] = await db.insert(meshService).values({ meshId, name, ...fields } as any).returning({ id: meshService.id });
  return row!.id;
}

export async function updateServiceStatus(meshId: string, name: string, status: string, extra?: { toolsSchema?: unknown; restartCount?: number; lastHealth?: Date }) {
  await db.update(meshService).set({ status, ...(extra ?? {}), updatedAt: new Date() } as any).where(and(eq(meshService.meshId, meshId), eq(meshService.name, name)));
}

export async function updateServiceScope(meshId: string, name: string, scope: unknown) {
  await db.update(meshService).set({ scope, updatedAt: new Date() } as any).where(and(eq(meshService.meshId, meshId), eq(meshService.name, name)));
}

export async function getService(meshId: string, name: string) {
  const rows = await db.select().from(meshService).where(and(eq(meshService.meshId, meshId), eq(meshService.name, name))).limit(1);
  return rows[0] ?? null;
}

export async function listDbMeshServices(meshId: string) {
  return db.select().from(meshService).where(eq(meshService.meshId, meshId));
}

export async function deleteService(meshId: string, name: string): Promise<boolean> {
  const deleted = await db.delete(meshService).where(and(eq(meshService.meshId, meshId), eq(meshService.name, name))).returning({ id: meshService.id });
  return deleted.length > 0;
}

export async function getRunningServices(meshId: string) {
  return db.select().from(meshService).where(and(eq(meshService.meshId, meshId), inArray(meshService.status, ["running", "failed", "crashed", "restarting"])));
}
