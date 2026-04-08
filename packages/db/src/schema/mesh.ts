import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgSchema,
  timestamp,
  text,
  uniqueIndex,
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
 * Signed, hash-chained audit log. NEVER stores message content — every
 * payload between peers is E2E encrypted client-side (libsodium), so
 * the broker/DB only ever see ciphertext + routing events.
 *
 * Each entry includes a SHA-256 hash of the previous entry's hash,
 * forming a tamper-evident chain per mesh. If any row is modified,
 * all subsequent hashes break — detectable via verifyChain().
 *
 * This table is append-only: no UPDATE or DELETE operations.
 */
export const auditLog = meshSchema.table("audit_log", {
  /** Serial-like integer PK for ordering. */
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  meshId: text()
    .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  eventType: text().notNull(),
  actorMemberId: text(),
  actorDisplayName: text(),
  payload: jsonb().notNull().default({}),
  prevHash: text().notNull(),
  hash: text().notNull(),
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
  sessionPubkey: text(),
  displayName: text(),
  pid: integer().notNull(),
  cwd: text().notNull(),
  status: presenceStatusEnum().notNull().default("idle"),
  statusSource: presenceStatusSourceEnum().notNull().default("jsonl"),
  statusUpdatedAt: timestamp().defaultNow().notNull(),
  summary: text(),
  groups: jsonb().$type<Array<{ name: string; role?: string }>>().default([]),
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
  senderSessionPubkey: text(),
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

/**
 * Shared key-value state scoped to a mesh. Any peer can read/write.
 * Changes push to all connected peers in real time.
 */
export const meshState = meshSchema.table(
  "state",
  {
    id: text().primaryKey().notNull().$defaultFn(generateId),
    meshId: text()
      .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    key: text().notNull(),
    value: jsonb().notNull(),
    updatedByPresence: text(),
    updatedByName: text(),
    updatedAt: timestamp().defaultNow().notNull(),
  },
  (table) => [uniqueIndex("state_mesh_key_idx").on(table.meshId, table.key)],
);

/**
 * Persistent shared memory for a mesh. Full-text searchable via a
 * tsvector generated column + GIN index added in raw SQL migration.
 */
export const meshMemory = meshSchema.table("memory", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  meshId: text()
    .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  content: text().notNull(),
  tags: text().array().default([]),
  rememberedBy: text().references(() => meshMember.id),
  rememberedByName: text(),
  rememberedAt: timestamp().defaultNow().notNull(),
  forgottenAt: timestamp(),
});

/**
 * File metadata for shared files in a mesh. Actual bytes live in MinIO;
 * this table tracks ownership, access control, and soft-deletion.
 */
export const meshFile = meshSchema.table("file", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  meshId: text()
    .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  name: text().notNull(),
  sizeBytes: integer().notNull(),
  mimeType: text(),
  minioKey: text().notNull(),
  tags: text().array().default([]),
  persistent: boolean().notNull().default(true),
  encrypted: boolean().notNull().default(false),
  ownerPubkey: text(),
  uploadedByName: text(),
  uploadedByMember: text().references(() => meshMember.id),
  targetSpec: text(), // null = entire mesh
  uploadedAt: timestamp().defaultNow().notNull(),
  expiresAt: timestamp(),
  deletedAt: timestamp(),
});

/**
 * Access log for file downloads. Tracks which peer accessed which file
 * and when, for auditability and read-receipt semantics.
 */
export const meshFileAccess = meshSchema.table("file_access", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  fileId: text()
    .references(() => meshFile.id, { onDelete: "cascade" })
    .notNull(),
  peerSessionPubkey: text(),
  peerName: text(),
  accessedAt: timestamp().defaultNow().notNull(),
});

/**
 * Per-peer encrypted symmetric keys for E2E encrypted files.
 * The file body is encrypted with a random key (Kf); Kf is sealed
 * (crypto_box_seal) to each authorized peer's X25519 pubkey and stored here.
 */
export const meshFileKey = meshSchema.table("file_key", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  fileId: text()
    .references(() => meshFile.id, { onDelete: "cascade" })
    .notNull(),
  peerPubkey: text().notNull(),
  sealedKey: text().notNull(),
  grantedAt: timestamp().defaultNow().notNull(),
  grantedByPubkey: text(),
});

export const meshFileKeyRelations = relations(meshFileKey, ({ one }) => ({
  file: one(meshFile, {
    fields: [meshFileKey.fileId],
    references: [meshFile.id],
  }),
}));

/**
 * Per-peer context snapshot. Each peer (member) has at most one context
 * entry per mesh, upserted on each share_context call. Allows peers to
 * discover what others are working on, which files they've read, and
 * key findings — without sending a direct message.
 *
 * `memberId` is the stable upsert key (survives reconnects). `presenceId`
 * is kept for backwards-compat but is nullable — new rows should always
 * populate `memberId`. The unique index on (meshId, memberId) prevents
 * stale rows from accumulating when a session reconnects with a new
 * ephemeral presenceId.
 */
export const meshContext = meshSchema.table(
  "context",
  {
    id: text().primaryKey().notNull().$defaultFn(generateId),
    meshId: text()
      .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    memberId: text().references(() => meshMember.id, { onDelete: "cascade", onUpdate: "cascade" }),
    presenceId: text().references(() => presence.id, { onDelete: "cascade" }),
    peerName: text(),
    summary: text().notNull(),
    filesRead: text().array().default([]),
    keyFindings: text().array().default([]),
    tags: text().array().default([]),
    updatedAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("context_mesh_member_idx").on(table.meshId, table.memberId),
  ],
);

/**
 * Mesh-scoped task board. Peers can create tasks, claim them, and mark
 * them done. Lightweight project management for multi-agent workflows.
 */
export const meshTask = meshSchema.table("task", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  meshId: text()
    .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  title: text().notNull(),
  assignee: text(),
  claimedByName: text(),
  claimedByPresence: text().references(() => presence.id),
  priority: text().notNull().default("normal"),
  status: text().notNull().default("open"),
  tags: text().array().default([]),
  result: text(),
  createdByName: text(),
  createdAt: timestamp().defaultNow().notNull(),
  claimedAt: timestamp(),
  completedAt: timestamp(),
});

/**
 * Named real-time data channels within a mesh. One peer publishes, all
 * subscribers receive. No message history — streams are live.
 * Use cases: build logs, deploy status, monitoring data, live code diffs.
 */
export const meshStream = meshSchema.table(
  "stream",
  {
    id: text().primaryKey().notNull().$defaultFn(generateId),
    meshId: text()
      .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    name: text().notNull(),
    createdByName: text(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [uniqueIndex("stream_mesh_name_idx").on(table.meshId, table.name)],
);

/**
 * Reusable skills (instructions/capabilities) shared across a mesh.
 * Peers publish skills so other peers can discover and load them.
 * Skills are scoped to a mesh and unique by (meshId, name).
 */
export const meshSkill = meshSchema.table(
  "skill",
  {
    id: text().primaryKey().notNull().$defaultFn(generateId),
    meshId: text()
      .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    name: text().notNull(),
    description: text().notNull(),
    instructions: text().notNull(),
    tags: text().array().default([]),
    authorMemberId: text().references(() => meshMember.id),
    authorName: text(),
    sourceType: text().default("inline"),
    bundleFileId: text().references(() => meshFile.id),
    gitUrl: text(),
    gitBranch: text().default("main"),
    gitSha: text(),
    manifest: jsonb(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp().defaultNow().notNull(),
  },
  (table) => [uniqueIndex("skill_mesh_name_idx").on(table.meshId, table.name)],
);

/**
 * Persistent scheduled messages. Survives broker restarts — on boot the
 * broker loads all non-cancelled, non-expired rows and re-arms timers.
 * Supports both one-shot (deliverAt) and recurring (cron expression).
 */
/**
 * Inbound webhooks: external services POST to a broker endpoint and the
 * payload is pushed to all connected mesh peers as a "webhook" push.
 */
export const meshWebhook = meshSchema.table(
  "webhook",
  {
    id: text().primaryKey().notNull().$defaultFn(generateId),
    meshId: text()
      .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    name: text().notNull(),
    secret: text().notNull(),
    active: boolean().notNull().default(true),
    createdBy: text()
      .references(() => meshMember.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [uniqueIndex("webhook_mesh_name_idx").on(table.meshId, table.name)],
);

export const meshService = meshSchema.table(
  "service",
  {
    id: text().primaryKey().notNull().$defaultFn(generateId),
    meshId: text()
      .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    name: text().notNull(),
    type: text().notNull(),
    sourceType: text().notNull(),
    sourceFileId: text().references(() => meshFile.id),
    sourceGitUrl: text(),
    sourceGitBranch: text().default("main"),
    sourceGitSha: text(),
    prevGitSha: text(),
    description: text().notNull(),
    instructions: text(),
    toolsSchema: jsonb(),
    manifest: jsonb(),
    runtime: text(),
    status: text().default("stopped"),
    config: jsonb().default({}),
    lastHealth: timestamp(),
    restartCount: integer().default(0),
    version: integer().default(1),
    scope: jsonb().default({ type: "peer" }),
    deployedBy: text().references(() => meshMember.id),
    deployedByName: text(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp().defaultNow().notNull(),
  },
  (table) => [uniqueIndex("service_mesh_name_idx").on(table.meshId, table.name)],
);

export const meshVaultEntry = meshSchema.table(
  "vault_entry",
  {
    id: text().primaryKey().notNull().$defaultFn(generateId),
    meshId: text()
      .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    memberId: text()
      .references(() => meshMember.id)
      .notNull(),
    key: text().notNull(),
    ciphertext: text().notNull(),
    nonce: text().notNull(),
    sealedKey: text().notNull(),
    entryType: text().default("env"),
    mountPath: text(),
    description: text(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp().defaultNow().notNull(),
  },
  (table) => [uniqueIndex("vault_entry_mesh_member_key_idx").on(table.meshId, table.memberId, table.key)],
);

export const meshWebhookRelations = relations(meshWebhook, ({ one }) => ({
  mesh: one(mesh, {
    fields: [meshWebhook.meshId],
    references: [mesh.id],
  }),
  creator: one(meshMember, {
    fields: [meshWebhook.createdBy],
    references: [meshMember.id],
  }),
}));

export const selectMeshWebhookSchema = createSelectSchema(meshWebhook);
export const insertMeshWebhookSchema = createInsertSchema(meshWebhook);
export type SelectMeshWebhook = typeof meshWebhook.$inferSelect;
export type InsertMeshWebhook = typeof meshWebhook.$inferInsert;

export const scheduledMessage = meshSchema.table("scheduled_message", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  meshId: text()
    .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  /** Nullable — the presence that created it may be gone after a restart. */
  presenceId: text(),
  memberId: text()
    .references(() => meshMember.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  to: text().notNull(),
  message: text().notNull(),
  /** Unix timestamp (ms) for one-shot delivery. Null for cron-only entries. */
  deliverAt: timestamp(),
  /** 5-field cron expression for recurring delivery. Null for one-shot. */
  cron: text(),
  subtype: text(),
  firedCount: integer().notNull().default(0),
  cancelled: boolean().notNull().default(false),
  firedAt: timestamp(),
  createdAt: timestamp().defaultNow().notNull(),
});

export const scheduledMessageRelations = relations(scheduledMessage, ({ one }) => ({
  mesh: one(mesh, {
    fields: [scheduledMessage.meshId],
    references: [mesh.id],
  }),
  member: one(meshMember, {
    fields: [scheduledMessage.memberId],
    references: [meshMember.id],
  }),
}));

export const selectScheduledMessageSchema = createSelectSchema(scheduledMessage);
export const insertScheduledMessageSchema = createInsertSchema(scheduledMessage);
export type SelectScheduledMessage = typeof scheduledMessage.$inferSelect;
export type InsertScheduledMessage = typeof scheduledMessage.$inferInsert;

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

export const meshStateRelations = relations(meshState, ({ one }) => ({
  mesh: one(mesh, {
    fields: [meshState.meshId],
    references: [mesh.id],
  }),
}));

export const meshMemoryRelations = relations(meshMemory, ({ one }) => ({
  mesh: one(mesh, {
    fields: [meshMemory.meshId],
    references: [mesh.id],
  }),
  member: one(meshMember, {
    fields: [meshMemory.rememberedBy],
    references: [meshMember.id],
  }),
}));

export const meshFileRelations = relations(meshFile, ({ one, many }) => ({
  mesh: one(mesh, {
    fields: [meshFile.meshId],
    references: [mesh.id],
  }),
  uploader: one(meshMember, {
    fields: [meshFile.uploadedByMember],
    references: [meshMember.id],
  }),
  accesses: many(meshFileAccess),
}));

export const meshFileAccessRelations = relations(meshFileAccess, ({ one }) => ({
  file: one(meshFile, {
    fields: [meshFileAccess.fileId],
    references: [meshFile.id],
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
export const selectMeshStateSchema = createSelectSchema(meshState);
export const insertMeshStateSchema = createInsertSchema(meshState);
export const selectMeshMemorySchema = createSelectSchema(meshMemory);
export const insertMeshMemorySchema = createInsertSchema(meshMemory);
export type SelectMeshState = typeof meshState.$inferSelect;
export type InsertMeshState = typeof meshState.$inferInsert;
export type SelectMeshMemory = typeof meshMemory.$inferSelect;
export type InsertMeshMemory = typeof meshMemory.$inferInsert;
export const selectMeshFileSchema = createSelectSchema(meshFile);
export const insertMeshFileSchema = createInsertSchema(meshFile);
export const selectMeshFileAccessSchema = createSelectSchema(meshFileAccess);
export const insertMeshFileAccessSchema = createInsertSchema(meshFileAccess);
export type SelectMeshFile = typeof meshFile.$inferSelect;
export type InsertMeshFile = typeof meshFile.$inferInsert;
export type SelectMeshFileAccess = typeof meshFileAccess.$inferSelect;
export type InsertMeshFileAccess = typeof meshFileAccess.$inferInsert;
export const selectMeshFileKeySchema = createSelectSchema(meshFileKey);
export const insertMeshFileKeySchema = createInsertSchema(meshFileKey);
export type SelectMeshFileKey = typeof meshFileKey.$inferSelect;
export type InsertMeshFileKey = typeof meshFileKey.$inferInsert;
export const selectMeshContextSchema = createSelectSchema(meshContext);
export const insertMeshContextSchema = createInsertSchema(meshContext);
export const selectMeshTaskSchema = createSelectSchema(meshTask);
export const insertMeshTaskSchema = createInsertSchema(meshTask);
export type SelectMeshContext = typeof meshContext.$inferSelect;
export type InsertMeshContext = typeof meshContext.$inferInsert;
export type SelectMeshTask = typeof meshTask.$inferSelect;
export type InsertMeshTask = typeof meshTask.$inferInsert;

export const meshContextRelations = relations(meshContext, ({ one }) => ({
  mesh: one(mesh, {
    fields: [meshContext.meshId],
    references: [mesh.id],
  }),
  presence: one(presence, {
    fields: [meshContext.presenceId],
    references: [presence.id],
  }),
}));

export const meshTaskRelations = relations(meshTask, ({ one }) => ({
  mesh: one(mesh, {
    fields: [meshTask.meshId],
    references: [mesh.id],
  }),
  claimedPresence: one(presence, {
    fields: [meshTask.claimedByPresence],
    references: [presence.id],
  }),
}));

export const meshStreamRelations = relations(meshStream, ({ one }) => ({
  mesh: one(mesh, {
    fields: [meshStream.meshId],
    references: [mesh.id],
  }),
}));

export const selectMeshStreamSchema = createSelectSchema(meshStream);
export const insertMeshStreamSchema = createInsertSchema(meshStream);
export type SelectMeshStream = typeof meshStream.$inferSelect;
export type InsertMeshStream = typeof meshStream.$inferInsert;

/**
 * Persisted peer session state. Survives disconnects — when a peer
 * reconnects (same meshId + memberId), the broker restores groups,
 * profile, visibility, summary, and cumulative stats automatically.
 * Keyed by (meshId, memberId) — one row per member per mesh.
 */
export const peerState = meshSchema.table(
  "peer_state",
  {
    id: text().primaryKey().notNull().$defaultFn(generateId),
    meshId: text()
      .references(() => mesh.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    memberId: text()
      .references(() => meshMember.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    groups: jsonb().$type<Array<{ name: string; role?: string }>>().default([]),
    profile: jsonb().$type<{ avatar?: string; title?: string; bio?: string; capabilities?: string[] }>().default({}),
    visible: boolean().notNull().default(true),
    lastSummary: text(),
    lastDisplayName: text(),
    cumulativeStats: jsonb().$type<{ messagesIn: number; messagesOut: number; toolCalls: number; errors: number }>().default({ messagesIn: 0, messagesOut: 0, toolCalls: 0, errors: 0 }),
    lastSeenAt: timestamp(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("peer_state_mesh_member_idx").on(table.meshId, table.memberId),
  ],
);

export const peerStateRelations = relations(peerState, ({ one }) => ({
  mesh: one(mesh, {
    fields: [peerState.meshId],
    references: [mesh.id],
  }),
  member: one(meshMember, {
    fields: [peerState.memberId],
    references: [meshMember.id],
  }),
}));

export const selectPeerStateSchema = createSelectSchema(peerState);
export const insertPeerStateSchema = createInsertSchema(peerState);
export type SelectPeerState = typeof peerState.$inferSelect;
export type InsertPeerState = typeof peerState.$inferInsert;

export const meshSkillRelations = relations(meshSkill, ({ one }) => ({
  mesh: one(mesh, {
    fields: [meshSkill.meshId],
    references: [mesh.id],
  }),
  author: one(meshMember, {
    fields: [meshSkill.authorMemberId],
    references: [meshMember.id],
  }),
  bundleFile: one(meshFile, {
    fields: [meshSkill.bundleFileId],
    references: [meshFile.id],
  }),
}));

export const selectMeshSkillSchema = createSelectSchema(meshSkill);
export const insertMeshSkillSchema = createInsertSchema(meshSkill);
export type SelectMeshSkill = typeof meshSkill.$inferSelect;
export type InsertMeshSkill = typeof meshSkill.$inferInsert;

export const meshServiceRelations = relations(meshService, ({ one }) => ({
  mesh: one(mesh, { fields: [meshService.meshId], references: [mesh.id] }),
  sourceFile: one(meshFile, { fields: [meshService.sourceFileId], references: [meshFile.id] }),
  deployer: one(meshMember, { fields: [meshService.deployedBy], references: [meshMember.id] }),
}));

export const selectMeshServiceSchema = createSelectSchema(meshService);
export const insertMeshServiceSchema = createInsertSchema(meshService);
export type SelectMeshService = typeof meshService.$inferSelect;
export type InsertMeshService = typeof meshService.$inferInsert;

export const meshVaultEntryRelations = relations(meshVaultEntry, ({ one }) => ({
  mesh: one(mesh, { fields: [meshVaultEntry.meshId], references: [mesh.id] }),
  member: one(meshMember, { fields: [meshVaultEntry.memberId], references: [meshMember.id] }),
}));

export const selectMeshVaultEntrySchema = createSelectSchema(meshVaultEntry);
export const insertMeshVaultEntrySchema = createInsertSchema(meshVaultEntry);
export type SelectMeshVaultEntry = typeof meshVaultEntry.$inferSelect;
export type InsertMeshVaultEntry = typeof meshVaultEntry.$inferInsert;
