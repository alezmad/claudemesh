import Link from "next/link";

import { db } from "@turbostarter/db/server";
import {
  mesh,
  meshMember,
  meshTopic,
  meshTopicMember,
  meshTopicMessage,
} from "@turbostarter/db/schema/mesh";
import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { pathsConfig } from "~/config/paths";
import { getSession } from "~/lib/auth/server";
import { getMetadata } from "~/lib/metadata";
import { Reveal } from "~/modules/dashboard/universe/reveal";

export const generateMetadata = getMetadata({
  title: "Topics",
  description: "Every topic across every mesh — sorted by activity.",
});

const formatRelative = (iso: string | null) => {
  if (!iso) return "never";
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86_400 * 30) return `${Math.floor(sec / 86_400)}d ago`;
  if (sec < 86_400 * 365) return `${Math.floor(sec / (86_400 * 30))}mo ago`;
  return `${Math.floor(sec / (86_400 * 365))}y ago`;
};

export default async function WorkspaceTopicsPage() {
  const { user } = await getSession();
  if (!user) {
    return null;
  }

  // Resolve every active membership for this user → list of (memberId, mesh).
  const memberships = await db
    .select({
      memberId: meshMember.id,
      meshId: meshMember.meshId,
      meshSlug: mesh.slug,
      meshName: mesh.name,
    })
    .from(meshMember)
    .innerJoin(mesh, eq(mesh.id, meshMember.meshId))
    .where(
      and(
        eq(meshMember.userId, user.id),
        isNull(meshMember.revokedAt),
        isNull(mesh.archivedAt),
      ),
    );

  const meshIds = memberships.map((m) => m.meshId);
  const myMemberIds = memberships.map((m) => m.memberId);
  const memberByMeshId = new Map(memberships.map((m) => [m.meshId, m]));

  const topics = meshIds.length
    ? await db
        .select({
          id: meshTopic.id,
          meshId: meshTopic.meshId,
          name: meshTopic.name,
          description: meshTopic.description,
          createdAt: meshTopic.createdAt,
        })
        .from(meshTopic)
        .where(
          and(inArray(meshTopic.meshId, meshIds), isNull(meshTopic.archivedAt)),
        )
        .orderBy(asc(meshTopic.name))
    : [];

  const topicIds = topics.map((t) => t.id);

  const lastMessages = topicIds.length
    ? await db
        .select({
          topicId: meshTopicMessage.topicId,
          lastAt: sql<Date>`max(${meshTopicMessage.createdAt})`,
        })
        .from(meshTopicMessage)
        .where(inArray(meshTopicMessage.topicId, topicIds))
        .groupBy(meshTopicMessage.topicId)
    : [];
  const lastByTopic = new Map(lastMessages.map((r) => [r.topicId, r.lastAt]));

  const unreadCounts =
    topicIds.length && myMemberIds.length
      ? await db
          .select({
            topicId: meshTopicMessage.topicId,
            n: count(meshTopicMessage.id),
          })
          .from(meshTopicMessage)
          .leftJoin(
            meshTopicMember,
            and(
              eq(meshTopicMember.topicId, meshTopicMessage.topicId),
              inArray(meshTopicMember.memberId, myMemberIds),
            ),
          )
          .where(
            and(
              inArray(meshTopicMessage.topicId, topicIds),
              sql`${meshTopicMessage.senderMemberId} <> ALL(${myMemberIds})`,
              or(
                isNull(meshTopicMember.lastReadAt),
                sql`${meshTopicMessage.createdAt} > ${meshTopicMember.lastReadAt}`,
              ),
            ),
          )
          .groupBy(meshTopicMessage.topicId)
      : [];
  const unreadByTopic = new Map(unreadCounts.map((r) => [r.topicId, Number(r.n)]));

  const items = topics
    .map((t) => {
      const m = memberByMeshId.get(t.meshId)!;
      const lastAt = lastByTopic.get(t.id);
      return {
        ...t,
        meshSlug: m.meshSlug,
        meshName: m.meshName,
        unread: unreadByTopic.get(t.id) ?? 0,
        lastMessageAt: lastAt ? new Date(lastAt).toISOString() : null,
      };
    })
    .sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt) {
        return b.lastMessageAt.localeCompare(a.lastMessageAt);
      }
      if (a.lastMessageAt) return -1;
      if (b.lastMessageAt) return 1;
      return a.name.localeCompare(b.name);
    });

  const totalUnread = items.reduce((acc, t) => acc + t.unread, 0);

  return (
    <div className="@container relative h-full p-6 md:p-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 85% -5%, rgba(188,209,202,0.08), transparent 70%)",
        }}
      />
      <div className="relative z-10 mx-auto max-w-[1100px]">
        <header className="mb-10 grid gap-6 border-b border-[var(--cm-border-soft,rgba(217,119,87,0.1))] pb-8 md:mb-14 md:grid-cols-[1fr_auto] md:items-end md:pb-10">
          <Reveal delay={0}>
            <h1
              className="text-[clamp(2rem,1.6rem+2.5vw,3.25rem)] leading-[1.05] tracking-tight"
              style={{ fontFamily: "var(--cm-font-serif)", fontWeight: 400 }}
            >
              Every <span className="italic text-[var(--cm-clay)]">topic</span>,
              <br />
              <span className="italic text-[var(--cm-fg-tertiary)]">across every</span>{" "}
              mesh.
            </h1>
          </Reveal>

          <Reveal delay={1}>
            <div className="flex items-baseline gap-6 font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]">
              <span>
                <span className="mr-2 text-[var(--cm-fg)]">{items.length}</span>
                topics
              </span>
              <span>
                <span
                  className={`mr-2 ${totalUnread > 0 ? "text-[var(--cm-clay)]" : "text-[var(--cm-fg)]"}`}
                >
                  {totalUnread}
                </span>
                unread
              </span>
              <span>
                <span className="mr-2 text-[var(--cm-fg)]">{memberships.length}</span>
                meshes
              </span>
            </div>
          </Reveal>
        </header>

        {items.length === 0 ? (
          <p className="text-[var(--cm-fg-secondary)]">
            No topics yet.{" "}
            <Link
              href={pathsConfig.dashboard.user.meshes.index}
              className="text-[var(--cm-clay)] underline-offset-4 hover:underline"
            >
              Open a mesh
            </Link>{" "}
            to start one.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--cm-border-soft,rgba(217,119,87,0.1))] border-y border-[var(--cm-border-soft,rgba(217,119,87,0.1))]">
            {items.map((t, i) => (
              <Reveal key={t.id} delay={Math.min(i, 8)}>
                <li>
                  <Link
                    href={pathsConfig.dashboard.user.meshes.topic(t.meshId, t.name)}
                    className="group flex items-center gap-5 px-2 py-4 transition-colors duration-200 hover:bg-[var(--cm-bg-hover)]"
                  >
                    <span className="flex w-32 shrink-0 items-center font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--cm-fg-tertiary)]">
                      {t.meshSlug}
                    </span>

                    <span className="flex min-w-0 flex-1 items-baseline gap-3">
                      <span
                        className="truncate text-[18px] tracking-tight text-[var(--cm-fg)] group-hover:text-[var(--cm-clay)]"
                        style={{ fontFamily: "var(--cm-font-serif)" }}
                      >
                        {t.name}
                      </span>
                      {t.description ? (
                        <span className="hidden truncate text-[13px] text-[var(--cm-fg-tertiary)] md:inline">
                          {t.description}
                        </span>
                      ) : null}
                    </span>

                    <span className="w-24 shrink-0 text-right">
                      {t.unread > 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(217,119,87,0.4)] bg-[rgba(217,119,87,0.08)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--cm-clay)]">
                          <span className="size-[6px] rounded-full bg-[var(--cm-clay)]" />
                          {t.unread}
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-[var(--cm-fg-tertiary)]">
                          ·
                        </span>
                      )}
                    </span>

                    <span className="w-20 shrink-0 text-right font-mono text-[11px] text-[var(--cm-fg-tertiary)]">
                      {formatRelative(t.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              </Reveal>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
