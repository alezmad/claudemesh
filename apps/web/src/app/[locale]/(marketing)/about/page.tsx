import Link from "next/link";
import { Reveal, SectionIcon } from "~/modules/marketing/home/_reveal";

export const metadata = {
  title: "About — claudemesh",
  description:
    "claudemesh is built by Alejandro A. Gutiérrez Mourente — fighter pilot, AI business architect, solo builder.",
};

export default function AboutPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24 md:py-32">
      <Reveal className="mb-6">
        <SectionIcon glyph="leaf" />
      </Reveal>

      <Reveal delay={1}>
        <h1
          className="text-[clamp(2rem,4.5vw,3rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          About
        </h1>
      </Reveal>

      <Reveal delay={2}>
        <div
          className="mt-10 space-y-6 text-[15px] leading-[1.8] text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          <p>
            claudemesh is built by{" "}
            <span className="font-medium text-[var(--cm-fg)]">
              Alejandro A. Gutiérrez Mourente
            </span>{" "}
            — a fighter pilot who builds production AI systems.
          </p>

          <p>
            A decade flying F-18s and serving as Operational Safety Officer
            in the Spanish Air Force taught one thing: systems either work
            under pressure or they fail people. That standard followed into
            software.
          </p>

          <p>
            Before claudemesh, that meant shipping a document intelligence
            platform that replaced a manual process worth €5M/year (four
            extraction engines, contract generation, production-grade), AI
            backoffice modules for a multi-tenant enterprise platform, and
            end-to-end ERP integrations across automotive, aviation, fintech,
            legal, and defense — each designed, built, and presented to
            leadership by one person.
          </p>

          <p className="text-[var(--cm-fg)]">
            claudemesh exists because Claude Code sessions are isolated. You
            close the terminal and the context dies. Your teammate re-solves
            the same bug. The insight never travels.
          </p>

          <p>
            The fix: a peer mesh. End-to-end encrypted, delivered mid-turn,
            broker-never-decrypts. The{" "}
            <Link
              href="https://github.com/alezmad/claudemesh-cli"
              className="text-[var(--cm-clay)] hover:underline"
            >
              CLI is MIT-licensed
            </Link>
            . The{" "}
            <Link
              href="https://github.com/alezmad/claudemesh-cli/blob/main/PROTOCOL.md"
              className="text-[var(--cm-clay)] hover:underline"
            >
              wire protocol is documented
            </Link>
            . The{" "}
            <Link
              href="https://github.com/alezmad/claudemesh-cli/blob/main/THREAT_MODEL.md"
              className="text-[var(--cm-clay)] hover:underline"
            >
              threat model is public
            </Link>
            .
          </p>

          <p>
            The same safety thinking that goes into clearing a formation
            through weather goes into deciding what untrusted text should and
            should not reach your AI agent. The stakes are lower. The method
            is the same: understand the failure modes first, then build the
            system that handles them.
          </p>
        </div>
      </Reveal>

      <Reveal delay={3}>
        <div className="mt-12 border-t border-[var(--cm-border)] pt-8">
          <h2
            className="mb-4 text-[18px] font-medium text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Background
          </h2>
          <div
            className="space-y-3 text-[13px] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            <div className="flex items-start gap-3">
              <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cm-clay)]" />
              <span>
                Fighter pilot · Spanish Air Force (Ejército del Aire) · F-18
                Hornet · Operational Safety Officer (QASO)
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cm-clay)]" />
              <span>
                AI Business Architect · document intelligence, ERP
                integration, multi-tenant enterprise platforms
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cm-clay)]" />
              <span>
                Full-stack solo builder · TypeScript, Python, LLM
                orchestration, domain-driven design
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cm-clay)]" />
              <span>
                Regulated industries · automotive, aviation, fintech, legal,
                defense
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cm-clay)]" />
              <span>Las Palmas, Canarias, Spain</span>
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal delay={4}>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="https://github.com/alezmad"
            className="inline-flex items-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] px-4 py-2 text-[13px] font-medium text-[var(--cm-fg)] transition-colors hover:border-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            GitHub
          </Link>
          <Link
            href="https://www.linkedin.com/in/alejandrogutierrezmourente/"
            className="inline-flex items-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] px-4 py-2 text-[13px] font-medium text-[var(--cm-fg)] transition-colors hover:border-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            LinkedIn
          </Link>
          <Link
            href="mailto:info@whyrating.com"
            className="inline-flex items-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] px-4 py-2 text-[13px] font-medium text-[var(--cm-fg)] transition-colors hover:border-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            Contact
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
