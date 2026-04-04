/**
 * Test helpers for broker integration tests.
 *
 * Each test gets its own fresh mesh + members via `setupTestMesh`.
 * Mesh isolation in the broker logic means tests don't interfere even
 * when they share a database and run in the same process — we just
 * need unique meshIds per test.
 */

import { eq, inArray } from "drizzle-orm";
import sodium from "libsodium-wrappers";
import { db } from "../src/db";
import { invite, mesh, meshMember } from "@turbostarter/db/schema/mesh";
import { user } from "@turbostarter/db/schema/auth";
import { randomBytes } from "node:crypto";
import { canonicalInvite } from "../src/crypto";

const TEST_USER_ID = "test-user-integration";

/**
 * Shared test user. Created once, reused across tests.
 * Uses a deterministic id so we can safely cascade-delete on cleanup.
 */
export async function ensureTestUser(): Promise<string> {
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, TEST_USER_ID));
  if (!existing) {
    await db.insert(user).values({
      id: TEST_USER_ID,
      name: "Broker Test User",
      email: "broker-test@claudemesh.test",
      emailVerified: true,
    });
  }
  return TEST_USER_ID;
}

export interface TestMesh {
  meshId: string;
  ownerPubkey: string;
  ownerSecretKey: string;
  peerA: { memberId: string; pubkey: string };
  peerB: { memberId: string; pubkey: string };
  cleanup: () => Promise<void>;
}

export interface TestInvite {
  token: string;
  payload: {
    v: 1;
    mesh_id: string;
    mesh_slug: string;
    broker_url: string;
    expires_at: number;
    mesh_root_key: string;
    role: "admin" | "member";
    owner_pubkey: string;
    signature: string;
  };
  inviteId: string;
}

/**
 * Create a test mesh + 2 members. Returns IDs + pubkeys and a
 * cleanup function that cascade-deletes the mesh (and all presence,
 * message_queue, member rows that reference it).
 */
export async function setupTestMesh(label: string): Promise<TestMesh> {
  const userId = await ensureTestUser();
  const slug = `t-${label}-${randomBytes(4).toString("hex")}`;

  await sodium.ready;
  const kpOwner = sodium.crypto_sign_keypair();
  const ownerPubkey = sodium.to_hex(kpOwner.publicKey);
  const ownerSecretKey = sodium.to_hex(kpOwner.privateKey);

  const [m] = await db
    .insert(mesh)
    .values({
      name: `Test ${label}`,
      slug,
      ownerUserId: userId,
      ownerPubkey,
      visibility: "private",
      transport: "managed",
      tier: "free",
    })
    .returning({ id: mesh.id });
  if (!m) throw new Error("failed to insert test mesh");

  const pubkeyA = "a".repeat(63) + randomBytes(1).toString("hex").slice(0, 1);
  const pubkeyB = "b".repeat(63) + randomBytes(1).toString("hex").slice(0, 1);

  const [mA] = await db
    .insert(meshMember)
    .values({
      meshId: m.id,
      userId,
      peerPubkey: pubkeyA,
      displayName: `peer-a-${label}`,
      role: "admin",
    })
    .returning({ id: meshMember.id });
  const [mB] = await db
    .insert(meshMember)
    .values({
      meshId: m.id,
      userId,
      peerPubkey: pubkeyB,
      displayName: `peer-b-${label}`,
      role: "member",
    })
    .returning({ id: meshMember.id });
  if (!mA || !mB) throw new Error("failed to insert test members");

  return {
    meshId: m.id,
    ownerPubkey,
    ownerSecretKey,
    peerA: { memberId: mA.id, pubkey: pubkeyA },
    peerB: { memberId: mB.id, pubkey: pubkeyB },
    cleanup: async () => {
      // Cascade delete takes care of members, presences, message_queue.
      await db.delete(mesh).where(eq(mesh.id, m.id));
    },
  };
}

/**
 * Create a signed invite row for an existing test mesh. Returns the
 * token + full payload + DB invite id. Defaults: 1-hour expiry, max
 * uses = 1, role = "member".
 */
export async function createTestInvite(
  m: TestMesh,
  opts: {
    maxUses?: number;
    expiresInSec?: number;
    role?: "admin" | "member";
    slug?: string;
    brokerUrl?: string;
  } = {},
): Promise<TestInvite> {
  await sodium.ready;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (opts.expiresInSec ?? 3600);
  const payload = {
    v: 1 as const,
    mesh_id: m.meshId,
    mesh_slug: opts.slug ?? "test-slug",
    broker_url: opts.brokerUrl ?? "ws://localhost:7900/ws",
    expires_at: expiresAt,
    mesh_root_key: "dGVzdC1tZXNoLXJvb3Qta2V5",
    role: opts.role ?? ("member" as const),
    owner_pubkey: m.ownerPubkey,
  };
  const canonical = canonicalInvite(payload);
  const signature = sodium.to_hex(
    sodium.crypto_sign_detached(
      sodium.from_string(canonical),
      sodium.from_hex(m.ownerSecretKey),
    ),
  );
  const full = { ...payload, signature };
  const token = Buffer.from(JSON.stringify(full), "utf-8").toString(
    "base64url",
  );
  const [row] = await db
    .insert(invite)
    .values({
      meshId: m.meshId,
      token,
      tokenBytes: canonical,
      maxUses: opts.maxUses ?? 1,
      usedCount: 0,
      role: opts.role ?? "member",
      expiresAt: new Date(expiresAt * 1000),
      createdBy: "test-user-integration",
    })
    .returning({ id: invite.id });
  if (!row) throw new Error("invite insert failed");
  return { token, payload: full, inviteId: row.id };
}

export async function generateRawKeypair(): Promise<{
  publicKey: string;
  secretKey: string;
}> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: sodium.to_hex(kp.publicKey),
    secretKey: sodium.to_hex(kp.privateKey),
  };
}

/**
 * Delete all meshes with slugs starting with "t-" (test prefix).
 * Used as a safety net in afterAll if individual cleanup() didn't run.
 */
export async function cleanupAllTestMeshes(): Promise<void> {
  const testMeshes = await db
    .select({ id: mesh.id })
    .from(mesh)
    .where(eq(mesh.ownerUserId, TEST_USER_ID));
  if (testMeshes.length === 0) return;
  await db.delete(mesh).where(
    inArray(
      mesh.id,
      testMeshes.map((m) => m.id),
    ),
  );
}
