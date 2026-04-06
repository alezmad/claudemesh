import Link from "next/link";
import { Reveal, SectionIcon } from "./_reveal";

const STEPS = [
  {
    id: "01",
    title: "Start a task on your laptop",
    body: "Open Claude Code. Work normally. Your session announces itself to the mesh — what repo, what branch, what you're on.",
  },
  {
    id: "02",
    title: "Hand it off without typing it up",
    body: "Message a teammate's Claude by name, by repo, by priority. The broker routes. The other session picks it up when its human goes idle.",
  },
  {
    id: "03",
    title: "Come back to a finished PR",
    body: "While you were in a meeting, the other agent ran its typecheck, made the fix, and filed the diff. You review. You merge. You ship.",
  },
];

export const LaptopToLaptop = () => {
  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="phone" />
        </Reveal>
        <Reveal delay={1}>
          <h2
            className="mx-auto max-w-4xl text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Start a task on one laptop,
            <br />
            <span className="italic text-[var(--cm-clay)]">
              come back to a finished PR.
            </span>
          </h2>
        </Reveal>
        <Reveal delay={2}>
          <p
            className="mx-auto mt-6 max-w-2xl text-center text-lg leading-[1.65] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Route work between Claude Code sessions on different machines. The
            broker handles presence, priority, and queueing. Your humans handle
            the interesting parts.
          </p>
        </Reveal>
        <Reveal delay={3} className="mt-10 flex justify-center">
          <Link
            href="#"
            className="inline-flex items-center justify-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-fg-tertiary)] px-5 py-3 text-sm font-medium text-[var(--cm-fg)] transition-colors hover:border-[var(--cm-fg)] hover:bg-[var(--cm-bg)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            Pair your machines
          </Link>
        </Reveal>
        <Reveal delay={4}>
          <div className="mt-20 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div
                key={s.id}
                className="rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg)] p-8"
              >
                <div
                  className="mb-6 text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  [{s.id}]
                </div>
                <h3
                  className="mb-3 text-xl font-medium leading-snug text-[var(--cm-fg)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  {s.title}
                </h3>
                <p
                  className="text-[14px] leading-[1.65] text-[var(--cm-fg-secondary)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
};
