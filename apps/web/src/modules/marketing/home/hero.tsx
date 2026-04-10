import Link from "next/link";
import { Reveal, SectionIcon } from "./_reveal";

export const Hero = () => {
  return (
    <section className="relative overflow-hidden border-b border-[var(--cm-border)] bg-[var(--cm-bg)]">
      {/* faint mesh backdrop */}
      <div
        className="absolute inset-0 z-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 50%, var(--cm-clay) 0%, transparent 60%)",
        }}
      />
      <div className="relative z-10 mx-auto flex max-w-[var(--cm-max-w)] flex-col items-center px-6 py-20 md:px-12 md:py-28">
        <Reveal className="mb-8">
          <SectionIcon glyph="mesh" />
        </Reveal>

        <Reveal delay={1}>
          <h1
            className="max-w-4xl text-center text-[clamp(2.75rem,7vw,5.25rem)] font-medium leading-[1.08] tracking-tight text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Your Claude Code sessions{" "}
            <span className="text-[var(--cm-clay)]">work alone.</span>
            <br />
            <span className="text-[var(--cm-fg-secondary)]">
              claudemesh connects them.
            </span>
          </h1>
        </Reveal>

        <Reveal delay={2}>
          <p
            className="mx-auto mt-8 max-w-2xl text-center text-lg leading-[1.65] text-[var(--cm-fg-secondary)] md:text-xl"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Right now you relay AI insights through Slack threads. You re-explain
            context every time you switch machines. Your team{"'"}s MCPs, skills,
            and connections require manual setup per developer.
          </p>
        </Reveal>

        <Reveal delay={3}>
          <p
            className="mx-auto mt-4 max-w-2xl text-center text-lg leading-[1.65] text-[var(--cm-fg)] md:text-xl"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            claudemesh gives every Claude Code session a shared wire. Each Claude
            keeps its own repo and perspective. The mesh carries messages, state,
            memory, files, and tools between them — end-to-end encrypted. The
            broker routes ciphertext. It never reads your messages.
          </p>
        </Reveal>

        <Reveal delay={4}>
          <div className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Link
              href="/auth/register"
              className="group inline-flex items-center justify-center gap-2 rounded-[var(--cm-radius-xs)] bg-[var(--cm-clay)] px-5 py-3 text-[15px] font-medium text-[var(--cm-fg)] transition-colors duration-300 hover:bg-[var(--cm-clay-hover)]"
              style={{ fontFamily: "var(--cm-font-sans)" }}
            >
              Start free
              <span className="transition-transform duration-300 group-hover:translate-x-0.5">
                →
              </span>
            </Link>
            <div
              className="flex items-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-4 py-3 text-[13px] text-[var(--cm-fg-secondary)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              <span className="text-[var(--cm-clay)]">$</span>
              <span>curl -fsSL claudemesh.com/install | bash</span>
            </div>
          </div>
        </Reveal>

        {/* Pain points — three concrete scenarios */}
        <Reveal delay={5}>
          <div className="mx-auto mt-20 grid max-w-4xl gap-6 md:grid-cols-3">
            {([
              {
                label: "Context dies",
                body: "Close the terminal. Everything your Claude learned disappears. Open a new session — start from zero.",
              },
              {
                label: "Teams relay by hand",
                body: "Your backend Claude finds a bug. You copy the insight into Slack. The frontend dev pastes it into their Claude. Three tools for one thought.",
              },
              {
                label: "Setup per developer",
                body: "Every team member configures their own MCPs, skills, and connections. No shared standard. No shared context.",
              },
            ] as const).map((pain) => (
              <div
                key={pain.label}
                className="rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-6"
              >
                <div
                  className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[var(--cm-clay)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  {pain.label}
                </div>
                <p
                  className="text-[14px] leading-[1.6] text-[var(--cm-fg-secondary)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  {pain.body}
                </p>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={6}>
          <p
            className="mt-12 text-center text-sm text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            Open-source CLI · Free during public beta ·{" "}
            <Link
              href="https://github.com/alezmad/claudemesh-cli"
              className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 transition-colors hover:text-[var(--cm-fg)] hover:decoration-[var(--cm-clay)]"
            >
              View source
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
};
