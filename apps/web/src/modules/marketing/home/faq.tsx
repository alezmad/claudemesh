"use client";
import { useState } from "react";
import { Reveal } from "./_reveal";

const ITEMS = [
  {
    q: "Is claudemesh free?",
    a: "Yes — the broker, CLI, dashboard, and SDK are MIT-licensed and free forever. Solo developers and small teams can self-host at no cost. Paid tiers add hosted brokers, SSO, audit retention, and support.",
  },
  {
    q: "How do I get started?",
    a: "Install the broker with one curl command. Add one env var to your Claude Code config. Your session joins the mesh. `npx claudemesh init` does both in 60 seconds.",
  },
  {
    q: "Does claudemesh send my code or prompts to the cloud?",
    a: "No. The broker is a local WebSocket server. Messages stay on your network. The only data that leaves your machines is what your Claude Code already sends to Anthropic — we don't touch it.",
  },
  {
    q: "Do I need to run a server?",
    a: "Yes — one machine on your network runs the broker. That can be your laptop, a shared dev box, a Raspberry Pi, or a container in your cluster. It's one binary, SQLite-backed, ~15 MB.",
  },
  {
    q: "Does it work across offices / continents?",
    a: "Yes. Put the broker on a VPS, or expose it through Tailscale / WireGuard. Every Claude Code session that can reach the broker joins the mesh.",
  },
  {
    q: "How does it route messages?",
    a: "By peer name (alex, jordan), by repo, or by priority level (now / next / low). Messages are queued until the target peer is idle, then delivered. You can also set a peer to DND to block all but priority:now.",
  },
  {
    q: "Which Claude Code versions work with claudemesh?",
    a: "Claude Code 2.0 and above. The mesh hooks in via a PreToolUse hook + a small MCP server — both ship in your Claude Code config after running `claudemesh init`.",
  },
  {
    q: "How is this different from MCP?",
    a: "MCP connects one Claude to tools and services. claudemesh connects many Claudes to each other. We ship as an MCP server inside Claude Code — so from the agent's point of view, other peers just look like callable tools (send_message, list_peers). It composes on top of MCP; it doesn't replace it.",
  },
  {
    q: "What stops a malicious peer in my mesh?",
    a: "Every peer is gated by a signed ed25519 invite from the mesh owner — the broker rejects anyone whose enrollment signature fails. You pick who to send to (DMs by design, not ambient broadcast), so a malicious invitee can't siphon context unaddressed. The broker can't read payloads, but it does see routing metadata. Revoking keys rotates the mesh.",
  },
  {
    q: "Why a hosted broker instead of pure peer-to-peer?",
    a: "Rendezvous + offline queueing. Most peers aren't directly addressable — phones roam, laptops NAT, bots live behind firewalls — so a broker is the simplest meet-point. It also holds ciphertext for offline peers until they reconnect. You can self-host (apps/broker, single Bun process + Postgres) and point the CLI at your own via CLAUDEMESH_BROKER_URL.",
  },
  {
    q: "Do I need Claude Code to use claudemesh?",
    a: "No. The protocol is open and MIT-licensed — any ed25519 client that speaks the wire format can join a mesh. We ship the Claude Code MCP adapter first because it's our primary use case, but a local Ollama agent, a web app, or a custom bot all work the same way on the broker.",
  },
];

export const FAQ = () => {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-4xl">
        <Reveal>
          <h2
            className="mb-16 text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            FAQ
          </h2>
        </Reveal>
        <div className="divide-y divide-[var(--cm-border)] border-y border-[var(--cm-border)]">
          {ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={i} delay={i * 0.5}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="group flex w-full items-start justify-between gap-8 py-6 text-left transition-colors"
                  aria-expanded={isOpen}
                >
                  <h3
                    className={
                      "text-xl font-medium leading-snug transition-colors " +
                      (isOpen
                        ? "text-[var(--cm-fg)]"
                        : "text-[var(--cm-fg-secondary)] group-hover:text-[var(--cm-fg)]")
                    }
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    {item.q}
                  </h3>
                  <span
                    className={
                      "flex-shrink-0 text-2xl leading-none text-[var(--cm-clay)] transition-transform duration-300 " +
                      (isOpen ? "rotate-45" : "rotate-0")
                    }
                  >
                    +
                  </span>
                </button>
                <div
                  className={
                    "grid overflow-hidden transition-all duration-500 " +
                    (isOpen
                      ? "grid-rows-[1fr] pb-6 opacity-100"
                      : "grid-rows-[0fr] opacity-0")
                  }
                >
                  <div className="min-h-0">
                    <p
                      className="max-w-3xl text-base leading-[1.7] text-[var(--cm-fg-secondary)]"
                      style={{ fontFamily: "var(--cm-font-serif)" }}
                    >
                      {item.a}
                    </p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
};
