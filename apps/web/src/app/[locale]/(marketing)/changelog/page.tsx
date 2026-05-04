import Link from "next/link";

import {
  CHANGELOG_ENTRIES,
  CHANGELOG_TYPE_COLOR,
  CHANGELOG_TYPE_LABELS,
} from "~/modules/marketing/home/changelog-data";

export const metadata = {
  title: "Changelog — claudemesh",
  description:
    "Release history for claudemesh-cli — every shipped version, with the why behind it.",
};

export default function ChangelogPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24 md:py-32">
      <div className="mb-12">
        <p
          className="text-[11px] uppercase tracking-[0.2em] text-[var(--cm-fg-tertiary)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          claudemesh-cli · release log
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,4.5vw,3rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Changelog
        </h1>
        <p
          className="mt-4 max-w-xl text-[15px] leading-[1.65] text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-sans)" }}
        >
          Hand-picked, load-bearing ships from{" "}
          <span className="text-[var(--cm-fg)]">v0.1.0</span> through{" "}
          <span className="text-[var(--cm-clay)]">v1.34.15</span>. For the
          byte-level diff, the canonical{" "}
          <Link
            href="https://github.com/alezmad/claudemesh/blob/main/apps/cli/CHANGELOG.md"
            className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 transition-colors hover:text-[var(--cm-fg)] hover:decoration-[var(--cm-clay)]"
          >
            CHANGELOG.md
          </Link>{" "}
          lives in the repo.
        </p>
      </div>

      {/* Vertical timeline rail */}
      <div className="relative">
        <div
          className="absolute left-[7px] top-2 hidden h-full w-px md:block"
          style={{
            background:
              "linear-gradient(to bottom, var(--cm-clay) 0%, var(--cm-fig) 30%, var(--cm-cactus) 60%, transparent 100%)",
          }}
        />

        <div className="space-y-10">
          {CHANGELOG_ENTRIES.map((entry, idx) => (
            <article
              key={entry.version + entry.date}
              className="relative md:pl-10"
            >
              {/* Dot on rail */}
              <div
                className="absolute left-0 top-[10px] hidden h-[15px] w-[15px] rounded-full border-2 md:block"
                style={{
                  borderColor: CHANGELOG_TYPE_COLOR[entry.type],
                  backgroundColor: "var(--cm-bg)",
                }}
              >
                <div
                  className="absolute inset-[3px] rounded-full"
                  style={{
                    backgroundColor: CHANGELOG_TYPE_COLOR[entry.type],
                    opacity: idx === 0 ? 1 : 0.5,
                  }}
                />
              </div>

              <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
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
                  className="text-[18px] font-medium text-[var(--cm-fg)]"
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
              </header>

              <h2
                className="text-[15px] font-medium text-[var(--cm-fg)]"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                {entry.title}
              </h2>

              <p
                className="mt-2 text-[14px] leading-[1.7] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                {entry.summary}
              </p>
            </article>
          ))}
        </div>
      </div>

      <footer className="mt-20 border-t border-[var(--cm-border)] pt-8">
        <p
          className="text-[13px] text-[var(--cm-fg-tertiary)]"
          style={{ fontFamily: "var(--cm-font-sans)" }}
        >
          Tracked at{" "}
          <Link
            href="https://github.com/alezmad/claudemesh/blob/main/docs/roadmap.md"
            className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 transition-colors hover:text-[var(--cm-fg)] hover:decoration-[var(--cm-clay)]"
          >
            docs/roadmap.md
          </Link>
          . Specs at{" "}
          <Link
            href="https://github.com/alezmad/claudemesh/tree/main/.artifacts/specs"
            className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 transition-colors hover:text-[var(--cm-fg)] hover:decoration-[var(--cm-clay)]"
          >
            .artifacts/specs/
          </Link>
          . Tagged binaries on{" "}
          <Link
            href="https://github.com/alezmad/claudemesh/releases"
            className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 transition-colors hover:text-[var(--cm-fg)] hover:decoration-[var(--cm-clay)]"
          >
            GitHub Releases
          </Link>
          .
        </p>
      </footer>
    </section>
  );
}
