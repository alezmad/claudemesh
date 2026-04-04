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
  mesh,
  meshMember as memberTable,
  messageQueue,
  pendingStatus,
  presence,
} from "@turbostarter/db/schema/mesh";
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
  pid: number;
  cwd: string;
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
      pid: params.pid,
      cwd: params.cwd,
      status: "idle",
      statusSource: "jsonl",
      statusUpdatedAt: now,
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

// --- Message queueing + delivery ---

export interface QueueParams {
  meshId: string;
  senderMemberId: string;
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
          AND (target_spec = ${memberPubkey} OR target_spec = '*')
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
      )
      AND m.id = mq.sender_member_id
      RETURNING mq.id, mq.priority, mq.nonce, mq.ciphertext,
               mq.created_at, mq.sender_member_id,
               m.peer_pubkey AS sender_pubkey
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
}

/** Stop background sweepers and mark all active presences disconnected. */
export async function stopSweepers(): Promise<void> {
  if (ttlTimer) clearInterval(ttlTimer);
  if (pendingTimer) clearInterval(pendingTimer);
  ttlTimer = null;
  pendingTimer = null;
  await db
    .update(presence)
    .set({ disconnectedAt: new Date() })
    .where(isNull(presence.disconnectedAt));
}

/**
 * Enroll a new member in an existing mesh. Called by the CLI join
 * flow after invite-link parsing + keypair generation client-side.
 *
 * v0.1.0: trusts the request. Signature verification + invite-token
 * one-time-use tracking land in Step 18.
 */
export async function joinMesh(args: {
  meshId: string;
  peerPubkey: string;
  displayName: string;
  role: "admin" | "member";
}): Promise<
  | { ok: true; memberId: string; alreadyMember?: boolean }
  | { ok: false; error: string }
> {
  // Validate the mesh exists.
  const [m] = await db
    .select({ id: mesh.id })
    .from(mesh)
    .where(and(eq(mesh.id, args.meshId), isNull(mesh.archivedAt)));
  if (!m) return { ok: false, error: "mesh not found or archived" };

  // Idempotency: same pubkey already a member → return existing id.
  const [existing] = await db
    .select({ id: memberTable.id })
    .from(memberTable)
    .where(
      and(
        eq(memberTable.meshId, args.meshId),
        eq(memberTable.peerPubkey, args.peerPubkey),
        isNull(memberTable.revokedAt),
      ),
    );
  if (existing) {
    return { ok: true, memberId: existing.id, alreadyMember: true };
  }

  const [row] = await db
    .insert(memberTable)
    .values({
      meshId: args.meshId,
      peerPubkey: args.peerPubkey,
      displayName: args.displayName,
      role: args.role,
    })
    .returning({ id: memberTable.id });
  if (!row) return { ok: false, error: "member insert failed" };
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
