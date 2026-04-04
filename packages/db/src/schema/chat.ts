import { relations } from "drizzle-orm";
import { integer, jsonb, pgSchema, timestamp, text } from "drizzle-orm/pg-core";

import { generateId } from "@turbostarter/shared/utils";

import { createInsertSchema, createSelectSchema } from "../utils/drizzle-zod";

import { user } from "./auth";

// Uniquely-named pgSchema export (not `schema`) so drizzle-kit can
// introspect it through the `export * from "./chat"` barrel. See
// mesh.ts for the full rationale.
export const chatSchema = pgSchema("chat");

export const messageRoleEnum = chatSchema.enum("role", [
  "system",
  "assistant",
  "user",
]);

export const chat = chatSchema.table("chat", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  name: text(),
  userId: text()
    .references(() => user.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    })
    .notNull(),
  createdAt: timestamp().defaultNow(),
});

export const message = chatSchema.table("message", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  chatId: text()
    .references(() => chat.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  role: messageRoleEnum().notNull(),
  createdAt: timestamp().defaultNow(),
});

export const messageRelations = relations(message, ({ many }) => ({
  part: many(part),
}));

export const part = chatSchema.table("part", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  messageId: text()
    .references(() => message.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  type: text().notNull(),
  order: integer().notNull(),
  details: jsonb().notNull(),
  createdAt: timestamp().defaultNow(),
});

export const partRelations = relations(part, ({ one }) => ({
  message: one(message, {
    fields: [part.messageId],
    references: [message.id],
  }),
}));

export const selectChatSchema = createSelectSchema(chat);
export const insertChatSchema = createInsertSchema(chat);
export const selectMessageSchema = createSelectSchema(message);
export const insertMessageSchema = createInsertSchema(message);
export const selectPartSchema = createSelectSchema(part);
export const insertPartSchema = createInsertSchema(part);

export type SelectChat = typeof chat.$inferSelect;
export type InsertChat = typeof chat.$inferInsert;
export type SelectMessage = typeof message.$inferSelect;
export type InsertMessage = typeof message.$inferInsert;
export type SelectPart = typeof part.$inferSelect;
export type InsertPart = typeof part.$inferInsert;
