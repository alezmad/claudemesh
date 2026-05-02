import { redirect } from "next/navigation";

import {
  getMyInvitesIncomingResponseSchema,
  getMyMeshesResponseSchema,
} from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { db } from "@turbostarter/db/server";
import {
  mesh,
  meshMember,
  meshNotification,
  meshTopic,
  meshTopicMember,
  meshTopicMessage,
} from "@turbostarter/db/schema/mesh";
import { aliasedTable, and, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import { appConfig } from "~/config/app";
import { pathsConfig } from "~/config/paths";
import { api } from "~/lib/api/server";
import { getSession } from "~/lib/auth/server";
import { getMetadata } from "~/lib/metadata";
import { InvitationsSection } from "~/modules/dashboard/universe/invitations";
import { MentionsSection } from "~/modules/dashboard/universe/mentions";
import { MeshesGrid } from "~/modules/dashboard/universe/meshes-grid";
import { UniverseWelcome } from "~/modules/dashboard/universe/welcome";

export const generateMetadata = getMetadata({
  title: "Your universe",
  description: "Meshes, peers, and invitations — all in one place.",
});

export default async function UniversePage() {
  const { user } = await getSession();
  const name = user?.name ?? "there";

  const [{ data: meshes }, { incoming }] = await Promise.all([
    handle(api.my.meshes.$get, {
      schema: getMyMeshesResponseSchema,
    })({
      query: { page: "1", perPage: "50", sort: JSON.stringify([]) },
    }),
    handle(api.my.invites.incoming.$get, {
      schema: getMyInvitesIncomingResponseSchema,
    })(),
  ]);

  const activeMeshes = meshes.filter((m) => !m.archivedAt);

  // First-time onboarding: brand-new user with nothing waiting → create flow.
  if (activeMeshes.length === 0 && incoming.length === 0) {
    redirect(`${pathsConfig.dashboard.user.meshes.new}?onboarding=1`);
  }

  // Decorate each mesh with its non-archived topic count so MeshesGrid
  // can show "X TOPICS" inline. One aggregate query, not N+1.
  const meshIds = activeMeshes.map((m) => m.id);
  const topicCounts = meshIds.length
    ? await db
        .select({ meshId: meshTopic.meshId, n: count() })
        .from(meshTopic)
        .where(
          and(inArray(meshTopic.meshId, meshIds), isNull(meshTopic.archivedAt)),
        )
        .groupBy(meshTopic.meshId)
    : [];
  const topicMap = new Map(topicCounts.map((r) => [r.meshId, Number(r.n)]));

  // Aggregate unread per mesh for the viewing user. Every topic_message
  // not authored by one of the viewer's member rows, in a topic whose
  // last_read_at by the viewer is null or older than the message,
  // counts as unread. The LEFT JOIN on topic_member is restricted to
  // the viewer's own member ids so a NULL row reliably means "viewer
  // never opened this topic" — every message in such a topic is unread.
  const myMembers = user && meshIds.length
    ? await db
        .select({
          id: meshMember.id,
          meshId: meshMember.meshId,
          displayName: meshMember.displayName,
        })
        .from(meshMember)
        .where(
          and(
            eq(meshMember.userId, user.id),
            inArray(meshMember.meshId, meshIds),
            isNull(meshMember.revokedAt),
          ),
        )
    : [];
  const myMemberIds = myMembers.map((m) => m.id);

  const unreadRows = myMemberIds.length
    ? await db
        .select({
          meshId: meshTopic.meshId,
          n: count(meshTopicMessage.id),
        })
        .from(meshTopicMessage)
        .innerJoin(meshTopic, eq(meshTopic.id, meshTopicMessage.topicId))
        .leftJoin(
          meshTopicMember,
          and(
            eq(meshTopicMember.topicId, meshTopicMessage.topicId),
            inArray(meshTopicMember.memberId, myMemberIds),
          ),
        )
        .where(
          and(
            inArray(meshTopic.meshId, meshIds),
            isNull(meshTopic.archivedAt),
            sql`${meshTopicMessage.senderMemberId} <> ALL(${myMemberIds})`,
            or(
              isNull(meshTopicMember.lastReadAt),
              sql`${meshTopicMessage.createdAt} > ${meshTopicMember.lastReadAt}`,
            ),
          ),
        )
        .groupBy(meshTopic.meshId)
    : [];
  const unreadMap = new Map(unreadRows.map((r) => [r.meshId, Number(r.n)]));

  const meshesWithTopics = activeMeshes.map((m) => ({
    ...m,
    topicCount: topicMap.get(m.id) ?? 0,
    unreadCount: unreadMap.get(m.id) ?? 0,
  }));

  // Recent @-mentions of the viewer across every mesh they belong to.
  // Reads from mesh.notification, populated at write time by the
  // POST /v1/messages handler + broker topic-send. Survives v0.3.0
  // per-topic encryption (the previous regex-on-decoded-ciphertext
  // approach would not). 7-day window keeps the result bounded.
  const mentionWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const senderMember = aliasedTable(meshMember, "sender_member");
  const mentionRows = myMemberIds.length
    ? await db
        .select({
          id: meshTopicMessage.id,
          notificationId: meshNotification.id,
          topicId: meshTopicMessage.topicId,
          topicName: meshTopic.name,
          meshId: meshTopic.meshId,
          meshName: mesh.name,
          senderName: senderMember.displayName,
          ciphertext: meshTopicMessage.ciphertext,
          readAt: meshNotification.readAt,
          createdAt: meshTopicMessage.createdAt,
        })
        .from(meshNotification)
        .innerJoin(
          meshTopicMessage,
          eq(meshTopicMessage.id, meshNotification.messageId),
        )
        .innerJoin(meshTopic, eq(meshTopic.id, meshNotification.topicId))
        .innerJoin(mesh, eq(mesh.id, meshTopic.meshId))
        .innerJoin(
          senderMember,
          eq(senderMember.id, meshNotification.senderMemberId),
        )
        .where(
          and(
            inArray(meshNotification.recipientMemberId, myMemberIds),
            isNull(meshTopic.archivedAt),
            gt(meshTopicMessage.createdAt, mentionWindow),
          ),
        )
        .orderBy(desc(meshTopicMessage.createdAt))
        .limit(20)
    : [];

  const decode = (b64: string) => {
    try {
      return Buffer.from(b64, "base64").toString("utf-8");
    } catch {
      return "[decode failed]";
    }
  };
  const mentions = mentionRows.map((r) => ({
    id: r.id,
    meshId: r.meshId,
    meshName: r.meshName,
    topicName: r.topicName,
    senderName: r.senderName,
    snippet: decode(r.ciphertext).slice(0, 240),
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="@container relative h-full p-6 md:p-10">
      {/* Subtle radial backdrop, matching marketing hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 15% -5%, rgba(217,119,87,0.08), transparent 70%)",
        }}
      />
      <div className="relative z-10 mx-auto max-w-[1400px]">
        <UniverseWelcome
          name={name}
          meshCount={activeMeshes.length}
          inviteCount={incoming.length}
        />

        <InvitationsSection
          incoming={incoming}
          appBaseUrl={appConfig.url ?? "https://claudemesh.com"}
        />

        <MentionsSection mentions={mentions} />

        <MeshesGrid meshes={meshesWithTopics} />
      </div>
    </div>
  );
}
