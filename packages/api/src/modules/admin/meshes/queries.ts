import dayjs from "dayjs";

import {
  and,
  asc,
  between,
  count,
  desc,
  eq,
  getOrderByFromSort,
  ilike,
  inArray,
  isNull,
  isNotNull,
  or,
  sql,
} from "@turbostarter/db";
import { user } from "@turbostarter/db/schema";
import {
  auditLog,
  invite,
  mesh,
  meshMember,
  presence,
} from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

import type { GetMeshesInput } from "../../../schema";

export const getMeshesCount = async () =>
  db
    .select({ count: count() })
    .from(mesh)
    .then((res) => res[0]?.count ?? 0);

export const getActiveMeshesCount = async () =>
  db
    .select({ count: count() })
    .from(mesh)
    .where(isNull(mesh.archivedAt))
    .then((res) => res[0]?.count ?? 0);

export const getMeshes = async (input: GetMeshesInput) => {
  const offset = (input.page - 1) * input.perPage;

  const where = and(
    input.q
      ? or(ilike(mesh.name, `%${input.q}%`), ilike(mesh.slug, `%${input.q}%`))
      : undefined,
    input.tier ? inArray(mesh.tier, input.tier) : undefined,
    input.transport ? inArray(mesh.transport, input.transport) : undefined,
    input.visibility ? inArray(mesh.visibility, input.visibility) : undefined,
    input.archived === true ? isNotNull(mesh.archivedAt) : undefined,
    input.archived === false ? isNull(mesh.archivedAt) : undefined,
    input.createdAt
      ? between(
          mesh.createdAt,
          dayjs(input.createdAt[0]).startOf("day").toDate(),
          dayjs(input.createdAt[1]).endOf("day").toDate(),
        )
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
        maxPeers: mesh.maxPeers,
        createdAt: mesh.createdAt,
        archivedAt: mesh.archivedAt,
        ownerUserId: mesh.ownerUserId,
        ownerName: user.name,
        ownerEmail: user.email,
        memberCount: sql<number>`(
          SELECT COUNT(*)::int FROM mesh.member m WHERE m.mesh_id = ${mesh.id}
        )`,
      })
      .from(mesh)
      .leftJoin(user, eq(mesh.ownerUserId, user.id))
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

export const getMeshById = async (id: string) => {
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
      ownerName: user.name,
      ownerEmail: user.email,
    })
    .from(mesh)
    .leftJoin(user, eq(mesh.ownerUserId, user.id))
    .where(eq(mesh.id, id))
    .limit(1);

  if (!m) return null;

  const members = await db
    .select({
      id: meshMember.id,
      displayName: meshMember.displayName,
      peerPubkey: meshMember.peerPubkey,
      role: meshMember.role,
      joinedAt: meshMember.joinedAt,
      lastSeenAt: meshMember.lastSeenAt,
      revokedAt: meshMember.revokedAt,
      userId: meshMember.userId,
    })
    .from(meshMember)
    .where(eq(meshMember.meshId, id))
    .orderBy(asc(meshMember.joinedAt));

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
      connectedAt: presence.connectedAt,
      lastPingAt: presence.lastPingAt,
      disconnectedAt: presence.disconnectedAt,
    })
    .from(presence)
    .leftJoin(meshMember, eq(presence.memberId, meshMember.id))
    .where(eq(meshMember.meshId, id))
    .orderBy(desc(presence.connectedAt))
    .limit(50);

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
    .where(eq(invite.meshId, id))
    .orderBy(desc(invite.createdAt))
    .limit(50);

  const auditEvents = await db
    .select({
      id: auditLog.id,
      eventType: auditLog.eventType,
      actorPeerId: auditLog.actorPeerId,
      targetPeerId: auditLog.targetPeerId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.meshId, id))
    .orderBy(desc(auditLog.createdAt))
    .limit(50);

  return { mesh: m, members, presences, invites, auditEvents };
};
