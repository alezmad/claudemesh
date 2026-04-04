#!/usr/bin/env bun
/**
 * One-off backfill: populate `mesh.mesh.owner_pubkey` for meshes
 * created before Step 18c landed.
 *
 * Runs idempotently: only touches rows where owner_pubkey IS NULL.
 * Generates a fresh ed25519 keypair per mesh and writes the owner
 * SECRET KEY to stdout (paired with mesh_id) so an operator can
 * hand it back to the mesh owner out-of-band.
 *
 * Usage:
 *   DATABASE_URL=... bun apps/broker/scripts/backfill-owner-pubkey.ts
 *
 * Output format (per row): `<mesh_id> <mesh_slug> <owner_pubkey> <owner_secret_key>`
 * Redirect stdout to a secure file — the secret keys grant admin
 * invite-signing power and must be stored carefully.
 */

import sodium from "libsodium-wrappers";
import { eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { mesh } from "@turbostarter/db/schema/mesh";

async function main(): Promise<void> {
  await sodium.ready;

  const missing = await db
    .select({ id: mesh.id, slug: mesh.slug, name: mesh.name })
    .from(mesh)
    .where(isNull(mesh.ownerPubkey));

  if (missing.length === 0) {
    console.error("[backfill] no rows to patch");
    return;
  }
  console.error(`[backfill] patching ${missing.length} mesh(es)`);

  for (const row of missing) {
    const kp = sodium.crypto_sign_keypair();
    const pubHex = sodium.to_hex(kp.publicKey);
    const secHex = sodium.to_hex(kp.privateKey);
    await db
      .update(mesh)
      .set({ ownerPubkey: pubHex })
      .where(eq(mesh.id, row.id));
    // stdout: machine-readable, one mesh per line
    console.log(`${row.id}\t${row.slug}\t${pubHex}\t${secHex}`);
    console.error(
      `[backfill] patched mesh "${row.slug}" (${row.id}) — save its secret key`,
    );
  }
  console.error(
    "[backfill] done. SECURELY HAND OFF secret keys to mesh owners.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(
      "[backfill] error:",
      e instanceof Error ? e.message : String(e),
    );
    process.exit(1);
  });
