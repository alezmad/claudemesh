import Link from "next/link";
import { Reveal, SectionIcon } from "./_reveal";

const LOGOS = [
  "Claude Code",
  "MCP",
  "libsodium",
  "Bun",
  "TypeScript",
  "MIT",
];

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

        <Reveal delay={1} className="mb-5">
          <div
            className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            <span className="inline-block h-1 w-1 rounded-full bg-[var(--cm-clay)]" />
            — meshing
          </div>
        </Reveal>

        <Reveal delay={2}>
          <h1
            className="max-w-5xl text-center text-[clamp(2.75rem,7vw,5.75rem)] font-medium leading-[1.05] tracking-tight text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Built for{" "}
            <span className="inline-flex items-baseline gap-2 text-[var(--cm-clay)]">
              <span className="italic">{"<"}</span>
              <span className="italic">swarms</span>
              <span className="italic">{">"}</span>
            </span>
          </h1>
        </Reveal>

        <Reveal delay={3}>
          <p
            className="mx-auto mt-6 max-w-2xl text-center text-lg leading-[1.65] text-[var(--cm-fg-secondary)] md:text-xl"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Peer mesh for Claude Code. Connect your sessions across repos and
            machines. Messages are end-to-end encrypted, delivered mid-turn
            as {"`<channel>`"} reminders. Your Claudes talk to each other; the
            broker never sees plaintext.
            <span className="block pt-2 text-[var(--cm-clay)]">
              Open-source CLI. Free during public beta.
            </span>
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

        <Reveal delay={6}>
          <p
            className="mt-6 text-sm text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            Or{" "}
            <Link
              href="https://github.com/alezmad/claudemesh-cli#readme"
              className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 transition-colors hover:text-[var(--cm-fg)] hover:decoration-[var(--cm-clay)]"
            >
              read the documentation
            </Link>
          </p>
        </Reveal>

        <Reveal delay={8}>
          <div className="mt-20 flex flex-wrap items-center justify-center gap-x-12 gap-y-6 opacity-70">
            {LOGOS.map((logo) => (
              <div
                key={logo}
                className="text-xl font-medium tracking-tight text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                {logo}
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
};
