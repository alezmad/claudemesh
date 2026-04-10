/**
 * v2 invite protocol — broker claim endpoint.
 *
 * Covers the sealed-root-key delivery flow added in
 * .artifacts/specs/2026-04-10-anthropic-vision-meshes-invites.md :
 *
 *   - happy path: signed v2 invite claim returns a sealed root_key the
 *     recipient can unseal back to the mesh.rootKey column value
 *   - tampered signature → 400 bad_signature
 *   - expired invite → 410 expired
 *   - revoked invite → 410 revoked
 *   - exhausted invite (usedCount === maxUses) → 410 exhausted
 *   - round-trip: recipient-side crypto_box_seal_open recovers the real key
 *
 * Tests talk directly to claimInviteV2Core() to avoid spinning up the
 * full broker HTTP server. The handler delegates to this function with
 * zero extra logic, so coverage is equivalent.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import sodium from "libsodium-wrappers";
import { db } from "../src/db";
import { invite, mesh } from "@turbostarter/db/schema/mesh";
import { canonicalInviteV2 } from "../src/crypto";
import { claimInviteV2Core } from "../src/index";
import {
  cleanupAllTestMeshes,
  setupTestMesh,
  type TestMesh,
} from "./helpers";

afterAll(async () => {
  await cleanupAllTestMeshes();
});

beforeAll(async () => {
  await sodium.ready;
});

/**
 * Set a random base64url root_key on an existing test mesh. The helpers
 * don't set one by default, so v2 tests prime it per-mesh here.
 */
async function primeRootKey(meshId: string): Promise<Uint8Array> {
  const key = sodium.randombytes_buf(32);
  const b64 = sodium.to_base64(key, sodium.base64_variants.URLSAFE_NO_PADDING);
  await db.update(mesh).set({ rootKey: b64 }).where(eq(mesh.id, meshId));
  return key;
}

/**
 * Insert a signed v2 invite row. Returns the opaque short code + the
 * recipient x25519 keypair the test will use to unseal.
 */
async function insertV2Invite(
  m: TestMesh,
  opts: {
    code: string;
    expiresInSec?: number;
    maxUses?: number;
    role?: "admin" | "member";
    tamper?: boolean; // corrupt the signature
    revoked?: boolean;
    used?: number;
  },
): Promise<{ inviteId: string; canonical: string }> {
  const expiresInSec = opts.expiresInSec ?? 3600;
  const expiresAt = new Date(Date.now() + expiresInSec * 1000);
  const maxUses = opts.maxUses ?? 1;
  const role = opts.role ?? "member";

  // Insert first with a placeholder capability so we have the invite id.
  const [row] = await db
    .insert(invite)
    .values({
      meshId: m.meshId,
      token: `v2-test-token-${opts.code}`,
      code: opts.code,
      maxUses,
      usedCount: opts.used ?? 0,
      role,
      expiresAt,
      createdBy: "test-user-integration",
      version: 2,
      revokedAt: opts.revoked ? new Date() : null,
    })
    .returning({ id: invite.id });
  if (!row) throw new Error("v2 invite insert failed");

  // Now compute canonical_v2 using the real invite id and sign with the
  // mesh owner's ed25519 secret key.
  const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);
  const canonical = canonicalInviteV2({
    mesh_id: m.meshId,
    invite_id: row.id,
    expires_at: expiresAtUnix,
    role,
    owner_pubkey: m.ownerPubkey,
  });
  let signatureHex = sodium.to_hex(
    sodium.crypto_sign_detached(
      sodium.from_string(canonical),
      sodium.from_hex(m.ownerSecretKey),
    ),
  );
  if (opts.tamper) {
    // Flip a single hex nibble — keeps length valid, invalidates signature.
    const first = signatureHex[0] === "0" ? "1" : "0";
    signatureHex = first + signatureHex.slice(1);
  }

  const capability = JSON.stringify({
    canonical,
    signature: signatureHex,
  });
  await db
    .update(invite)
    .set({ capabilityV2: capability })
    .where(eq(invite.id, row.id));
  return { inviteId: row.id, canonical };
}

function genRecipientX25519(): { pk: string; sk: Uint8Array } {
  const kp = sodium.crypto_box_keypair();
  return {
    pk: sodium.to_base64(kp.publicKey, sodium.base64_variants.URLSAFE_NO_PADDING),
    sk: kp.privateKey,
  };
}

describe("claimInviteV2Core — v2 invite claim", () => {
  let m: TestMesh;
  afterEach(async () => m && (await m.cleanup()));

  test("happy path: signed v2 invite returns sealed root_key and member row", async () => {
    m = await setupTestMesh("v2-ok");
    const rootKeyBytes = await primeRootKey(m.meshId);
    const code = `c${Math.random().toString(36).slice(2, 10)}`;
    const { inviteId, canonical } = await insertV2Invite(m, { code });
    const recipient = genRecipientX25519();

    const result = await claimInviteV2Core({
      code,
      recipientX25519PubkeyBase64url: recipient.pk,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);
    expect(result.body.mesh_id).toBe(m.meshId);
    expect(result.body.owner_pubkey).toBe(m.ownerPubkey);
    expect(result.body.canonical_v2).toBe(canonical);
    expect(result.body.member_id).toBeTruthy();

    // Recipient unseals the sealed_root_key using its x25519 secret key.
    const sealed = sodium.from_base64(
      result.body.sealed_root_key,
      sodium.base64_variants.URLSAFE_NO_PADDING,
    );
    const recipientPkBytes = sodium.from_base64(
      recipient.pk,
      sodium.base64_variants.URLSAFE_NO_PADDING,
    );
    const opened = sodium.crypto_box_seal_open(
      sealed,
      recipientPkBytes,
      recipient.sk,
    );
    expect(opened).toBeInstanceOf(Uint8Array);
    expect(opened.length).toBe(32);
    expect(Array.from(opened)).toEqual(Array.from(rootKeyBytes));

    // usedCount incremented and claimedByPubkey recorded.
    const [updated] = await db
      .select({
        usedCount: invite.usedCount,
        claimedByPubkey: invite.claimedByPubkey,
      })
      .from(invite)
      .where(eq(invite.id, inviteId));
    expect(updated?.usedCount).toBe(1);
    expect(updated?.claimedByPubkey).toBe(recipient.pk);
  });

  test("tampered signature → 400 bad_signature", async () => {
    m = await setupTestMesh("v2-tampered");
    await primeRootKey(m.meshId);
    const code = `c${Math.random().toString(36).slice(2, 10)}`;
    await insertV2Invite(m, { code, tamper: true });
    const recipient = genRecipientX25519();

    const result = await claimInviteV2Core({
      code,
      recipientX25519PubkeyBase64url: recipient.pk,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("bad_signature");
  });

  test("expired invite → 410 expired", async () => {
    m = await setupTestMesh("v2-expired");
    await primeRootKey(m.meshId);
    const code = `c${Math.random().toString(36).slice(2, 10)}`;
    await insertV2Invite(m, { code, expiresInSec: -60 });
    const recipient = genRecipientX25519();

    const result = await claimInviteV2Core({
      code,
      recipientX25519PubkeyBase64url: recipient.pk,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(410);
    expect(result.body.error).toBe("expired");
  });

  test("revoked invite → 410 revoked", async () => {
    m = await setupTestMesh("v2-revoked");
    await primeRootKey(m.meshId);
    const code = `c${Math.random().toString(36).slice(2, 10)}`;
    await insertV2Invite(m, { code, revoked: true });
    const recipient = genRecipientX25519();

    const result = await claimInviteV2Core({
      code,
      recipientX25519PubkeyBase64url: recipient.pk,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(410);
    expect(result.body.error).toBe("revoked");
  });

  test("exhausted invite (usedCount >= maxUses) → 410 exhausted", async () => {
    m = await setupTestMesh("v2-exhausted");
    await primeRootKey(m.meshId);
    const code = `c${Math.random().toString(36).slice(2, 10)}`;
    await insertV2Invite(m, { code, maxUses: 1, used: 1 });
    const recipient = genRecipientX25519();

    const result = await claimInviteV2Core({
      code,
      recipientX25519PubkeyBase64url: recipient.pk,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(410);
    expect(result.body.error).toBe("exhausted");
  });

  test("unknown code → 404 not_found", async () => {
    m = await setupTestMesh("v2-404");
    await primeRootKey(m.meshId);
    const recipient = genRecipientX25519();

    const result = await claimInviteV2Core({
      code: "nonexistent",
      recipientX25519PubkeyBase64url: recipient.pk,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("not_found");
  });
});
