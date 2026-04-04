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
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits, hyphens"),
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
  inviteLink: z.string(),
  expiresAt: z.coerce.date(),
});
export type CreateMyInviteResponse = z.infer<typeof createMyInviteResponseSchema>;

// ---------------------------------------------------------------------
// List my invites (pending + sent)
// ---------------------------------------------------------------------

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
