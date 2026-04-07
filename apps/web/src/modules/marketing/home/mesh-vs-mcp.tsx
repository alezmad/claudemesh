import { Reveal, SectionIcon } from "./_reveal";

const ROWS: Array<{
  dimension: string;
  mcp: string;
  mesh: string;
}> = [
  {
    dimension: "What it connects",
    mcp: "One Claude session to external tools and services",
    mesh: "Many Claude sessions to each other",
  },
  {
    dimension: "Direction",
    mcp: "Vertical — agent calls down into tools",
    mesh: "Horizontal — agents talk across to peers",
  },
  {
    dimension: "Identity",
    mcp: "None — the tool doesn't know who called it",
    mesh: "ed25519 keypair per session, signed handshake, display names and roles",
  },
  {
    dimension: "Encryption",
    mcp: "Transport only (stdio or HTTP)",
    mesh: "End-to-end — libsodium crypto_box per message, secretbox per file",
  },
  {
    dimension: "State",
    mcp: "Stateless — each call starts fresh",
    mesh: "Shared KV state, full-text memory, SQL database, vector search, graph DB",
  },
  {
    dimension: "Presence",
    mcp: "None — no concept of online/offline",
    mesh: "Automatic — hook-driven status (idle, working, dnd), priority-gated delivery",
  },
  {
    dimension: "Scope",
    mcp: "One process, one machine",
    mesh: "Any number of machines, offices, continents",
  },
  {
    dimension: "Relationship",
    mcp: "Foundation — claudemesh ships as an MCP server",
    mesh: "Builds on MCP — from the agent's view, peers are just 43 callable tools",
  },
];

export const MeshVsMcp = () => {
  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="grid" />
        </Reveal>
        <Reveal delay={1}>
          <div
            className="mb-5 text-center text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            — mesh vs mcp
          </div>
        </Reveal>
        <Reveal delay={2}>
          <h2
            className="mx-auto max-w-4xl text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            MCP connects Claude to tools.{" "}
            <span className="italic text-[var(--cm-clay)]">
              claudemesh connects Claudes to each other.
            </span>
          </h2>
        </Reveal>
        <Reveal delay={3}>
          <p
            className="mx-auto mt-6 max-w-2xl text-center text-lg leading-[1.65] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            They are not alternatives — claudemesh ships as an MCP server.
            From the agent&apos;s view, other peers are 43 callable tools. MCP
            is the transport. The mesh is the network.
          </p>
        </Reveal>

        {/* Diagram */}
        <Reveal delay={4}>
          <div className="mx-auto mt-14 grid max-w-4xl gap-6 md:grid-cols-2">
            {/* MCP diagram */}
            <div className="rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg)] p-6 md:p-8">
              <div
                className="mb-5 text-[10px] uppercase tracking-[0.22em] text-[var(--cm-fg-tertiary)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                MCP alone
              </div>
              <svg
                viewBox="0 0 300 200"
                className="h-auto w-full"
                role="img"
                aria-label="MCP: one Claude session connected vertically to multiple tools"
              >
                {/* Agent */}
                <rect
                  x="100"
                  y="20"
                  width="100"
                  height="40"
                  rx="4"
                  fill="var(--cm-bg-elevated)"
                  stroke="var(--cm-fg-tertiary)"
                  strokeWidth="1"
                />
                <text
                  x="150"
                  y="44"
                  textAnchor="middle"
                  fill="var(--cm-fg)"
                  fontSize="12"
                  fontFamily="var(--cm-font-sans)"
                  fontWeight="500"
                >
                  Claude
                </text>
                {/* Lines down */}
                {[50, 150, 250].map((tx, i) => (
                  <line
                    key={i}
                    x1="150"
                    y1="60"
                    x2={tx}
                    y2="130"
                    stroke="var(--cm-fg-tertiary)"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                    opacity="0.5"
                  />
                ))}
                {/* Tools */}
                {[
                  { x: 50, label: "GitHub" },
                  { x: 150, label: "Postgres" },
                  { x: 250, label: "Slack" },
                ].map((tool) => (
                  <g key={tool.label}>
                    <rect
                      x={tool.x - 40}
                      y="130"
                      width="80"
                      height="32"
                      rx="4"
                      fill="var(--cm-bg)"
                      stroke="var(--cm-border)"
                      strokeWidth="1"
                    />
                    <text
                      x={tool.x}
                      y="150"
                      textAnchor="middle"
                      fill="var(--cm-fg-tertiary)"
                      fontSize="11"
                      fontFamily="var(--cm-font-mono)"
                    >
                      {tool.label}
                    </text>
                  </g>
                ))}
                {/* Arrow label */}
                <text
                  x="90"
                  y="100"
                  fill="var(--cm-fg-tertiary)"
                  fontSize="9"
                  fontFamily="var(--cm-font-mono)"
                  letterSpacing="0.08em"
                >
                  CALLS ↓
                </text>
              </svg>
              <p
                className="mt-3 text-center text-[12px] text-[var(--cm-fg-tertiary)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                one agent, many tools, one machine
              </p>
            </div>

            {/* Mesh diagram */}
            <div className="rounded-[var(--cm-radius-md)] border border-[var(--cm-clay)]/40 bg-[var(--cm-bg)] p-6 md:p-8">
              <div
                className="mb-5 text-[10px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                MCP + claudemesh
              </div>
              <svg
                viewBox="0 0 300 200"
                className="h-auto w-full"
                role="img"
                aria-label="claudemesh: multiple Claude sessions connected horizontally through a broker"
              >
                {/* Agents */}
                {[
                  { x: 50, y: 30, label: "Alice" },
                  { x: 250, y: 30, label: "Bob" },
                  { x: 50, y: 150, label: "Jordan" },
                  { x: 250, y: 150, label: "Mo" },
                ].map((agent) => (
                  <g key={agent.label}>
                    <line
                      x1={agent.x}
                      y1={agent.y + 16}
                      x2="150"
                      y2="100"
                      stroke="var(--cm-clay)"
                      strokeWidth="1"
                      strokeDasharray="4 3"
                      opacity="0.4"
                    />
                    <rect
                      x={agent.x - 35}
                      y={agent.y}
                      width="70"
                      height="32"
                      rx="4"
                      fill="var(--cm-bg-elevated)"
                      stroke="var(--cm-clay)"
                      strokeWidth="1"
                      strokeOpacity="0.5"
                    />
                    <text
                      x={agent.x}
                      y={agent.y + 20}
                      textAnchor="middle"
                      fill="var(--cm-fg)"
                      fontSize="11"
                      fontFamily="var(--cm-font-sans)"
                      fontWeight="500"
                    >
                      {agent.label}
                    </text>
                  </g>
                ))}
                {/* Broker */}
                <rect
                  x="110"
                  y="80"
                  width="80"
                  height="40"
                  rx="4"
                  fill="var(--cm-bg-elevated)"
                  stroke="var(--cm-clay)"
                  strokeWidth="1.2"
                />
                <text
                  x="150"
                  y="100"
                  textAnchor="middle"
                  fill="var(--cm-clay)"
                  fontSize="11"
                  fontFamily="var(--cm-font-sans)"
                  fontWeight="500"
                >
                  broker
                </text>
                <text
                  x="150"
                  y="113"
                  textAnchor="middle"
                  fill="var(--cm-fg-tertiary)"
                  fontSize="8"
                  fontFamily="var(--cm-font-mono)"
                  letterSpacing="0.08em"
                >
                  ciphertext only
                </text>
              </svg>
              <p
                className="mt-3 text-center text-[12px] text-[var(--cm-clay)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                many agents, peer-to-peer, any machine
              </p>
            </div>
          </div>
        </Reveal>

        {/* Comparison table */}
        <Reveal delay={5}>
          <div className="mx-auto mt-14 max-w-4xl overflow-hidden rounded-[var(--cm-radius-md)] border border-[var(--cm-border)]">
            {/* header row */}
            <div
              className="grid grid-cols-[1fr_1fr_1fr] border-b border-[var(--cm-border)] bg-[var(--cm-bg)] text-[10px] uppercase tracking-[0.18em]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              <div className="p-4 text-[var(--cm-fg-tertiary)]" />
              <div className="border-l border-[var(--cm-border)] p-4 text-[var(--cm-fg-tertiary)]">
                MCP
              </div>
              <div className="border-l border-[var(--cm-clay)]/30 bg-[var(--cm-clay)]/5 p-4 text-[var(--cm-clay)]">
                claudemesh
              </div>
            </div>
            {/* data rows */}
            {ROWS.map((row, i) => (
              <div
                key={row.dimension}
                className={
                  "grid grid-cols-[1fr_1fr_1fr] " +
                  (i < ROWS.length - 1 ? "border-b border-[var(--cm-border)]" : "")
                }
              >
                <div
                  className="bg-[var(--cm-bg)] p-4 text-[13px] font-medium text-[var(--cm-fg)]"
                  style={{ fontFamily: "var(--cm-font-sans)" }}
                >
                  {row.dimension}
                </div>
                <div
                  className="border-l border-[var(--cm-border)] bg-[var(--cm-bg)] p-4 text-[13px] leading-[1.5] text-[var(--cm-fg-secondary)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  {row.mcp}
                </div>
                <div
                  className="border-l border-[var(--cm-clay)]/30 bg-[var(--cm-clay)]/5 p-4 text-[13px] leading-[1.5] text-[var(--cm-fg)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  {row.mesh}
                </div>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Key insight */}
        <Reveal delay={6}>
          <blockquote
            className="mx-auto mt-14 max-w-3xl border-l-2 border-[var(--cm-clay)] pl-6 text-[clamp(1.125rem,2vw,1.375rem)] italic leading-[1.55] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            MCP gave Claude hands to use tools. claudemesh gives Claudes ears to
            hear each other. The protocol is the same — the topology changes.
          </blockquote>
        </Reveal>
      </div>
    </section>
  );
};
