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

/**
 * pgSchema namespace for all mesh/broker tables.
 *
 * Exported under a UNIQUE name (not generic `schema`) to avoid being
 * shadowed by `export * from` barrel merging when another module
 * (chat, image) exports its own `schema` pgSchema. Without this, the
 * TS ambiguous-re-export rule silently drops the `schema` binding,
 * drizzle-kit can't introspect the pgSchema, and `CREATE SCHEMA
 * "mesh"` is never emitted in the generated migration — producing
 * broken migrations for fresh databases.
 *
 * See: pdf.ts for the same pattern (pdfSchema).
 */
export const meshSchema = pgSchema("mesh");

export const meshVisibilityEnum = meshSchema.enum("visibility", [
  "private",
  "public",
]);

export const meshTransportEnum = meshSchema.enum("transport", [
  "managed",
  "tailscale",
  "self_hosted",
]);

export const meshTierEnum = meshSchema.enum("tier", [
  "free",
  "pro",
  "team",
  "enterprise",
]);

export const meshRoleEnum = meshSchema.enum("role", ["admin", "member"]);

export const presenceStatusEnum = meshSchema.enum("presence_status", [
  "idle",
  "working",
  "dnd",
]);

export const presenceStatusSourceEnum = meshSchema.enum("presence_status_source", [
  "hook",
  "manual",
  "jsonl",
]);

export const messagePriorityEnum = meshSchema.enum("message_priority", [
  "now",
  "next",
  "low",
]);

/**
 * A mesh is a peer group of Claude Code sessions that can talk to each
 * other via the broker. Ownership is tied to a user; transport/tier
 * describe how it's hosted and billed.
 */
export const mesh = meshSchema.table("mesh", {
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
  /**
   * ed25519 public key (hex) of the mesh owner / admin signer.
   * Invites are signed by the corresponding secret key and verified
   * by the broker on /join against this column. Nullable for existing
   * rows; required for new meshes.
   */
  ownerPubkey: text(),
  /**
   * ed25519 secret key (hex, 64 bytes) that signs invites server-side.
   *
   * v0.1.0: stored plaintext-at-rest. Acceptable trade-off for a
   * managed-broker SaaS launch — the operator controls the key.
   * v0.2.0 will either (a) encrypt-at-rest with a column-level KEK,
   * or (b) migrate to client-held keys so the server never holds
   * admin material.
   */
  ownerSecretKey: text(),
  /**
   * 32-byte shared key (base64url) used by channels/broadcasts in the
   * mesh. Embedded in invites so joiners can encrypt/decrypt channel
   * traffic. Not used by 1:1 direct messages (those use crypto_box
   * with recipient's ed25519 pubkey).
   */
  rootKey: text(),
  createdAt: timestamp().defaultNow().notNull(),
  archivedAt: timestamp(),
});

/**
 * A member is a peer that has joined a mesh. user_id is nullable to
 * allow anonymous/invite-only peers (identity is the ed25519 pubkey).
 *
 * Note on asymmetric naming: the DB table is `mesh.member` (short,
 * lives in the `mesh` pgSchema) but the TS export is `meshMember`.
 * This is deliberate — `auth.member` also exports a `member` binding,
 * and the schema barrel uses `export *`, which would silently drop
 * one of the two on collision. Unique TS name + short DB name is the
 * cleanest trade-off.
 */
export const meshMember = meshSchema.table("member", {
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
 *
 * `token`       — opaque DB lookup key (the ic:// link's payload)
 * `tokenBytes`  — canonical signed bytes that the broker re-verifies
 *                 against mesh.ownerPubkey on every /join call
 */
export const invite = meshSchema.table("invite", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  meshId: text()
    .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  token: text().notNull().unique(),
  tokenBytes: text(),
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
export const auditLog = meshSchema.table("audit_log", {
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

/**
 * Live WebSocket connection tracking for a member. One presence row per
 * active Claude Code session: created on connect, updated on every
 * heartbeat/hook signal, closed out (disconnectedAt set) on disconnect.
 * Persisted so the broker can resume state after a restart.
 */
export const presence = meshSchema.table("presence", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  memberId: text()
    .references(() => meshMember.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  sessionId: text().notNull(),
  pid: integer().notNull(),
  cwd: text().notNull(),
  status: presenceStatusEnum().notNull().default("idle"),
  statusSource: presenceStatusSourceEnum().notNull().default("jsonl"),
  statusUpdatedAt: timestamp().defaultNow().notNull(),
  connectedAt: timestamp().defaultNow().notNull(),
  lastPingAt: timestamp().defaultNow().notNull(),
  disconnectedAt: timestamp(),
});

/**
 * In-flight E2E-encrypted message envelopes awaiting delivery.
 * The broker only ever sees ciphertext + routing metadata — the
 * nonce+ciphertext pair is sealed with libsodium client-side.
 *
 * `targetSpec` is free-form text and can address: a specific member
 * pubkey (direct message), a channel (`#general`), a tag (`tag:admins`),
 * or a broadcast (`*`). Resolution happens in broker logic, not SQL.
 */
export const messageQueue = meshSchema.table("message_queue", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  meshId: text()
    .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  senderMemberId: text()
    .references(() => meshMember.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  targetSpec: text().notNull(),
  priority: messagePriorityEnum().notNull().default("next"),
  nonce: text().notNull(),
  ciphertext: text().notNull(),
  createdAt: timestamp().defaultNow().notNull(),
  deliveredAt: timestamp(),
  expiresAt: timestamp(),
});

/**
 * First-turn race handler: hook signals that fire BEFORE the peer has
 * a registered mesh.member row get stashed here keyed by (pid, cwd),
 * then applied to the member's presence on register. Swept after TTL.
 *
 * Intentionally NOT linked to member/mesh via FK — the whole point is
 * that no member row exists yet when the hook fires.
 */
export const pendingStatus = meshSchema.table("pending_status", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  pid: integer().notNull(),
  cwd: text().notNull(),
  status: text().notNull(),
  statusSource: text().notNull(),
  createdAt: timestamp().defaultNow().notNull(),
  appliedAt: timestamp(),
});

export const meshRelations = relations(mesh, ({ one, many }) => ({
  owner: one(user, {
    fields: [mesh.ownerUserId],
    references: [user.id],
  }),
  members: many(meshMember),
  invites: many(invite),
  auditLogs: many(auditLog),
  messageQueue: many(messageQueue),
}));

export const meshMemberRelations = relations(meshMember, ({ one, many }) => ({
  mesh: one(mesh, {
    fields: [meshMember.meshId],
    references: [mesh.id],
  }),
  user: one(user, {
    fields: [meshMember.userId],
    references: [user.id],
  }),
  presences: many(presence),
  sentMessages: many(messageQueue),
}));

export const presenceRelations = relations(presence, ({ one }) => ({
  member: one(meshMember, {
    fields: [presence.memberId],
    references: [meshMember.id],
  }),
}));

export const messageQueueRelations = relations(messageQueue, ({ one }) => ({
  mesh: one(mesh, {
    fields: [messageQueue.meshId],
    references: [mesh.id],
  }),
  sender: one(meshMember, {
    fields: [messageQueue.senderMemberId],
    references: [meshMember.id],
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
export const selectMemberSchema = createSelectSchema(meshMember);
export const insertMemberSchema = createInsertSchema(meshMember);
export const selectInviteSchema = createSelectSchema(invite);
export const insertInviteSchema = createInsertSchema(invite);
export const selectAuditLogSchema = createSelectSchema(auditLog);
export const insertAuditLogSchema = createInsertSchema(auditLog);
export const selectPresenceSchema = createSelectSchema(presence);
export const insertPresenceSchema = createInsertSchema(presence);
export const selectMessageQueueSchema = createSelectSchema(messageQueue);
export const insertMessageQueueSchema = createInsertSchema(messageQueue);
export const selectPendingStatusSchema = createSelectSchema(pendingStatus);
export const insertPendingStatusSchema = createInsertSchema(pendingStatus);

export type SelectMesh = typeof mesh.$inferSelect;
export type InsertMesh = typeof mesh.$inferInsert;
export type SelectMember = typeof meshMember.$inferSelect;
export type InsertMember = typeof meshMember.$inferInsert;
export type SelectInvite = typeof invite.$inferSelect;
export type InsertInvite = typeof invite.$inferInsert;
export type SelectAuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;
export type SelectPresence = typeof presence.$inferSelect;
export type InsertPresence = typeof presence.$inferInsert;
export type SelectMessageQueue = typeof messageQueue.$inferSelect;
export type InsertMessageQueue = typeof messageQueue.$inferInsert;
export type SelectPendingStatus = typeof pendingStatus.$inferSelect;
export type InsertPendingStatus = typeof pendingStatus.$inferInsert;
