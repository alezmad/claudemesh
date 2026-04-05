import Link from "next/link";
import { Reveal, SectionIcon } from "./_reveal";

const CARDS = [
  {
    accent: "clay",
    title: "Start in your terminal",
    body: "Drop the broker next to Claude Code. One env var. Your session joins the mesh.",
    cta: { label: "Install", href: "https://github.com/alezmad/claudemesh-cli#install" },
    mock: (
      <div
        className="rounded-[8px] bg-[#D97757] p-6 font-mono text-[11px] leading-[1.6] text-[#141413]"
        style={{ fontFamily: "var(--cm-font-mono)" }}
      >
        <div className="mb-2 opacity-70">$ claudemesh join</div>
        <div>✓ connected to mesh.team.local</div>
        <div>✓ announced: alex · api-gateway · working</div>
        <div>✓ 5 peers online</div>
        <div className="mt-3 opacity-70">
          → ready. messages route to your Claude Code.
        </div>
      </div>
    ),
  },
  {
    accent: "oat",
    title: "Bridge to your editor",
    body: "VS Code, Cursor, JetBrains — the mesh exposes an MCP server your editor's agent can call.",
    cta: { label: "VS Code", href: "https://github.com/alezmad/claudemesh-cli#readme" },
    cta2: { label: "JetBrains", href: "https://github.com/alezmad/claudemesh-cli#readme" },
    mock: (
      <div
        className="rounded-[8px] border border-[var(--cm-border)] bg-[var(--cm-bg)] p-4"
        style={{ fontFamily: "var(--cm-font-mono)" }}
      >
        <div className="text-[10px] text-[var(--cm-fg-tertiary)]">
          .claude/mcp.json
        </div>
        <pre className="mt-2 text-[11px] leading-[1.6] text-[var(--cm-fg)]">
          {`{
  "servers": {
    "mesh": {
      "url": "ws://mesh.team:7899"
    }
  }
}`}
        </pre>
      </div>
    ),
  },
  {
    accent: "cactus",
    title: "Reach across machines",
    body: "Tailscale, WireGuard, or plain WS over your LAN. The broker is one binary, anywhere.",
    cta: { label: "Open the dashboard", href: "/dashboard" },
    mock: (
      <div
        className="rounded-[8px] border border-[var(--cm-border)] bg-[var(--cm-bg)] p-4"
        style={{ fontFamily: "var(--cm-font-sans)" }}
      >
        <div className="mb-3 text-[10px] uppercase tracking-wider text-[var(--cm-fg-tertiary)]">
          Peers on mesh
        </div>
        {[
          ["alex", "macOS · working"],
          ["jordan", "linux · idle"],
          ["mo", "macOS · dnd"],
        ].map(([n, s]) => (
          <div
            key={n}
            className="flex items-center justify-between border-b border-[var(--cm-border)] py-1.5 text-[12px] last:border-b-0"
          >
            <span className="text-[var(--cm-fg)]">{n}</span>
            <span className="text-[var(--cm-fg-tertiary)]">{s}</span>
          </div>
        ))}
      </div>
    ),
  },
];

export const MeetsYou = () => {
  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg)] px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="terminal" />
        </Reveal>
        <Reveal delay={1}>
          <h2
            className="mx-auto max-w-4xl text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Meets every agent where it runs
          </h2>
        </Reveal>
        <Reveal delay={2}>
          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {CARDS.map((c) => (
              <article
                key={c.title}
                className="flex flex-col overflow-hidden rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-6"
              >
                <div className="mb-6">{c.mock}</div>
                <h3
                  className="mb-2 text-xl font-medium leading-snug text-[var(--cm-fg)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  {c.title}
                </h3>
                <p
                  className="mb-6 text-[14px] leading-[1.6] text-[var(--cm-fg-secondary)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  {c.body}
                </p>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Link
                    href={c.cta.href}
                    className="inline-flex items-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-fg-tertiary)] px-4 py-2 text-[13px] font-medium text-[var(--cm-fg)] transition-colors hover:border-[var(--cm-fg)] hover:bg-[var(--cm-bg)]"
                    style={{ fontFamily: "var(--cm-font-sans)" }}
                  >
                    {c.cta.label} →
                  </Link>
                  {c.cta2 && (
                    <Link
                      href={c.cta2.href}
                      className="inline-flex items-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] px-4 py-2 text-[13px] font-medium text-[var(--cm-fg-secondary)] transition-colors hover:border-[var(--cm-fg-tertiary)] hover:text-[var(--cm-fg)]"
                      style={{ fontFamily: "var(--cm-font-sans)" }}
                    >
                      {c.cta2.label} →
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
};
