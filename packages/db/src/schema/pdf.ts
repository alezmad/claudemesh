import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgSchema,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

import { generateId } from "@turbostarter/shared/utils";

import { createInsertSchema, createSelectSchema } from "../utils/drizzle-zod";

import { user } from "./auth";

// PDF-specific schema (separate from chat schema)
export const pdfSchema = pgSchema("pdf");

export const pdfMessageRoleEnum = pdfSchema.enum("role", [
  "user",
  "assistant",
  "system",
]);

/**
 * Document processing status enum
 * Tracks the state of embedding generation for RAG
 */
export const pdfProcessingStatusEnum = pdfSchema.enum("processing_status", [
  "pending", // Just uploaded, processing not started
  "processing", // Dual-resolution chunking in progress
  "ready", // Embeddings generated, searchable
  "failed", // Processing failed
]);

export const pdfChat = pdfSchema.table("chat", {
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

export const pdfMessage = pdfSchema.table("message", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  chatId: text()
    .references(() => pdfChat.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  content: text().notNull(),
  role: pdfMessageRoleEnum().notNull(),
  createdAt: timestamp().defaultNow(),
});

export const pdfDocument = pdfSchema.table("document", {
  id: text().primaryKey().notNull().$defaultFn(generateId),
  chatId: text()
    .references(() => pdfChat.id, { onDelete: "cascade", onUpdate: "cascade" })
    .notNull(),
  name: text().notNull(),
  path: text().notNull(),
  /** Processing status for embedding generation */
  processingStatus: pdfProcessingStatusEnum().default("pending").notNull(),
  /** Error message if processing failed */
  processingError: text(),
  createdAt: timestamp().defaultNow(),
});

export const pdfEmbedding = pdfSchema.table(
  "embedding",
  {
    id: text().primaryKey().notNull().$defaultFn(generateId),
    documentId: text()
      .references(() => pdfDocument.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      })
      .notNull(),
    content: text().notNull(),
    embedding: vector({ dimensions: 1536 }).notNull(),
    // Citation metadata for page navigation
    pageNumber: integer(),
    charStart: integer(),
    charEnd: integer(),
    sectionTitle: text(),
    createdAt: timestamp().defaultNow(),
  },
  (table) => ({
    embeddingIndex: index("pdf_embeddingIndex").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  }),
);

export const pdfEmbeddingRelations = relations(pdfEmbedding, ({ one }) => ({
  document: one(pdfDocument, {
    fields: [pdfEmbedding.documentId],
    references: [pdfDocument.id],
  }),
}));

// =============================================================================
// DUAL-RESOLUTION CHUNKING (WF-0028)
// =============================================================================

/**
 * Unit type enum for citation units
 */
export const pdfUnitTypeEnum = pdfSchema.enum("unit_type", [
  "prose",
  "heading",
  "list",
  "table",
  "code",
]);

/**
 * Retrieval chunks: semantic units for vector search
 * Groups 3-5 citation units for efficient embedding search
 */
export const pdfRetrievalChunk = pdfSchema.table(
  "retrieval_chunk",
  {
    id: text().primaryKey().notNull().$defaultFn(generateId),
    documentId: text()
      .references(() => pdfDocument.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      })
      .notNull(),

    // Content (concatenated from citation units)
    content: text().notNull(),

    // Embedding for vector search
    embedding: vector({ dimensions: 1536 }),

    // Boundaries
    pageStart: integer().notNull(),
    pageEnd: integer().notNull(),

    // Semantic context
    sectionHierarchy: text().array(),
    chunkType: text().default("prose"),

    createdAt: timestamp().defaultNow(),
  },
  (table) => ({
    documentIdx: index("idx_rc_document").on(table.documentId),
    embeddingIdx: index("idx_rc_embedding").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  }),
);

/**
 * Citation units: paragraph-level with precise bounding boxes
 * Each unit is a single paragraph with exact position for pixel-perfect highlighting
 */
export const pdfCitationUnit = pdfSchema.table(
  "citation_unit",
  {
    id: text().primaryKey().notNull().$defaultFn(generateId),
    documentId: text()
      .references(() => pdfDocument.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      })
      .notNull(),
    retrievalChunkId: text().references(() => pdfRetrievalChunk.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),

    // Content
    content: text().notNull(),

    // Position (precise)
    pageNumber: integer().notNull(),
    paragraphIndex: integer().notNull(), // 0-based within page
    charStart: integer().notNull(), // Within page text
    charEnd: integer().notNull(),

    // Bounding box (for pixel-perfect highlighting)
    bboxX: real(),
    bboxY: real(),
    bboxWidth: real(),
    bboxHeight: real(),

    // Metadata
    sectionTitle: text(),
    unitType: pdfUnitTypeEnum().default("prose"),

    createdAt: timestamp().defaultNow(),
  },
  (table) => ({
    documentIdx: index("idx_cu_document").on(table.documentId),
    retrievalIdx: index("idx_cu_retrieval").on(table.retrievalChunkId),
    pageIdx: index("idx_cu_page").on(table.documentId, table.pageNumber),
    uniqueParaIdx: uniqueIndex("idx_cu_unique").on(
      table.documentId,
      table.pageNumber,
      table.paragraphIndex,
    ),
  }),
);

// Relations for dual-resolution tables
export const pdfRetrievalChunkRelations = relations(
  pdfRetrievalChunk,
  ({ one, many }) => ({
    document: one(pdfDocument, {
      fields: [pdfRetrievalChunk.documentId],
      references: [pdfDocument.id],
    }),
    citationUnits: many(pdfCitationUnit),
  }),
);

export const pdfCitationUnitRelations = relations(
  pdfCitationUnit,
  ({ one }) => ({
    document: one(pdfDocument, {
      fields: [pdfCitationUnit.documentId],
      references: [pdfDocument.id],
    }),
    retrievalChunk: one(pdfRetrievalChunk, {
      fields: [pdfCitationUnit.retrievalChunkId],
      references: [pdfRetrievalChunk.id],
    }),
  }),
);

export const selectPdfChatSchema = createSelectSchema(pdfChat);
export const insertPdfChatSchema = createInsertSchema(pdfChat);
export const selectPdfMessageSchema = createSelectSchema(pdfMessage);
export const insertPdfMessageSchema = createInsertSchema(pdfMessage);
export const selectPdfDocumentSchema = createSelectSchema(pdfDocument);
export const insertPdfDocumentSchema = createInsertSchema(pdfDocument);
export const selectPdfEmbeddingSchema = createSelectSchema(pdfEmbedding);
export const insertPdfEmbeddingSchema = createInsertSchema(pdfEmbedding);

export type SelectPdfChat = typeof pdfChat.$inferSelect;
export type InsertPdfChat = typeof pdfChat.$inferInsert;
export type SelectPdfMessage = typeof pdfMessage.$inferSelect;
export type InsertPdfMessage = typeof pdfMessage.$inferInsert;
export type SelectPdfDocument = typeof pdfDocument.$inferSelect;
export type InsertPdfDocument = typeof pdfDocument.$inferInsert;
export type SelectPdfEmbedding = typeof pdfEmbedding.$inferSelect;
export type InsertPdfEmbedding = typeof pdfEmbedding.$inferInsert;

// Dual-resolution schemas and types
export const selectPdfRetrievalChunkSchema =
  createSelectSchema(pdfRetrievalChunk);
export const insertPdfRetrievalChunkSchema =
  createInsertSchema(pdfRetrievalChunk);
export const selectPdfCitationUnitSchema = createSelectSchema(pdfCitationUnit);
export const insertPdfCitationUnitSchema = createInsertSchema(pdfCitationUnit);

export type SelectPdfRetrievalChunk = typeof pdfRetrievalChunk.$inferSelect;
export type InsertPdfRetrievalChunk = typeof pdfRetrievalChunk.$inferInsert;
export type SelectPdfCitationUnit = typeof pdfCitationUnit.$inferSelect;
export type InsertPdfCitationUnit = typeof pdfCitationUnit.$inferInsert;
