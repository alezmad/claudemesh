import { Hono } from "hono";
import * as z from "zod";

import { Credits } from "@turbostarter/ai/credits/utils";
import {
  createChat,
  deleteChat,
  getChat,
  getChatDocuments,
  getChatMessages,
  getDocument,
  getUserChats,
  streamChatWithDocuments,
} from "@turbostarter/ai/pdf/api";
import { pdfMessageSchema } from "@turbostarter/ai/pdf/schema";
import {
  searchWithCitations,
  getCitationUnitsForChunk,
  getCitationUnitById,
} from "@turbostarter/ai/pdf/search";
import {
  insertPdfChatSchema,
  insertPdfDocumentSchema,
} from "@turbostarter/db/schema/pdf";

import { deductCredits, enforceAuth, rateLimiter, validate } from "../../middleware";

import type { User } from "@turbostarter/auth";

const createChatSchema = z.object({
  ...insertPdfChatSchema.omit({ userId: true }).shape,
  ...insertPdfDocumentSchema.omit({ chatId: true }).shape,
});

type _CreateChatInput = z.infer<typeof createChatSchema>;

// ============================================================================
// Search Schemas
// ============================================================================

const searchInputSchema = z.object({
  query: z.string().min(1),
  documentId: z.string(),
  limit: z.number().min(1).max(20).optional(),
  threshold: z.number().min(0).max(1).optional(),
});

type _SearchInput = z.infer<typeof searchInputSchema>;

const chatsRouter = new Hono<{
  Variables: {
    user: User;
  };
}>()
  .post(
    "/",
    enforceAuth,
    rateLimiter,
    validate("json", createChatSchema),
    async (c) => {
      const input = c.req.valid("json");

      // Deduct credits
      await deductCredits(Credits.COST.DEFAULT, "pdf-chat")(c, async () => { /* noop */ });

      return c.json(
        await createChat({
          ...input,
          userId: c.var.user.id,
        }),
      );
    },
  )
  .get("/", enforceAuth, async (c) => c.json(await getUserChats(c.var.user.id)))
  .get("/:id", enforceAuth, async (c) =>
    c.json((await getChat(c.req.param("id"))) ?? null),
  )
  .delete("/:id", enforceAuth, async (c) =>
    c.json(await deleteChat(c.req.param("id"))),
  )
  .post(
    "/:id/messages",
    enforceAuth,
    rateLimiter,
    validate("json", pdfMessageSchema),
    async (c) => {
      const input = c.req.valid("json");
      const chatId = c.req.param("id");

      // Get documents for this chat to enable document-specific search
      const documents = await getChatDocuments(chatId);
      const documentIds = documents.map((d) => d.id);
      console.log(`📝 POST /:id/messages - chatId: ${chatId}, documents found: ${documents.length}, documentIds:`, documentIds);

      // Deduct credits
      await deductCredits(Credits.COST.DEFAULT, "pdf-chat")(c, async () => { /* noop */ });

      return streamChatWithDocuments({
        ...input,
        signal: c.req.raw.signal,
        chatId,
        documentIds,
      });
    },
  )
  .get("/:id/messages", enforceAuth, async (c) =>
    c.json(await getChatMessages(c.req.param("id"))),
  )
  .get("/:id/documents", enforceAuth, async (c) =>
    c.json(await getChatDocuments(c.req.param("id"))),
  );

// ============================================================================
// Embeddings Router
// ============================================================================

const embeddingsRouter = new Hono<{
  Variables: {
    user: User;
  };
}>()
  .get("/:id", enforceAuth, async (c) => {
    const { getEmbeddingById } = await import("@turbostarter/ai/pdf/embeddings");
    const embedding = await getEmbeddingById(c.req.param("id"));
    if (!embedding) {
      return c.json({ error: "Embedding not found" }, 404);
    }
    return c.json(embedding);
  });

// ============================================================================
// Search Router (WF-0028 Dual-Resolution Search)
// ============================================================================

const searchRouter = new Hono<{
  Variables: {
    user: User;
  };
}>()
  .post(
    "/",
    enforceAuth,
    validate("json", searchInputSchema),
    async (c) => {
      const input = c.req.valid("json");
      const results = await searchWithCitations(input.query, input.documentId, {
        limit: input.limit,
        threshold: input.threshold,
      });
      return c.json({ data: results });
    },
  )
  // NOTE: More specific route must come BEFORE generic :chunkId route
  .get("/citation-units/single/:id", enforceAuth, async (c) => {
    const unitId = c.req.param("id");
    const unit = await getCitationUnitById(unitId);
    if (!unit) {
      return c.json({ error: "Citation unit not found" }, 404);
    }
    return c.json({ data: unit });
  })
  .get("/citation-units/:chunkId", enforceAuth, async (c) => {
    const chunkId = c.req.param("chunkId");
    const units = await getCitationUnitsForChunk(chunkId);
    return c.json({ data: units });
  });

// ============================================================================
// Documents Router (document status and management)
// ============================================================================

const documentsRouter = new Hono<{
  Variables: {
    user: User;
  };
}>()
  .get("/:id/status", enforceAuth, async (c) => {
    const document = await getDocument(c.req.param("id"));
    if (!document) {
      return c.json({ error: "Document not found" }, 404);
    }
    return c.json({
      id: document.id,
      processingStatus: document.processingStatus,
      processingError: document.processingError,
    });
  });

// ============================================================================
// Diagnostics Router (for debugging embedding issues)
// ============================================================================

const diagnosticsRouter = new Hono<{
  Variables: {
    user: User;
  };
}>()
  .get("/chat/:chatId", enforceAuth, async (c) => {
    const { sql } = await import("@turbostarter/db");
    const { db } = await import("@turbostarter/db/server");

    const chatId = c.req.param("chatId");

    // Get documents for this chat
    const documents = await getChatDocuments(chatId);

    if (documents.length === 0) {
      return c.json({ error: "No documents found for chat", chatId });
    }

    // Get embedding counts per document
    const diagnostics = await Promise.all(
      documents.map(async (doc) => {
        const countResult = await db.execute<{ count: string }>(sql`
          SELECT COUNT(*) as count FROM pdf.embedding WHERE document_id = ${doc.id}
        `);
        const rows = Array.isArray(countResult) ? countResult : [];
        const count = parseInt(rows[0]?.count ?? "0", 10);

        // Get sample content
        const sampleResult = await db.execute<{ content: string; page_number: number }>(sql`
          SELECT LEFT(content, 100) as content, page_number
          FROM pdf.embedding
          WHERE document_id = ${doc.id}
          LIMIT 2
        `);
        const samples = Array.isArray(sampleResult) ? sampleResult : [];

        return {
          documentId: doc.id,
          documentName: doc.name,
          embeddingCount: count,
          samples: samples.map(s => ({
            preview: s.content,
            page: s.page_number,
          })),
        };
      })
    );

    return c.json({
      chatId,
      documentCount: documents.length,
      documents: diagnostics,
      totalEmbeddings: diagnostics.reduce((sum, d) => sum + d.embeddingCount, 0),
    });
  });

export const pdfRouter = new Hono()
  .route("/chats", chatsRouter)
  .route("/documents", documentsRouter)
  .route("/embeddings", embeddingsRouter)
  .route("/search", searchRouter)
  .route("/diagnostics", diagnosticsRouter);
