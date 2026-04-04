import dayjs from "dayjs";

import {
  and,
  between,
  count,
  desc,
  eq,
  getOrderByFromSort,
  gte,
  ilike,
  inArray,
  or,
  sql,
} from "@turbostarter/db";
import { auditLog, mesh } from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

import type { GetAuditInput } from "../../../schema";

export const getMessages24hCount = async () =>
  db
    .select({ count: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.eventType, "message_sent"),
        gte(auditLog.createdAt, dayjs().subtract(24, "hour").toDate()),
      ),
    )
    .then((res) => res[0]?.count ?? 0);

export const getAudit = async (input: GetAuditInput) => {
  const offset = (input.page - 1) * input.perPage;

  const where = and(
    input.q
      ? or(
          ilike(auditLog.eventType, `%${input.q}%`),
          ilike(mesh.name, `%${input.q}%`),
          ilike(auditLog.actorPeerId, `%${input.q}%`),
        )
      : undefined,
    input.eventType ? inArray(auditLog.eventType, input.eventType) : undefined,
    input.meshId ? inArray(auditLog.meshId, input.meshId) : undefined,
    input.createdAt
      ? between(
          auditLog.createdAt,
          dayjs(input.createdAt[0]).startOf("day").toDate(),
          dayjs(input.createdAt[1]).endOf("day").toDate(),
        )
      : undefined,
  );

  const orderBy = input.sort
    ? getOrderByFromSort({ sort: input.sort, defaultSchema: auditLog })
    : [desc(auditLog.createdAt)];

  return db.transaction(async (tx) => {
    const data = await tx
      .select({
        id: auditLog.id,
        meshId: auditLog.meshId,
        meshName: mesh.name,
        meshSlug: mesh.slug,
        eventType: auditLog.eventType,
        actorPeerId: auditLog.actorPeerId,
        targetPeerId: auditLog.targetPeerId,
        metadata: sql<Record<string, unknown>>`${auditLog.metadata}`,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(mesh, eq(auditLog.meshId, mesh.id))
      .where(where)
      .limit(input.perPage)
      .offset(offset)
      .orderBy(...orderBy);

    const total = await tx
      .select({ count: count() })
      .from(auditLog)
      .leftJoin(mesh, eq(auditLog.meshId, mesh.id))
      .where(where)
      .execute()
      .then((res) => res[0]?.count ?? 0);

    return { data, total };
  });
};
