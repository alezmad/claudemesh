"use client";
import { useState } from "react";
import Link from "next/link";
import { Reveal, SectionIcon } from "./_reveal";

const TIERS = {
  individual: [
    {
      name: "Solo",
      desc: "Run the broker on your laptop. Pair your Claude Code sessions across repos.",
      price: "Free",
      cta: "Install locally",
      href: "https://github.com/claudemesh/claudemesh",
    },
    {
      name: "Pro",
      desc: "Mesh dashboard, peer registry, message history, priority routing.",
      price: "$12",
      note: "per month",
      cta: "Start free trial",
      href: "#",
    },
    {
      name: "Plus",
      desc: "Cross-machine mesh via Tailscale / WireGuard, MCP bridge, audit log.",
      price: "$24",
      note: "per month",
      cta: "Start free trial",
      href: "#",
    },
  ],
  team: [
    {
      name: "Team",
      desc: "Self-hosted broker. SSO, shared presence, team audit log, 25 peers.",
      price: "$99",
      note: "per month · unlimited peers",
      cta: "Get started",
      href: "#",
    },
    {
      name: "Business",
      desc: "Multi-region brokers, retention controls, Slack/Linear bridges.",
      price: "$499",
      note: "per month",
      cta: "Get started",
      href: "#",
    },
    {
      name: "Enterprise",
      desc: "Air-gapped deploy, custom SAML, dedicated support, SOC 2 pack.",
      price: "Contact",
      cta: "Contact sales",
      href: "#",
    },
  ],
};

export const Pricing = () => {
  const [tab, setTab] = useState<"individual" | "team">("individual");
  const tiers = TIERS[tab];
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
        <Reveal delay={2} className="mt-10 flex justify-center">
          <div className="inline-flex rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-1">
            {(["individual", "team"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={
                  "rounded-[calc(var(--cm-radius-xs)-2px)] px-4 py-2 text-[13px] font-medium transition-colors " +
                  (tab === k
                    ? "bg-[var(--cm-fg)] text-[var(--cm-bg)]"
                    : "text-[var(--cm-fg-secondary)] hover:text-[var(--cm-fg)]")
                }
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                {k === "individual" ? "Individual" : "Team & Enterprise"}
              </button>
            ))}
          </div>
        </Reveal>
        <Reveal delay={3}>
          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {tiers.map((tier) => (
              <article
                key={tier.name}
                className="flex flex-col rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-8 transition-colors hover:border-[var(--cm-clay)]"
              >
                <div className="mb-5">
                  <SectionIcon glyph="leaf" />
                </div>
                <h3
                  className="mb-2 text-[28px] font-medium leading-tight text-[var(--cm-fg)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  {tier.name}
                </h3>
                <p
                  className="mb-6 text-[14px] leading-[1.6] text-[var(--cm-fg-secondary)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  {tier.desc}
                </p>
                <div className="mb-6 mt-auto">
                  <div
                    className="text-[32px] font-medium text-[var(--cm-fg)]"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    {tier.price}
                  </div>
                  {tier.note && (
                    <div
                      className="text-xs text-[var(--cm-fg-tertiary)]"
                      style={{ fontFamily: "var(--cm-font-mono)" }}
                    >
                      {tier.note}
                    </div>
                  )}
                </div>
                <Link
                  href={tier.href}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-fg-tertiary)] px-5 py-2.5 text-sm font-medium text-[var(--cm-fg)] transition-colors hover:border-[var(--cm-fg)] hover:bg-[var(--cm-bg)]"
                  style={{ fontFamily: "var(--cm-font-sans)" }}
                >
                  {tier.cta}
                </Link>
              </article>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
};
