/**
 * Granular permission checks for mesh operations.
 *
 * If a meshPermission row exists for the member, use it.
 * Otherwise, derive defaults from the member's role.
 */

import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { meshPermission, meshMember, mesh, DEFAULT_PERMISSIONS } from "@turbostarter/db/schema/mesh";
import type { PermissionKey } from "@turbostarter/db/schema/mesh";

export interface ResolvedPermissions {
  canInvite: boolean;
  canDeployMcp: boolean;
  canManageFiles: boolean;
  canManageVault: boolean;
  canManageWatches: boolean;
  canManageWebhooks: boolean;
  canWriteState: boolean;
  canSend: boolean;
  canUseTools: boolean;
  canDeleteMesh: boolean;
  canManagePermissions: boolean;
}

/**
 * Get effective permissions for a member in a mesh.
 * Checks for explicit permission row, falls back to role defaults.
 */
export async function getPermissions(meshId: string, memberId: string): Promise<ResolvedPermissions> {
  // Get the explicit permission row if it exists
  const [perm] = await db.select().from(meshPermission)
    .where(and(eq(meshPermission.meshId, meshId), eq(meshPermission.memberId, memberId)))
    .limit(1);

  if (perm) {
    return {
      canInvite: perm.canInvite,
      canDeployMcp: perm.canDeployMcp,
      canManageFiles: perm.canManageFiles,
      canManageVault: perm.canManageVault,
      canManageWatches: perm.canManageWatches,
      canManageWebhooks: perm.canManageWebhooks,
      canWriteState: perm.canWriteState,
      canSend: perm.canSend,
      canUseTools: perm.canUseTools,
      canDeleteMesh: perm.canDeleteMesh,
      canManagePermissions: perm.canManagePermissions,
    };
  }

  // Fall back to role-based defaults
  const [member] = await db.select().from(meshMember)
    .where(eq(meshMember.id, memberId))
    .limit(1);

  if (!member) return DEFAULT_PERMISSIONS.member;

  // Check if member is mesh owner
  const [m] = await db.select().from(mesh)
    .where(eq(mesh.id, meshId))
    .limit(1);

  if (m && m.ownerUserId && member.userId === m.ownerUserId) {
    return DEFAULT_PERMISSIONS.owner;
  }

  return DEFAULT_PERMISSIONS[member.role] ?? DEFAULT_PERMISSIONS.member;
}

/**
 * Check a single permission for a member.
 * Returns true if allowed, false if denied.
 */
export async function checkPermission(
  meshId: string,
  memberId: string,
  permission: PermissionKey,
): Promise<boolean> {
  const perms = await getPermissions(meshId, memberId);
  return perms[permission];
}

/**
 * Set explicit permissions for a member (partial update).
 * Creates the row if it doesn't exist.
 */
export async function setPermissions(
  meshId: string,
  memberId: string,
  updates: Partial<ResolvedPermissions>,
): Promise<void> {
  const [existing] = await db.select().from(meshPermission)
    .where(and(eq(meshPermission.meshId, meshId), eq(meshPermission.memberId, memberId)))
    .limit(1);

  if (existing) {
    await db.update(meshPermission)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(meshPermission.id, existing.id));
  } else {
    // Get role defaults first, then overlay updates
    const defaults = await getPermissions(meshId, memberId);
    await db.insert(meshPermission).values({
      meshId,
      memberId,
      ...defaults,
      ...updates,
    });
  }
}
