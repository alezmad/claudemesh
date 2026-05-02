"use client";
import { useRef } from "react";
import { Reveal, SectionIcon } from "./_reveal";

const MILESTONES = [
  {
    version: "v0.1",
    phase: "Foundation",
    color: "var(--cm-clay)",
    items: [
      "E2E encrypted messaging (libsodium crypto_box)",
      "WSS broker with reconnect + priority routing",
      "ed25519 identity + signed invite links",
      "claudemesh launch with dev-channel push",
      "Named sessions + ephemeral keypairs",
      "Production hardening (stale sweep, sender exclusion)",
    ],
    stat: "16 releases",
  },
  {
    version: "v0.2",
    phase: "Groups",
    color: "var(--cm-fig)",
    items: [
      "@group routing with roles (lead, member, observer)",
      "Interactive wizard for launch configuration",
      "Dynamic join/leave groups at runtime",
      "Multicast delivery with sender exclusion",
    ],
    stat: "6 coordination patterns",
  },
  {
    version: "v0.3",
    phase: "Shared Intelligence",
    color: "var(--cm-cactus)",
    items: [
      "Shared state — live key-value with push notifications",
      "Memory — persistent knowledge with full-text search",
      "Message status — per-recipient delivery tracking",
      "MCP instructions — dynamic identity + tool guide",
    ],
    stat: "Peers learn collectively",
  },
  {
    version: "v0.4",
    phase: "Files & Targeting",
    color: "var(--cm-oat)",
    items: [
      "MinIO file sharing with per-peer access control",
      "Message attachments (ephemeral, 24h TTL)",
      "Multi-target messages with deduplication",
      "Targeted views — per-audience message tailoring",
    ],
    stat: "Binary artifacts + text",
  },
  {
    version: "v0.5",
    phase: "Data Platform",
    color: "var(--cm-clay)",
    items: [
      "Per-mesh SQL database (Postgres schema)",
      "Vector search (Qdrant semantic embeddings)",
      "Graph database (Neo4j entity relationships)",
      "Context sharing between peer sessions",
      "Tasks — create, claim, complete work items",
      "Streams — real-time pub/sub data channels",
    ],
    stat: "5 persistence backends",
  },
  {
    version: "v0.6–0.8",
    phase: "Platform",
    color: "var(--cm-fig)",
    items: [
      "Mesh MCP proxy — dynamic tool sharing between peers",
      "Skills catalog — publish + discover reusable instructions",
      "Signed hash-chain audit log for mesh events",
      "Inbound webhooks for external integrations",
      "Scheduled messages + cron-based reminders",
      "Mesh services — deploy MCP servers with vault + scopes",
      "Runner container for git/npx service sources",
      "URL watch — broker polls URLs, notifies on change",
      "Telegram bridge with multi-tenant routing",
      "Peer stats reporting (messages, uptime, errors)",
    ],
    stat: "43 MCP tools total",
  },
];

export const Timeline = () => {
  const trackRef = useRef<HTMLDivElement>(null);

  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg)] px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="layers" />
        </Reveal>
        <Reveal delay={1}>
          <h2
            className="text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Shipped, not promised
          </h2>
        </Reveal>
        <Reveal delay={2}>
          <p
            className="mx-auto mt-4 max-w-xl text-center text-[15px] leading-[1.6] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            66 npm releases. Every feature below is in production today.
          </p>
        </Reveal>

        <Reveal delay={3}>
          <div ref={trackRef} className="relative mt-16">
            {/* Vertical line */}
            <div
              className="absolute left-[24px] top-0 hidden h-full w-px md:block"
              style={{ background: "linear-gradient(to bottom, var(--cm-clay), var(--cm-fig), var(--cm-cactus), transparent)" }}
            />

            <div className="space-y-12 md:space-y-16">
              {MILESTONES.map((m, idx) => (
                <div key={m.version} className="relative md:pl-16">
                  {/* Dot on timeline */}
                  <div
                    className="absolute left-[17px] top-[6px] hidden h-[15px] w-[15px] rounded-full border-2 md:block"
                    style={{
                      borderColor: m.color,
                      backgroundColor: "var(--cm-bg)",
                    }}
                  >
                    <div
                      className="absolute inset-[3px] rounded-full"
                      style={{ backgroundColor: m.color }}
                    />
                  </div>

                  {/* Content */}
                  <div className="rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-6 transition-colors hover:border-[color:var(--hover-color)]"
                    style={{ "--hover-color": m.color } as React.CSSProperties}
                  >
                    {/* Header */}
                    <div className="mb-4 flex items-baseline justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span
                          className="rounded-[4px] px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            fontFamily: "var(--cm-font-mono)",
                            backgroundColor: m.color,
                            color: "var(--cm-gray-900)",
                          }}
                        >
                          {m.version}
                        </span>
                        <h3
                          className="text-[18px] font-medium text-[var(--cm-fg)]"
                          style={{ fontFamily: "var(--cm-font-serif)" }}
                        >
                          {m.phase}
                        </h3>
                      </div>
                      <span
                        className="hidden shrink-0 text-[11px] text-[var(--cm-fg-tertiary)] sm:block"
                        style={{ fontFamily: "var(--cm-font-mono)" }}
                      >
                        {m.stat}
                      </span>
                    </div>

                    {/* Items grid */}
                    <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                      {m.items.map((item) => (
                        <div
                          key={item}
                          className="flex items-start gap-2 text-[13px] leading-[1.5] text-[var(--cm-fg-secondary)]"
                          style={{ fontFamily: "var(--cm-font-sans)" }}
                        >
                          <span
                            className="mt-[7px] block h-[5px] w-[5px] shrink-0 rounded-full"
                            style={{ backgroundColor: m.color, opacity: 0.6 }}
                          />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom: what's next */}
            <div className="relative mt-12 md:pl-16">
              <div
                className="absolute left-[17px] top-[6px] hidden h-[15px] w-[15px] rounded-full border-2 border-dashed border-[var(--cm-fg-tertiary)] md:block"
              />
              <div
                className="rounded-[var(--cm-radius-md)] border border-dashed border-[var(--cm-border)] p-6"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="rounded-[4px] border border-[var(--cm-fg-tertiary)] px-2 py-0.5 text-[11px] text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    next
                  </span>
                  <span
                    className="text-[14px] text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    Daemon redesign · per-topic encryption · self-host
                    packaging · federation
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
