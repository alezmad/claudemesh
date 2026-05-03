import Link from "next/link";

import { db } from "@turbostarter/db/server";
import {
  mesh,
  meshMember,
  meshNotification,
  meshTopic,
  meshTopicMessage,
} from "@turbostarter/db/schema/mesh";
import { aliasedTable, and, desc, eq, gt, inArray, isNull } from "drizzle-orm";

import { pathsConfig } from "~/config/paths";
import { getSession } from "~/lib/auth/server";
import { getMetadata } from "~/lib/metadata";
import { Reveal } from "~/modules/dashboard/universe/reveal";

export const generateMetadata = getMetadata({
  title: "Notifications",
  description: "@-mentions across every mesh, last 7 days.",
});

const formatRelative = (iso: string) => {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86_400 * 30) return `${Math.floor(sec / 86_400)}d ago`;
  if (sec < 86_400 * 365) return `${Math.floor(sec / (86_400 * 30))}mo ago`;
  return `${Math.floor(sec / (86_400 * 365))}y ago`;
};

const decode = (b64: string) => {
  try {
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return "";
  }
};

interface PageProps {
  searchParams: Promise<{ all?: string }>;
}

export default async function WorkspaceNotificationsPage({
  searchParams,
}: PageProps) {
  const { user } = await getSession();
  if (!user) return null;

  const params = await searchParams;
  const includeAll = params.all === "1";

  const memberships = await db
    .select({ memberId: meshMember.id })
    .from(meshMember)
    .innerJoin(mesh, eq(mesh.id, meshMember.meshId))
    .where(
      and(
        eq(meshMember.userId, user.id),
        isNull(meshMember.revokedAt),
        isNull(mesh.archivedAt),
      ),
    );

  const myMemberIds = memberships.map((m) => m.memberId);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const senderMember = aliasedTable(meshMember, "sender_member");
  const rows = myMemberIds.length
    ? await db
        .select({
          id: meshNotification.id,
          messageId: meshTopicMessage.id,
          topicName: meshTopic.name,
          meshId: meshTopic.meshId,
          meshSlug: mesh.slug,
          senderName: senderMember.displayName,
          ciphertext: meshTopicMessage.ciphertext,
          bodyVersion: meshTopicMessage.bodyVersion,
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
            gt(meshTopicMessage.createdAt, since),
            ...(includeAll ? [] : [isNull(meshNotification.readAt)]),
          ),
        )
        .orderBy(desc(meshTopicMessage.createdAt))
        .limit(100)
    : [];

  const items = rows.map((r) => ({
    id: r.id,
    messageId: r.messageId,
    topicName: r.topicName,
    meshId: r.meshId,
    meshSlug: r.meshSlug,
    senderName: r.senderName ?? "?",
    snippet: r.bodyVersion === 1 ? decode(r.ciphertext).slice(0, 240) : null,
    encrypted: r.bodyVersion === 2,
    read: !!r.readAt,
    createdAt: r.createdAt.toISOString(),
  }));

  const unreadCount = items.filter((i) => !i.read).length;

  return (
    <div className="@container relative h-full p-6 md:p-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% -10%, rgba(217,119,87,0.08), transparent 70%)",
        }}
      />
      <div className="relative z-10 mx-auto max-w-[900px]">
        <header className="mb-10 grid gap-6 border-b border-[var(--cm-border-soft,rgba(217,119,87,0.1))] pb-8 md:mb-14 md:grid-cols-[1fr_auto] md:items-end md:pb-10">
          <Reveal delay={0}>
            <h1
              className="text-[clamp(2rem,1.6rem+2.5vw,3.25rem)] leading-[1.05] tracking-tight"
              style={{ fontFamily: "var(--cm-font-serif)", fontWeight: 400 }}
            >
              <span className="italic text-[var(--cm-fg-tertiary)]">Mentions</span>,{" "}
              <span className="italic text-[var(--cm-clay)]">on you</span>.
            </h1>
          </Reveal>

          <Reveal delay={1}>
            <div className="flex items-center gap-6 font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]">
              <span>
                <span
                  className={`mr-2 ${unreadCount > 0 ? "text-[var(--cm-clay)]" : "text-[var(--cm-fg)]"}`}
                >
                  {unreadCount}
                </span>
                unread
              </span>
              <span>
                <span className="mr-2 text-[var(--cm-fg)]">{items.length}</span>
                {includeAll ? "shown" : "in window"}
              </span>
              <Link
                href={
                  includeAll
                    ? pathsConfig.dashboard.user.notifications
                    : `${pathsConfig.dashboard.user.notifications}?all=1`
                }
                className="text-[var(--cm-clay)] underline-offset-4 hover:underline"
              >
                {includeAll ? "unread only" : "show all"}
              </Link>
            </div>
          </Reveal>
        </header>

        {items.length === 0 ? (
          <p className="text-[var(--cm-fg-secondary)]">
            {includeAll
              ? "No mentions in the last 7 days."
              : "Inbox zero. Nothing waiting on you."}
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {items.map((n, i) => (
              <Reveal key={n.id} delay={Math.min(i, 8)}>
                <li
                  className={`group relative rounded-md border bg-[var(--cm-bg-elevated)] px-5 py-4 transition-colors duration-200 ${
                    n.read
                      ? "border-[var(--cm-border-soft,rgba(217,119,87,0.1))]"
                      : "border-[rgba(217,119,87,0.4)]"
                  }`}
                >
                  <Link
                    href={pathsConfig.dashboard.user.meshes.topic(
                      n.meshId,
                      n.topicName,
                    )}
                    className="block"
                  >
                    <div className="mb-2 flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.16em]">
                      {!n.read ? (
                        <span className="size-[6px] rounded-full bg-[var(--cm-clay)]" />
                      ) : null}
                      <span className="text-[var(--cm-fg-tertiary)]">
                        {n.meshSlug}
                      </span>
                      <span className="text-[var(--cm-clay)]">#{n.topicName}</span>
                      <span className="text-[var(--cm-fg-tertiary)]">
                        from {n.senderName}
                      </span>
                      <span className="ml-auto text-[var(--cm-fg-tertiary)]">
                        {formatRelative(n.createdAt)}
                      </span>
                    </div>
                    <p
                      className={`text-[15px] leading-[1.55] ${n.read ? "text-[var(--cm-fg-secondary)]" : "text-[var(--cm-fg)]"}`}
                      style={{ fontFamily: "var(--cm-font-serif)" }}
                    >
                      {n.encrypted
                        ? <span className="text-[var(--cm-fg-tertiary)] italic">(encrypted — open the topic to decrypt)</span>
                        : n.snippet || <span className="text-[var(--cm-fg-tertiary)] italic">(empty)</span>}
                    </p>
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
