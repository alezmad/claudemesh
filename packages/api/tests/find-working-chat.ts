/**
 * Find the chat with the working sample PDF
 * Run: pnpm with-env npx tsx packages/api/tests/find-working-chat.ts
 */
import { sql } from "@turbostarter/db";
import { db } from "@turbostarter/db/server";

async function find() {
  // Get the most recent sample-local-pdf document
  const doc = await db.execute<{
    id: string;
    chat_id: string;
    path: string;
  }>(sql`
    SELECT id, chat_id, path
    FROM pdf.document
    WHERE name = 'sample-local-pdf'
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const docRecord = (doc as { id: string; chat_id: string; path: string }[])[0];
  if (!docRecord) {
    console.log("No sample-local-pdf found");
    process.exit(1);
  }

  console.log(`\n📄 Most recent sample-local-pdf:`);
  console.log(`   Document ID: ${docRecord.id}`);
  console.log(`   Chat ID: ${docRecord.chat_id}`);
  console.log(`\n🔗 URL: /pdf/${docRecord.chat_id}`);

  // Check embeddings content
  const embeddings = await db.execute<{
    content: string;
    page_number: number;
  }>(sql`
    SELECT LEFT(content, 100) as content, page_number
    FROM pdf.embedding
    WHERE document_id = ${docRecord.id}
    LIMIT 3
  `);

  console.log(`\n📊 Sample embedding content:`);
  for (const emb of embeddings as { content: string; page_number: number }[]) {
    console.log(`   Page ${emb.page_number}: "${emb.content.replace(/\n/g, " ")}"`);
  }

  process.exit(0);
}

find().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
