/**
 * Script to regenerate embeddings for documents with 0 embeddings
 * Run: pnpm with-env npx tsx packages/api/tests/regenerate-embeddings.ts
 */
import { generateDocumentEmbeddings } from "@turbostarter/ai/pdf/embeddings";
import { sql } from "@turbostarter/db";
import { pdfEmbedding } from "@turbostarter/db/schema/pdf";
import { db } from "@turbostarter/db/server";

async function regenerate() {
  // Find documents with 0 embeddings
  const orphans = await db.execute<{
    id: string;
    path: string;
    chat_id: string;
  }>(sql`
    SELECT d.id, d.path, d.chat_id
    FROM pdf.document d
    WHERE NOT EXISTS (
      SELECT 1 FROM pdf.embedding e WHERE e.document_id = d.id
    )
  `);

  console.log(`Found ${orphans.length} documents without embeddings`);

  for (const doc of orphans) {
    console.log(`\nProcessing document: ${doc.id}`);
    console.log(`  Path: ${doc.path}`);

    try {
      const generated = await generateDocumentEmbeddings(doc.path);
      console.log(`  Generated ${generated.length} chunks`);

      if (generated.length > 0) {
        await db
          .insert(pdfEmbedding)
          .values(
            generated.map((chunk) => ({
              content: chunk.content,
              documentId: doc.id,
              embedding: chunk.embedding,
              pageNumber: chunk.metadata.pageNumber,
              charStart: chunk.metadata.charStart,
              charEnd: chunk.metadata.charEnd,
              sectionTitle: chunk.metadata.sectionTitle,
            })),
          )
          .onConflictDoNothing();
        console.log(`  ✅ Inserted embeddings`);
      }
    } catch (error) {
      console.error(`  ❌ Error:`, error instanceof Error ? error.message : error);
    }
  }

  console.log("\nDone!");
  process.exit(0);
}

regenerate().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
