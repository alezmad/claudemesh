import Link from "next/link";

import { pathsConfig } from "~/config/paths";

interface Mention {
  id: string;
  meshId: string;
  meshName: string;
  topicName: string;
  senderName: string;
  snippet: string;
  createdAt: string;
}

const monoStyle = { fontFamily: "var(--cm-font-mono)" } as const;
const serifStyle = { fontFamily: "var(--cm-font-serif)", fontWeight: 400 } as const;

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

/**
 * Highlight @mentions in clay so the reader's eye lands on the call-out.
 * Matches the in-chat renderer; kept inline here to avoid pulling the
 * client component into the server-rendered universe page.
 */
function renderSnippet(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(^|\s)(@[A-Za-z0-9_-]+)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + (m[1]?.length ?? 0);
    if (start > lastIndex) {
      parts.push(<span key={key++}>{text.slice(lastIndex, start)}</span>);
    }
    parts.push(
      <span key={key++} className="text-[var(--cm-clay)] font-medium">
        {m[2]}
      </span>,
    );
    lastIndex = start + (m[2]?.length ?? 0);
  }
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }
  return parts;
}

export const MentionsSection = ({ mentions }: { mentions: Mention[] }) => {
  if (mentions.length === 0) return null;

  return (
    <section className="mb-14">
      <div className="mb-6 flex items-baseline justify-between gap-6">
        <h2
          className="text-[28px] leading-none tracking-tight"
          style={serifStyle}
        >
          Recent <span className="italic text-[var(--cm-clay)]">mentions</span>
        </h2>
        <span
          className="text-[11px] uppercase tracking-[0.14em] text-[var(--cm-fg-tertiary)]"
          style={monoStyle}
        >
          {mentions.length} · last 7 days
        </span>
      </div>

      <ol className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {mentions.map((m) => (
          <li key={m.id}>
            <Link
              href={pathsConfig.dashboard.user.meshes.topic(m.meshId, m.topicName)}
              className="group flex flex-col gap-2 rounded-md border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-4 py-3 transition-colors hover:border-[var(--cm-border-hover)] hover:bg-[var(--cm-bg-hover)]"
            >
              <div
                className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[var(--cm-fg-tertiary)]"
                style={monoStyle}
              >
                <span className="text-[var(--cm-fg-secondary)]">{m.meshName}</span>
                <span>·</span>
                <span>
                  <span className="text-[var(--cm-clay)]">#</span>
                  {m.topicName}
                </span>
                <span>·</span>
                <span>{fmtRelative(m.createdAt)}</span>
                <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
                  open →
                </span>
              </div>
              <p className="text-[13px] text-[var(--cm-fg)] line-clamp-2">
                <span
                  className="text-[var(--cm-fg-secondary)]"
                  style={monoStyle}
                >
                  {m.senderName}
                </span>{" "}
                {renderSnippet(m.snippet)}
              </p>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
};
