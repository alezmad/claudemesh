import Link from "next/link";

import {
  CHANGELOG_ENTRIES,
  CHANGELOG_TYPE_COLOR,
  CHANGELOG_TYPE_LABELS,
} from "./changelog-data";
import { Reveal, SectionIcon } from "./_reveal";

/**
 * Compact recent-releases strip for the home page. Pulls the top N entries
 * from the same data source as the full /changelog page so they never
 * disagree.
 */
export const LatestReleases = ({ count = 5 }: { count?: number }) => {
  const recent = CHANGELOG_ENTRIES.slice(0, count);

  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-6 py-24 md:px-12 md:py-28">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="grid" />
        </Reveal>

        <Reveal delay={1}>
          <p
            className="text-center text-[11px] uppercase tracking-[0.2em] text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            release log · last {count} ships
          </p>
        </Reveal>

        <Reveal delay={2}>
          <h2
            className="mt-3 text-center text-[clamp(1.75rem,3.5vw,2.5rem)] font-medium leading-[1.15] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            What shipped this week
          </h2>
        </Reveal>

        <Reveal delay={3}>
          <p
            className="mx-auto mt-3 max-w-xl text-center text-[14px] leading-[1.65] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            Every release is in production on{" "}
            <span
              className="text-[var(--cm-fg)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              wss://ic.claudemesh.com
            </span>{" "}
            within minutes. The CLI publishes to npm; the broker auto-deploys.
          </p>
        </Reveal>

        <Reveal delay={4}>
          <ol className="mx-auto mt-12 max-w-3xl space-y-4">
            {recent.map((entry, idx) => (
              <li key={entry.version + entry.date}>
                <Link
                  href="/changelog"
                  className="group block rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg)] p-5 transition-colors hover:border-[var(--cm-clay)]/40"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span
                      className="rounded-[3px] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                      style={{
                        fontFamily: "var(--cm-font-mono)",
                        backgroundColor: CHANGELOG_TYPE_COLOR[entry.type],
                        color: "var(--cm-gray-900)",
                      }}
                    >
                      {CHANGELOG_TYPE_LABELS[entry.type]}
                    </span>
                    <span
                      className="text-[16px] font-medium text-[var(--cm-fg)]"
                      style={{ fontFamily: "var(--cm-font-serif)" }}
                    >
                      v{entry.version}
                    </span>
                    <time
                      dateTime={entry.date}
                      className="text-[11px] text-[var(--cm-fg-tertiary)]"
                      style={{ fontFamily: "var(--cm-font-mono)" }}
                    >
                      {new Date(entry.date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                    {idx === 0 && (
                      <span
                        className="rounded-full bg-[var(--cm-clay)]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--cm-clay)]"
                        style={{ fontFamily: "var(--cm-font-mono)" }}
                      >
                        latest
                      </span>
                    )}
                  </div>
                  <h3
                    className="mt-2.5 text-[15px] font-medium text-[var(--cm-fg)] transition-colors group-hover:text-[var(--cm-clay)]"
                    style={{ fontFamily: "var(--cm-font-sans)" }}
                  >
                    {entry.title}
                  </h3>
                  <p
                    className="mt-2 line-clamp-2 text-[13px] leading-[1.6] text-[var(--cm-fg-secondary)]"
                    style={{ fontFamily: "var(--cm-font-sans)" }}
                  >
                    {entry.summary}
                  </p>
                </Link>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal delay={5}>
          <div className="mt-10 flex justify-center">
            <Link
              href="/changelog"
              className="group inline-flex items-center gap-2 text-[13px] font-medium text-[var(--cm-fg-secondary)] transition-colors hover:text-[var(--cm-clay)]"
              style={{ fontFamily: "var(--cm-font-sans)" }}
            >
              <span className="border-b border-dashed border-[var(--cm-fg-tertiary)] pb-0.5 transition-colors group-hover:border-[var(--cm-clay)]">
                Read the full changelog
              </span>
              <span className="transition-transform duration-300 group-hover:translate-x-1">
                →
              </span>
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
