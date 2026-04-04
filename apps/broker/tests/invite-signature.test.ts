/**
 * Invite signature + one-time-use tracking.
 *
 * Covers the full joinMesh() security envelope:
 *   - signed invites accepted
 *   - tampered payloads rejected
 *   - mismatched owner_pubkey rejected
 *   - expired / revoked / exhausted invites rejected
 *   - idempotency: same pubkey rejoins without burning a use
 *   - atomic single-use: concurrent joins produce exactly one winner
 */

import { afterAll, afterEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { invite, mesh } from "@turbostarter/db/schema/mesh";
import { joinMesh } from "../src/broker";
import {
  cleanupAllTestMeshes,
  createTestInvite,
  generateRawKeypair,
  setupTestMesh,
  type TestInvite,
  type TestMesh,
} from "./helpers";

afterAll(async () => {
  await cleanupAllTestMeshes();
});

describe("joinMesh — signed invites", () => {
  let m: TestMesh;
  afterEach(async () => m && (await m.cleanup()));

  test("valid signed invite → join succeeds", async () => {
    m = await setupTestMesh("inv-valid");
    const inv = await createTestInvite(m);
    const kp = await generateRawKeypair();
    const result = await joinMesh({
      inviteToken: inv.token,
      invitePayload: inv.payload,
      peerPubkey: kp.publicKey,
      displayName: "alice",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.memberId).toMatch(/^[A-Za-z0-9]+$/);
  });

  test("tampered payload → invite_bad_signature", async () => {
    m = await setupTestMesh("inv-tampered");
    const inv = await createTestInvite(m);
    const kp = await generateRawKeypair();
    const tampered = { ...inv.payload, mesh_slug: "HACKED" };
    const result = await joinMesh({
      inviteToken: inv.token,
      invitePayload: tampered,
      peerPubkey: kp.publicKey,
      displayName: "mallory",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invite_bad_signature");
  });

  test("owner key mismatch → invite_owner_mismatch", async () => {
    m = await setupTestMesh("inv-owner-mismatch");
    // Signer has a valid keypair but is NOT the mesh owner.
    const fake = await generateRawKeypair();
    // Build a properly-signed payload with the fake owner key.
    const { canonicalInvite } = await import("../src/crypto");
    const sodium = await import("libsodium-wrappers").then((m) => m.default);
    await sodium.ready;
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      v: 1 as const,
      mesh_id: m.meshId,
      mesh_slug: "x",
      broker_url: "ws://localhost/ws",
      expires_at: now + 3600,
      mesh_root_key: "a",
      role: "member" as const,
      owner_pubkey: fake.publicKey, // wrong owner
    };
    const sig = sodium.to_hex(
      sodium.crypto_sign_detached(
        sodium.from_string(canonicalInvite(payload)),
        sodium.from_hex(fake.secretKey),
      ),
    );
    const token = Buffer.from(
      JSON.stringify({ ...payload, signature: sig }),
      "utf-8",
    ).toString("base64url");
    // Have to insert a matching invite row so broker can look it up.
    await db.insert(invite).values({
      meshId: m.meshId,
      token,
      maxUses: 1,
      usedCount: 0,
      role: "member",
      expiresAt: new Date((now + 3600) * 1000),
      createdBy: "test-user-integration",
    });

    const joiner = await generateRawKeypair();
    const result = await joinMesh({
      inviteToken: token,
      invitePayload: { ...payload, signature: sig },
      peerPubkey: joiner.publicKey,
      displayName: "joiner",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invite_owner_mismatch");
  });

  test("expired invite → invite_expired", async () => {
    m = await setupTestMesh("inv-expired");
    // Create invite with expiry in the past (we use a far-future expiry
    // for signing, then back-date the DB row to simulate staleness
    // without the client-side expiry check tripping).
    const inv = await createTestInvite(m, { expiresInSec: 3600 });
    await db
      .update(invite)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invite.id, inv.inviteId));
    const kp = await generateRawKeypair();
    const result = await joinMesh({
      inviteToken: inv.token,
      invitePayload: inv.payload,
      peerPubkey: kp.publicKey,
      displayName: "late",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invite_expired");
  });

  test("revoked invite → invite_revoked", async () => {
    m = await setupTestMesh("inv-revoked");
    const inv = await createTestInvite(m);
    await db
      .update(invite)
      .set({ revokedAt: new Date() })
      .where(eq(invite.id, inv.inviteId));
    const kp = await generateRawKeypair();
    const result = await joinMesh({
      inviteToken: inv.token,
      invitePayload: inv.payload,
      peerPubkey: kp.publicKey,
      displayName: "blocked",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invite_revoked");
  });

  test("exhausted invite → invite_exhausted", async () => {
    m = await setupTestMesh("inv-exhausted");
    const inv = await createTestInvite(m, { maxUses: 2 });
    // First two joins succeed.
    const k1 = await generateRawKeypair();
    const k2 = await generateRawKeypair();
    const r1 = await joinMesh({
      inviteToken: inv.token,
      invitePayload: inv.payload,
      peerPubkey: k1.publicKey,
      displayName: "first",
    });
    const r2 = await joinMesh({
      inviteToken: inv.token,
      invitePayload: inv.payload,
      peerPubkey: k2.publicKey,
      displayName: "second",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Third should be rejected.
    const k3 = await generateRawKeypair();
    const r3 = await joinMesh({
      inviteToken: inv.token,
      invitePayload: inv.payload,
      peerPubkey: k3.publicKey,
      displayName: "third",
    });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error).toBe("invite_exhausted");
  });

  test("idempotent re-join doesn't burn a use", async () => {
    m = await setupTestMesh("inv-idempotent");
    const inv = await createTestInvite(m, { maxUses: 1 });
    const kp = await generateRawKeypair();
    const r1 = await joinMesh({
      inviteToken: inv.token,
      invitePayload: inv.payload,
      peerPubkey: kp.publicKey,
      displayName: "alice",
    });
    const r2 = await joinMesh({
      inviteToken: inv.token,
      invitePayload: inv.payload,
      peerPubkey: kp.publicKey,
      displayName: "alice",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r2.memberId).toBe(r1.memberId);
      expect(r2.alreadyMember).toBe(true);
    }
    // usedCount should still be 1, not 2.
    const [row] = await db
      .select({ usedCount: invite.usedCount })
      .from(invite)
      .where(eq(invite.id, inv.inviteId));
    expect(row?.usedCount).toBe(1);
  });

  test("atomic single-use: concurrent joins, exactly one wins", async () => {
    m = await setupTestMesh("inv-atomic");
    const inv = await createTestInvite(m, { maxUses: 1 });
    // Fire 5 distinct joiners concurrently at a 1-use invite.
    const joiners = await Promise.all(
      Array.from({ length: 5 }).map(() => generateRawKeypair()),
    );
    const results = await Promise.all(
      joiners.map((kp, i) =>
        joinMesh({
          inviteToken: inv.token,
          invitePayload: inv.payload,
          peerPubkey: kp.publicKey,
          displayName: `racer-${i}`,
        }),
      ),
    );
    const oks = results.filter((r) => r.ok);
    const exhausted = results.filter(
      (r) => !r.ok && r.error === "invite_exhausted",
    );
    expect(oks.length).toBe(1);
    expect(exhausted.length).toBe(4);
  });

  test("wrong mesh_id in payload vs DB row → invite_mesh_mismatch", async () => {
    m = await setupTestMesh("inv-mesh-mismatch");
    const inv = await createTestInvite(m);
    // Point the DB row at a different mesh (create another one with
    // the SAME owner_pubkey so we get past the owner check).
    const other = await setupTestMesh("inv-mesh-other");
    try {
      // Align other's owner_pubkey to m's so only mesh_id differs.
      await db
        .update(mesh)
        .set({ ownerPubkey: m.ownerPubkey })
        .where(eq(mesh.id, other.meshId));
      // Re-point invite row's meshId to other.
      await db
        .update(invite)
        .set({ meshId: other.meshId })
        .where(eq(invite.id, inv.inviteId));
      const kp = await generateRawKeypair();
      const result = await joinMesh({
        inviteToken: inv.token,
        invitePayload: inv.payload, // still claims m.meshId
        peerPubkey: kp.publicKey,
        displayName: "cross",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("invite_mesh_mismatch");
    } finally {
      await other.cleanup();
    }
  });
});
