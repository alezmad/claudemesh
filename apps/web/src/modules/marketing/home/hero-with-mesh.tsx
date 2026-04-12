import Link from "next/link";

import { HeroMeshAnimation } from "./hero-mesh-animation";
import { Reveal, SectionIcon } from "./_reveal";

export const HeroWithMesh = () => {
  return (
    <section className="relative overflow-hidden border-b border-[var(--cm-border)] bg-[var(--cm-bg)]">
      {/* Full-bleed mesh animation as hero background */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute inset-0">
          <HeroMeshAnimation fit="cover" />
        </div>
        {/* Radial vignette: dark where text sits, transparent at the edges
            so the corner peers keep pulsing visibly */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 900px 540px at 50% 38%, rgba(5,5,5,0.92) 0%, rgba(5,5,5,0.75) 38%, rgba(5,5,5,0.3) 68%, rgba(5,5,5,0) 100%)",
          }}
        />
        {/* Top/bottom fades so the animation bleeds into surrounding sections */}
        <div
          className="absolute inset-x-0 top-0 h-32"
          style={{
            background:
              "linear-gradient(to bottom, rgba(5,5,5,0.85) 0%, rgba(5,5,5,0) 100%)",
          }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-32"
          style={{
            background:
              "linear-gradient(to top, rgba(5,5,5,0.95) 0%, rgba(5,5,5,0) 100%)",
          }}
        />
      </div>

      <div className="relative z-10 mx-auto flex max-w-[var(--cm-max-w)] flex-col items-center px-6 py-24 md:px-12 md:py-32">
        <Reveal className="mb-8">
          <SectionIcon glyph="mesh" />
        </Reveal>

        <Reveal delay={1}>
          <h1
            className="max-w-4xl text-center text-[clamp(2.75rem,7vw,5.25rem)] font-medium leading-[1.08] tracking-tight text-[var(--cm-fg)]"
            style={{
              fontFamily: "var(--cm-font-serif)",
              textShadow: "0 2px 30px rgba(0,0,0,0.85)",
            }}
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
            style={{
              fontFamily: "var(--cm-font-serif)",
              textShadow: "0 2px 20px rgba(0,0,0,0.8)",
            }}
          >
            Share context, files, skills, and MCPs across every Claude Code
            session — end-to-end encrypted. Hosted on claudemesh.com or
            self-hosted in your VPC. Same CLI, same wire, your choice.
          </p>
        </Reveal>

        <Reveal delay={3}>
          <div className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Link
              href="/auth/register"
              className="group inline-flex items-center justify-center gap-2 rounded-[var(--cm-radius-xs)] bg-[var(--cm-clay)] px-5 py-3 text-[15px] font-medium text-[var(--cm-fg)] shadow-[0_10px_40px_rgba(215,119,87,0.35)] transition-colors duration-300 hover:bg-[var(--cm-clay-hover)]"
              style={{ fontFamily: "var(--cm-font-sans)" }}
            >
              Start free
              <span className="transition-transform duration-300 group-hover:translate-x-0.5">
                →
              </span>
            </Link>
            <div
              className="flex items-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/85 px-4 py-3 text-[13px] text-[var(--cm-fg-secondary)] backdrop-blur-md"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              <span className="text-[var(--cm-clay)]">$</span>
              <span>curl -fsSL claudemesh.com/install | bash</span>
            </div>
          </div>
        </Reveal>

        <Reveal delay={4}>
          <p
            className="mt-14 text-center text-sm text-[var(--cm-fg-tertiary)]"
            style={{
              fontFamily: "var(--cm-font-sans)",
              textShadow: "0 2px 16px rgba(0,0,0,0.8)",
            }}
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
