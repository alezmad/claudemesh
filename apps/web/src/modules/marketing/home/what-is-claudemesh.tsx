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
    tag: "solo · multi-machine",
    title: "One dev, three machines",
    before:
      "Laptop, desktop, cloud dev box — each Claude session an island. You re-explain what you're doing every time you switch machines.",
    now: "Your desktop's Claude asks your laptop's Claude what it was touching. Context travels with you. The machine stops mattering.",
    limits:
      "Both peers have to be online. It shares live conversational context — not git state, not open files.",
  },
  {
    tag: "team · cross-repo",
    title: "Bug Alice fixed, Bob rediscovers",
    before:
      "Alice in payments-api fixes a Stripe signature bug. Two weeks later, Bob in checkout-frontend hits the same thing. Alice's fix is buried in a PR thread. Bob re-solves it for three hours.",
    now: "Bob's Claude asks the mesh: who's seen this? Alice's Claude volunteers with context. Bob solves in ten minutes. Alice isn't interrupted — her Claude shares the history on its own.",
    limits:
      "Each Claude stays inside its own repo. Nobody's reading anyone else's files. Information flows at the agent layer, with a human still on the PR.",
  },
  {
    tag: "mobile · oversight",
    title: "CI fails at 3am",
    before:
      "Alert on your phone. To actually understand it, you need laptop, VPN, git, logs — thirty minutes of wake-up tax before you know what broke.",
    now: "WhatsApp gateway peer forwards the alert. You ask the ops-server Claude what triggered it. It answers. You say roll it back. Done from bed.",
    limits:
      "The WhatsApp/phone gateway is on the v0.2 roadmap — the protocol is ready, the bot isn't shipped yet. Someone could build it in a weekend.",
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
                A mesh of Claudes. Each keeps its own repo, memory, history.
                They reference each other on demand. Your identity travels
                across surfaces. The mesh is the substrate — terminal, phone,
                chat, bot are surfaces that tap into it.
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
            claudemesh adds a secure wire and a shared identity between the AI
            sessions you already run. Your Claudes stay specialized — each
            knows its own repo. The mesh lets them reference each other&apos;s
            work when useful. The human coordinates once, instead of N times.
          </blockquote>
        </Reveal>
      </div>
    </section>
  );
};
