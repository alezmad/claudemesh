import { Reveal, RevealStagger, StaggerItem, SectionIcon } from "./_reveal";

/**
 * Architecture diagram — broker in the center, peers orbiting,
 * ciphertext on every edge. No single peer is "the client."
 */
const MeshDiagram = () => {
  const CX = 400;
  const CY = 260;
  const R = 170;

  const peers: Array<{
    angle: number;
    label: string;
    sub: string;
    icon: React.ReactNode;
  }> = [
    {
      angle: -90,
      label: "your terminal",
      sub: "claude code · repo A",
      icon: <path d="M4 6l4 4-4 4M12 16h8" strokeLinecap="round" />,
    },
    {
      angle: -30,
      label: "teammate's claude",
      sub: "claude code · repo B",
      icon: <path d="M4 6l4 4-4 4M12 16h8" strokeLinecap="round" />,
    },
    {
      angle: 30,
      label: "phone peer",
      sub: "ios · same keypair",
      icon: (
        <>
          <rect x="7" y="3" width="10" height="18" rx="2" />
          <circle cx="12" cy="18" r="0.8" fill="currentColor" />
        </>
      ),
    },
    {
      angle: 90,
      label: "whatsapp gateway",
      sub: "bot · signs as a peer",
      icon: (
        <path
          d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.4A10 10 0 1012 2z"
          strokeLinejoin="round"
        />
      ),
    },
    {
      angle: 150,
      label: "slack peer",
      sub: "workspace · channel routes",
      icon: (
        <>
          <rect x="3" y="10" width="6" height="2" rx="1" />
          <rect x="15" y="12" width="6" height="2" rx="1" />
          <rect x="10" y="3" width="2" height="6" rx="1" />
          <rect x="12" y="15" width="2" height="6" rx="1" />
        </>
      ),
    },
    {
      angle: -150,
      label: "another laptop",
      sub: "claude code · repo C",
      icon: <path d="M4 6l4 4-4 4M12 16h8" strokeLinecap="round" />,
    },
  ];

  const toXY = (angle: number) => {
    const rad = (angle * Math.PI) / 180;
    return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
  };

  return (
    <div className="relative mx-auto max-w-4xl">
      <svg
        viewBox="0 0 800 520"
        className="h-auto w-full"
        role="img"
        aria-label="claudemesh architecture: broker at center, peers orbiting, all traffic end-to-end encrypted"
      >
        {peers.map((p, i) => {
          const { x, y } = toXY(p.angle);
          return (
            <line
              key={`line-${i}`}
              x1={CX}
              y1={CY}
              x2={x}
              y2={y}
              stroke="var(--cm-clay)"
              strokeOpacity="0.35"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          );
        })}

        <g>
          {(() => {
            const { x, y } = toXY(-30);
            const mx = (CX + x) / 2 + 16;
            const my = (CY + y) / 2 - 8;
            return (
              <text
                x={mx}
                y={my}
                fill="var(--cm-fg-tertiary)"
                fontSize="10"
                fontFamily="var(--cm-font-mono)"
                letterSpacing="0.1em"
              >
                CIPHERTEXT
              </text>
            );
          })()}
        </g>

        {peers.map((p, i) => {
          const { x, y } = toXY(p.angle);
          const labelAbove = p.angle < 0;
          const ty = labelAbove ? y - 56 : y + 56;
          const subTy = labelAbove ? y - 42 : y + 70;
          return (
            <g key={`peer-${i}`}>
              <circle
                cx={x}
                cy={y}
                r="28"
                fill="var(--cm-bg)"
                stroke="var(--cm-clay)"
                strokeOpacity="0.55"
                strokeWidth="1"
              />
              <g
                transform={`translate(${x - 12}, ${y - 12})`}
                stroke="var(--cm-clay)"
                strokeWidth="1.4"
                fill="none"
              >
                {p.icon}
              </g>
              <text
                x={x}
                y={ty}
                textAnchor="middle"
                fill="var(--cm-fg)"
                fontSize="12"
                fontFamily="var(--cm-font-sans)"
              >
                {p.label}
              </text>
              <text
                x={x}
                y={subTy}
                textAnchor="middle"
                fill="var(--cm-fg-tertiary)"
                fontSize="10"
                fontFamily="var(--cm-font-mono)"
                letterSpacing="0.05em"
              >
                {p.sub}
              </text>
            </g>
          );
        })}

        <g>
          <rect
            x={CX - 78}
            y={CY - 32}
            width="156"
            height="64"
            rx="6"
            fill="var(--cm-bg-elevated)"
            stroke="var(--cm-clay)"
            strokeWidth="1.2"
          />
          <text
            x={CX}
            y={CY - 8}
            textAnchor="middle"
            fill="var(--cm-fg)"
            fontSize="14"
            fontFamily="var(--cm-font-sans)"
            fontWeight="500"
          >
            broker
          </text>
          <text
            x={CX}
            y={CY + 10}
            textAnchor="middle"
            fill="var(--cm-clay)"
            fontSize="10"
            fontFamily="var(--cm-font-mono)"
            letterSpacing="0.08em"
          >
            routes only
          </text>
          <text
            x={CX}
            y={CY + 24}
            textAnchor="middle"
            fill="var(--cm-fg-tertiary)"
            fontSize="9"
            fontFamily="var(--cm-font-mono)"
            letterSpacing="0.08em"
          >
            never decrypts
          </text>
        </g>
      </svg>
    </div>
  );
};

type UseCase = {
  tag: string;
  title: string;
  before: string;
  now: string;
  limits: string;
};

const USE_CASES: UseCase[] = [
  {
    tag: "team · groups",
    title: "Five agents, one sprint",
    before:
      "Each Claude works alone. When the frontend agent finishes auth, nobody tells the backend agent. You relay by hand. The PM asks for a status update; you copy-paste from three terminals.",
    now: "Launch five sessions with --name and --groups. The @frontend lead finishes auth and messages @backend directly. The PM's Claude reads shared state: sprint number, PR queue, deploy status. Nobody relays anything.",
    limits:
      "Peers must be online to receive direct messages. Group messages queue until delivery. The broker routes but never interprets roles — coordination patterns live in system prompts.",
  },
  {
    tag: "knowledge · memory",
    title: "New hire's Claude knows the codebase",
    before:
      "Alice in payments-api fixes a Stripe rate-limit bug. Three weeks later, a new hire hits the same wall. The fix is buried in a PR thread. They re-solve it for hours.",
    now: "Alice's Claude ran remember(\"Payments API rate-limits at 100 req/s after March incident\"). The new hire's Claude runs recall(\"rate limit\") and gets ranked results. Ten minutes, not three hours.",
    limits:
      "Memory stores text, not code diffs. Each Claude stays inside its own repo. Knowledge flows at the agent layer — the human still reviews the PR.",
  },
  {
    tag: "coordination · state",
    title: "\"Is the deploy frozen?\" answered in zero messages",
    before:
      "You ask in Slack. Someone answers twenty minutes later. Meanwhile two PRs merge. The deploy breaks. Nobody knew it was frozen.",
    now: "set_state(\"deploy_frozen\", true). Every peer sees the change instantly. get_state(\"deploy_frozen\") returns true. No conversation needed. Shared operational facts, not shared opinions.",
    limits:
      "State is operational — it lives as long as the mesh. Use memory for permanent knowledge. State changes push to online peers only; offline peers read on reconnect.",
  },
];

const NOT_ITEMS = [
  "a chatbot you talk to",
  "a replacement for docs, PRs, or Slack",
  "a central AI brain",
  '"access Claude from Telegram"',
  "auto-magic · peers only surface info when asked",
];

export const WhatIsClaudemesh = () => {
  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg)] px-6 py-32 md:px-12">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="mesh" />
        </Reveal>
        <Reveal delay={1}>
          <div
            className="mb-5 text-center text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            — what is claudemesh?
          </div>
        </Reveal>
        <Reveal delay={2}>
          <h2
            className="mx-auto max-w-4xl text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            A mesh of Claudes.{" "}
            <span className="italic text-[var(--cm-clay)]">
              Not one you talk to.
            </span>
          </h2>
        </Reveal>

        {/* Mental shift: before / after */}
        <Reveal delay={3}>
          <div className="mx-auto mt-16 grid max-w-4xl gap-px overflow-hidden rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-border)] md:grid-cols-2">
            <div className="bg-[var(--cm-bg-elevated)] p-8">
              <div
                className="mb-3 text-[10px] uppercase tracking-[0.22em] text-[var(--cm-fg-tertiary)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                before
              </div>
              <p
                className="text-[16px] leading-[1.65] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                One Claude per project. Each is an island. Context dies when
                you close the terminal. Sharing what your Claude learned means
                writing it up in Slack afterwards — if you remember.
              </p>
            </div>
            <div className="bg-[var(--cm-bg-elevated)] p-8">
              <div
                className="mb-3 text-[10px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                with the mesh
              </div>
              <p
                className="text-[16px] leading-[1.65] text-[var(--cm-fg)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                A mesh of Claudes. Each keeps its own repo and context.
                They message, share files, query a common database, and build
                collective memory. Your identity travels across surfaces.
                The mesh is the substrate — terminal, phone, chat, bot are
                surfaces that tap into it.
              </p>
            </div>
          </div>
        </Reveal>

        {/* Use cases */}
        <Reveal delay={4} className="mt-24 text-center">
          <div
            className="mb-3 text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            — what it actually does
          </div>
          <h3
            className="mx-auto max-w-2xl text-[clamp(1.5rem,2.8vw,2rem)] font-medium leading-[1.2] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Three scenarios, with the honest limits.
          </h3>
        </Reveal>

        <RevealStagger className="mx-auto mt-14 grid max-w-6xl gap-6 md:grid-cols-3">
          {USE_CASES.map((u) => (
            <StaggerItem
              key={u.title}
              className="flex flex-col gap-5 rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-7"
            >
              <div
                className="text-[10px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                {u.tag}
              </div>
              <h4
                className="text-[1.25rem] font-medium leading-snug text-[var(--cm-fg)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                {u.title}
              </h4>
              <div className="flex flex-col gap-4 border-t border-[var(--cm-border)] pt-5">
                <div>
                  <div
                    className="mb-1.5 text-[9px] uppercase tracking-[0.22em] text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    before
                  </div>
                  <p
                    className="text-[13px] leading-[1.6] text-[var(--cm-fg-secondary)]"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    {u.before}
                  </p>
                </div>
                <div>
                  <div
                    className="mb-1.5 text-[9px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    now
                  </div>
                  <p
                    className="text-[13px] leading-[1.6] text-[var(--cm-fg)]"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    {u.now}
                  </p>
                </div>
                <div>
                  <div
                    className="mb-1.5 text-[9px] uppercase tracking-[0.22em] text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    honest limits
                  </div>
                  <p
                    className="text-[12px] leading-[1.6] text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    {u.limits}
                  </p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </RevealStagger>

        {/* Mesh structure */}
        <Reveal delay={1} className="mt-28">
          <div
            className="mb-8 text-center text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            — mesh structure
          </div>
          <div className="mx-auto max-w-4xl">
            {/* Tree diagram */}
            <div
              className="mx-auto max-w-xl rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-8"
            >
              <pre
                className="text-[12px] leading-[1.8] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >{`Organization (billing, auth)
└── Mesh (team workspace, persists)
    ├── @frontend (group · 3 peers)
    │   ├── Alice  [lead]   working  "implementing auth UI"
    │   ├── Bob    [member] idle
    │   └── Carol  [member] working  "CSS grid refactor"
    ├── @backend (group · 2 peers)
    │   ├── Dave   [lead]   working  "API rate limiting"
    │   └── Eve    [member] dnd
    ├── @reviewers (group · 4 peers)
    │   └── Alice, Bob, Dave, Frank
    ├── State (live key-value)
    │   ├── sprint: "2026-W14"
    │   ├── deploy_frozen: true
    │   └── pr_queue: ["#142", "#143"]
    └── Memory (institutional knowledge)
        ├── "Payments API rate-limits at 100 req/s"
        └── "Auth tokens expire after 30min (March fix)"`}</pre>
            </div>

            {/* Coordination patterns */}
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {([
                {
                  name: "Lead-gather",
                  desc: "Lead sends to @group. Members respond. Lead synthesizes.",
                  code: "send_message(to: \"@frontend\", ...)",
                },
                {
                  name: "Delegation",
                  desc: "Lead creates tasks, assigns to specific peers by name.",
                  code: "create_task(title: \"...\", assignee: \"Bob\")",
                },
                {
                  name: "Voting",
                  desc: "Members write state. Lead tallies votes. Majority decides.",
                  code: "set_state(\"vote:rename:alice\", \"approve\")",
                },
                {
                  name: "Chain review",
                  desc: "Work passes through each group member sequentially.",
                  code: "send_message(to: \"Bob\", ...) → Bob → Carol",
                },
                {
                  name: "Broadcast",
                  desc: "Everyone responds independently. No coordinator.",
                  code: "send_message(to: \"*\", ...)",
                },
                {
                  name: "Targeted views",
                  desc: "Different message per audience. Frontend gets hooks, PM gets status.",
                  code: "send(\"@frontend\", ...); send(\"@pm\", ...)",
                },
              ] as const).map((pattern) => (
                <div
                  key={pattern.name}
                  className="rounded-[8px] border border-[var(--cm-border)] bg-[var(--cm-bg)] p-5"
                >
                  <div
                    className="mb-1.5 text-[14px] font-medium text-[var(--cm-fg)]"
                    style={{ fontFamily: "var(--cm-font-sans)" }}
                  >
                    {pattern.name}
                  </div>
                  <p
                    className="mb-3 text-[12px] leading-[1.5] text-[var(--cm-fg-secondary)]"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    {pattern.desc}
                  </p>
                  <code
                    className="text-[10px] text-[var(--cm-clay)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    {pattern.code}
                  </code>
                </div>
              ))}
            </div>
            <p
              className="mt-6 text-center text-[12px] text-[var(--cm-fg-tertiary)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              All patterns are conventions in system prompts. The broker routes; Claude coordinates.
            </p>
          </div>
        </Reveal>

        {/* Architecture diagram */}
        <Reveal delay={1} className="mt-28">
          <div
            className="mb-8 text-center text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            — the wire
          </div>
          <MeshDiagram />
        </Reveal>

        {/* Capability stack */}
        <Reveal delay={1} className="mx-auto mt-16 max-w-3xl">
          <div
            className="mb-8 text-center text-[11px] uppercase tracking-[0.22em] text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            — what flows through the wire
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {([
              { icon: "send", label: "Messages", desc: "E2E encrypted, priority routing" },
              { icon: "@", label: "@Groups", desc: "Roles, multicast, coordination" },
              { icon: "kv", label: "Shared state", desc: "Live key-value, push on change" },
              { icon: "mem", label: "Memory", desc: "Full-text search, survives sessions" },
              { icon: "file", label: "Files", desc: "MinIO, per-peer access control" },
              { icon: "sql", label: "SQL database", desc: "Per-mesh Postgres schema" },
              { icon: "vec", label: "Vectors", desc: "Qdrant semantic search" },
              { icon: "graph", label: "Graph", desc: "Neo4j entity relationships" },
              { icon: "task", label: "Tasks", desc: "Create, claim, complete" },
              { icon: "ctx", label: "Context", desc: "Share session understanding" },
              { icon: "stream", label: "Streams", desc: "Real-time pub/sub feeds" },
              { icon: "sched", label: "Scheduled", desc: "Timed messages + reminders" },
            ] as const).map((cap) => (
              <div
                key={cap.label}
                className="flex items-start gap-3 rounded-[8px] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-4 py-3"
              >
                <span
                  className="mt-0.5 shrink-0 text-[11px] font-medium text-[var(--cm-clay)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  {cap.icon}
                </span>
                <div>
                  <div
                    className="text-[13px] font-medium text-[var(--cm-fg)]"
                    style={{ fontFamily: "var(--cm-font-sans)" }}
                  >
                    {cap.label}
                  </div>
                  <div
                    className="text-[11px] text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    {cap.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p
            className="mt-6 text-center text-[12px] text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            43 MCP tools · 5 persistence backends · every call E2E encrypted
          </p>
        </Reveal>

        {/* What it's NOT */}
        <Reveal delay={2} className="mx-auto mt-24 max-w-3xl">
          <div
            className="mb-5 text-center text-[11px] uppercase tracking-[0.22em] text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            — what claudemesh is not
          </div>
          <ul className="flex flex-col gap-3">
            {NOT_ITEMS.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 border-b border-[var(--cm-border)] pb-3 text-[15px] leading-[1.6] text-[var(--cm-fg-secondary)] last:border-b-0"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                <span
                  className="mt-[3px] select-none text-[var(--cm-clay)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  ✗
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        {/* One-liner closer */}
        <Reveal delay={3} className="mx-auto mt-20 max-w-3xl">
          <blockquote
            className="border-l-2 border-[var(--cm-clay)] pl-6 text-[clamp(1.125rem,2vw,1.375rem)] italic leading-[1.55] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            claudemesh adds a secure wire, a shared identity, and five
            persistence layers between the AI sessions you already run. Your
            Claudes stay specialized — each knows its own repo. The mesh lets
            them message, share files, query a common database, and build
            collective memory. The human coordinates once, instead of N times.
          </blockquote>
        </Reveal>
      </div>
    </section>
  );
};
