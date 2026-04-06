"use client";
import { useState } from "react";
import { Reveal, SectionIcon } from "./_reveal";

const FEATURES = [
  {
    key: "onboard",
    tab: "Onboarding",
    title: "Bootstrap any teammate",
    body: "New hire's Claude inherits the team's context library on day one. No hand-holding, no week-long repo tour.",
  },
  {
    key: "handoff",
    tab: "Hand-offs",
    title: "Work travels with context",
    body: "Pass an investigation to your teammate's session with full history — hypotheses, logs, files touched, commands run.",
  },
  {
    key: "refactor",
    tab: "Refactors",
    title: "Coordinate cross-cutting changes",
    body: "Rename a type, rotate a secret, bump a schema — once. Every other agent picks up the change from its own repo.",
  },
];

export const Features = () => {
  const [active, setActive] = useState(0);
  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg)] px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="grid" />
        </Reveal>
        <Reveal delay={1}>
          <h2
            className="mx-auto max-w-4xl text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            What could your mesh do?
          </h2>
        </Reveal>
        <Reveal delay={2} className="mt-10 flex justify-center">
          <div
            className="flex items-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-4 py-3 text-[13px] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            <span className="text-[var(--cm-clay)]">$</span>
            <span>curl -fsSL claudemesh.com/install | bash</span>
            <button
              className="ml-2 rounded border border-[var(--cm-border)] px-1.5 py-0.5 text-[10px] text-[var(--cm-fg-tertiary)] transition-colors hover:border-[var(--cm-fg)] hover:text-[var(--cm-fg)]"
              aria-label="Copy"
            >
              copy
            </button>
          </div>
        </Reveal>
        <Reveal delay={3}>
          <p
            className="mt-4 text-center text-sm text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            Free forever for solo developers · Or read the{" "}
            <a
              href="#"
              className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 transition-colors hover:text-[var(--cm-fg)] hover:decoration-[var(--cm-clay)]"
            >
              documentation
            </a>
          </p>
        </Reveal>
        <Reveal delay={4}>
          <div className="mt-16 flex justify-center gap-2">
            {FEATURES.map((f, i) => (
              <button
                key={f.key}
                onClick={() => setActive(i)}
                className={
                  "rounded-[var(--cm-radius-xs)] border px-4 py-2 text-[13px] font-medium transition-colors " +
                  (active === i
                    ? "border-[var(--cm-clay)] bg-[var(--cm-clay)]/10 text-[var(--cm-clay)]"
                    : "border-[var(--cm-border)] text-[var(--cm-fg-secondary)] hover:border-[var(--cm-fg-tertiary)] hover:text-[var(--cm-fg)]")
                }
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                {f.tab}
              </button>
            ))}
          </div>
          <div className="mx-auto mt-10 max-w-3xl rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-10 text-center">
            <h3
              className="mb-4 text-[28px] font-medium leading-tight text-[var(--cm-fg)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              {FEATURES[active]?.title}
            </h3>
            <p
              className="text-[15px] leading-[1.65] text-[var(--cm-fg-secondary)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              {FEATURES[active]?.body}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
