import { Hono } from "hono";
import sodium from "libsodium-wrappers";

import { count, eq, isNull, sql } from "@turbostarter/db";
import { user } from "@turbostarter/db/schema";
import {
  invite,
  mesh,
  meshMember,
  messageQueue,
  presence,
} from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

/**
 * Unauthed public stats for the landing page counter.
 *
 * In-memory 60s cache. Results are aggregate counts only — no ids,
 * no names, no ciphertext, no routing metadata. Safe for public consumption.
 */
const CACHE_TTL_MS = 60_000;

interface PublicStats {
  messagesRouted: number;
  meshesCreated: number;
  peersActive: number;
  lastUpdated: string;
}

let cachedStats: { value: PublicStats; expiresAt: number } | null = null;

const fetchStats = async (): Promise<PublicStats> => {
  const [[messagesRouted], [meshesCreated], [peersActive]] = await Promise.all([
    db.select({ c: count() }).from(messageQueue),
    db
      .select({ c: count() })
      .from(mesh)
      .where(isNull(mesh.archivedAt)),
    db
      .select({ c: count() })
      .from(presence)
      .where(isNull(presence.disconnectedAt)),
  ]);

  return {
    messagesRouted: messagesRouted?.c ?? 0,
    meshesCreated: meshesCreated?.c ?? 0,
    peersActive: peersActive?.c ?? 0,
    lastUpdated: new Date().toISOString(),
  };
};

// ---------------------------------------------------------------------
// Invite preview (read-only, no counter mutation)
// ---------------------------------------------------------------------

interface InvitePayload {
  v: number;
  mesh_id: string;
  mesh_slug: string;
  broker_url: string;
  expires_at: number;
  mesh_root_key: string;
  role: "admin" | "member";
  owner_pubkey: string;
  signature?: string;
}

const canonicalInvite = (p: Omit<InvitePayload, "signature">): string =>
  `${p.v}|${p.mesh_id}|${p.mesh_slug}|${p.broker_url}|${p.expires_at}|${p.mesh_root_key}|${p.role}|${p.owner_pubkey}`;

let sodiumReady = false;
const ensureSodium = async () => {
  if (!sodiumReady) {
    await sodium.ready;
    sodiumReady = true;
  }
  return sodium;
};

const decodeInviteToken = (
  token: string,
): InvitePayload | null => {
  try {
    const json = Buffer.from(token, "base64url").toString("utf-8");
    const obj = JSON.parse(json) as unknown;
    if (
      typeof obj !== "object" ||
      obj === null ||
      !("mesh_id" in obj) ||
      !("signature" in obj)
    ) {
      return null;
    }
    return obj as InvitePayload;
  } catch {
    return null;
  }
};

// Invite preview handler — route is mounted below alongside /stats.
const inviteHandler = async (rawToken: string) => {
  const payload = decodeInviteToken(rawToken);
  if (!payload || !payload.signature) {
    return {
      valid: false as const,
      reason: "malformed" as const,
      meshName: null,
      inviterName: null,
      expiresAt: null,
    };
  }

  // Verify ed25519 signature matches owner_pubkey from payload
  const s = await ensureSodium();
  let sigValid = false;
  try {
    sigValid = s.crypto_sign_verify_detached(
      s.from_hex(payload.signature),
      s.from_string(canonicalInvite(payload)),
      s.from_hex(payload.owner_pubkey),
    );
  } catch {
    sigValid = false;
  }
  if (!sigValid) {
    return {
      valid: false as const,
      reason: "bad_signature" as const,
      meshName: null,
      inviterName: null,
      expiresAt: null,
    };
  }

  // DB lookup — mesh + invite row + inviter
  const [row] = await db
    .select({
      inviteId: invite.id,
      maxUses: invite.maxUses,
      usedCount: invite.usedCount,
      role: invite.role,
      expiresAt: invite.expiresAt,
      revokedAt: invite.revokedAt,
      meshId: mesh.id,
      meshName: mesh.name,
      meshSlug: mesh.slug,
      meshArchivedAt: mesh.archivedAt,
      inviterName: user.name,
    })
    .from(invite)
    .leftJoin(mesh, eq(invite.meshId, mesh.id))
    .leftJoin(user, eq(invite.createdBy, user.id))
    .where(eq(invite.token, rawToken))
    .limit(1);

  if (!row || !row.meshId) {
    return {
      valid: false as const,
      reason: "not_found" as const,
      meshName: null,
      inviterName: null,
      expiresAt: null,
    };
  }

  if (row.revokedAt) {
    return {
      valid: false as const,
      reason: "revoked" as const,
      meshName: row.meshName,
      inviterName: row.inviterName,
      expiresAt: row.expiresAt,
    };
  }
  if (row.meshArchivedAt) {
    return {
      valid: false as const,
      reason: "mesh_archived" as const,
      meshName: row.meshName,
      inviterName: row.inviterName,
      expiresAt: row.expiresAt,
    };
  }
  if (row.expiresAt < new Date()) {
    return {
      valid: false as const,
      reason: "expired" as const,
      meshName: row.meshName,
      inviterName: row.inviterName,
      expiresAt: row.expiresAt,
    };
  }
  if (row.usedCount >= row.maxUses) {
    return {
      valid: false as const,
      reason: "exhausted" as const,
      meshName: row.meshName,
      inviterName: row.inviterName,
      expiresAt: row.expiresAt,
    };
  }

  // Count active members
  const [memberCountRow] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(meshMember)
    .where(eq(meshMember.meshId, row.meshId));

  return {
    valid: true as const,
    meshName: row.meshName ?? "",
    meshSlug: row.meshSlug ?? "",
    inviterName: row.inviterName,
    memberCount: memberCountRow?.c ?? 0,
    role: row.role,
    expiresAt: row.expiresAt,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    token: rawToken,
  };
};

export const publicRouter = new Hono()
  .get("/invite/:token", async (c) => {
    const result = await inviteHandler(c.req.param("token"));
    // Small cache on valid invites, no cache on errors (reason can change)
    if (result.valid) {
      c.header("cache-control", "public, max-age=30");
    } else {
      c.header("cache-control", "no-store");
    }
    return c.json(result);
  })
  /**
   * Resolve a short invite code to its canonical long token.
   *
   * URL shortener only — the long token still carries the root_key,
   * so this endpoint is NOT a security boundary. See the v2 invite
   * protocol spec for the real fix.
   *
   * Returns 404 if the code is unknown OR the invite was revoked/
   * archived so stale short URLs don't leak mesh metadata.
   */
  .get("/invite-code/:code", async (c) => {
    const code = c.req.param("code");
    const [row] = await db
      .select({ token: invite.token, revokedAt: invite.revokedAt })
      .from(invite)
      .where(eq(invite.code, code))
      .limit(1);
    c.header("cache-control", "no-store");
    if (!row || row.revokedAt) {
      return c.json({ found: false as const }, 404);
    }
    return c.json({ found: true as const, token: row.token });
  })
  .get("/stats", async (c) => {
  const now = Date.now();
  if (cachedStats && cachedStats.expiresAt > now) {
    c.header("x-cache", "HIT");
    return c.json(cachedStats.value);
  }

  const value = await fetchStats();
  cachedStats = { value, expiresAt: now + CACHE_TTL_MS };
  c.header("x-cache", "MISS");
  c.header("cache-control", "public, max-age=60, s-maxage=60");
  return c.json(value);
});
