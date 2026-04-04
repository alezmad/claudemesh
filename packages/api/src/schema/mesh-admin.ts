import * as z from "zod";

import {
  offsetPaginationSchema,
  sortSchema,
} from "@turbostarter/shared/schema";

// ---------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------

export const meshTierEnum = z.enum(["free", "pro", "team", "enterprise"]);
export const meshTransportEnum = z.enum([
  "managed",
  "tailscale",
  "self_hosted",
]);
export const meshVisibilityEnum = z.enum(["private", "public"]);

export const getMeshesInputSchema = offsetPaginationSchema.extend({
  sort: z
    .string()
    .transform((val) =>
      z.array(sortSchema).parse(JSON.parse(decodeURIComponent(val))),
    )
    .optional(),
  q: z.string().optional(),
  tier: z
    .union([meshTierEnum.transform((v) => [v]), z.array(meshTierEnum)])
    .optional(),
  transport: z
    .union([
      meshTransportEnum.transform((v) => [v]),
      z.array(meshTransportEnum),
    ])
    .optional(),
  visibility: z
    .union([
      meshVisibilityEnum.transform((v) => [v]),
      z.array(meshVisibilityEnum),
    ])
    .optional(),
  archived: z.coerce.boolean().optional(),
  createdAt: z.tuple([z.coerce.number(), z.coerce.number()]).optional(),
});
export type GetMeshesInput = z.infer<typeof getMeshesInputSchema>;

export const getMeshesResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      visibility: meshVisibilityEnum,
      transport: meshTransportEnum,
      tier: meshTierEnum,
      maxPeers: z.number().nullable(),
      createdAt: z.coerce.date(),
      archivedAt: z.coerce.date().nullable(),
      ownerUserId: z.string(),
      ownerName: z.string().nullable(),
      ownerEmail: z.string().nullable(),
      memberCount: z.number(),
    }),
  ),
  total: z.number(),
});
export type GetMeshesResponse = z.infer<typeof getMeshesResponseSchema>;

export const getMeshResponseSchema = z.object({
  mesh: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      visibility: meshVisibilityEnum,
      transport: meshTransportEnum,
      tier: meshTierEnum,
      maxPeers: z.number().nullable(),
      createdAt: z.coerce.date(),
      archivedAt: z.coerce.date().nullable(),
      ownerUserId: z.string(),
      ownerName: z.string().nullable(),
      ownerEmail: z.string().nullable(),
    })
    .nullable(),
  members: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      peerPubkey: z.string(),
      role: z.enum(["admin", "member"]),
      joinedAt: z.coerce.date(),
      lastSeenAt: z.coerce.date().nullable(),
      revokedAt: z.coerce.date().nullable(),
      userId: z.string().nullable(),
    }),
  ),
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
      connectedAt: z.coerce.date(),
      lastPingAt: z.coerce.date(),
      disconnectedAt: z.coerce.date().nullable(),
    }),
  ),
  invites: z.array(
    z.object({
      id: z.string(),
      token: z.string(),
      maxUses: z.number(),
      usedCount: z.number(),
      role: z.enum(["admin", "member"]),
      expiresAt: z.coerce.date(),
      createdAt: z.coerce.date(),
      revokedAt: z.coerce.date().nullable(),
    }),
  ),
  auditEvents: z.array(
    z.object({
      id: z.string(),
      eventType: z.string(),
      actorPeerId: z.string().nullable(),
      targetPeerId: z.string().nullable(),
      metadata: z.record(z.string(), z.any()),
      createdAt: z.coerce.date(),
    }),
  ),
});
export type GetMeshResponse = z.infer<typeof getMeshResponseSchema>;

// ---------------------------------------------------------------------
// Sessions (live presences across all meshes)
// ---------------------------------------------------------------------

export const presenceStatusEnum = z.enum(["idle", "working", "dnd"]);

export const getSessionsInputSchema = offsetPaginationSchema.extend({
  sort: z
    .string()
    .transform((val) =>
      z.array(sortSchema).parse(JSON.parse(decodeURIComponent(val))),
    )
    .optional(),
  q: z.string().optional(),
  status: z
    .union([presenceStatusEnum.transform((v) => [v]), z.array(presenceStatusEnum)])
    .optional(),
  active: z.coerce.boolean().optional(),
});
export type GetSessionsInput = z.infer<typeof getSessionsInputSchema>;

export const getSessionsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      memberId: z.string(),
      displayName: z.string().nullable(),
      meshId: z.string(),
      meshName: z.string().nullable(),
      meshSlug: z.string().nullable(),
      sessionId: z.string(),
      pid: z.number(),
      cwd: z.string(),
      status: presenceStatusEnum,
      statusSource: z.enum(["hook", "manual", "jsonl"]),
      statusUpdatedAt: z.coerce.date(),
      connectedAt: z.coerce.date(),
      lastPingAt: z.coerce.date(),
      disconnectedAt: z.coerce.date().nullable(),
    }),
  ),
  total: z.number(),
});
export type GetSessionsResponse = z.infer<typeof getSessionsResponseSchema>;

// ---------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------

export const getInvitesInputSchema = offsetPaginationSchema.extend({
  sort: z
    .string()
    .transform((val) =>
      z.array(sortSchema).parse(JSON.parse(decodeURIComponent(val))),
    )
    .optional(),
  q: z.string().optional(),
  revoked: z.coerce.boolean().optional(),
  expired: z.coerce.boolean().optional(),
});
export type GetInvitesInput = z.infer<typeof getInvitesInputSchema>;

export const getInvitesResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      meshId: z.string(),
      meshName: z.string().nullable(),
      meshSlug: z.string().nullable(),
      token: z.string(),
      maxUses: z.number(),
      usedCount: z.number(),
      role: z.enum(["admin", "member"]),
      expiresAt: z.coerce.date(),
      createdAt: z.coerce.date(),
      revokedAt: z.coerce.date().nullable(),
      createdByName: z.string().nullable(),
    }),
  ),
  total: z.number(),
});
export type GetInvitesResponse = z.infer<typeof getInvitesResponseSchema>;

// ---------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------

export const getAuditInputSchema = offsetPaginationSchema.extend({
  sort: z
    .string()
    .transform((val) =>
      z.array(sortSchema).parse(JSON.parse(decodeURIComponent(val))),
    )
    .optional(),
  q: z.string().optional(),
  eventType: z
    .union([z.string().transform((v) => [v]), z.array(z.string())])
    .optional(),
  meshId: z
    .union([z.string().transform((v) => [v]), z.array(z.string())])
    .optional(),
  createdAt: z.tuple([z.coerce.number(), z.coerce.number()]).optional(),
});
export type GetAuditInput = z.infer<typeof getAuditInputSchema>;

export const getAuditResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      meshId: z.string(),
      meshName: z.string().nullable(),
      meshSlug: z.string().nullable(),
      eventType: z.string(),
      actorPeerId: z.string().nullable(),
      targetPeerId: z.string().nullable(),
      metadata: z.record(z.string(), z.any()),
      createdAt: z.coerce.date(),
    }),
  ),
  total: z.number(),
});
export type GetAuditResponse = z.infer<typeof getAuditResponseSchema>;

// ---------------------------------------------------------------------
// Summary counts
// ---------------------------------------------------------------------

export const getMeshSummaryResponseSchema = z.object({
  meshes: z.number(),
  activeMeshes: z.number(),
  totalPresences: z.number(),
  activePresences: z.number(),
  messages24h: z.number(),
});
export type GetMeshSummaryResponse = z.infer<typeof getMeshSummaryResponseSchema>;
