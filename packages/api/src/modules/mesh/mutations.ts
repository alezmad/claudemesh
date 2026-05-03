import { randomBytes } from "node:crypto";

import sodium from "libsodium-wrappers";

import { and, asc, eq, isNull } from "@turbostarter/db";
import {
  invite,
  mesh,
  meshMember,
  meshTopic,
  meshTopicMember,
  meshTopicMemberKey,
  pendingInvite,
} from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

import type {
  CreateEmailInviteInput,
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

/**
 * v2 canonical invite bytes — format is LOCKED and MUST match
 * `canonicalInviteV2` in apps/broker/src/crypto.ts exactly. The broker
 * recomputes this on every claim and compares byte-for-byte against the
 * signed `capabilityV2.canonical` stored on the invite row. Any drift
 * between this string and the broker's version produces `bad_signature`.
 *
 * No root_key and no broker_url: the v2 protocol moves the root_key out
 * of the URL and the broker is the authority for where the key lives.
 */
const canonicalInviteV2 = (p: {
  mesh_id: string;
  invite_id: string;
  expires_at: number; // unix seconds
  role: "admin" | "member";
  owner_pubkey: string; // hex
}): string =>
  `v=2|${p.mesh_id}|${p.invite_id}|${p.expires_at}|${p.role}|${p.owner_pubkey}`;

/**
 * Derive the broker's HTTP base URL from the configured WebSocket URL.
 * `wss://host/ws` → `https://host`, `ws://host/ws` → `http://host`.
 * The claim endpoint lives at `${base}/invites/:code/claim`.
 */
export const brokerHttpBase = (): string => {
  const wsUrl = BROKER_URL;
  const httpUrl = wsUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://")
    .replace(/\/ws\/?$/, "")
    .replace(/\/$/, "");
  return httpUrl;
};

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

  // v0.7.0 collapse: mesh.name always == mesh.slug. Input.name is
  // accepted from create UIs (dashboard, CLI) and used to derive the
  // slug; we drop the original spelling so name and slug never drift.
  const [created] = await db
    .insert(mesh)
    .values({
      name: slug,
      slug,
      visibility: input.visibility,
      transport: input.transport,
      ownerUserId: userId,
      ownerPubkey,
      ownerSecretKey,
      rootKey,
    })
    .returning({ id: mesh.id, slug: mesh.slug });
  if (!created) throw new Error("mesh insert returned no row");

  // Create the owner's peer-identity member row. Mirrors what the broker
  // does on first WS hello so a web-only user has a valid identity from
  // t=0 — without this, the topic chat can't issue a dashboard apikey
  // (issuedByMemberId is a FK), and the owner's "oldest member row in
  // the mesh" lookup returns null. Fresh ed25519 keypair; secret key is
  // discarded because web users don't sign anything in v0.2.0 (no DMs,
  // base64 plaintext on topics). If they later install the CLI, the
  // broker will mint a separate member row with a CLI-side keypair —
  // both work for their respective surfaces.
  const peerKp = s.crypto_sign_keypair();
  const peerPubkey = s.to_hex(peerKp.publicKey);
  const [ownerMember] = await db
    .insert(meshMember)
    .values({
      meshId: created.id,
      peerPubkey,
      displayName: `${input.name}-owner`,
      role: "admin",
      userId,
      dashboardUserId: userId,
    })
    .returning({ id: meshMember.id });
  if (!ownerMember) throw new Error("owner member insert returned no row");

  // Auto-create #general and subscribe the owner as 'lead'.
  const generalTopic = await ensureGeneralTopic(created.id);
  if (generalTopic) {
    await db
      .insert(meshTopicMember)
      .values({
        topicId: generalTopic.id,
        memberId: ownerMember.id,
        role: "lead",
      })
      .onConflictDoNothing();
  }

  return created;
};

/**
 * Idempotently create the conventional `#general` topic for a mesh.
 *
 * `#general` is the default web-readable room: a public topic that every
 * mesh has so the dashboard chat surface always has somewhere to land.
 * Subscription is not required for read access via the REST surface, so
 * subscribing members happens lazily at member-row creation time
 * (invite-claim) rather than here.
 *
 * Safe to call repeatedly — the unique (meshId, name) index keeps it a
 * no-op on the second call.
 */
export const ensureGeneralTopic = async (
  meshId: string,
): Promise<{ id: string } | null> => {
  const [existing] = await db
    .select({
      id: meshTopic.id,
      encryptedKeyPubkey: meshTopic.encryptedKeyPubkey,
    })
    .from(meshTopic)
    .where(and(eq(meshTopic.meshId, meshId), eq(meshTopic.name, "general")))
    .limit(1);
  if (existing) return { id: existing.id };

  // Generate the topic's symmetric key + an ephemeral sender keypair
  // for v0.3.0 phase 2 sealing. Mirrors the broker's createTopic path
  // so web-created topics aren't stuck as unencrypted v0.2.0 placeholders.
  // The plaintext topicKey leaves memory after sealing one copy for
  // the mesh owner — the broker never persists it.
  await sodium.ready;
  const topicKey = sodium.randombytes_buf(32);
  const senderKp = sodium.crypto_box_keypair();

  const [row] = await db
    .insert(meshTopic)
    .values({
      meshId,
      name: "general",
      description: "Default mesh-wide channel. Every member can read and post.",
      visibility: "public",
      encryptedKeyPubkey: sodium.to_hex(senderKp.publicKey),
    })
    .onConflictDoNothing()
    .returning({ id: meshTopic.id });
  if (!row) return null;

  // Seal a copy for the oldest non-revoked member (the owner, by
  // construction — owner-as-member rows are minted at mesh creation
  // time, ahead of this call).
  const [owner] = await db
    .select({
      id: meshMember.id,
      peerPubkey: meshMember.peerPubkey,
    })
    .from(meshMember)
    .where(and(eq(meshMember.meshId, meshId), isNull(meshMember.revokedAt)))
    .orderBy(asc(meshMember.joinedAt))
    .limit(1);
  if (owner) {
    try {
      const recipientX25519 = sodium.crypto_sign_ed25519_pk_to_curve25519(
        sodium.from_hex(owner.peerPubkey),
      );
      const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
      const sealed = sodium.crypto_box_easy(
        topicKey,
        nonce,
        recipientX25519,
        senderKp.privateKey,
      );
      // Embed sender x25519 pubkey as the first 32 bytes so future
      // re-sealed copies (carrying a different sender) decode the same
      // way as creator-sealed copies.
      const blob = new Uint8Array(32 + sealed.length);
      blob.set(senderKp.publicKey, 0);
      blob.set(sealed, 32);
      await db.insert(meshTopicMemberKey).values({
        topicId: row.id,
        memberId: owner.id,
        encryptedKey: sodium.to_base64(blob, sodium.base64_variants.ORIGINAL),
        nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
      }).onConflictDoNothing();
    } catch {
      // Owner pubkey isn't a valid ed25519 key (legacy data?). Topic
      // is still created — phase 3 re-seal flow will handle it.
    }
  }

  return row;
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

/**
 * Decline an incoming pending invite addressed to this user's email.
 * Marks the pending_invite row as revoked so it no longer surfaces
 * in /invites/incoming. The underlying short-code invite is NOT revoked
 * (inviter may re-send), only this user's copy is dismissed.
 */
export const declineIncomingInvite = async ({
  email,
  pendingInviteId,
}: {
  email: string;
  pendingInviteId: string;
}) => {
  const [updated] = await db
    .update(pendingInvite)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(pendingInvite.id, pendingInviteId),
        eq(pendingInvite.email, email),
        isNull(pendingInvite.acceptedAt),
        isNull(pendingInvite.revokedAt),
      ),
    )
    .returning({ id: pendingInvite.id });

  if (!updated) {
    throw new Error("Invitation not found or already resolved.");
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
          // v2 starts here — capabilityV2 is backfilled below in a second
          // UPDATE because the canonical bytes depend on invite.id which
          // we only know post-insert.
          version: 2,
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

  // --- v2 capability: sign canonical bytes that include the invite id ---
  // The broker recomputes these exact bytes on claim and verifies the
  // signature against mesh.ownerPubkey. Stored shape is the JSON literal
  // the broker expects in `invite.capabilityV2`:
  //   { "canonical": "v=2|...", "signature": "<hex>" }
  // We reuse the existing `capabilityV2` text column — no schema change.
  const canonicalV2 = canonicalInviteV2({
    mesh_id: meshRow.id,
    invite_id: created.id,
    expires_at: expiresAtSec,
    role: input.role,
    owner_pubkey: meshRow.ownerPubkey,
  });
  const signatureV2 = s.to_hex(
    s.crypto_sign_detached(
      s.from_string(canonicalV2),
      s.from_hex(meshRow.ownerSecretKey),
    ),
  );
  const capabilityV2Json = JSON.stringify({
    canonical: canonicalV2,
    signature: signatureV2,
  });
  await db
    .update(invite)
    .set({ capabilityV2: capabilityV2Json })
    .where(eq(invite.id, created.id));

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
    // v2 surface: safe to share (no root_key, no secrets).
    version: 2 as const,
    canonicalV2,
    ownerPubkey: meshRow.ownerPubkey,
  };
};

// ---------------------------------------------------------------------
// Email invites (v2 only)
// ---------------------------------------------------------------------

/**
 * Send a mesh invite by email. Mints a normal v2 invite (same short code
 * path as `createMyInvite`), then records a `pending_invite` row tying
 * `(mesh, email)` to the underlying invite code. Delivery goes through
 * the email provider if one is wired; otherwise we log a TODO and
 * return success so the rest of the flow is testable end-to-end.
 *
 * The email body contains `${APP_URL}/i/${code}` — the exact same short
 * URL that link-shares use. No new user-visible surface.
 */
export const createEmailInvite = async ({
  userId,
  meshId,
  input,
}: {
  userId: string;
  meshId: string;
  input: CreateEmailInviteInput;
}) => {
  // Reuse createMyInvite — all authz, signing, and short-code collision
  // logic lives there. We only add the pending_invite row + email send.
  const minted = await createMyInvite({
    userId,
    meshId,
    input: {
      role: input.role,
      maxUses: input.maxUses,
      expiresInDays: input.expiresInDays,
    },
  });

  if (!minted.code) {
    // Should never happen — createMyInvite always allocates a code now.
    throw new Error("Could not mint an email invite (no short code).");
  }

  const [pending] = await db
    .insert(pendingInvite)
    .values({
      meshId,
      email: input.email,
      code: minted.code,
      createdBy: userId,
    })
    .returning({ id: pendingInvite.id });

  if (!pending) {
    throw new Error("Could not record pending invite row.");
  }

  const appBase = APP_URL.replace(/\/$/, "");
  const shortUrl = `${appBase}/i/${minted.code}`;

  // Fire-and-forget-ish send. Failures are logged but do NOT roll back
  // the invite — the admin can copy the short URL from the dashboard.
  await sendEmailInvite({
    to: input.email,
    shortUrl,
    inviterUserId: userId,
    meshId,
  });

  return {
    pendingInviteId: pending.id,
    code: minted.code,
    email: input.email,
    shortUrl,
    expiresAt: minted.expiresAt,
  };
};

/**
 * Deliver the email that carries a `claudemesh.com/i/{code}` short URL.
 *
 * TODO: wire this to the turbostarter Postmark provider. The email
 * package exposes `sendEmail` via a template system; adding a new
 * template file lives in `packages/email/**` which is out of scope for
 * this wave. For now we log the intended send so the upstream mutation
 * resolves cleanly and the rest of the flow is integration-testable.
 */
const sendEmailInvite = async (params: {
  to: string;
  shortUrl: string;
  inviterUserId: string;
  meshId: string;
}): Promise<void> => {
  // eslint-disable-next-line no-console
  console.warn(
    "[claudemesh] TODO: wire email invite to Postmark provider",
    {
      to: params.to,
      shortUrl: params.shortUrl,
      inviterUserId: params.inviterUserId,
      meshId: params.meshId,
    },
  );
};
