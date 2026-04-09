/**
 * Member profile REST API handlers.
 *
 * PATCH /mesh/:meshId/member/:memberId — update member profile
 * GET   /mesh/:meshId/members          — list all members with online status
 * PATCH /mesh/:meshId/settings         — update mesh settings (selfEditable)
 *
 * These are standalone handler functions. Route wiring happens in index.ts.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  mesh as meshTable,
  meshMember as memberTable,
  presence as presenceTable,
} from "@turbostarter/db/schema/mesh";

// --- Types ---

export interface MemberProfileUpdate {
  displayName?: string;
  roleTag?: string;
  groups?: Array<{ name: string; role?: string }>;
  messageMode?: "push" | "inbox" | "off";
}

export interface MemberPermissionUpdate {
  permission?: "admin" | "member"; // only admins can change this
}

export type MemberUpdateRequest = MemberProfileUpdate & MemberPermissionUpdate;

interface SelfEditablePolicy {
  displayName: boolean;
  roleTag: boolean;
  groups: boolean;
  messageMode: boolean;
}

// --- Handlers ---

/**
 * Update a member's profile fields.
 *
 * Authorization:
 * - If caller is the target member: check mesh.selfEditable for each field
 * - If caller is a mesh admin: allow all fields
 * - permission field: admin-only always
 *
 * Returns: { ok: true, member: {...} } or { ok: false, error: string }
 */
export async function updateMemberProfile(
  meshId: string,
  memberId: string,
  callerMemberId: string, // from auth header or WS connection
  updates: MemberUpdateRequest,
): Promise<
  | { ok: true; member: Record<string, unknown>; changes: MemberProfileUpdate }
  | { ok: false; error: string }
> {
  // 1. Load mesh for selfEditable policy
  const [m] = await db
    .select({ id: meshTable.id, selfEditable: meshTable.selfEditable })
    .from(meshTable)
    .where(and(eq(meshTable.id, meshId), isNull(meshTable.archivedAt)));

  if (!m) return { ok: false, error: "mesh not found" };

  // 2. Load caller's member row to check permission
  const [caller] = await db
    .select({ id: memberTable.id, role: memberTable.role })
    .from(memberTable)
    .where(
      and(
        eq(memberTable.id, callerMemberId),
        eq(memberTable.meshId, meshId),
        isNull(memberTable.revokedAt),
      ),
    );

  if (!caller) return { ok: false, error: "caller not a member of this mesh" };

  const isAdmin = caller.role === "admin";
  const isSelf = callerMemberId === memberId;

  if (!isAdmin && !isSelf) {
    return {
      ok: false,
      error: "not authorized — only admins or self can edit",
    };
  }

  // 3. Check self-edit permissions for non-admin self-edits
  const policy: SelfEditablePolicy =
    (m.selfEditable as SelfEditablePolicy) ?? {
      displayName: true,
      roleTag: true,
      groups: true,
      messageMode: true,
    };

  const rejected: string[] = [];
  if (!isAdmin && isSelf) {
    if (updates.displayName !== undefined && !policy.displayName)
      rejected.push("displayName");
    if (updates.roleTag !== undefined && !policy.roleTag)
      rejected.push("roleTag");
    if (updates.groups !== undefined && !policy.groups)
      rejected.push("groups");
    if (updates.messageMode !== undefined && !policy.messageMode)
      rejected.push("messageMode");
    if (updates.permission !== undefined) rejected.push("permission");
  }

  if (rejected.length > 0) {
    return {
      ok: false,
      error: `admin-managed fields: ${rejected.join(", ")}`,
    };
  }

  // 4. Build update set
  const set: Record<string, unknown> = {};
  const changes: MemberProfileUpdate = {};

  if (updates.displayName !== undefined) {
    set.displayName = updates.displayName;
    changes.displayName = updates.displayName;
  }
  if (updates.roleTag !== undefined) {
    set.roleTag = updates.roleTag;
    changes.roleTag = updates.roleTag;
  }
  if (updates.groups !== undefined) {
    set.defaultGroups = updates.groups;
    changes.groups = updates.groups;
  }
  if (updates.messageMode !== undefined) {
    set.messageMode = updates.messageMode;
    changes.messageMode = updates.messageMode;
  }
  if (updates.permission !== undefined && isAdmin) {
    set.role = updates.permission;
  }

  if (Object.keys(set).length === 0) {
    return { ok: false, error: "no fields to update" };
  }

  // 5. Update member row
  await db.update(memberTable).set(set).where(eq(memberTable.id, memberId));

  // 6. Read back the updated member
  const [updated] = await db
    .select()
    .from(memberTable)
    .where(eq(memberTable.id, memberId));

  if (!updated) return { ok: false, error: "member not found after update" };

  return {
    ok: true,
    member: {
      id: updated.id,
      displayName: updated.displayName,
      roleTag: updated.roleTag,
      groups: updated.defaultGroups,
      messageMode: updated.messageMode,
      permission: updated.role,
      dashboardUserId: updated.dashboardUserId,
      joinedAt: updated.joinedAt,
      lastSeenAt: updated.lastSeenAt,
    },
    changes,
  };
}

/**
 * List all members of a mesh with online status.
 */
export async function listMeshMembers(
  meshId: string,
): Promise<
  | { ok: true; members: Array<Record<string, unknown>> }
  | { ok: false; error: string }
> {
  // Verify mesh exists
  const [m] = await db
    .select({ id: meshTable.id })
    .from(meshTable)
    .where(and(eq(meshTable.id, meshId), isNull(meshTable.archivedAt)));

  if (!m) return { ok: false, error: "mesh not found" };

  // Get all non-revoked members
  const members = await db
    .select()
    .from(memberTable)
    .where(
      and(eq(memberTable.meshId, meshId), isNull(memberTable.revokedAt)),
    );

  // Early return for empty member list (avoids invalid SQL IN clause)
  if (members.length === 0) {
    return { ok: true, members: [] };
  }

  // Get active presences for online status
  const activePresences = await db
    .select({
      memberId: presenceTable.memberId,
      count: sql<number>`count(*)::int`,
    })
    .from(presenceTable)
    .where(
      and(
        isNull(presenceTable.disconnectedAt),
        sql`${presenceTable.memberId} IN (${sql.join(
          members.map((m) => sql`${m.id}`),
          sql`, `,
        )})`,
      ),
    )
    .groupBy(presenceTable.memberId);

  const onlineMap = new Map(
    activePresences.map((p) => [p.memberId, p.count]),
  );

  return {
    ok: true,
    members: members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      roleTag: member.roleTag,
      groups: member.defaultGroups,
      messageMode: member.messageMode,
      permission: member.role,
      dashboardUserId: member.dashboardUserId,
      joinedAt: member.joinedAt?.toISOString(),
      lastSeenAt: member.lastSeenAt?.toISOString(),
      online: onlineMap.has(member.id),
      sessionCount: onlineMap.get(member.id) ?? 0,
    })),
  };
}

/**
 * Update mesh settings (currently: selfEditable policy).
 * Admin-only.
 */
export async function updateMeshSettings(
  meshId: string,
  callerMemberId: string,
  settings: { selfEditable?: SelfEditablePolicy },
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Check caller is admin
  const [caller] = await db
    .select({ role: memberTable.role })
    .from(memberTable)
    .where(
      and(
        eq(memberTable.id, callerMemberId),
        eq(memberTable.meshId, meshId),
        isNull(memberTable.revokedAt),
      ),
    );

  if (!caller || caller.role !== "admin") {
    return { ok: false, error: "admin access required" };
  }

  const set: Record<string, unknown> = {};
  if (settings.selfEditable) set.selfEditable = settings.selfEditable;

  if (Object.keys(set).length === 0) {
    return { ok: false, error: "no settings to update" };
  }

  await db.update(meshTable).set(set).where(eq(meshTable.id, meshId));

  return { ok: true };
}
