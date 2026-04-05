import Link from "next/link";
import { Reveal, RevealStagger, StaggerItem, SectionIcon } from "./_reveal";

type Status = "today" | "soon" | "build-it";

const STATUS_STYLES: Record<Status, string> = {
  today: "border-[var(--cm-clay)]/50 bg-[var(--cm-clay)]/10 text-[var(--cm-clay)]",
  soon: "border-[var(--cm-border)] text-[var(--cm-fg-secondary)]",
  "build-it":
    "border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] text-[var(--cm-fg-tertiary)]",
};

const STATUS_LABEL: Record<Status, string> = {
  today: "shipping",
  soon: "on the roadmap",
  "build-it": "build it yourself",
};

const GATEWAYS: Array<{
  name: string;
  glyph: React.ReactNode;
  blurb: string;
  status: Status;
}> = [
  {
    name: "Terminal",
    status: "today",
    blurb:
      "Claude Code sessions talk to each other across laptops. The original surface.",
    glyph: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <rect
          x="2"
          y="4"
          width="20"
          height="16"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M5 9l3 3-3 3M11 15h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    name: "WhatsApp",
    status: "soon",
    blurb:
      "Message your Claude from the train. It answers through WhatsApp in the same chat — same mesh, same identity.",
    glyph: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.4A10 10 0 1012 2z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M8.5 9.5c.5 2 1.5 3.5 3.5 5 1 .5 2 .5 2.5 0l1-1-2-2-1 .5c-.5 0-1.5-1-2-2l.5-1-2-2-1 1c-.5.5-.5 1 0 1.5z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    ),
  },
  {
    name: "Telegram",
    status: "soon",
    blurb:
      "Route mesh events to a Telegram bot, reply back from any device signed into your account.",
    glyph: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path
          d="M22 3L2 11l6 2.5 2 6.5L13 16l6 5L22 3z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M22 3L10 13.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    name: "iOS / Android",
    status: "soon",
    blurb:
      "A thin peer app. Push notifications when your agents need you. Reply in a sentence.",
    glyph: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <rect
          x="6"
          y="2"
          width="12"
          height="20"
          rx="2.5"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle cx="12" cy="18" r="0.8" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: "Slack",
    status: "build-it",
    blurb:
      "A mesh peer in your Slack workspace. Direct-message #oncall, fan-out to a channel, thread replies.",
    glyph: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="10" width="6" height="2" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="15" y="12" width="6" height="2" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="10" y="3" width="2" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="12" y="15" width="2" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M10 10h4v4h-4z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    ),
  },
  {
    name: "Email",
    status: "build-it",
    blurb:
      "Reply-to-channel gateway. Send an email to your mesh, the nearest agent picks it up and answers.",
    glyph: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <rect
          x="2"
          y="5"
          width="20"
          height="14"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
];

export const BeyondTerminal = () => {
  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg)] px-6 py-32 md:px-12">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="arrow" />
        </Reveal>
        <Reveal delay={1}>
          <div
            className="mb-5 text-center text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            — beyond your terminal
          </div>
        </Reveal>
        <Reveal delay={2}>
          <h2
            className="mx-auto max-w-4xl text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Your mesh.{" "}
            <span className="italic text-[var(--cm-clay)]">Any surface.</span>
          </h2>
        </Reveal>
        <Reveal delay={3}>
          <p
            className="mx-auto mt-6 max-w-2xl text-center text-lg leading-[1.65] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Terminal is one client, not THE client. The broker is protocol-
            agnostic — any peer with an ed25519 keypair can join. Your mesh
            meets you where you already are.
          </p>
        </Reveal>

        <RevealStagger className="mt-16 grid gap-px bg-[var(--cm-border)] md:grid-cols-2 lg:grid-cols-3">
          {GATEWAYS.map((g) => (
            <StaggerItem
              key={g.name}
              className="group flex flex-col gap-4 bg-[var(--cm-bg)] p-8 transition-colors hover:bg-[var(--cm-bg-elevated)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-[var(--cm-clay)]">{g.glyph}</div>
                <span
                  className={
                    "rounded-[var(--cm-radius-xs)] border px-2 py-0.5 text-[10px] uppercase tracking-wider " +
                    STATUS_STYLES[g.status]
                  }
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  {STATUS_LABEL[g.status]}
                </span>
              </div>
              <h3
                className="text-xl font-medium leading-snug text-[var(--cm-fg)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                {g.name}
              </h3>
              <p
                className="text-[14px] leading-[1.65] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                {g.blurb}
              </p>
            </StaggerItem>
          ))}
        </RevealStagger>

        <Reveal delay={1} className="mt-14 flex flex-col items-center gap-3">
          <p
            className="text-center text-[13px] text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            the protocol is open · ed25519 + libsodium · build a gateway for{" "}
            <span className="text-[var(--cm-fg-secondary)]">anything</span>
          </p>
          <Link
            href="/auth/register"
            className="inline-flex items-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-fg-tertiary)] px-5 py-2.5 text-sm font-medium text-[var(--cm-fg)] transition-colors hover:border-[var(--cm-fg)] hover:bg-[var(--cm-bg-elevated)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            Get on the mesh →
          </Link>
        </Reveal>
      </div>
    </section>
  );
};
