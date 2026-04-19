import {
  and,
  asc,
  count,
  desc,
  eq,
  getOrderByFromSort,
  gt,
  ilike,
  isNull,
  or,
  sql,
} from "@turbostarter/db";
import {
  auditLog,
  invite,
  mesh,
  meshMember,
  messageQueue,
  pendingInvite,
  presence,
  user,
} from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

import type { GetMyMeshesInput } from "../../schema";

export const getMyMeshes = async ({
  userId,
  ...input
}: GetMyMeshesInput & { userId: string }) => {
  const offset = (input.page - 1) * input.perPage;

  // User sees: meshes they own OR meshes where they have a meshMember row
  const baseWhere = or(
    eq(mesh.ownerUserId, userId),
    sql`EXISTS (SELECT 1 FROM mesh.member mm WHERE mm.mesh_id = ${mesh.id} AND mm.user_id = ${userId} AND mm.revoked_at IS NULL)`,
  );

  const where = and(
    baseWhere,
    input.q
      ? or(ilike(mesh.name, `%${input.q}%`), ilike(mesh.slug, `%${input.q}%`))
      : undefined,
  );

  const orderBy = input.sort
    ? getOrderByFromSort({ sort: input.sort, defaultSchema: mesh })
    : [desc(mesh.createdAt)];

  return db.transaction(async (tx) => {
    const data = await tx
      .select({
        id: mesh.id,
        name: mesh.name,
        slug: mesh.slug,
        visibility: mesh.visibility,
        transport: mesh.transport,
        tier: mesh.tier,
        createdAt: mesh.createdAt,
        archivedAt: mesh.archivedAt,
        isOwner: sql<boolean>`${mesh.ownerUserId} = ${userId}`,
        myRole: sql<"admin" | "member">`CASE WHEN ${mesh.ownerUserId} = ${userId} THEN 'admin'::text ELSE COALESCE((SELECT role::text FROM mesh.member mm2 WHERE mm2.mesh_id = ${mesh.id} AND mm2.user_id = ${userId} AND mm2.revoked_at IS NULL LIMIT 1), 'member') END`,
        memberCount: sql<number>`(SELECT COUNT(*)::int FROM mesh.member mm3 WHERE mm3.mesh_id = ${mesh.id} AND mm3.revoked_at IS NULL)`,
      })
      .from(mesh)
      .where(where)
      .limit(input.perPage)
      .offset(offset)
      .orderBy(...orderBy);

    const total = await tx
      .select({ count: count() })
      .from(mesh)
      .where(where)
      .execute()
      .then((res) => res[0]?.count ?? 0);

    return { data, total };
  });
};

export const getMyMeshById = async ({
  userId,
  meshId,
}: {
  userId: string;
  meshId: string;
}) => {
  const [m] = await db
    .select({
      id: mesh.id,
      name: mesh.name,
      slug: mesh.slug,
      visibility: mesh.visibility,
      transport: mesh.transport,
      tier: mesh.tier,
      maxPeers: mesh.maxPeers,
      createdAt: mesh.createdAt,
      archivedAt: mesh.archivedAt,
      ownerUserId: mesh.ownerUserId,
    })
    .from(mesh)
    .where(eq(mesh.id, meshId))
    .limit(1);

  if (!m) return null;

  // Authz: user must own OR be a non-revoked member
  const isOwner = m.ownerUserId === userId;
  if (!isOwner) {
    const [membership] = await db
      .select({ id: meshMember.id, role: meshMember.role })
      .from(meshMember)
      .where(
        and(
          eq(meshMember.meshId, meshId),
          eq(meshMember.userId, userId),
          isNull(meshMember.revokedAt),
        ),
      )
      .limit(1);
    if (!membership) return null;
  }

  const members = await db
    .select({
      id: meshMember.id,
      displayName: meshMember.displayName,
      role: meshMember.role,
      joinedAt: meshMember.joinedAt,
      lastSeenAt: meshMember.lastSeenAt,
      revokedAt: meshMember.revokedAt,
      userId: meshMember.userId,
    })
    .from(meshMember)
    .where(eq(meshMember.meshId, meshId))
    .orderBy(asc(meshMember.joinedAt));

  const invites = await db
    .select({
      id: invite.id,
      token: invite.token,
      maxUses: invite.maxUses,
      usedCount: invite.usedCount,
      role: invite.role,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      revokedAt: invite.revokedAt,
    })
    .from(invite)
    .where(eq(invite.meshId, meshId))
    .orderBy(desc(invite.createdAt))
    .limit(50);

  // Derive myRole for the mesh top-level field
  const myRole: "admin" | "member" = isOwner
    ? "admin"
    : (members.find((mem) => mem.userId === userId)?.role ?? "member");

  return {
    mesh: { ...m, isOwner, myRole },
    members: members.map((mem) => ({
      id: mem.id,
      displayName: mem.displayName,
      role: mem.role,
      joinedAt: mem.joinedAt,
      lastSeenAt: mem.lastSeenAt,
      revokedAt: mem.revokedAt,
      isMe: mem.userId === userId,
    })),
    invites,
  };
};

/**
 * Live mesh stream — presences + recent message envelopes (metadata only) +
 * recent audit events. Polled every 3-5s by the live dashboard. Authz:
 * caller must own OR be a non-revoked member of the mesh.
 *
 * Envelopes expose a 24-char ciphertext preview so the UI can show
 * "broker sees: <blob>" truthfully — this IS what the broker sees.
 * Plaintext, nonces, full ciphertext are NEVER returned from here.
 */
export const getMyMeshStream = async ({
  userId,
  meshId,
}: {
  userId: string;
  meshId: string;
}) => {
  // Authz check — same pattern as getMyMeshById
  const [m] = await db
    .select({ ownerUserId: mesh.ownerUserId })
    .from(mesh)
    .where(eq(mesh.id, meshId))
    .limit(1);
  if (!m) return null;

  const isOwner = m.ownerUserId === userId;
  if (!isOwner) {
    const [membership] = await db
      .select({ id: meshMember.id })
      .from(meshMember)
      .where(
        and(
          eq(meshMember.meshId, meshId),
          eq(meshMember.userId, userId),
          isNull(meshMember.revokedAt),
        ),
      )
      .limit(1);
    if (!membership) return null;
  }

  const presences = await db
    .select({
      id: presence.id,
      memberId: presence.memberId,
      displayName: meshMember.displayName,
      sessionId: presence.sessionId,
      pid: presence.pid,
      cwd: presence.cwd,
      status: presence.status,
      statusSource: presence.statusSource,
      statusUpdatedAt: presence.statusUpdatedAt,
      lastPingAt: presence.lastPingAt,
      disconnectedAt: presence.disconnectedAt,
    })
    .from(presence)
    .leftJoin(meshMember, eq(presence.memberId, meshMember.id))
    .where(and(eq(meshMember.meshId, meshId), isNull(presence.disconnectedAt)))
    .orderBy(desc(presence.lastPingAt))
    .limit(20);

  const envelopes = await db
    .select({
      id: messageQueue.id,
      senderMemberId: messageQueue.senderMemberId,
      senderDisplayName: meshMember.displayName,
      targetSpec: messageQueue.targetSpec,
      priority: messageQueue.priority,
      ciphertextPreview: sql<string>`LEFT(${messageQueue.ciphertext}, 24)`,
      size: sql<number>`OCTET_LENGTH(${messageQueue.ciphertext})`,
      createdAt: messageQueue.createdAt,
      deliveredAt: messageQueue.deliveredAt,
    })
    .from(messageQueue)
    .leftJoin(meshMember, eq(messageQueue.senderMemberId, meshMember.id))
    .where(eq(messageQueue.meshId, meshId))
    .orderBy(desc(messageQueue.createdAt))
    .limit(50);

  const auditEvents = await db
    .select({
      id: auditLog.id,
      eventType: auditLog.eventType,
      actorPeerId: auditLog.actorPeerId,
      targetPeerId: auditLog.targetPeerId,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.meshId, meshId))
    .orderBy(desc(auditLog.createdAt))
    .limit(20);

  return { presences, envelopes, auditEvents };
};

export const getMyExport = async ({ userId }: { userId: string }) => {
  const meshesOwned = await db
    .select({
      id: mesh.id,
      name: mesh.name,
      slug: mesh.slug,
      visibility: mesh.visibility,
      transport: mesh.transport,
      tier: mesh.tier,
      createdAt: mesh.createdAt,
      archivedAt: mesh.archivedAt,
    })
    .from(mesh)
    .where(eq(mesh.ownerUserId, userId));

  const memberships = await db
    .select({
      meshId: meshMember.meshId,
      meshName: mesh.name,
      meshSlug: mesh.slug,
      memberId: meshMember.id,
      displayName: meshMember.displayName,
      role: meshMember.role,
      joinedAt: meshMember.joinedAt,
      revokedAt: meshMember.revokedAt,
    })
    .from(meshMember)
    .leftJoin(mesh, eq(meshMember.meshId, mesh.id))
    .where(eq(meshMember.userId, userId));

  const invitesSent = await db
    .select({
      id: invite.id,
      meshId: invite.meshId,
      meshSlug: mesh.slug,
      role: invite.role,
      maxUses: invite.maxUses,
      usedCount: invite.usedCount,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      revokedAt: invite.revokedAt,
    })
    .from(invite)
    .leftJoin(mesh, eq(invite.meshId, mesh.id))
    .where(eq(invite.createdBy, userId));

  // Audit events for the user's owned meshes only (privacy: don't leak
  // events from meshes the user merely joined)
  const meshIds = meshesOwned.map((m) => m.id);
  const auditEvents =
    meshIds.length > 0
      ? await db
          .select({
            id: auditLog.id,
            meshId: auditLog.meshId,
            eventType: auditLog.eventType,
            actorPeerId: auditLog.actorPeerId,
            targetPeerId: auditLog.targetPeerId,
            metadata: sql<Record<string, unknown>>`${auditLog.metadata}`,
            createdAt: auditLog.createdAt,
          })
          .from(auditLog)
          .where(
            sql`${auditLog.meshId} = ANY(ARRAY[${sql.join(
              meshIds.map((id) => sql`${id}`),
              sql`, `,
            )}]::text[])`,
          )
          .orderBy(desc(auditLog.createdAt))
          .limit(5000)
      : [];

  return {
    exportedAt: new Date().toISOString(),
    meshesOwned,
    memberships,
    invitesSent,
    auditEvents,
  };
};

/**
 * Pending invitations addressed to this user's email. A pending_invite row is
 * created when someone calls `claudemesh share <email>`; we join it against the
 * underlying `invite` row to get role + expiry, and against `user` (inviter)
 * and `mesh` (target) for display. Returned only when unaccepted, unrevoked,
 * and not expired.
 */
export const getMyInvitesIncoming = async ({ email }: { email: string }) => {
  const now = new Date();
  return db
    .select({
      id: pendingInvite.id,
      meshId: pendingInvite.meshId,
      meshName: mesh.name,
      meshSlug: mesh.slug,
      code: pendingInvite.code,
      role: invite.role,
      expiresAt: invite.expiresAt,
      sentAt: pendingInvite.sentAt,
      inviterName: user.name,
      inviterEmail: user.email,
      memberCount: sql<number>`(
        SELECT COUNT(*)::int FROM mesh.member
        WHERE mesh_id = ${pendingInvite.meshId} AND revoked_at IS NULL
      )`,
    })
    .from(pendingInvite)
    .leftJoin(mesh, eq(pendingInvite.meshId, mesh.id))
    .leftJoin(invite, eq(pendingInvite.code, invite.code))
    .leftJoin(user, eq(pendingInvite.createdBy, user.id))
    .where(
      and(
        eq(pendingInvite.email, email),
        isNull(pendingInvite.acceptedAt),
        isNull(pendingInvite.revokedAt),
        or(isNull(invite.expiresAt), gt(invite.expiresAt, now)),
      ),
    )
    .orderBy(desc(pendingInvite.sentAt))
    .limit(50);
};

export const getMyInvitesSent = async ({ userId }: { userId: string }) =>
  db
    .select({
      id: invite.id,
      meshId: invite.meshId,
      meshName: mesh.name,
      meshSlug: mesh.slug,
      token: invite.token,
      role: invite.role,
      maxUses: invite.maxUses,
      usedCount: invite.usedCount,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      revokedAt: invite.revokedAt,
    })
    .from(invite)
    .leftJoin(mesh, eq(invite.meshId, mesh.id))
    .where(eq(invite.createdBy, userId))
    .orderBy(desc(invite.createdAt))
    .limit(100);
