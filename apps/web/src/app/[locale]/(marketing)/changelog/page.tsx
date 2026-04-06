export const metadata = {
  title: "Changelog — claudemesh",
  description: "Release history for claudemesh-cli.",
};

const ENTRIES = [
  { version: "0.1.4", date: "2026-04-06", type: "feat", summary: "Stateful welcome screen, PROTOCOL.md, THREAT_MODEL.md, Windows CI matrix" },
  { version: "0.1.3", date: "2026-04-05", type: "feat", summary: "claudemesh --version, status, doctor commands" },
  { version: "0.1.2", date: "2026-04-05", type: "feat", summary: "claudemesh launch command, transparency banner, decrypt fix, Windows support" },
];

const TYPE_LABELS: Record<string, string> = { feat: "Feature", fix: "Fix", docs: "Docs" };
const TYPE_COLORS: Record<string, string> = { feat: "bg-[var(--cm-clay)]", fix: "bg-[var(--cm-cactus)]", docs: "bg-[var(--cm-oat)]" };

export default function ChangelogPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24 md:py-32">
      <h1
        className="text-[clamp(2rem,4.5vw,3rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
        style={{ fontFamily: "var(--cm-font-serif)" }}
      >
        Changelog
      </h1>
      <p
        className="mt-4 text-[15px] text-[var(--cm-fg-secondary)]"
        style={{ fontFamily: "var(--cm-font-sans)" }}
      >
        Every shipped version of claudemesh-cli.
      </p>
      <div className="mt-12 space-y-8">
        {ENTRIES.map((entry) => (
          <article key={entry.version} className="border-b border-[var(--cm-border)] pb-6">
            <div className="flex items-center gap-3">
              <span
                className={`rounded-[4px] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--cm-bg)] ${TYPE_COLORS[entry.type] || "bg-[var(--cm-fg-tertiary)]"}`}
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                {TYPE_LABELS[entry.type] || entry.type}
              </span>
              <span className="text-[18px] font-medium text-[var(--cm-fg)]" style={{ fontFamily: "var(--cm-font-serif)" }}>
                v{entry.version}
              </span>
              <time dateTime={entry.date} className="text-[11px] text-[var(--cm-fg-tertiary)]" style={{ fontFamily: "var(--cm-font-mono)" }}>
                {new Date(entry.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
              </time>
            </div>
            <p className="mt-2 text-[14px] leading-[1.6] text-[var(--cm-fg-secondary)]" style={{ fontFamily: "var(--cm-font-sans)" }}>
              {entry.summary}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
