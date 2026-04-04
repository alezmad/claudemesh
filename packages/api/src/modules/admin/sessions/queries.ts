import {
  and,
  count,
  desc,
  eq,
  getOrderByFromSort,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "@turbostarter/db";
import { mesh, meshMember, presence } from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

import type { GetSessionsInput } from "../../../schema";

export const getPresencesCount = async () =>
  db
    .select({ count: count() })
    .from(presence)
    .then((res) => res[0]?.count ?? 0);

export const getActivePresencesCount = async () =>
  db
    .select({ count: count() })
    .from(presence)
    .where(isNull(presence.disconnectedAt))
    .then((res) => res[0]?.count ?? 0);

export const getSessions = async (input: GetSessionsInput) => {
  const offset = (input.page - 1) * input.perPage;

  const where = and(
    input.q
      ? or(
          ilike(meshMember.displayName, `%${input.q}%`),
          ilike(presence.cwd, `%${input.q}%`),
          ilike(mesh.name, `%${input.q}%`),
        )
      : undefined,
    input.status ? inArray(presence.status, input.status) : undefined,
    input.active === true ? isNull(presence.disconnectedAt) : undefined,
    input.active === false
      ? sql`${presence.disconnectedAt} IS NOT NULL`
      : undefined,
  );

  const orderBy = input.sort
    ? getOrderByFromSort({ sort: input.sort, defaultSchema: presence })
    : [desc(presence.lastPingAt)];

  return db.transaction(async (tx) => {
    const data = await tx
      .select({
        id: presence.id,
        memberId: presence.memberId,
        displayName: meshMember.displayName,
        meshId: meshMember.meshId,
        meshName: mesh.name,
        meshSlug: mesh.slug,
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
      .leftJoin(mesh, eq(meshMember.meshId, mesh.id))
      .where(where)
      .limit(input.perPage)
      .offset(offset)
      .orderBy(...orderBy);

    const total = await tx
      .select({ count: count() })
      .from(presence)
      .leftJoin(meshMember, eq(presence.memberId, meshMember.id))
      .leftJoin(mesh, eq(meshMember.meshId, mesh.id))
      .where(where)
      .execute()
      .then((res) => res[0]?.count ?? 0);

    return { data, total };
  });
};
