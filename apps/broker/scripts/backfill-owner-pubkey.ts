#!/usr/bin/env bun
/**
 * One-off backfill: populate owner_pubkey + owner_secret_key +
 * root_key for meshes created before Step 18c crypto landed.
 *
 * Runs idempotently: only touches rows where ANY of those three
 * columns is NULL. Generates a fresh keypair + root key per mesh
 * and stores ALL THREE server-side (invites are signed server-side
 * by the web UI's create-invite flow, so it needs the secret key).
 *
 * Usage:
 *   DATABASE_URL=... bun apps/broker/scripts/backfill-owner-pubkey.ts
 *
 * Output (stdout): one tab-separated row per patched mesh:
 *   <mesh_id>  <mesh_slug>  <owner_pubkey>  <owner_secret_key>  <root_key>
 */

import sodium from "libsodium-wrappers";
import { eq, isNull, or } from "drizzle-orm";
import { db } from "../src/db";
import { mesh } from "@turbostarter/db/schema/mesh";

async function main(): Promise<void> {
  await sodium.ready;

  const missing = await db
    .select({
      id: mesh.id,
      slug: mesh.slug,
      ownerPubkey: mesh.ownerPubkey,
      ownerSecretKey: mesh.ownerSecretKey,
      rootKey: mesh.rootKey,
    })
    .from(mesh)
    .where(
      or(
        isNull(mesh.ownerPubkey),
        isNull(mesh.ownerSecretKey),
        isNull(mesh.rootKey),
      )!,
    );

  if (missing.length === 0) {
    console.error("[backfill] no rows to patch");
    return;
  }
  console.error(`[backfill] patching ${missing.length} mesh(es)`);

  for (const row of missing) {
    const kp = sodium.crypto_sign_keypair();
    const pubHex = sodium.to_hex(kp.publicKey);
    const secHex = sodium.to_hex(kp.privateKey);
    const rootKey = sodium.to_base64(
      sodium.randombytes_buf(32),
      sodium.base64_variants.URLSAFE_NO_PADDING,
    );
    await db
      .update(mesh)
      .set({
        ownerPubkey: pubHex,
        ownerSecretKey: secHex,
        rootKey,
      })
      .where(eq(mesh.id, row.id));
    console.log(
      `${row.id}\t${row.slug}\t${pubHex}\t${secHex}\t${rootKey}`,
    );
    console.error(`[backfill] patched mesh "${row.slug}" (${row.id})`);
  }
  console.error("[backfill] done.");
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
