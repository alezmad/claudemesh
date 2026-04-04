/**
 * Test helpers for broker integration tests.
 *
 * Each test gets its own fresh mesh + members via `setupTestMesh`.
 * Mesh isolation in the broker logic means tests don't interfere even
 * when they share a database and run in the same process — we just
 * need unique meshIds per test.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { mesh, meshMember } from "@turbostarter/db/schema/mesh";
import { user } from "@turbostarter/db/schema/auth";
import { randomBytes } from "node:crypto";

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
  peerA: { memberId: string; pubkey: string };
  peerB: { memberId: string; pubkey: string };
  cleanup: () => Promise<void>;
}

/**
 * Create a test mesh + 2 members. Returns IDs + pubkeys and a
 * cleanup function that cascade-deletes the mesh (and all presence,
 * message_queue, member rows that reference it).
 */
export async function setupTestMesh(label: string): Promise<TestMesh> {
  const userId = await ensureTestUser();
  const slug = `t-${label}-${randomBytes(4).toString("hex")}`;

  const [m] = await db
    .insert(mesh)
    .values({
      name: `Test ${label}`,
      slug,
      ownerUserId: userId,
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
    peerA: { memberId: mA.id, pubkey: pubkeyA },
    peerB: { memberId: mB.id, pubkey: pubkeyB },
    cleanup: async () => {
      // Cascade delete takes care of members, presences, message_queue.
      await db.delete(mesh).where(eq(mesh.id, m.id));
    },
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
