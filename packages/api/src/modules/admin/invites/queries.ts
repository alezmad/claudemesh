import {
  and,
  count,
  desc,
  eq,
  getOrderByFromSort,
  ilike,
  isNotNull,
  isNull,
  lt,
  or,
} from "@turbostarter/db";
import { user } from "@turbostarter/db/schema";
import { invite, mesh } from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

import type { GetInvitesInput } from "../../../schema";

export const getInvites = async (input: GetInvitesInput) => {
  const offset = (input.page - 1) * input.perPage;
  const now = new Date();

  const where = and(
    input.q
      ? or(
          ilike(mesh.name, `%${input.q}%`),
          ilike(invite.token, `%${input.q}%`),
        )
      : undefined,
    input.revoked === true ? isNotNull(invite.revokedAt) : undefined,
    input.revoked === false ? isNull(invite.revokedAt) : undefined,
    input.expired === true ? lt(invite.expiresAt, now) : undefined,
  );

  const orderBy = input.sort
    ? getOrderByFromSort({ sort: input.sort, defaultSchema: invite })
    : [desc(invite.createdAt)];

  return db.transaction(async (tx) => {
    const data = await tx
      .select({
        id: invite.id,
        meshId: invite.meshId,
        meshName: mesh.name,
        meshSlug: mesh.slug,
        token: invite.token,
        maxUses: invite.maxUses,
        usedCount: invite.usedCount,
        role: invite.role,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
        revokedAt: invite.revokedAt,
        createdByName: user.name,
      })
      .from(invite)
      .leftJoin(mesh, eq(invite.meshId, mesh.id))
      .leftJoin(user, eq(invite.createdBy, user.id))
      .where(where)
      .limit(input.perPage)
      .offset(offset)
      .orderBy(...orderBy);

    const total = await tx
      .select({ count: count() })
      .from(invite)
      .leftJoin(mesh, eq(invite.meshId, mesh.id))
      .where(where)
      .execute()
      .then((res) => res[0]?.count ?? 0);

    return { data, total };
  });
};
