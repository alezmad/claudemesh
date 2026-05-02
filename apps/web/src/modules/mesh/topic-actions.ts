"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { db } from "@turbostarter/db/server";
import {
  mesh,
  meshMember,
  meshTopic,
  meshTopicMember,
} from "@turbostarter/db/schema/mesh";
import { and, asc, eq, isNull } from "drizzle-orm";

import { pathsConfig } from "~/config/paths";
import { getSession } from "~/lib/auth/server";

const TOPIC_NAME_RX = /^[a-z0-9][a-z0-9-]{0,49}$/;

/**
 * Server action: create a topic in a mesh.
 *
 * The caller must own or be a non-revoked member of the mesh. The newly
 * created topic auto-subscribes the creator (rows in mesh.topic_member),
 * matching the CLI verb's behavior. On success the page revalidates and
 * the user is redirected into the topic chat.
 */
export async function createTopic(
  meshId: string,
  formData: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) redirect(pathsConfig.auth.login);

  const rawName = String(formData.get("name") ?? "").trim();
  const description =
    String(formData.get("description") ?? "").trim() || null;

  const name = rawName.replace(/^#+/, "").toLowerCase();
  if (!TOPIC_NAME_RX.test(name)) {
    throw new Error(
      "Topic name must be 1-50 characters: lowercase letters, digits, dashes; cannot start with a dash.",
    );
  }

  // Authz — own or member.
  const [meshRow] = await db
    .select({ id: mesh.id, ownerUserId: mesh.ownerUserId })
    .from(mesh)
    .where(eq(mesh.id, meshId))
    .limit(1);
  if (!meshRow) throw new Error("Mesh not found.");

  const isOwner = meshRow.ownerUserId === session.user.id;
  let memberId: string | null = null;
  if (isOwner) {
    const [m] = await db
      .select({ id: meshMember.id })
      .from(meshMember)
      .where(and(eq(meshMember.meshId, meshId), isNull(meshMember.revokedAt)))
      .orderBy(asc(meshMember.joinedAt))
      .limit(1);
    memberId = m?.id ?? null;
  } else {
    const [m] = await db
      .select({ id: meshMember.id })
      .from(meshMember)
      .where(
        and(
          eq(meshMember.meshId, meshId),
          eq(meshMember.userId, session.user.id),
          isNull(meshMember.revokedAt),
        ),
      )
      .limit(1);
    memberId = m?.id ?? null;
  }
  if (!memberId) throw new Error("You are not a member of this mesh.");

  // Insert. Unique index on (meshId, name) handles dup detection.
  let topicId: string;
  try {
    const [row] = await db
      .insert(meshTopic)
      .values({
        meshId,
        name,
        description,
        createdByMemberId: memberId,
        visibility: "public",
      })
      .returning({ id: meshTopic.id });
    if (!row) throw new Error("Insert returned no row.");
    topicId = row.id;
  } catch (e) {
    const msg = (e as { message?: string }).message ?? "";
    if (msg.includes("topic_mesh_name_unique") || msg.includes("duplicate")) {
      throw new Error(`A topic named #${name} already exists in this mesh.`);
    }
    throw e;
  }

  // Auto-subscribe the creator. Idempotent via the unique index.
  await db
    .insert(meshTopicMember)
    .values({ topicId, memberId, role: "lead" })
    .onConflictDoNothing();

  revalidatePath(pathsConfig.dashboard.user.meshes.mesh(meshId));
  revalidatePath(pathsConfig.dashboard.user.index);
  redirect(pathsConfig.dashboard.user.meshes.topic(meshId, name));
}
