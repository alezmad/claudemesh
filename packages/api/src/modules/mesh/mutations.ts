import sodium from "libsodium-wrappers";

import { and, eq, isNull } from "@turbostarter/db";
import { invite, mesh, meshMember } from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

import type {
  CreateMyInviteInput,
  CreateMyMeshInput,
} from "../../schema";

const BROKER_URL = process.env.NEXT_PUBLIC_BROKER_URL ?? "ws://localhost:7900";
const APP_URL = process.env.NEXT_PUBLIC_URL ?? "https://claudemesh.com";

/**
 * Canonical invite bytes — MUST match the broker's canonicalInvite()
 * in apps/broker/src/crypto.ts exactly. Any delimiter/field change
 * between signer and verifier produces `invite_bad_signature`.
 */
const canonicalInvite = (p: {
  v: number;
  mesh_id: string;
  mesh_slug: string;
  broker_url: string;
  expires_at: number;
  mesh_root_key: string;
  role: "admin" | "member";
  owner_pubkey: string;
}): string =>
  `${p.v}|${p.mesh_id}|${p.mesh_slug}|${p.broker_url}|${p.expires_at}|${p.mesh_root_key}|${p.role}|${p.owner_pubkey}`;

let sodiumReady = false;
const ensureSodium = async (): Promise<typeof sodium> => {
  if (!sodiumReady) {
    await sodium.ready;
    sodiumReady = true;
  }
  return sodium;
};

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

  // Generate the mesh owner's ed25519 keypair (signs invites) and a
  // 32-byte shared root key (channel encryption in later steps).
  // See mesh.ownerSecretKey comment re: plaintext-at-rest trade-off.
  const s = await ensureSodium();
  const kp = s.crypto_sign_keypair();
  const ownerPubkey = s.to_hex(kp.publicKey);
  const ownerSecretKey = s.to_hex(kp.privateKey);
  const rootKey = s.to_base64(
    s.randombytes_buf(32),
    s.base64_variants.URLSAFE_NO_PADDING,
  );

  const [created] = await db
    .insert(mesh)
    .values({
      name: input.name,
      slug: input.slug,
      visibility: input.visibility,
      transport: input.transport,
      ownerUserId: userId,
      ownerPubkey,
      ownerSecretKey,
      rootKey,
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

export const createMyInvite = async ({
  userId,
  meshId,
  input,
}: {
  userId: string;
  meshId: string;
  input: CreateMyInviteInput;
}) => {
  // Authz: owner or admin member can invite.
  const [meshRow] = await db
    .select({
      id: mesh.id,
      slug: mesh.slug,
      ownerUserId: mesh.ownerUserId,
      ownerPubkey: mesh.ownerPubkey,
      ownerSecretKey: mesh.ownerSecretKey,
      rootKey: mesh.rootKey,
    })
    .from(mesh)
    .where(eq(mesh.id, meshId))
    .limit(1);

  if (!meshRow) {
    throw new Error("Mesh not found.");
  }
  if (
    !meshRow.ownerPubkey ||
    !meshRow.ownerSecretKey ||
    !meshRow.rootKey
  ) {
    throw new Error(
      "Mesh is missing owner keypair or root key — run backfill script.",
    );
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

  const expiresAt = new Date(
    Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
  );
  const expiresAtSec = Math.floor(expiresAt.getTime() / 1000);

  // Build the canonical signed payload. Signature covers every field
  // except `signature` itself; broker re-verifies identically.
  const payloadCore = {
    v: 1 as const,
    mesh_id: meshRow.id,
    mesh_slug: meshRow.slug,
    broker_url: BROKER_URL,
    expires_at: expiresAtSec,
    mesh_root_key: meshRow.rootKey,
    role: input.role,
    owner_pubkey: meshRow.ownerPubkey,
  };
  const canonical = canonicalInvite(payloadCore);
  const s = await ensureSodium();
  const signature = s.to_hex(
    s.crypto_sign_detached(
      s.from_string(canonical),
      s.from_hex(meshRow.ownerSecretKey),
    ),
  );
  const fullPayload = { ...payloadCore, signature };

  // The base64url(JSON) is BOTH the link payload AND the DB lookup
  // token — broker's /join resolves invites by this string.
  const token = Buffer.from(JSON.stringify(fullPayload), "utf-8").toString(
    "base64url",
  );
  const [created] = await db
    .insert(invite)
    .values({
      meshId,
      token,
      tokenBytes: canonical,
      maxUses: input.maxUses,
      role: input.role,
      expiresAt,
      createdBy: userId,
    })
    .returning({
      id: invite.id,
      token: invite.token,
      expiresAt: invite.expiresAt,
    });

  return {
    id: created!.id,
    token: created!.token,
    expiresAt: created!.expiresAt,
    inviteLink: `ic://join/${token}`,
    joinUrl: `${APP_URL.replace(/\/$/, "")}/join/${token}`,
  };
};
