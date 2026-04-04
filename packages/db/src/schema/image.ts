import { relations } from "drizzle-orm";
import { pgSchema, text, timestamp, integer } from "drizzle-orm/pg-core";

import { generateId } from "@turbostarter/shared/utils";

import { createInsertSchema, createSelectSchema } from "../utils/drizzle-zod";

import { user } from "./auth";

export const schema = pgSchema("image");

export const aspectRatioEnum = schema.enum("aspect_ratio", [
  "square",
  "standard",
  "landscape",
  "portrait",
]);

export const generation = schema.table("generation", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  prompt: text().notNull(),
  model: text().notNull(),
  aspectRatio: aspectRatioEnum().default("square").notNull(),
  count: integer().default(1).notNull(),
  userId: text()
    .references(() => user.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    })
    .notNull(),
  createdAt: timestamp().defaultNow(),
  completedAt: timestamp(),
});

export const generationRelations = relations(generation, ({ many }) => ({
  image: many(image),
}));

export const image = schema.table("image", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  generationId: text()
    .references(() => generation.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    })
    .notNull(),
  url: text().notNull(),
  createdAt: timestamp().defaultNow(),
});

export const imageRelations = relations(image, ({ one }) => ({
  generation: one(generation, {
    fields: [image.generationId],
    references: [generation.id],
  }),
}));

export const selectGenerationSchema = createSelectSchema(generation);
export const insertGenerationSchema = createInsertSchema(generation);
export const selectImageSchema = createSelectSchema(image);
export const insertImageSchema = createInsertSchema(image);

export type SelectGeneration = typeof generation.$inferSelect;
export type InsertGeneration = typeof generation.$inferInsert;
export type SelectImage = typeof image.$inferSelect;
export type InsertImage = typeof image.$inferInsert;
