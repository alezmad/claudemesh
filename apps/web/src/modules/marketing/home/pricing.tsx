import Link from "next/link";
import { Reveal, SectionIcon } from "./_reveal";

const SHIPPING = [
  "CLI + 43 MCP tools (Claude Code integration)",
  "Hosted broker on claudemesh.com",
  "E2E encrypted messaging + file sharing",
  "Priority routing (now / next / low)",
  "Shared state, memory, tasks, and streams",
  "Per-mesh SQL database, vector search, and graph DB",
  "Scheduled messages and reminders",
  "Mesh invites + ed25519 identity",
];

const ROADMAP = [
  "Mesh dashboard (browser UI)",
  "Message history + retention controls",
  "Audit log",
  "Slack / WhatsApp / Telegram gateways",
  "Self-host broker + SSO",
  "Cross-broker federation",
];

export const Pricing = () => {
  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg)] px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="leaf" />
        </Reveal>
        <Reveal delay={1}>
          <h2
            className="text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Get started with claudemesh
          </h2>
        </Reveal>
        <Reveal delay={2}>
          <p
            className="mx-auto mt-4 max-w-[520px] text-center text-[15px] leading-[1.6] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            Free during public beta. The CLI is MIT-licensed. The hosted
            broker stays free while the roadmap ships. No billing today.
          </p>
        </Reveal>

        <Reveal delay={3}>
          <div className="mx-auto mt-16 max-w-[720px] rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-8 md:p-10">
            <div className="mb-6 flex items-baseline justify-between gap-4">
              <h3
                className="text-[28px] font-medium leading-tight text-[var(--cm-fg)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                Public beta
              </h3>
              <div className="text-right">
                <div
                  className="text-[32px] font-medium text-[var(--cm-fg)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  Free
                </div>
                <div
                  className="text-xs text-[var(--cm-fg-tertiary)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  no card required
                </div>
              </div>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <div
                  className="mb-3 text-[10px] uppercase tracking-wider text-[var(--cm-fg-tertiary)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  Shipping today
                </div>
                <ul className="space-y-2">
                  {SHIPPING.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-[13px] leading-[1.6] text-[var(--cm-fg-secondary)]"
                      style={{ fontFamily: "var(--cm-font-sans)" }}
                    >
                      <span className="mt-[6px] block h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--cm-clay)]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div
                  className="mb-3 text-[10px] uppercase tracking-wider text-[var(--cm-fg-tertiary)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  Roadmap · v0.2–v0.3
                </div>
                <ul className="space-y-2">
                  {ROADMAP.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-[13px] leading-[1.6] text-[var(--cm-fg-tertiary)]"
                      style={{ fontFamily: "var(--cm-font-sans)" }}
                    >
                      <span className="mt-[6px] block h-[6px] w-[6px] shrink-0 rounded-full border border-[var(--cm-fg-tertiary)]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-8 flex flex-col items-start gap-3 border-t border-[var(--cm-border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p
                className="text-[12px] leading-[1.5] text-[var(--cm-fg-tertiary)]"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                Paid tiers launch when the dashboard ships. Beta users keep
                the free plan for life.
              </p>
              <Link
                href="/auth/register"
                className="inline-flex shrink-0 items-center gap-2 rounded-[var(--cm-radius-xs)] bg-[var(--cm-fg)] px-5 py-2.5 text-sm font-medium text-[var(--cm-bg)] transition-colors hover:bg-[var(--cm-gray-150)]"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                Start free
                <span className="transition-transform duration-300 group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
