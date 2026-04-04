#!/usr/bin/env bun
/**
 * Seed a minimal "smoke-test" mesh with two members.
 *
 * Idempotent: safe to run repeatedly. Re-creates members by
 * deleting any prior "smoke-test" mesh and its cascaded rows first.
 *
 * Outputs the meshId + both memberIds + both pubkeys as JSON (stdout)
 * so peer-a.ts and peer-b.ts can read them before connecting.
 */

import { eq } from "drizzle-orm";
import sodium from "libsodium-wrappers";
import { db } from "../src/db";
import { mesh, meshMember } from "@turbostarter/db/schema/mesh";
import { user } from "@turbostarter/db/schema/auth";

const USER_ID = "test-user-smoke";
const MESH_SLUG = "smoke-test";

async function main() {
  // Generate real ed25519 keypairs so crypto_box (via ed25519→X25519
  // conversion) works in Step 18+ round-trip tests.
  await sodium.ready;
  const kpA = sodium.crypto_sign_keypair();
  const kpB = sodium.crypto_sign_keypair();
  const PEER_A_PUBKEY = sodium.to_hex(kpA.publicKey);
  const PEER_A_SECRET = sodium.to_hex(kpA.privateKey);
  const PEER_B_PUBKEY = sodium.to_hex(kpB.publicKey);
  const PEER_B_SECRET = sodium.to_hex(kpB.privateKey);

  // Ensure the test user exists (re-usable across runs).
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, USER_ID));
  if (!existingUser) {
    await db.insert(user).values({
      id: USER_ID,
      name: "Smoke Test User",
      email: "smoke@claudemesh.test",
      emailVerified: true,
    });
  }

  // Drop any prior mesh with this slug (cascades to members).
  await db.delete(mesh).where(eq(mesh.slug, MESH_SLUG));

  // Fresh mesh + 2 members.
  const [m] = await db
    .insert(mesh)
    .values({
      name: "Smoke Test",
      slug: MESH_SLUG,
      ownerUserId: USER_ID,
      visibility: "private",
      transport: "managed",
      tier: "free",
    })
    .returning({ id: mesh.id });
  if (!m) throw new Error("mesh insert failed");

  const [peerA] = await db
    .insert(meshMember)
    .values({
      meshId: m.id,
      userId: USER_ID,
      peerPubkey: PEER_A_PUBKEY,
      displayName: "peer-a",
      role: "admin",
    })
    .returning({ id: meshMember.id });
  const [peerB] = await db
    .insert(meshMember)
    .values({
      meshId: m.id,
      userId: USER_ID,
      peerPubkey: PEER_B_PUBKEY,
      displayName: "peer-b",
      role: "member",
    })
    .returning({ id: meshMember.id });
  if (!peerA || !peerB) throw new Error("member insert failed");

  const seed = {
    meshId: m.id,
    peerA: {
      memberId: peerA.id,
      pubkey: PEER_A_PUBKEY,
      secretKey: PEER_A_SECRET,
    },
    peerB: {
      memberId: peerB.id,
      pubkey: PEER_B_PUBKEY,
      secretKey: PEER_B_SECRET,
    },
  };
  console.log(JSON.stringify(seed, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed] error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
