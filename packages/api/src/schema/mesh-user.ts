import * as z from "zod";

import {
  offsetPaginationSchema,
  sortSchema,
} from "@turbostarter/shared/schema";

export const meshVisibilityEnum = z.enum(["private", "public"]);
export const meshTransportEnum = z.enum([
  "managed",
  "tailscale",
  "self_hosted",
]);
export const meshRoleEnum = z.enum(["admin", "member"]);

// ---------------------------------------------------------------------
// List my meshes
// ---------------------------------------------------------------------

export const getMyMeshesInputSchema = offsetPaginationSchema.extend({
  sort: z
    .string()
    .transform((val) =>
      z.array(sortSchema).parse(JSON.parse(decodeURIComponent(val))),
    )
    .optional(),
  q: z.string().optional(),
});
export type GetMyMeshesInput = z.infer<typeof getMyMeshesInputSchema>;

export const getMyMeshesResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      visibility: meshVisibilityEnum,
      transport: meshTransportEnum,
      tier: z.enum(["free", "pro", "team", "enterprise"]),
      createdAt: z.coerce.date(),
      archivedAt: z.coerce.date().nullable(),
      myRole: meshRoleEnum,
      isOwner: z.boolean(),
      memberCount: z.number(),
    }),
  ),
  total: z.number(),
});
export type GetMyMeshesResponse = z.infer<typeof getMyMeshesResponseSchema>;

// ---------------------------------------------------------------------
// Create mesh
// ---------------------------------------------------------------------

export const createMyMeshInputSchema = z.object({
  name: z.string().min(2).max(80),
  visibility: meshVisibilityEnum.default("private"),
  transport: meshTransportEnum.default("managed"),
});
export type CreateMyMeshInput = z.infer<typeof createMyMeshInputSchema>;

export const createMyMeshResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
});
export type CreateMyMeshResponse = z.infer<typeof createMyMeshResponseSchema>;

// ---------------------------------------------------------------------
// Single mesh (user view)
// ---------------------------------------------------------------------

export const getMyMeshResponseSchema = z.object({
  mesh: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      visibility: meshVisibilityEnum,
      transport: meshTransportEnum,
      tier: z.enum(["free", "pro", "team", "enterprise"]),
      maxPeers: z.number().nullable(),
      createdAt: z.coerce.date(),
      archivedAt: z.coerce.date().nullable(),
      isOwner: z.boolean(),
      myRole: meshRoleEnum,
    })
    .nullable(),
  members: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      role: meshRoleEnum,
      joinedAt: z.coerce.date(),
      lastSeenAt: z.coerce.date().nullable(),
      revokedAt: z.coerce.date().nullable(),
      isMe: z.boolean(),
    }),
  ),
  invites: z.array(
    z.object({
      id: z.string(),
      token: z.string(),
      maxUses: z.number(),
      usedCount: z.number(),
      role: meshRoleEnum,
      expiresAt: z.coerce.date(),
      createdAt: z.coerce.date(),
      revokedAt: z.coerce.date().nullable(),
    }),
  ),
});
export type GetMyMeshResponse = z.infer<typeof getMyMeshResponseSchema>;

// ---------------------------------------------------------------------
// Generate invite
// ---------------------------------------------------------------------

export const createMyInviteInputSchema = z.object({
  role: meshRoleEnum.default("member"),
  maxUses: z.number().int().min(1).max(1000).default(1),
  expiresInDays: z.number().int().min(1).max(365).default(7),
});
export type CreateMyInviteInput = z.infer<typeof createMyInviteInputSchema>;

export const createMyInviteResponseSchema = z.object({
  id: z.string(),
  token: z.string(),
  code: z.string().nullable(),
  inviteLink: z.string(),
  joinUrl: z.string(),
  shortUrl: z.string().nullable(),
  expiresAt: z.coerce.date(),
  // v2 fields — present on every new invite. v1-only rows will return
  // these as undefined on the legacy list endpoint; new rows always set
  // them because createMyInvite now mints v2 capabilities by default.
  version: z.literal(2).optional(),
  canonicalV2: z.string().optional(),
  ownerPubkey: z.string().optional(),
});
export type CreateMyInviteResponse = z.infer<typeof createMyInviteResponseSchema>;

// ---------------------------------------------------------------------
// Email invites
// ---------------------------------------------------------------------

export const createEmailInviteInputSchema = z.object({
  email: z.string().email(),
  role: meshRoleEnum.default("member"),
  maxUses: z.number().int().min(1).max(1000).default(1),
  expiresInDays: z.number().int().min(1).max(365).default(7),
});
export type CreateEmailInviteInput = z.infer<typeof createEmailInviteInputSchema>;

export const createEmailInviteResponseSchema = z.object({
  pendingInviteId: z.string(),
  code: z.string(),
  email: z.string(),
  shortUrl: z.string(),
  expiresAt: z.coerce.date(),
});
export type CreateEmailInviteResponse = z.infer<
  typeof createEmailInviteResponseSchema
>;

// ---------------------------------------------------------------------
// v2 invite claim (public, proxies to broker)
// ---------------------------------------------------------------------

export const claimInviteInputSchema = z.object({
  recipient_x25519_pubkey: z.string().min(32),
});
export type ClaimInviteInput = z.infer<typeof claimInviteInputSchema>;

export const claimInviteResponseSchema = z.object({
  sealed_root_key: z.string(),
  mesh_id: z.string(),
  member_id: z.string(),
  owner_pubkey: z.string(),
  canonical_v2: z.string(),
});
export type ClaimInviteResponse = z.infer<typeof claimInviteResponseSchema>;

// ---------------------------------------------------------------------
// List my invites (pending + sent)
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Live mesh stream (presences + recent envelopes + recent audit events)
// ---------------------------------------------------------------------

export const getMyMeshStreamResponseSchema = z.object({
  presences: z.array(
    z.object({
      id: z.string(),
      memberId: z.string(),
      displayName: z.string().nullable(),
      sessionId: z.string(),
      pid: z.number(),
      cwd: z.string(),
      status: z.enum(["idle", "working", "dnd"]),
      statusSource: z.enum(["hook", "manual", "jsonl"]),
      statusUpdatedAt: z.coerce.date(),
      lastPingAt: z.coerce.date(),
      disconnectedAt: z.coerce.date().nullable(),
    }),
  ),
  envelopes: z.array(
    z.object({
      id: z.string(),
      senderMemberId: z.string(),
      senderDisplayName: z.string().nullable(),
      targetSpec: z.string(),
      priority: z.enum(["now", "next", "low"]),
      ciphertextPreview: z.string(),
      size: z.number(),
      createdAt: z.coerce.date(),
      deliveredAt: z.coerce.date().nullable(),
    }),
  ),
  auditEvents: z.array(
    z.object({
      id: z.string(),
      eventType: z.string(),
      actorPeerId: z.string().nullable(),
      targetPeerId: z.string().nullable(),
      createdAt: z.coerce.date(),
    }),
  ),
});
export type GetMyMeshStreamResponse = z.infer<
  typeof getMyMeshStreamResponseSchema
>;

// ---------------------------------------------------------------------
// Public invite preview (unauthed invite-landing page)
// ---------------------------------------------------------------------

export const publicInviteResponseSchema = z.discriminatedUnion("valid", [
  z.object({
    valid: z.literal(true),
    meshName: z.string(),
    meshSlug: z.string(),
    inviterName: z.string().nullable(),
    memberCount: z.number(),
    role: z.enum(["admin", "member"]),
    expiresAt: z.coerce.date(),
    maxUses: z.number(),
    usedCount: z.number(),
    token: z.string(),
  }),
  z.object({
    valid: z.literal(false),
    reason: z.enum([
      "malformed",
      "bad_signature",
      "expired",
      "revoked",
      "exhausted",
      "mesh_archived",
      "not_found",
    ]),
    meshName: z.string().nullable(),
    inviterName: z.string().nullable(),
    expiresAt: z.coerce.date().nullable(),
  }),
]);
export type PublicInviteResponse = z.infer<typeof publicInviteResponseSchema>;

// ---------------------------------------------------------------------
// Public stats (unauthed landing counter)
// ---------------------------------------------------------------------

export const publicStatsResponseSchema = z.object({
  messagesRouted: z.number(),
  meshesCreated: z.number(),
  peersActive: z.number(),
  lastUpdated: z.string(),
});
export type PublicStatsResponse = z.infer<typeof publicStatsResponseSchema>;

export const getMyInvitesResponseSchema = z.object({
  sent: z.array(
    z.object({
      id: z.string(),
      meshId: z.string(),
      meshName: z.string().nullable(),
      meshSlug: z.string().nullable(),
      token: z.string(),
      role: meshRoleEnum,
      maxUses: z.number(),
      usedCount: z.number(),
      expiresAt: z.coerce.date(),
      createdAt: z.coerce.date(),
      revokedAt: z.coerce.date().nullable(),
    }),
  ),
});
export type GetMyInvitesResponse = z.infer<typeof getMyInvitesResponseSchema>;
