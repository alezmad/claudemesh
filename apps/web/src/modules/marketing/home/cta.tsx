import Link from "next/link";
import { Reveal, SectionIcon } from "./_reveal";

export const CallToAction = () => {
  return (
    <section className="relative overflow-hidden bg-[var(--cm-bg)] px-6 py-32 md:px-12 md:py-40">
      <div
        className="absolute inset-0 z-0 opacity-[0.1]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 100%, var(--cm-clay) 0%, transparent 55%)",
        }}
      />
      <div className="relative z-10 mx-auto max-w-5xl text-center">
        <Reveal className="mb-8 flex justify-center">
          <SectionIcon glyph="mesh" />
        </Reveal>
        <Reveal delay={1}>
          <h2
            className="text-[clamp(2.25rem,5.5vw,4.5rem)] font-medium leading-[1.05] tracking-tight text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Connect what&apos;s scattered.
            <br />
            <span className="italic text-[var(--cm-clay)]">
              Ship what ships together.
            </span>
          </h2>
        </Reveal>
        <Reveal delay={2}>
          <p
            className="mx-auto mt-8 max-w-2xl text-lg leading-[1.65] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Anthropic built Claude Code per developer. The next unlock is
            between developers. Build the layer with us.
          </p>
        </Reveal>
        <Reveal delay={3}>
          <div className="mt-12 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Link
              href="/auth/register"
              className="group inline-flex items-center justify-center gap-2 rounded-[var(--cm-radius-xs)] bg-[var(--cm-clay)] px-6 py-3.5 text-[15px] font-medium text-[var(--cm-fg)] transition-colors duration-300 hover:bg-[var(--cm-clay-hover)]"
              style={{ fontFamily: "var(--cm-font-sans)" }}
            >
              Start free
              <span className="transition-transform duration-300 group-hover:translate-x-0.5">
                →
              </span>
            </Link>
            <Link
              href="#docs"
              className="inline-flex items-center justify-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-fg-tertiary)] px-6 py-3.5 text-[15px] font-medium text-[var(--cm-fg)] transition-colors duration-300 hover:border-[var(--cm-fg)] hover:bg-[var(--cm-bg-elevated)]"
              style={{ fontFamily: "var(--cm-font-sans)" }}
            >
              Read the docs
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
