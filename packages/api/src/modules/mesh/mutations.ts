import { randomBytes, createHash } from "node:crypto";

import { and, eq, isNull } from "@turbostarter/db";
import { invite, mesh, meshMember } from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

import type {
  CreateMyInviteInput,
  CreateMyMeshInput,
} from "../../schema";

const BROKER_URL = process.env.NEXT_PUBLIC_BROKER_URL ?? "ws://localhost:7900";

export const createMyMesh = async ({
  userId,
  input,
}: {
  userId: string;
  input: CreateMyMeshInput;
}) => {
  // Slug collision check
  const [existing] = await db
    .select({ id: mesh.id })
    .from(mesh)
    .where(eq(mesh.slug, input.slug))
    .limit(1);

  if (existing) {
    throw new Error("A mesh with that slug already exists.");
  }

  const [created] = await db
    .insert(mesh)
    .values({
      name: input.name,
      slug: input.slug,
      visibility: input.visibility,
      transport: input.transport,
      ownerUserId: userId,
    })
    .returning({ id: mesh.id, slug: mesh.slug });

  return created!;
};

export const archiveMyMesh = async ({
  userId,
  meshId,
}: {
  userId: string;
  meshId: string;
}) => {
  const [updated] = await db
    .update(mesh)
    .set({ archivedAt: new Date() })
    .where(and(eq(mesh.id, meshId), eq(mesh.ownerUserId, userId)))
    .returning({ id: mesh.id });

  if (!updated) {
    throw new Error("Mesh not found or you are not the owner.");
  }
  return updated;
};

export const leaveMyMesh = async ({
  userId,
  meshId,
}: {
  userId: string;
  meshId: string;
}) => {
  const [updated] = await db
    .update(meshMember)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(meshMember.meshId, meshId),
        eq(meshMember.userId, userId),
        isNull(meshMember.revokedAt),
      ),
    )
    .returning({ id: meshMember.id });

  if (!updated) {
    throw new Error("You are not a member of this mesh.");
  }
  return updated;
};

/** Encode an ic://join/<base64url(JSON)> invite link. Format mirrors
 *  apps/cli/src/invite/parse.ts exactly. */
const encodeInviteLink = (payload: unknown): string => {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, "utf-8").toString("base64url");
  return `ic://join/${encoded}`;
};

/** Placeholder deterministic root key until mesh_root_key column lands
 *  (Step 18 crypto). Signature verification is Step 18, so an actual
 *  ed25519 pubkey is not yet required — only presence is checked. */
const derivePlaceholderRootKey = (meshId: string, meshSlug: string): string =>
  createHash("sha256").update(`${meshId}:${meshSlug}`).digest("hex");

export const createMyInvite = async ({
  userId,
  meshId,
  input,
}: {
  userId: string;
  meshId: string;
  input: CreateMyInviteInput;
}) => {
  // Authz: owner or admin member can invite
  const [meshRow] = await db
    .select({
      id: mesh.id,
      slug: mesh.slug,
      ownerUserId: mesh.ownerUserId,
    })
    .from(mesh)
    .where(eq(mesh.id, meshId))
    .limit(1);

  if (!meshRow) {
    throw new Error("Mesh not found.");
  }

  const isOwner = meshRow.ownerUserId === userId;
  if (!isOwner) {
    const [membership] = await db
      .select({ role: meshMember.role })
      .from(meshMember)
      .where(
        and(
          eq(meshMember.meshId, meshId),
          eq(meshMember.userId, userId),
          isNull(meshMember.revokedAt),
        ),
      )
      .limit(1);
    if (!membership || membership.role !== "admin") {
      throw new Error("Only owners and admins can issue invites.");
    }
  }

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(
    Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
  );

  const [created] = await db
    .insert(invite)
    .values({
      meshId,
      token,
      maxUses: input.maxUses,
      role: input.role,
      expiresAt,
      createdBy: userId,
    })
    .returning({ id: invite.id, token: invite.token, expiresAt: invite.expiresAt });

  const payload = {
    v: 1 as const,
    mesh_id: meshRow.id,
    mesh_slug: meshRow.slug,
    broker_url: BROKER_URL,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    mesh_root_key: derivePlaceholderRootKey(meshRow.id, meshRow.slug),
    role: input.role,
    // signature: added in Step 18 (ed25519 sign by mesh_root_key)
  };

  return {
    id: created!.id,
    token: created!.token,
    expiresAt: created!.expiresAt,
    inviteLink: encodeInviteLink(payload),
  };
};
