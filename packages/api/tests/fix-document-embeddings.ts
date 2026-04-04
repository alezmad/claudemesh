/**
 * Script to fix embeddings for a specific document with corrupted embeddings
 * Run: pnpm with-env npx tsx packages/api/tests/fix-document-embeddings.ts
 */
import { generateDocumentEmbeddings } from "@turbostarter/ai/pdf/embeddings";
import { sql } from "@turbostarter/db";
import { pdfEmbedding } from "@turbostarter/db/schema/pdf";
import { db } from "@turbostarter/db/server";

const DOC_ID = "JnOv9Z7JK2ZWU92OrFFFuuCY1TSksaWv";

async function fix() {
  console.log(`\n=== Fixing embeddings for document: ${DOC_ID} ===\n`);

  // 1. Get the document path
  const docResult = await db.execute<{
    id: string;
    path: string;
    name: string | null;
  }>(sql`
    SELECT id, path, name
    FROM pdf.document
    WHERE id = ${DOC_ID}
  `);

  const docs = Array.isArray(docResult) ? docResult : [];
  if (docs.length === 0) {
    console.log("❌ Document not found!");
    process.exit(1);
  }

  const doc = docs[0]!;
  console.log(`📄 Document: ${doc.name ?? doc.id}`);
  console.log(`📁 Path: ${doc.path}`);

  // 2. Delete existing (corrupted) embeddings
  console.log("\n🗑️  Deleting corrupted embeddings...");
  await db.execute(sql`
    DELETE FROM pdf.embedding
    WHERE document_id = ${DOC_ID}
  `);
  console.log("   Done.");

  // 3. Regenerate embeddings from the actual PDF
  console.log("\n📊 Generating new embeddings from PDF...");
  try {
    const generated = await generateDocumentEmbeddings(doc.path);
    console.log(`   Generated ${generated.length} chunks`);

    if (generated.length === 0) {
      console.log("⚠️  No chunks generated - PDF may be empty or unreadable");
      process.exit(1);
    }

    // Show sample of new embeddings
    console.log("\n   Sample content:");
    for (let i = 0; i < Math.min(3, generated.length); i++) {
      const chunk = generated[i]!;
      console.log(`   Page ${chunk.metadata.pageNumber}: "${chunk.content.substring(0, 60)}..."`);
    }

    // 4. Insert new embeddings
    console.log("\n💾 Inserting new embeddings...");
    await db
      .insert(pdfEmbedding)
      .values(
        generated.map((chunk) => ({
          content: chunk.content,
          documentId: DOC_ID,
          embedding: chunk.embedding,
          pageNumber: chunk.metadata.pageNumber,
          charStart: chunk.metadata.charStart,
          charEnd: chunk.metadata.charEnd,
          sectionTitle: chunk.metadata.sectionTitle,
        })),
      );

    console.log(`   ✅ Inserted ${generated.length} embeddings`);

    // 5. Verify
    const countResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int as count
      FROM pdf.embedding
      WHERE document_id = ${DOC_ID}
    `);
    const count = (countResult as { count: number }[])[0]?.count ?? 0;
    console.log(`\n✅ Verification: Document now has ${count} embeddings`);
  } catch (error) {
    console.error("\n❌ Error generating embeddings:", error);
    process.exit(1);
  }

  process.exit(0);
}

fix().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
