/**
 * Broker-side ed25519 verification helpers.
 *
 * Used to authenticate the WS hello handshake: clients sign a canonical
 * byte string with their mesh.member.peerPubkey's secret key, broker
 * verifies with the claimed pubkey, then cross-checks the pubkey is a
 * current member of the claimed mesh.
 */

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import sodium from "libsodium-wrappers";
import { db } from "./db";
import { invite as inviteTable, mesh, meshMember, meshTopic, meshTopicMember } from "@turbostarter/db/schema/mesh";

let ready = false;
async function ensureSodium(): Promise<typeof sodium> {
  if (!ready) {
    await sodium.ready;
    ready = true;
  }
  return sodium;
}

/** Canonical hello bytes: clients sign this, broker verifies this. */
export function canonicalHello(
  meshId: string,
  memberId: string,
  pubkey: string,
  timestamp: number,
): string {
  return `${meshId}|${memberId}|${pubkey}|${timestamp}`;
}

/** Canonical invite bytes — everything in the payload except the signature. */
export function canonicalInvite(fields: {
  v: number;
  mesh_id: string;
  mesh_slug: string;
  broker_url: string;
  expires_at: number;
  mesh_root_key: string;
  role: "admin" | "member";
  owner_pubkey: string;
}): string {
  return `${fields.v}|${fields.mesh_id}|${fields.mesh_slug}|${fields.broker_url}|${fields.expires_at}|${fields.mesh_root_key}|${fields.role}|${fields.owner_pubkey}`;
}

/**
 * Verify an ed25519 signature over arbitrary canonical bytes.
 * Used by invite verification + (future) any other signed payload.
 */
export async function verifyEd25519(
  canonicalText: string,
  signatureHex: string,
  pubkeyHex: string,
): Promise<boolean> {
  if (
    !/^[0-9a-f]{64}$/i.test(pubkeyHex) ||
    !/^[0-9a-f]{128}$/i.test(signatureHex)
  ) {
    return false;
  }
  const s = await ensureSodium();
  try {
    return s.crypto_sign_verify_detached(
      s.from_hex(signatureHex),
      s.from_string(canonicalText),
      s.from_hex(pubkeyHex),
    );
  } catch {
    return false;
  }
}

/**
 * Canonical v2 invite bytes — signed by the mesh owner's ed25519 secret key.
 * NOTE: deliberately does NOT include the root_key or broker_url; the v2
 * protocol moves the root_key out of the URL entirely. Format is locked:
 * `v=2|mesh_id|invite_id|expires_at|role|owner_pubkey` (no trailing newline).
 */
export function canonicalInviteV2(p: {
  mesh_id: string;
  invite_id: string;
  expires_at: number; // unix seconds
  role: "admin" | "member";
  owner_pubkey: string; // hex
}): string {
  return `v=2|${p.mesh_id}|${p.invite_id}|${p.expires_at}|${p.role}|${p.owner_pubkey}`;
}

/**
 * Verify an ed25519 signature over the v2 canonical invite bytes against
 * the mesh owner's public key. Returns true on valid signature.
 */
export async function verifyInviteV2(params: {
  canonical: string;
  signatureHex: string;
  ownerPubkeyHex: string;
}): Promise<boolean> {
  return verifyEd25519(
    params.canonical,
    params.signatureHex,
    params.ownerPubkeyHex,
  );
}

/**
 * Seal the mesh root_key to a recipient-provided x25519 public key using
 * libsodium's sealed box (crypto_box_seal). Only the holder of the matching
 * x25519 secret key can unseal.
 *
 *   rootKeyBase64url is the mesh.root_key column value (base64url of 32 bytes).
 *   recipientX25519PubkeyBase64url is the 32-byte x25519 pubkey the recipient
 *     provided in its claim request. We do NOT convert an ed25519 pubkey here —
 *     the recipient generates a dedicated x25519 keypair and sends us the pubkey.
 *
 * Returns base64url of the sealed ciphertext.
 */
export async function sealRootKeyToRecipient(params: {
  rootKeyBase64url: string;
  recipientX25519PubkeyBase64url: string;
}): Promise<string> {
  const s = await ensureSodium();
  const rootKeyBytes = s.from_base64(
    params.rootKeyBase64url,
    s.base64_variants.URLSAFE_NO_PADDING,
  );
  const recipientPk = s.from_base64(
    params.recipientX25519PubkeyBase64url,
    s.base64_variants.URLSAFE_NO_PADDING,
  );
  if (recipientPk.length !== 32) {
    throw new Error("recipient_x25519_pubkey must decode to 32 bytes");
  }
  const sealed = s.crypto_box_seal(rootKeyBytes, recipientPk);
  return s.to_base64(sealed, s.base64_variants.URLSAFE_NO_PADDING);
}

export const HELLO_SKEW_MS = 60_000;

/**
 * Verify a hello's ed25519 signature + timestamp skew.
 * Returns { ok: true } on success, or { ok: false, reason } describing
 * which check failed (for structured error response).
 */
export async function verifyHelloSignature(args: {
  meshId: string;
  memberId: string;
  pubkey: string;
  timestamp: number;
  signature: string;
  now?: number;
}): Promise<
  | { ok: true }
  | { ok: false; reason: "timestamp_skew" | "bad_signature" | "malformed" }
> {
  const now = args.now ?? Date.now();
  if (
    !Number.isFinite(args.timestamp) ||
    Math.abs(now - args.timestamp) > HELLO_SKEW_MS
  ) {
    return { ok: false, reason: "timestamp_skew" };
  }
  if (
    !/^[0-9a-f]{64}$/i.test(args.pubkey) ||
    !/^[0-9a-f]{128}$/i.test(args.signature)
  ) {
    return { ok: false, reason: "malformed" };
  }
  const s = await ensureSodium();
  try {
    const canonical = canonicalHello(
      args.meshId,
      args.memberId,
      args.pubkey,
      args.timestamp,
    );
    const ok = s.crypto_sign_verify_detached(
      s.from_hex(args.signature),
      s.from_string(canonical),
      s.from_hex(args.pubkey),
    );
    return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

// ----------------------------------------------------------------------------
// v2 invite claim core — exported for the HTTP handler in index.ts AND for
// tests that need to exercise the logic without spinning up the broker server.
// ----------------------------------------------------------------------------
//
// capabilityV2 column is stored as JSON:
//   { "canonical": "v=2|mesh_id|invite_id|expires_at|role|owner_pubkey",
//     "signature": "<hex ed25519 detached signature>" }
// The broker recomputes the canonical bytes from the invite row and verifies
// the signature against mesh.ownerPubkey. v1 rows (version === 1 OR
// capabilityV2 === null) skip verification — the legacy path still works
// during the deprecation window.

export type InviteClaimV2Result =
  | {
      ok: true;
      status: 200;
      body: {
        sealed_root_key: string;
        mesh_id: string;
        member_id: string;
        owner_pubkey: string;
        canonical_v2: string;
      };
    }
  | { ok: false; status: 400 | 404 | 410; body: { error: string } };

export async function claimInviteV2Core(params: {
  code: string;
  recipientX25519PubkeyBase64url: string;
  displayName?: string;
  now?: number;
}): Promise<InviteClaimV2Result> {
  const now = params.now ?? Date.now();
  const recipientPk = params.recipientX25519PubkeyBase64url;

  if (!recipientPk || typeof recipientPk !== "string" || recipientPk.length < 32) {
    return { ok: false, status: 400, body: { error: "malformed" } };
  }

  // 1. Look up the invite by opaque code.
  const [inv] = await db
    .select()
    .from(inviteTable)
    .where(eq(inviteTable.code, params.code))
    .limit(1);
  if (!inv) return { ok: false, status: 404, body: { error: "not_found" } };

  // 2. Lifecycle checks: revoked → expired → exhausted.
  if (inv.revokedAt) {
    return { ok: false, status: 410, body: { error: "revoked" } };
  }
  if (inv.expiresAt.getTime() < now) {
    return { ok: false, status: 410, body: { error: "expired" } };
  }
  if (inv.usedCount >= inv.maxUses) {
    return { ok: false, status: 410, body: { error: "exhausted" } };
  }

  // 3. Load the mesh for owner_pubkey + root_key.
  const [m] = await db
    .select({
      id: mesh.id,
      ownerPubkey: mesh.ownerPubkey,
      rootKey: mesh.rootKey,
    })
    .from(mesh)
    .where(and(eq(mesh.id, inv.meshId), isNull(mesh.archivedAt)))
    .limit(1);
  if (!m) return { ok: false, status: 404, body: { error: "not_found" } };
  if (!m.ownerPubkey || !m.rootKey) {
    return { ok: false, status: 400, body: { error: "malformed" } };
  }

  // 4. Compute canonical_v2 from the row (used in the response either way).
  const expiresAtUnix = Math.floor(inv.expiresAt.getTime() / 1000);
  const canonical = canonicalInviteV2({
    mesh_id: inv.meshId,
    invite_id: inv.id,
    expires_at: expiresAtUnix,
    role: inv.role as "admin" | "member",
    owner_pubkey: m.ownerPubkey,
  });

  if (inv.version === 2 && inv.capabilityV2) {
    let storedCanonical: string | undefined;
    let signatureHex: string | undefined;
    try {
      const parsed = JSON.parse(inv.capabilityV2) as {
        canonical?: string;
        signature?: string;
      };
      storedCanonical = parsed.canonical;
      signatureHex = parsed.signature;
    } catch {
      return { ok: false, status: 400, body: { error: "malformed" } };
    }
    if (!storedCanonical || !signatureHex) {
      return { ok: false, status: 400, body: { error: "malformed" } };
    }
    // Broker-recomputed canonical must match the signed bytes exactly.
    if (storedCanonical !== canonical) {
      return { ok: false, status: 400, body: { error: "bad_signature" } };
    }
    const sigOk = await verifyInviteV2({
      canonical: storedCanonical,
      signatureHex,
      ownerPubkeyHex: m.ownerPubkey,
    });
    if (!sigOk) {
      return { ok: false, status: 400, body: { error: "bad_signature" } };
    }
  }
  // v1 rows: skip signature verification (legacy path during migration).

  // 5. Atomic consume: increment used_count iff still under max_uses.
  const [claimed] = await db
    .update(inviteTable)
    .set({
      usedCount: sql`${inviteTable.usedCount} + 1`,
      claimedByPubkey: recipientPk,
    })
    .where(
      and(
        eq(inviteTable.id, inv.id),
        lt(inviteTable.usedCount, inv.maxUses),
      ),
    )
    .returning({ id: inviteTable.id });
  if (!claimed) {
    return { ok: false, status: 410, body: { error: "exhausted" } };
  }

  // 6. Create a member row for the claimant.
  const preset = (inv.preset as {
    displayName?: string;
    roleTag?: string;
    groups?: Array<{ name: string; role?: string }>;
    messageMode?: string;
  } | null) ?? {};
  const displayName =
    preset.displayName ?? params.displayName ?? `member-${recipientPk.slice(0, 8)}`;
  const [row] = await db
    .insert(meshMember)
    .values({
      meshId: inv.meshId,
      peerPubkey: recipientPk,
      displayName,
      role: inv.role,
      roleTag: preset.roleTag ?? null,
      defaultGroups: preset.groups ?? [],
      messageMode: preset.messageMode ?? "push",
    })
    .returning({ id: meshMember.id });
  if (!row) {
    return { ok: false, status: 400, body: { error: "malformed" } };
  }

  // 6b. Auto-subscribe the new member to #general (the default mesh-wide
  // room). Idempotent via unique (topic_id, member_id). If the mesh was
  // created before #general auto-creation existed, ensure it now via a
  // best-effort INSERT … ON CONFLICT — backfill migration handles the
  // bulk case so this is just a safety net.
  await db
    .insert(meshTopic)
    .values({
      meshId: inv.meshId,
      name: "general",
      description: "Default mesh-wide channel. Every member can read and post.",
      visibility: "public",
    })
    .onConflictDoNothing();
  const [generalTopic] = await db
    .select({ id: meshTopic.id })
    .from(meshTopic)
    .where(and(eq(meshTopic.meshId, inv.meshId), eq(meshTopic.name, "general")))
    .limit(1);
  if (generalTopic) {
    await db
      .insert(meshTopicMember)
      .values({ topicId: generalTopic.id, memberId: row.id, role: "member" })
      .onConflictDoNothing();
  }

  // 7. Seal the mesh root_key to the recipient's x25519 pubkey.
  let sealed: string;
  try {
    sealed = await sealRootKeyToRecipient({
      rootKeyBase64url: m.rootKey,
      recipientX25519PubkeyBase64url: recipientPk,
    });
  } catch {
    return { ok: false, status: 400, body: { error: "malformed" } };
  }

  return {
    ok: true,
    status: 200,
    body: {
      sealed_root_key: sealed,
      mesh_id: inv.meshId,
      member_id: row.id,
      owner_pubkey: m.ownerPubkey,
      canonical_v2: canonical,
    },
  };
}
