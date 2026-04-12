import { Reveal, SectionIcon } from "./_reveal";

type Card = {
  label: string;
  title: string;
  theyDo: string;
  weDo: string;
  tone: "compare" | "claim";
};

const CARDS: Card[] = [
  {
    label: "vs. MCP",
    title: "One Claude to its tools",
    theyDo:
      "MCP wires one Claude session to external services — GitHub, Postgres, a browser. The tool never knows who called it, never talks back, never sees other sessions.",
    weDo: "claudemesh ships as an MCP server itself. We extend the model: publish an MCP once, every peer's Claude Code sees its tools. Credentials stay on the publisher's machine.",
    tone: "compare",
  },
  {
    label: "vs. Subagents",
    title: "Helpers inside one session",
    theyDo:
      "Subagents spawn helper agents within a single Claude Code session. They share one context, one terminal, one machine. When the session closes, they're gone.",
    weDo: "claudemesh connects full, independent Claude Code sessions across machines, across developers, across continents. Each peer keeps its own repo, its own perspective, its own scrollback.",
    tone: "compare",
  },
  {
    label: "vs. OpenClaw",
    title: "Autonomous agents that run while you sleep",
    theyDo:
      "OpenClaw runs unattended. One agent brain, many subagents, 200+ LLMs on tap. It triages issues overnight, opens PRs, pokes CI, reacts to webhooks — all without a human in the loop. Different job, and a good one.",
    weDo: "claudemesh is about the sessions you're actively running. When your Claude Code is open and you're shipping, the mesh wires your session to your teammates'. OpenClaw automates overnight; claudemesh meshes your work hours. They compose — put an OpenClaw instance on the mesh and it joins as just another peer.",
    tone: "compare",
  },
  {
    label: "What claudemesh is",
    title: "The wire between Claude Code sessions",
    theyDo:
      "Every Claude Code session today is an island. Context dies with the terminal. Skills and MCPs are per-developer. Teammates relay insights through Slack.",
    weDo: "claudemesh is one thing: a peer network for Claude Code. Share context, files, skills, MCPs, and slash commands across sessions — end-to-end encrypted. Host the broker on claudemesh.com or run it in your VPC. Same CLI either way.",
    tone: "claim",
  },
];

export const WhereMeshFits = () => {
  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg)] px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="arrow" />
        </Reveal>
        <Reveal delay={1}>
          <h2
            className="mx-auto max-w-4xl text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Where claudemesh fits
          </h2>
        </Reveal>
        <Reveal delay={2}>
          <p
            className="mx-auto mt-4 max-w-2xl text-center text-sm leading-[1.6] text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            A quick tour of what claudemesh is — and what it isn&apos;t. We
            compose with the rest of the Claude Code ecosystem. We don&apos;t
            replace any of it.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-5 md:grid-cols-2">
          {CARDS.map((c) => {
            const isClaim = c.tone === "claim";
            return (
              <Reveal key={c.label} delay={3}>
                <div
                  className={
                    "flex h-full flex-col rounded-[var(--cm-radius-md)] border p-7 md:p-8 " +
                    (isClaim
                      ? "border-[var(--cm-clay)]/60 bg-[var(--cm-clay)]/[0.06]"
                      : "border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]")
                  }
                >
                  <div
                    className={
                      "mb-3 text-[11px] uppercase tracking-[0.18em] " +
                      (isClaim
                        ? "text-[var(--cm-clay)]"
                        : "text-[var(--cm-fg-tertiary)]")
                    }
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    {c.label}
                  </div>
                  <h3
                    className="mb-4 text-[22px] font-medium leading-snug text-[var(--cm-fg)]"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    {c.title}
                  </h3>
                  <p
                    className="text-[14px] leading-[1.65] text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    {c.theyDo}
                  </p>
                  <div className="my-4 h-px bg-[var(--cm-border)]" />
                  <p
                    className={
                      "text-[14px] leading-[1.65] " +
                      (isClaim
                        ? "text-[var(--cm-fg)]"
                        : "text-[var(--cm-fg-secondary)]")
                    }
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    {c.weDo}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
};
