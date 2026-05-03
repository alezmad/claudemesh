import Link from "next/link";

import { db } from "@turbostarter/db/server";
import {
  mesh,
  meshMember,
  meshTopic,
  meshTopicMessage,
} from "@turbostarter/db/schema/mesh";
import { aliasedTable, and, desc, eq, gt, inArray, isNull, notInArray } from "drizzle-orm";

import { pathsConfig } from "~/config/paths";
import { getSession } from "~/lib/auth/server";
import { getMetadata } from "~/lib/metadata";
import { Reveal } from "~/modules/dashboard/universe/reveal";

export const generateMetadata = getMetadata({
  title: "Activity",
  description: "Recent messages across every mesh, last 24 hours.",
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

export default async function WorkspaceActivityPage() {
  const { user } = await getSession();
  if (!user) return null;

  const memberships = await db
    .select({ memberId: meshMember.id, meshId: meshMember.meshId })
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
  const meshIds = memberships.map((m) => m.meshId);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const senderMember = aliasedTable(meshMember, "sender_member");
  const rows = meshIds.length && myMemberIds.length
    ? await db
        .select({
          messageId: meshTopicMessage.id,
          topicName: meshTopic.name,
          meshId: meshTopic.meshId,
          meshSlug: mesh.slug,
          senderName: senderMember.displayName,
          ciphertext: meshTopicMessage.ciphertext,
          bodyVersion: meshTopicMessage.bodyVersion,
          createdAt: meshTopicMessage.createdAt,
        })
        .from(meshTopicMessage)
        .innerJoin(meshTopic, eq(meshTopic.id, meshTopicMessage.topicId))
        .innerJoin(mesh, eq(mesh.id, meshTopic.meshId))
        .leftJoin(
          senderMember,
          eq(senderMember.id, meshTopicMessage.senderMemberId),
        )
        .where(
          and(
            inArray(meshTopic.meshId, meshIds),
            isNull(meshTopic.archivedAt),
            gt(meshTopicMessage.createdAt, since),
            notInArray(meshTopicMessage.senderMemberId, myMemberIds),
          ),
        )
        .orderBy(desc(meshTopicMessage.createdAt))
        .limit(200)
    : [];

  const items = rows.map((r) => ({
    messageId: r.messageId,
    topicName: r.topicName,
    meshId: r.meshId,
    meshSlug: r.meshSlug,
    senderName: r.senderName ?? "?",
    snippet: r.bodyVersion === 1 ? decode(r.ciphertext).slice(0, 240) : null,
    encrypted: r.bodyVersion === 2,
    createdAt: r.createdAt.toISOString(),
  }));

  // Group consecutive entries by mesh+topic so a chatty thread reads
  // as a cluster rather than 20 identical headers.
  const clusters: Array<{ meshId: string; meshSlug: string; topicName: string; messages: typeof items }> = [];
  for (const m of items) {
    const last = clusters[clusters.length - 1];
    if (last && last.meshId === m.meshId && last.topicName === m.topicName) {
      last.messages.push(m);
    } else {
      clusters.push({
        meshId: m.meshId,
        meshSlug: m.meshSlug,
        topicName: m.topicName,
        messages: [m],
      });
    }
  }

  return (
    <div className="@container relative h-full p-6 md:p-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 25% -10%, rgba(188,209,202,0.08), transparent 70%)",
        }}
      />
      <div className="relative z-10 mx-auto max-w-[900px]">
        <header className="mb-10 grid gap-6 border-b border-[var(--cm-border-soft,rgba(217,119,87,0.1))] pb-8 md:mb-14 md:grid-cols-[1fr_auto] md:items-end md:pb-10">
          <Reveal delay={0}>
            <h1
              className="text-[clamp(2rem,1.6rem+2.5vw,3.25rem)] leading-[1.05] tracking-tight"
              style={{ fontFamily: "var(--cm-font-serif)", fontWeight: 400 }}
            >
              <span className="italic text-[var(--cm-fg-tertiary)]">What you</span>{" "}
              <span className="italic text-[var(--cm-clay)]">missed</span>.
            </h1>
          </Reveal>

          <Reveal delay={1}>
            <div className="flex items-baseline gap-6 font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]">
              <span>
                <span className="mr-2 text-[var(--cm-fg)]">{items.length}</span>
                events
              </span>
              <span>
                <span className="mr-2 text-[var(--cm-fg)]">{clusters.length}</span>
                threads
              </span>
              <span>
                <span className="mr-2 text-[var(--cm-fg)]">24h</span>
                window
              </span>
            </div>
          </Reveal>
        </header>

        {clusters.length === 0 ? (
          <p className="text-[var(--cm-fg-secondary)]">
            Quiet on every front. Nothing posted in the last 24 hours.
          </p>
        ) : (
          <ul className="flex flex-col gap-8">
            {clusters.map((c, ci) => (
              <Reveal key={`${c.meshId}-${c.topicName}-${ci}`} delay={Math.min(ci, 8)}>
                <li>
                  <Link
                    href={pathsConfig.dashboard.user.meshes.topic(c.meshId, c.topicName)}
                    className="mb-3 flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--cm-fg-tertiary)] hover:text-[var(--cm-clay)]"
                  >
                    <span>{c.meshSlug}</span>
                    <span className="text-[var(--cm-clay)]">#{c.topicName}</span>
                    <span className="ml-auto">{c.messages.length} msg{c.messages.length === 1 ? "" : "s"}</span>
                  </Link>
                  <ol className="flex flex-col gap-2 border-l border-[var(--cm-border-soft,rgba(217,119,87,0.1))] pl-4">
                    {c.messages.map((m) => (
                      <li key={m.messageId} className="flex flex-col gap-1">
                        <div className="flex items-baseline gap-2 text-[12px]">
                          <span className="font-medium text-[var(--cm-fg)]">{m.senderName}</span>
                          <span className="text-[var(--cm-fg-tertiary)]">{formatRelative(m.createdAt)}</span>
                        </div>
                        <p
                          className="text-[14px] leading-[1.55] text-[var(--cm-fg-secondary)]"
                          style={{ fontFamily: "var(--cm-font-serif)" }}
                        >
                          {m.encrypted
                            ? <span className="italic text-[var(--cm-fg-tertiary)]">(encrypted)</span>
                            : m.snippet || <span className="italic text-[var(--cm-fg-tertiary)]">(empty)</span>}
                        </p>
                      </li>
                    ))}
                  </ol>
                </li>
              </Reveal>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
