/**
 * Script to check a specific document and its embeddings
 * Run: pnpm with-env npx tsx packages/api/tests/check-document.ts
 */
import { sql } from "@turbostarter/db";
import { db } from "@turbostarter/db/server";

const DOC_ID = "JnOv9Z7JK2ZWU92OrFFFuuCY1TSksaWv";

async function check() {
  console.log(`\n=== Checking document: ${DOC_ID} ===\n`);

  // 1. Check if document exists in pdf.document
  const docResult = await db.execute<{
    id: string;
    path: string;
    name: string | null;
    chat_id: string;
    created_at: Date;
  }>(sql`
    SELECT id, path, name, chat_id, created_at
    FROM pdf.document
    WHERE id = ${DOC_ID}
  `);

  console.log("Document record:", docResult);

  if (!Array.isArray(docResult) || docResult.length === 0) {
    console.log("❌ Document NOT FOUND in pdf.document table!");

    // Check if it might be in a different table or with different ID
    const allDocs = await db.execute<{
      id: string;
      path: string;
      chat_id: string;
    }>(sql`SELECT id, path, chat_id FROM pdf.document ORDER BY created_at DESC LIMIT 10`);

    console.log("\nRecent documents in pdf.document:");
    for (const doc of allDocs as { id: string; path: string }[]) {
      console.log(`  - ${doc.id} | ${doc.path}`);
    }

    process.exit(0);
  }

  const doc = docResult[0]!;
  console.log(`✅ Document found: ${doc.name ?? doc.path}`);

  // 2. Count embeddings for this document
  const embeddingCount = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int as count
    FROM pdf.embedding
    WHERE document_id = ${DOC_ID}
  `);

  const count = (embeddingCount as { count: number }[])[0]?.count ?? 0;
  console.log(`📊 Embedding count: ${count}`);

  if (count === 0) {
    console.log("❌ Document has 0 embeddings - needs regeneration!");
    console.log(`   Path: ${doc.path}`);
  } else {
    console.log("✅ Document has embeddings");

    // Show sample embeddings
    const samples = await db.execute(sql`
      SELECT id, LEFT(content, 80) as preview, page_number
      FROM pdf.embedding
      WHERE document_id = ${DOC_ID}
      LIMIT 3
    `);
    console.log("\nSample embeddings:", samples);
  }

  process.exit(0);
}

check().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
