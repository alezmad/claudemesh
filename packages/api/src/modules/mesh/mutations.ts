import { randomBytes } from "node:crypto";

import sodium from "libsodium-wrappers";

import { and, eq, isNull } from "@turbostarter/db";
import { invite, mesh, meshMember } from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

import type {
  CreateMyInviteInput,
  CreateMyMeshInput,
} from "../../schema";

const BROKER_URL =
  process.env.NEXT_PUBLIC_BROKER_URL ?? "wss://ic.claudemesh.com/ws";
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

/**
 * Slugify a display name into a URL-safe token. Used only as cosmetic
 * metadata embedded in invite payloads for debugging/display — NOT as a
 * canonical identifier. `mesh.id` (opaque) is the canonical identity.
 */
const toSlug = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "mesh";

/**
 * Base62 alphabet excluding visually ambiguous characters (0, O, I, l, 1).
 * 57 symbols × 8 positions ≈ 1.1e14 combinations — birthday collision at
 * ~10M invites, fine for years. We retry-on-conflict at insert time anyway.
 */
const SHORTCODE_ALPHABET =
  "23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const generateShortCode = (len = 8): string => {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += SHORTCODE_ALPHABET[bytes[i]! % SHORTCODE_ALPHABET.length];
  }
  return out;
};

export const createMyMesh = async ({
  userId,
  input,
}: {
  userId: string;
  input: CreateMyMeshInput;
}) => {
  // Slug is derived from name and stored non-uniquely — meshes are identified
  // by `mesh.id` (opaque). Two users can freely name their meshes "platform".
  const slug = toSlug(input.name);

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
      slug,
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

  // Short URL shortener code. Retry on the (extremely unlikely) collision
  // against the unique index. 3 attempts is plenty given the keyspace.
  let code = generateShortCode();
  let created:
    | { id: string; token: string; code: string | null; expiresAt: Date }
    | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rows = await db
        .insert(invite)
        .values({
          meshId,
          token,
          tokenBytes: canonical,
          code,
          maxUses: input.maxUses,
          role: input.role,
          expiresAt,
          createdBy: userId,
        })
        .returning({
          id: invite.id,
          token: invite.token,
          code: invite.code,
          expiresAt: invite.expiresAt,
        });
      created = rows[0];
      break;
    } catch (e) {
      // Only retry on short-code collision; rethrow anything else.
      if (e instanceof Error && e.message.includes("invite_code_unique_idx")) {
        code = generateShortCode();
        continue;
      }
      throw e;
    }
  }
  if (!created) {
    throw new Error("Could not allocate a unique invite code — retry.");
  }

  const appBase = APP_URL.replace(/\/$/, "");
  return {
    id: created.id,
    token: created.token,
    code: created.code,
    expiresAt: created.expiresAt,
    inviteLink: `ic://join/${token}`,
    joinUrl: `${appBase}/join/${token}`,
    // The human-friendly short URL. Redirects to joinUrl server-side.
    // Prefer this when sharing. See spec for why this is NOT a capability
    // boundary (the long token still carries the root_key).
    shortUrl: created.code ? `${appBase}/i/${created.code}` : null,
  };
};
