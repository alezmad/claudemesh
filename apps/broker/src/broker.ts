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
  meshApiKey,
  meshFile,
  meshFileAccess,
  meshFileKey,
  meshContext,
  meshMember as memberTable,
  meshMemory,
  meshNotification,
  meshState,
  meshService,
  meshSkill,
  meshStream,
  meshTopic,
  meshTopicMember,
  meshTopicMemberKey,
  meshTopicMessage,
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

/**
 * Sweep undelivered message_queue rows older than 7 days.
 *
 * Messages sent to non-matching targetSpecs (e.g. typos, peer disconnected
 * before claim) would otherwise sit in delivered_at=NULL forever — unbounded
 * growth. 7d matches invite expiry, so any legitimately held message is
 * already stale by then.
 *
 * Returns the number of rows deleted so the caller can log + meter.
 */
export async function sweepOrphanMessages(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await db.execute(sql`
    DELETE FROM mesh.message_queue
    WHERE delivered_at IS NULL
      AND created_at < ${cutoff}
    RETURNING id
  `);
  const rows = (result as unknown as { rows?: unknown[]; length?: number }).rows ?? result;
  const count = Array.isArray(rows) ? rows.length : 0;
  return count;
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
    memberPubkey: string;
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
  // memberPubkey is also surfaced so callers (grants, audit, safety-number
  // verify) can operate on the stable identity key rather than the
  // per-connection ephemeral one.
  return rows.map((r) => ({
    pubkey: r.sessionPubkey || r.memberPubkey,
    memberPubkey: r.memberPubkey,
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

// --- Topics (v0.2.0) ---
//
// Conversational primitive within a mesh. Spec:
// .artifacts/specs/2026-05-02-v0.2.0-scope.md
//
// Mesh = trust boundary. Group = identity tag. Topic = conversation scope.
// Three orthogonal axes; topics complement (don't replace) groups.
//
// Routing: topic-tagged messages use targetSpec = "#<topicId>". The drain
// query joins topic_member to filter delivery, so non-members never see
// the message. Topic-tagged messages are also persisted to topic_message
// so humans (and opting-in agents) can fetch history on reconnect.

/** Create a topic in a mesh. Idempotent on (meshId, name). */
export async function createTopic(args: {
  meshId: string;
  name: string;
  description?: string;
  visibility?: "public" | "private" | "dm";
  createdByMemberId?: string;
}): Promise<{ id: string; created: boolean; encryptedKeyPubkey?: string }> {
  const existing = await db
    .select({
      id: meshTopic.id,
      encryptedKeyPubkey: meshTopic.encryptedKeyPubkey,
    })
    .from(meshTopic)
    .where(and(eq(meshTopic.meshId, args.meshId), eq(meshTopic.name, args.name)));
  if (existing[0]) {
    return {
      id: existing[0].id,
      created: false,
      encryptedKeyPubkey: existing[0].encryptedKeyPubkey ?? undefined,
    };
  }

  // Generate the topic's per-message symmetric key + an ephemeral
  // sender keypair used to seal it for each member. The plaintext
  // topicKey is held in memory only long enough to seal one copy per
  // member; the broker never persists it.
  const topicKeyBundle = await generateTopicKeyBundle();

  const [row] = await db
    .insert(meshTopic)
    .values({
      meshId: args.meshId,
      name: args.name,
      description: args.description ?? null,
      visibility: args.visibility ?? "public",
      createdByMemberId: args.createdByMemberId ?? null,
      encryptedKeyPubkey: topicKeyBundle.senderPubkeyHex,
    })
    .returning({ id: meshTopic.id });
  if (!row) throw new Error("failed to create topic");

  // Seal a copy for the creator immediately. Other members get sealed
  // copies as they join via joinTopic().
  if (args.createdByMemberId) {
    await sealTopicKeyForMember({
      topicId: row.id,
      memberId: args.createdByMemberId,
      bundle: topicKeyBundle,
    });
  }

  return {
    id: row.id,
    created: true,
    encryptedKeyPubkey: topicKeyBundle.senderPubkeyHex,
  };
}

/**
 * Generate a per-topic symmetric key + an ephemeral x25519 sender keypair
 * used to seal it. Returns the bundle in a form that callers can hand to
 * sealTopicKeyForMember() repeatedly without ever persisting the key
 * plaintext.
 *
 * crypto_kx is the libsodium primitive matching v0.1's mesh handshake,
 * but we only need a fresh x25519 pair here — keyPair() suffices.
 */
async function generateTopicKeyBundle(): Promise<{
  topicKey: Uint8Array;
  senderSecret: Uint8Array;
  senderPubkey: Uint8Array;
  senderPubkeyHex: string;
}> {
  const sodium = await import("libsodium-wrappers");
  await sodium.ready;
  const topicKey = sodium.randombytes_buf(32);
  const sender = sodium.crypto_box_keypair();
  return {
    topicKey,
    senderSecret: sender.privateKey,
    senderPubkey: sender.publicKey,
    senderPubkeyHex: sodium.to_hex(sender.publicKey),
  };
}

interface TopicKeyBundle {
  topicKey: Uint8Array;
  senderSecret: Uint8Array;
  senderPubkey: Uint8Array;
  senderPubkeyHex: string;
}

/**
 * Seal the topic key for one member using crypto_box. Idempotent on
 * (topicId, memberId) — calling again rotates the cipher but not the
 * underlying key (rotation is a separate flow).
 *
 * The recipient's peer pubkey is the ed25519 key they registered with
 * the broker. crypto_box wants x25519, so we convert. Members decrypt
 * with crypto_box_open + sender pubkey + their own x25519 secret
 * (derived from their ed25519 secret the same way).
 */
async function sealTopicKeyForMember(args: {
  topicId: string;
  memberId: string;
  bundle: TopicKeyBundle;
}): Promise<void> {
  const [member] = await db
    .select({ peerPubkey: memberTable.peerPubkey })
    .from(memberTable)
    .where(eq(memberTable.id, args.memberId));
  if (!member) return;

  const sodium = await import("libsodium-wrappers");
  await sodium.ready;
  let recipientX25519: Uint8Array;
  try {
    const ed = sodium.from_hex(member.peerPubkey);
    recipientX25519 = sodium.crypto_sign_ed25519_pk_to_curve25519(ed);
  } catch {
    // Recipient pubkey isn't a valid ed25519 key — skip silently. The
    // member won't be able to read v2 messages on this topic until
    // their identity is regenerated.
    return;
  }
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const sealed = sodium.crypto_box_easy(
    args.bundle.topicKey,
    nonce,
    recipientX25519,
    args.bundle.senderSecret,
  );
  // Embed sender x25519 pubkey as the first 32 bytes so re-sealed
  // copies (which carry their own sender pubkey from a different
  // member) decode the same way as creator-sealed copies.
  const blob = new Uint8Array(32 + sealed.length);
  blob.set(args.bundle.senderPubkey, 0);
  blob.set(sealed, 32);
  const encryptedKey = sodium.to_base64(blob, sodium.base64_variants.ORIGINAL);
  const nonceB64 = sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL);

  await db
    .insert(meshTopicMemberKey)
    .values({
      topicId: args.topicId,
      memberId: args.memberId,
      encryptedKey,
      nonce: nonceB64,
    })
    .onConflictDoUpdate({
      target: [meshTopicMemberKey.topicId, meshTopicMemberKey.memberId],
      set: {
        encryptedKey,
        nonce: nonceB64,
        rotatedAt: new Date(),
      },
    });
}

/** List topics in a mesh, with member counts. */
export async function listTopics(meshId: string): Promise<
  Array<{
    id: string;
    name: string;
    description: string | null;
    visibility: "public" | "private" | "dm";
    memberCount: number;
    createdAt: Date;
  }>
> {
  const rows = await db
    .select({
      id: meshTopic.id,
      name: meshTopic.name,
      description: meshTopic.description,
      visibility: meshTopic.visibility,
      createdAt: meshTopic.createdAt,
      memberCount: sql<number>`(SELECT COUNT(*)::int FROM mesh.topic_member WHERE topic_id = ${meshTopic.id})`,
    })
    .from(meshTopic)
    .where(and(eq(meshTopic.meshId, meshId), isNull(meshTopic.archivedAt)))
    .orderBy(asc(meshTopic.name));
  return rows;
}

/** Resolve a topic by name within a mesh. */
export async function findTopicByName(
  meshId: string,
  name: string,
): Promise<{ id: string; visibility: "public" | "private" | "dm" } | null> {
  const [row] = await db
    .select({ id: meshTopic.id, visibility: meshTopic.visibility })
    .from(meshTopic)
    .where(
      and(
        eq(meshTopic.meshId, meshId),
        eq(meshTopic.name, name),
        isNull(meshTopic.archivedAt),
      ),
    );
  return row ?? null;
}

/** Add a member to a topic. Idempotent. */
export async function joinTopic(args: {
  topicId: string;
  memberId: string;
  role?: "lead" | "member" | "observer";
}): Promise<void> {
  await db
    .insert(meshTopicMember)
    .values({
      topicId: args.topicId,
      memberId: args.memberId,
      role: args.role ?? "member",
    })
    .onConflictDoNothing();
}

/** Remove a member from a topic. */
export async function leaveTopic(args: {
  topicId: string;
  memberId: string;
}): Promise<void> {
  await db
    .delete(meshTopicMember)
    .where(
      and(
        eq(meshTopicMember.topicId, args.topicId),
        eq(meshTopicMember.memberId, args.memberId),
      ),
    );
}

/** List members of a topic with display names. */
export async function topicMembers(topicId: string): Promise<
  Array<{
    memberId: string;
    pubkey: string;
    displayName: string;
    role: "lead" | "member" | "observer";
    joinedAt: Date;
    lastReadAt: Date | null;
  }>
> {
  const rows = await db
    .select({
      memberId: meshTopicMember.memberId,
      pubkey: memberTable.peerPubkey,
      displayName: memberTable.displayName,
      role: meshTopicMember.role,
      joinedAt: meshTopicMember.joinedAt,
      lastReadAt: meshTopicMember.lastReadAt,
    })
    .from(meshTopicMember)
    .innerJoin(memberTable, eq(meshTopicMember.memberId, memberTable.id))
    .where(eq(meshTopicMember.topicId, topicId))
    .orderBy(asc(memberTable.displayName));
  return rows;
}

/** Return all topic ids a member belongs to (used by message routing). */
export async function getMemberTopicIds(memberId: string): Promise<string[]> {
  const rows = await db
    .select({ id: meshTopicMember.topicId })
    .from(meshTopicMember)
    .where(eq(meshTopicMember.memberId, memberId));
  return rows.map((r) => r.id);
}

/** Append a topic message to persistent history. */
export async function appendTopicMessage(args: {
  topicId: string;
  senderMemberId: string;
  senderSessionPubkey?: string;
  nonce: string;
  ciphertext: string;
  /**
   * Optional client-extracted mention list (lowercased display names
   * without the leading @). Required once per-topic encryption lands —
   * the server can't read v0.3.0 ciphertext. Falls back to a regex on
   * the v0.2.0 base64 plaintext when omitted.
   */
  mentions?: string[];
}): Promise<string> {
  const [row] = await db
    .insert(meshTopicMessage)
    .values({
      topicId: args.topicId,
      senderMemberId: args.senderMemberId,
      senderSessionPubkey: args.senderSessionPubkey ?? null,
      nonce: args.nonce,
      ciphertext: args.ciphertext,
    })
    .returning({ id: meshTopicMessage.id });
  if (!row) throw new Error("failed to append topic message");

  void fanOutMentions({
    messageId: row.id,
    topicId: args.topicId,
    senderMemberId: args.senderMemberId,
    ciphertext: args.ciphertext,
    explicit: args.mentions,
  }).catch(() => {
    // Notifications are advisory; don't fail the message write.
  });

  return row.id;
}

/**
 * Extract `@<displayName>` tokens from a base64-of-UTF8 plaintext body.
 * Capped at 16 tokens. Returns lowercased names without the @ prefix.
 */
function extractMentionTokens(b64: string): string[] {
  let text: string;
  try {
    text = Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return [];
  }
  const found = new Set<string>();
  const re = /(^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]{1,64})(?=$|[^A-Za-z0-9_-])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[2]!.toLowerCase());
    if (found.size >= 16) break;
  }
  return [...found];
}

async function fanOutMentions(args: {
  messageId: string;
  topicId: string;
  senderMemberId: string;
  ciphertext: string;
  explicit?: string[];
}): Promise<void> {
  let tokens = args.explicit?.map((s) => s.toLowerCase().replace(/^@/, ""));
  if (!tokens || tokens.length === 0) {
    tokens = extractMentionTokens(args.ciphertext);
  }
  if (tokens.length === 0) return;

  const [topic] = await db
    .select({ meshId: meshTopic.meshId })
    .from(meshTopic)
    .where(eq(meshTopic.id, args.topicId));
  if (!topic) return;

  const recipients = await db
    .select({
      id: memberTable.id,
      displayName: memberTable.displayName,
    })
    .from(memberTable)
    .where(
      and(eq(memberTable.meshId, topic.meshId), isNull(memberTable.revokedAt)),
    );
  const tokenSet = new Set(tokens);
  const targets = recipients
    .filter(
      (r) =>
        tokenSet.has(r.displayName.toLowerCase()) &&
        r.id !== args.senderMemberId,
    )
    .slice(0, 32);
  if (targets.length === 0) return;

  await db
    .insert(meshNotification)
    .values(
      targets.map((t) => ({
        meshId: topic.meshId,
        topicId: args.topicId,
        messageId: args.messageId,
        recipientMemberId: t.id,
        senderMemberId: args.senderMemberId,
        kind: "mention",
      })),
    )
    .onConflictDoNothing();
}

/**
 * Fetch topic history for a member. Pagination via `before` cursor (id of
 * an earlier message); pass null for the latest page.
 */
export async function topicHistory(args: {
  topicId: string;
  limit?: number;
  beforeId?: string;
}): Promise<
  Array<{
    id: string;
    senderMemberId: string;
    senderPubkey: string;
    nonce: string;
    ciphertext: string;
    createdAt: Date;
  }>
> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const beforeClause = args.beforeId
    ? sql`AND tm.created_at < (SELECT created_at FROM mesh.topic_message WHERE id = ${args.beforeId})`
    : sql``;
  const result = await db.execute<{
    id: string;
    sender_member_id: string;
    sender_pubkey: string;
    nonce: string;
    ciphertext: string;
    created_at: Date;
  }>(sql`
    SELECT tm.id, tm.sender_member_id,
           COALESCE(tm.sender_session_pubkey, m.peer_pubkey) AS sender_pubkey,
           tm.nonce, tm.ciphertext, tm.created_at
    FROM mesh.topic_message tm
    JOIN mesh.member m ON m.id = tm.sender_member_id
    WHERE tm.topic_id = ${args.topicId}
    ${beforeClause}
    ORDER BY tm.created_at DESC, tm.id DESC
    LIMIT ${limit}
  `);
  const rows = (result.rows ?? result) as Array<{
    id: string;
    sender_member_id: string;
    sender_pubkey: string;
    nonce: string;
    ciphertext: string;
    created_at: Date;
  }>;
  return rows.map((r) => ({
    id: r.id,
    senderMemberId: r.sender_member_id,
    senderPubkey: r.sender_pubkey,
    nonce: r.nonce,
    ciphertext: r.ciphertext,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}

/** Update last_read_at for a member's topic subscription. */
export async function markTopicRead(args: {
  topicId: string;
  memberId: string;
}): Promise<void> {
  await db
    .update(meshTopicMember)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(meshTopicMember.topicId, args.topicId),
        eq(meshTopicMember.memberId, args.memberId),
      ),
    );
}

// --- API keys (v0.2.0) ---
//
// Bearer-token auth for REST + external WS. Keys are 32 bytes of CSPRNG
// rendered as base32, stored as Argon2id hashes. Capabilities + topic
// scopes are enforced at the route layer in apps/web (REST) and at the
// hello layer in the broker (external WS, future).
//
// Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/** Generate a fresh API key secret. Returns the plaintext (show once),
 * its prefix (8 chars, displayable), and a SHA-256 hash for storage.
 * (We use SHA-256 here, not Argon2 — these are random 256-bit secrets,
 * not low-entropy passwords; brute force isn't a threat. Argon2 is for
 * humans typing memorable passwords. The trade-off is ~100x faster
 * verification on the request hot path with no real security loss.)
 */
function newApiKeySecret(): { plaintext: string; prefix: string; hash: string } {
  const bytes = randomBytes(32);
  const plaintext = "cm_" + bytes.toString("base64url");
  const prefix = plaintext.slice(0, 11); // "cm_" + 8 chars
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, prefix, hash };
}

/** Issue a new API key. Returns the plaintext secret (show ONCE) plus
 * the persisted key record. */
export async function createApiKey(args: {
  meshId: string;
  label: string;
  capabilities: Array<"send" | "read" | "state_write" | "admin">;
  topicScopes?: string[] | null;
  issuedByMemberId?: string;
  expiresAt?: Date;
}): Promise<{
  id: string;
  secret: string;
  label: string;
  prefix: string;
  capabilities: Array<"send" | "read" | "state_write" | "admin">;
  topicScopes: string[] | null;
  createdAt: Date;
}> {
  const { plaintext, prefix, hash } = newApiKeySecret();
  const [row] = await db
    .insert(meshApiKey)
    .values({
      meshId: args.meshId,
      label: args.label,
      secretHash: hash,
      secretPrefix: prefix,
      capabilities: args.capabilities,
      topicScopes: args.topicScopes ?? null,
      issuedByMemberId: args.issuedByMemberId ?? null,
      expiresAt: args.expiresAt,
    })
    .returning({
      id: meshApiKey.id,
      label: meshApiKey.label,
      capabilities: meshApiKey.capabilities,
      topicScopes: meshApiKey.topicScopes,
      createdAt: meshApiKey.createdAt,
    });
  if (!row) throw new Error("failed to create api key");
  return {
    id: row.id,
    secret: plaintext,
    label: row.label,
    prefix,
    capabilities: row.capabilities ?? [],
    topicScopes: row.topicScopes ?? null,
    createdAt: row.createdAt,
  };
}

/** List API keys for a mesh (without revealing hashes/secrets). */
export async function listApiKeys(meshId: string): Promise<
  Array<{
    id: string;
    label: string;
    prefix: string;
    capabilities: Array<"send" | "read" | "state_write" | "admin">;
    topicScopes: string[] | null;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date | null;
  }>
> {
  const rows = await db
    .select({
      id: meshApiKey.id,
      label: meshApiKey.label,
      prefix: meshApiKey.secretPrefix,
      capabilities: meshApiKey.capabilities,
      topicScopes: meshApiKey.topicScopes,
      createdAt: meshApiKey.createdAt,
      lastUsedAt: meshApiKey.lastUsedAt,
      revokedAt: meshApiKey.revokedAt,
      expiresAt: meshApiKey.expiresAt,
    })
    .from(meshApiKey)
    .where(eq(meshApiKey.meshId, meshId))
    .orderBy(desc(meshApiKey.createdAt));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    prefix: r.prefix,
    capabilities: r.capabilities ?? [],
    topicScopes: r.topicScopes ?? null,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt,
    expiresAt: r.expiresAt,
  }));
}

/**
 * Revoke an API key. Returns "revoked" with the matched id, or a
 * structured error.
 *
 * Accepts either the full id or a unique prefix (length >= 6) — the
 * CLI's `apikey list` truncates ids to 8 chars for display, so users
 * naturally paste the truncated form. Prefix matching is bounded to
 * the caller's mesh and only succeeds if exactly one key matches;
 * ambiguous prefixes return `not_unique` so we never silently revoke
 * the wrong key.
 *
 * Idempotent for already-revoked keys (returns "revoked" with the
 * prior revoked_at).
 */
export async function revokeApiKey(args: {
  meshId: string;
  id: string;
}): Promise<
  | { status: "revoked"; id: string }
  | { status: "not_found" }
  | { status: "not_unique"; matches: number }
> {
  const candidates = await db
    .select({ id: meshApiKey.id, revokedAt: meshApiKey.revokedAt })
    .from(meshApiKey)
    .where(
      and(
        eq(meshApiKey.meshId, args.meshId),
        // Try exact match first; fall back to prefix.
        sql`(${meshApiKey.id} = ${args.id} OR ${meshApiKey.id} LIKE ${args.id + "%"})`,
      ),
    )
    .limit(2);
  if (candidates.length === 0) return { status: "not_found" };
  if (candidates.length > 1) {
    return { status: "not_unique", matches: candidates.length };
  }
  const matched = candidates[0]!;
  if (!matched.revokedAt) {
    await db
      .update(meshApiKey)
      .set({ revokedAt: new Date() })
      .where(eq(meshApiKey.id, matched.id));
  }
  return { status: "revoked", id: matched.id };
}

/**
 * Verify an API key secret. Returns the matched key record if the
 * secret hashes match a non-revoked, non-expired row in the given mesh
 * (or any mesh, if meshId omitted). Constant-time comparison so timing
 * leaks don't reveal which keys exist.
 */
export async function verifyApiKey(args: {
  secret: string;
  meshId?: string;
}): Promise<{
  id: string;
  meshId: string;
  capabilities: Array<"send" | "read" | "state_write" | "admin">;
  topicScopes: string[] | null;
} | null> {
  if (!args.secret.startsWith("cm_")) return null;
  const prefix = args.secret.slice(0, 11);
  const hash = createHash("sha256").update(args.secret).digest("hex");
  const candidates = await db
    .select({
      id: meshApiKey.id,
      meshId: meshApiKey.meshId,
      secretHash: meshApiKey.secretHash,
      capabilities: meshApiKey.capabilities,
      topicScopes: meshApiKey.topicScopes,
      revokedAt: meshApiKey.revokedAt,
      expiresAt: meshApiKey.expiresAt,
    })
    .from(meshApiKey)
    .where(
      args.meshId
        ? and(eq(meshApiKey.meshId, args.meshId), eq(meshApiKey.secretPrefix, prefix))
        : eq(meshApiKey.secretPrefix, prefix),
    );
  const now = new Date();
  for (const c of candidates) {
    if (c.revokedAt) continue;
    if (c.expiresAt && c.expiresAt < now) continue;
    const a = Buffer.from(c.secretHash, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length) continue;
    if (!timingSafeEqual(a, b)) continue;
    // Update last_used_at lazily — best-effort, don't block on it.
    void db
      .update(meshApiKey)
      .set({ lastUsedAt: now })
      .where(eq(meshApiKey.id, c.id))
      .catch(() => {});
    return {
      id: c.id,
      meshId: c.meshId,
      capabilities: c.capabilities ?? [],
      topicScopes: c.topicScopes ?? null,
    };
  }
  return null;
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
  manifest?: unknown,
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
        manifest: manifest ?? null,
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
      manifest: manifest ?? null,
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
  manifest: unknown;
  createdAt: Date;
} | null> {
  const rows = await db
    .select({
      name: meshSkill.name,
      description: meshSkill.description,
      instructions: meshSkill.instructions,
      tags: meshSkill.tags,
      authorName: meshSkill.authorName,
      manifest: meshSkill.manifest,
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
    manifest: r.manifest,
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
  memberId: string,
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

  // Topic membership targets (v0.2.0). targetSpec for topic-tagged
  // messages is "#<topicId>". A member receives a topic message iff
  // they're in topic_member for that topic. We resolve memberships
  // here and inline the list — same pattern as groups, no schema join
  // in the hot path.
  const topicIds = await getMemberTopicIds(memberId);
  const topicTargetList =
    topicIds.length > 0
      ? sql.raw(topicIds.map((id) => `'#${id}'`).join(","))
      : null;

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
          AND (target_spec = ${memberPubkey} OR target_spec = '*'${sessionPubkey ? sql` OR target_spec = ${sessionPubkey}` : sql``} OR target_spec IN (${groupTargetList})${topicTargetList ? sql` OR target_spec IN (${topicTargetList})` : sql``})
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
  // Orphan-message sweep every hour; cheap, rows are all >7d at deletion time.
  setInterval(() => {
    sweepOrphanMessages()
      .then((n) => { if (n > 0) console.log(`[broker] orphan msgs swept: ${n}`); })
      .catch((e) => console.error("[broker] orphan msg sweep:", e));
  }, 60 * 60_000).unref();
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
  //    Apply invite preset overrides (displayName, roleTag, groups, messageMode).
  const preset = (inv.preset as any) ?? {};
  const [row] = await db
    .insert(memberTable)
    .values({
      meshId: invitePayload.mesh_id,
      peerPubkey,
      displayName: preset.displayName ?? displayName,
      role: invitePayload.role,
      roleTag: preset.roleTag ?? null,
      defaultGroups: preset.groups ?? [],
      messageMode: preset.messageMode ?? "push",
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
): Promise<{
  id: string;
  displayName: string;
  role: string;
  roleTag: string | null;
  defaultGroups: Array<{ name: string; role?: string }>;
  messageMode: string | null;
  dashboardUserId: string | null;
} | null> {
  const [row] = await db
    .select({
      id: memberTable.id,
      displayName: memberTable.displayName,
      role: memberTable.role,
      roleTag: memberTable.roleTag,
      defaultGroups: memberTable.defaultGroups,
      messageMode: memberTable.messageMode,
      dashboardUserId: memberTable.dashboardUserId,
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
