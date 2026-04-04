/**
 * List recent documents and their embedding counts
 * Run: pnpm with-env npx tsx packages/api/tests/list-documents.ts
 */
import { sql } from "@turbostarter/db";
import { db } from "@turbostarter/db/server";

async function list() {
  const docs = await db.execute<{
    id: string;
    name: string | null;
    path: string;
    embedding_count: number;
    created_at: Date;
  }>(sql`
    SELECT d.id, d.name, d.path, d.created_at,
           (SELECT COUNT(*)::int FROM pdf.embedding e WHERE e.document_id = d.id) as embedding_count
    FROM pdf.document d
    ORDER BY d.created_at DESC
    LIMIT 10
  `);

  console.log("\nRecent documents:\n");
  for (const doc of docs as { id: string; name: string | null; path: string; embedding_count: number; created_at: Date }[]) {
    console.log(`  📄 ${doc.name ?? "unnamed"}`);
    console.log(`     ID: ${doc.id}`);
    console.log(`     Path: ${doc.path}`);
    console.log(`     Embeddings: ${doc.embedding_count}`);
    console.log(`     Created: ${String(doc.created_at)}`);
    console.log("");
  }

  process.exit(0);
}

list().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
