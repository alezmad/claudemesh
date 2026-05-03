import Link from "next/link";

import { db } from "@turbostarter/db/server";
import {
  mesh,
  meshMember,
  meshTopic,
  meshTopicMessage,
} from "@turbostarter/db/schema/mesh";
import { aliasedTable, and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { pathsConfig } from "~/config/paths";
import { getSession } from "~/lib/auth/server";
import { getMetadata } from "~/lib/metadata";
import { Reveal } from "~/modules/dashboard/universe/reveal";

export const generateMetadata = getMetadata({
  title: "Search",
  description: "Find topics, messages, and people across every mesh.",
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

const Highlight = ({ text, query }: { text: string; query: string }) => {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[rgba(217,119,87,0.18)] px-0.5 text-[var(--cm-clay)]">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
};

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function WorkspaceSearchPage({ searchParams }: PageProps) {
  const { user } = await getSession();
  if (!user) return null;

  const params = await searchParams;
  const q = (params.q ?? "").trim();

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

  const meshIds = memberships.map((m) => m.meshId);

  let topicHits: Array<{
    id: string;
    name: string;
    description: string | null;
    meshId: string;
    meshSlug: string;
  }> = [];
  let messageHits: Array<{
    messageId: string;
    topicId: string;
    topicName: string;
    meshId: string;
    meshSlug: string;
    senderName: string;
    snippet: string | null;
    encrypted: boolean;
    createdAt: string;
  }> = [];

  if (q.length >= 2 && meshIds.length > 0) {
    const pattern = `%${q.toLowerCase()}%`;
    topicHits = await db
      .select({
        id: meshTopic.id,
        name: meshTopic.name,
        description: meshTopic.description,
        meshId: meshTopic.meshId,
        meshSlug: mesh.slug,
      })
      .from(meshTopic)
      .innerJoin(mesh, eq(mesh.id, meshTopic.meshId))
      .where(
        and(
          inArray(meshTopic.meshId, meshIds),
          isNull(meshTopic.archivedAt),
          sql`lower(${meshTopic.name}) like ${pattern}`,
        ),
      )
      .orderBy(asc(meshTopic.name))
      .limit(50);

    const senderMember = aliasedTable(meshMember, "sender_member");
    const messageWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const candidates = await db
      .select({
        messageId: meshTopicMessage.id,
        topicId: meshTopicMessage.topicId,
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
      .leftJoin(senderMember, eq(senderMember.id, meshTopicMessage.senderMemberId))
      .where(
        and(
          inArray(meshTopic.meshId, meshIds),
          isNull(meshTopic.archivedAt),
          gt(meshTopicMessage.createdAt, messageWindow),
        ),
      )
      .orderBy(desc(meshTopicMessage.createdAt))
      .limit(2000);

    const qLower = q.toLowerCase();
    for (const r of candidates) {
      const sender = r.senderName ?? "?";
      const snippet = r.bodyVersion === 1 ? decode(r.ciphertext).slice(0, 240) : null;
      const matched =
        (snippet && snippet.toLowerCase().includes(qLower)) ||
        sender.toLowerCase().includes(qLower) ||
        r.topicName.toLowerCase().includes(qLower);
      if (!matched) continue;
      messageHits.push({
        messageId: r.messageId,
        topicId: r.topicId,
        topicName: r.topicName,
        meshId: r.meshId,
        meshSlug: r.meshSlug,
        senderName: sender,
        snippet,
        encrypted: r.bodyVersion === 2,
        createdAt: r.createdAt.toISOString(),
      });
      if (messageHits.length >= 50) break;
    }
  }

  return (
    <div className="@container relative h-full p-6 md:p-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% -10%, rgba(217,119,87,0.06), transparent 70%)",
        }}
      />
      <div className="relative z-10 mx-auto max-w-[900px]">
        <header className="mb-10 border-b border-[var(--cm-border-soft,rgba(217,119,87,0.1))] pb-8 md:mb-14 md:pb-10">
          <Reveal delay={0}>
            <h1
              className="mb-6 text-[clamp(2rem,1.6rem+2.5vw,3.25rem)] leading-[1.05] tracking-tight"
              style={{ fontFamily: "var(--cm-font-serif)", fontWeight: 400 }}
            >
              <span className="italic text-[var(--cm-fg-tertiary)]">Find</span>{" "}
              <span className="italic text-[var(--cm-clay)]">anything</span>.
            </h1>
          </Reveal>

          <Reveal delay={1}>
            <form method="get" className="flex items-center gap-3">
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="topic, sender, or text…"
                autoFocus
                className="flex-1 rounded-md border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-4 py-2.5 text-[15px] text-[var(--cm-fg)] placeholder-[var(--cm-fg-tertiary)] outline-none focus:border-[var(--cm-clay)] focus:ring-1 focus:ring-[rgba(217,119,87,0.3)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              />
              <button
                type="submit"
                className="rounded-md border border-[var(--cm-clay)] bg-[var(--cm-clay)] px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.18em] text-white hover:opacity-90"
              >
                Search
              </button>
            </form>
            {q && q.length < 2 ? (
              <p className="mt-3 text-[12px] text-[var(--cm-fg-tertiary)]">Type at least 2 characters.</p>
            ) : null}
            {q && q.length >= 2 ? (
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]">
                <span className="mr-2 text-[var(--cm-fg)]">{topicHits.length}</span>topics ·
                <span className="mx-2 text-[var(--cm-fg)]">{messageHits.length}</span>messages
                · 30-day window for messages
              </p>
            ) : null}
          </Reveal>
        </header>

        {q.length < 2 ? (
          <p className="text-[var(--cm-fg-secondary)]">
            Search across every mesh you belong to. Topic names, sender display names, and message text (v1 messages decoded; v2 ciphertext matched only by topic + sender).
          </p>
        ) : topicHits.length === 0 && messageHits.length === 0 ? (
          <p className="text-[var(--cm-fg-secondary)]">
            No matches for "<span className="text-[var(--cm-clay)]">{q}</span>".
          </p>
        ) : (
          <div className="flex flex-col gap-10">
            {topicHits.length > 0 ? (
              <section>
                <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]">
                  Topics
                </h2>
                <ul className="flex flex-col">
                  {topicHits.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={pathsConfig.dashboard.user.meshes.topic(t.meshId, t.name)}
                        className="flex items-baseline gap-4 border-b border-[var(--cm-border-soft,rgba(217,119,87,0.08))] py-3 hover:bg-[var(--cm-bg-hover)]"
                      >
                        <span className="w-32 shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--cm-fg-tertiary)]">
                          {t.meshSlug}
                        </span>
                        <span
                          className="text-[18px] tracking-tight text-[var(--cm-fg)]"
                          style={{ fontFamily: "var(--cm-font-serif)" }}
                        >
                          #<Highlight text={t.name} query={q} />
                        </span>
                        {t.description ? (
                          <span className="hidden truncate text-[13px] text-[var(--cm-fg-tertiary)] md:inline">
                            — {t.description}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {messageHits.length > 0 ? (
              <section>
                <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]">
                  Messages
                </h2>
                <ul className="flex flex-col gap-3">
                  {messageHits.map((m) => (
                    <li
                      key={m.messageId}
                      className="rounded-md border border-[var(--cm-border-soft,rgba(217,119,87,0.1))] bg-[var(--cm-bg-elevated)] px-5 py-4"
                    >
                      <Link
                        href={pathsConfig.dashboard.user.meshes.topic(m.meshId, m.topicName)}
                        className="block"
                      >
                        <div className="mb-2 flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--cm-fg-tertiary)]">
                          <span>{m.meshSlug}</span>
                          <span className="text-[var(--cm-clay)]">
                            #<Highlight text={m.topicName} query={q} />
                          </span>
                          <span>
                            from <Highlight text={m.senderName} query={q} />
                          </span>
                          <span className="ml-auto">{formatRelative(m.createdAt)}</span>
                        </div>
                        <p
                          className="text-[14px] leading-[1.55] text-[var(--cm-fg-secondary)]"
                          style={{ fontFamily: "var(--cm-font-serif)" }}
                        >
                          {m.encrypted ? (
                            <span className="italic text-[var(--cm-fg-tertiary)]">
                              (encrypted — open the topic to decrypt)
                            </span>
                          ) : m.snippet ? (
                            <Highlight text={m.snippet} query={q} />
                          ) : (
                            <span className="italic text-[var(--cm-fg-tertiary)]">(empty)</span>
                          )}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
