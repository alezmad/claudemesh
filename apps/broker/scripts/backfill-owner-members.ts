/**
 * One-shot backfill: every active mesh whose owner has no peer-identity
 * member row gets one minted via a fresh ed25519 keypair. Without this,
 * web-first owners (who never connected via CLI) can't access the chat
 * surface — issueDashboardApiKey is a FK to mesh.member, and the topic
 * page server component's owner branch picks the oldest member row in
 * the mesh (which is null if none exist).
 *
 * Idempotent. Safe to re-run. Each run prints per-mesh status.
 *
 * Owner identification: a member is the "owner's row" when its user_id
 * matches mesh.owner_user_id. The script targets meshes that have zero
 * such matching rows (regardless of total member count — a mesh with
 * peers but no owner member also gets a fresh owner row).
 *
 * The owner row is also auto-subscribed to #general as 'lead' so the
 * unread/role accounting matches CLI-flow meshes.
 *
 * Usage:
 *   DATABASE_URL=... bun apps/broker/scripts/backfill-owner-members.ts
 */

import postgres from "postgres";
import sodium from "libsodium-wrappers";

interface Orphan {
  meshId: string;
  slug: string;
  ownerUserId: string;
  meshName: string;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(2);
  }

  await sodium.ready;

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const orphans = await sql<Orphan[]>`
      SELECT m.id AS "meshId", m.slug, m.owner_user_id AS "ownerUserId", m.name AS "meshName"
      FROM mesh.mesh m
      WHERE m.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM mesh.member mm
          WHERE mm.mesh_id = m.id
            AND mm.revoked_at IS NULL
            AND mm.user_id = m.owner_user_id
        )
      ORDER BY m.created_at
    `;
    console.log(`backfill · ${orphans.length} meshes need an owner member row`);

    let inserted = 0;
    for (const o of orphans) {
      const kp = sodium.crypto_sign_keypair();
      const peerPubkey = sodium.to_hex(kp.publicKey);
      const id = sodium.to_hex(sodium.randombytes_buf(16));
      try {
        await sql.begin(async (tx) => {
          await tx`
            INSERT INTO mesh.member (
              id, mesh_id, peer_pubkey, display_name, role,
              user_id, dashboard_user_id
            )
            VALUES (
              ${id}, ${o.meshId}, ${peerPubkey},
              ${o.meshName + "-owner"}, ${"admin"}::mesh.role,
              ${o.ownerUserId}, ${o.ownerUserId}
            )
          `;
          // Subscribe to #general as 'lead' if the topic exists.
          await tx`
            INSERT INTO mesh.topic_member (topic_id, member_id, role)
            SELECT t.id, ${id}, ${"lead"}::mesh.topic_member_role
            FROM mesh.topic t
            WHERE t.mesh_id = ${o.meshId} AND t.name = 'general'
            ON CONFLICT (topic_id, member_id) DO NOTHING
          `;
        });
        inserted += 1;
        console.log(`  + ${o.slug.padEnd(20)} owner=${o.ownerUserId.slice(0, 8)}… member=${id.slice(0, 8)}… pk=${peerPubkey.slice(0, 12)}…`);
      } catch (e) {
        console.error(`  ✗ ${o.slug}: ${(e as Error).message}`);
        throw e;
      }
    }
    console.log(`backfill done · ${inserted} owner member rows inserted`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error("backfill failed:", e);
  process.exit(1);
});
