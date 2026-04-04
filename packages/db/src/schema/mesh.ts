import { relations } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgSchema,
  timestamp,
  text,
} from "drizzle-orm/pg-core";

import { generateId } from "@turbostarter/shared/utils";

import { createInsertSchema, createSelectSchema } from "../utils/drizzle-zod";

import { user } from "./auth";

export const schema = pgSchema("mesh");

export const meshVisibilityEnum = schema.enum("visibility", [
  "private",
  "public",
]);

export const meshTransportEnum = schema.enum("transport", [
  "managed",
  "tailscale",
  "self_hosted",
]);

export const meshTierEnum = schema.enum("tier", [
  "free",
  "pro",
  "team",
  "enterprise",
]);

export const meshRoleEnum = schema.enum("role", ["admin", "member"]);

/**
 * A mesh is a peer group of Claude Code sessions that can talk to each
 * other via the broker. Ownership is tied to a user; transport/tier
 * describe how it's hosted and billed.
 */
export const mesh = schema.table("mesh", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  name: text().notNull(),
  slug: text().notNull().unique(),
  ownerUserId: text()
    .references(() => user.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  visibility: meshVisibilityEnum().notNull().default("private"),
  transport: meshTransportEnum().notNull().default("managed"),
  maxPeers: integer(),
  tier: meshTierEnum().notNull().default("free"),
  createdAt: timestamp().defaultNow().notNull(),
  archivedAt: timestamp(),
});

/**
 * A member is a peer that has joined a mesh. user_id is nullable to
 * allow anonymous/invite-only peers (identity is the ed25519 pubkey).
 */
export const member = schema.table("member", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  meshId: text()
    .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  userId: text().references(() => user.id, {
    onDelete: "set null",
    onUpdate: "cascade",
  }),
  peerPubkey: text().notNull(),
  displayName: text().notNull(),
  role: meshRoleEnum().notNull().default("member"),
  joinedAt: timestamp().defaultNow().notNull(),
  lastSeenAt: timestamp(),
  revokedAt: timestamp(),
});

/**
 * Invite tokens used to join a mesh via shareable URL.
 */
export const invite = schema.table("invite", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  meshId: text()
    .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  token: text().notNull().unique(),
  maxUses: integer().notNull().default(1),
  usedCount: integer().notNull().default(0),
  role: meshRoleEnum().notNull().default("member"),
  expiresAt: timestamp().notNull(),
  createdBy: text()
    .references(() => user.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  createdAt: timestamp().defaultNow().notNull(),
  revokedAt: timestamp(),
});

/**
 * Metadata-only audit log. NEVER stores message content — every
 * payload between peers is E2E encrypted client-side (libsodium), so
 * the broker/DB only ever see ciphertext + routing events.
 */
export const auditLog = schema.table("audit_log", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  meshId: text()
    .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  eventType: text().notNull(),
  actorPeerId: text(),
  targetPeerId: text(),
  metadata: jsonb().notNull().default({}),
  createdAt: timestamp().defaultNow().notNull(),
});

export const meshRelations = relations(mesh, ({ one, many }) => ({
  owner: one(user, {
    fields: [mesh.ownerUserId],
    references: [user.id],
  }),
  members: many(member),
  invites: many(invite),
  auditLogs: many(auditLog),
}));

export const memberRelations = relations(member, ({ one }) => ({
  mesh: one(mesh, {
    fields: [member.meshId],
    references: [mesh.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const inviteRelations = relations(invite, ({ one }) => ({
  mesh: one(mesh, {
    fields: [invite.meshId],
    references: [mesh.id],
  }),
  creator: one(user, {
    fields: [invite.createdBy],
    references: [user.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  mesh: one(mesh, {
    fields: [auditLog.meshId],
    references: [mesh.id],
  }),
}));

export const selectMeshSchema = createSelectSchema(mesh);
export const insertMeshSchema = createInsertSchema(mesh);
export const selectMemberSchema = createSelectSchema(member);
export const insertMemberSchema = createInsertSchema(member);
export const selectInviteSchema = createSelectSchema(invite);
export const insertInviteSchema = createInsertSchema(invite);
export const selectAuditLogSchema = createSelectSchema(auditLog);
export const insertAuditLogSchema = createInsertSchema(auditLog);

export type SelectMesh = typeof mesh.$inferSelect;
export type InsertMesh = typeof mesh.$inferInsert;
export type SelectMember = typeof member.$inferSelect;
export type InsertMember = typeof member.$inferInsert;
export type SelectInvite = typeof invite.$inferSelect;
export type InsertInvite = typeof invite.$inferInsert;
export type SelectAuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;
