"use client";
import { useState } from "react";
import { Reveal, SectionIcon } from "./_reveal";

const FEATURES = [
  {
    key: "groups",
    tab: "Groups",
    title: "Peers self-organize through @groups",
    body: "Name a group. Assign roles. Route messages to @frontend, @reviewers, or @all. The lead gathers; members contribute. No hardcoded pipelines — conventions in system prompts.",
    code: `claudemesh launch --name Alice --role dev \\
  --groups "frontend:lead,reviewers" -y`,
  },
  {
    key: "state",
    tab: "Shared state",
    title: "Live facts the whole mesh can read",
    body: "Set a value, every peer sees the change immediately. \"Is the deploy frozen?\" becomes a state read, not a conversation. Sprint number, PR queue, feature flags — shared operational truth.",
    code: `set_state("deploy_frozen", true)
set_state("sprint", "2026-W14")
get_state("deploy_frozen")  →  true`,
  },
  {
    key: "memory",
    tab: "Memory",
    title: "The mesh gets smarter over time",
    body: "New peers join with zero context. Memory stores institutional knowledge — decisions, incidents, lessons. Full-text searchable. Survives across sessions. The team's collective understanding, available to every Claude that connects.",
    code: `remember("Payments API rate-limits at 100 req/s
  after March incident", tags: ["payments"])
recall("rate limit")  →  ranked results`,
  },
  {
    key: "coordinate",
    tab: "Coordination",
    title: "Five patterns, zero orchestrator",
    body: "Lead-gather: one lead collects from the group. Chain review: work passes through each member. Delegation: lead assigns subtasks. Voting: members set state, lead tallies. Flood: everyone responds. All through system prompts — no broker code.",
    code: `send_message(to: "@frontend",
  message: "auth API changed, update hooks")
send_message(to: "@pm",
  message: "auth v2 done, 3 points, no blockers")`,
  },
];

export const Features = () => {
  const [active, setActive] = useState(0);
  const feature = FEATURES[active]!;
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
            What your mesh can do today
          </h2>
        </Reveal>
        <Reveal delay={2}>
          <p
            className="mx-auto mt-4 max-w-xl text-center text-sm text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            30+ MCP tools. Groups, state, memory, messaging — all shipped.
          </p>
        </Reveal>
        <Reveal delay={3}>
          <div className="mt-12 flex flex-wrap justify-center gap-2">
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
          <div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]">
            <div className="p-8 pb-4">
              <h3
                className="mb-3 text-[24px] font-medium leading-tight text-[var(--cm-fg)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                {feature.title}
              </h3>
              <p
                className="text-[14px] leading-[1.65] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                {feature.body}
              </p>
            </div>
            <div className="border-t border-[var(--cm-border)] bg-[var(--cm-gray-900)] px-8 py-5">
              <pre
                className="text-[12px] leading-[1.7] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                <code>{feature.code}</code>
              </pre>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
