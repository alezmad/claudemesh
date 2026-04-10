import { ConsentSummary } from "./consent-summary";
import { InviterLine } from "./inviter-line";
import { RoleBadge, roleLabel } from "./role-badge";

interface InviteCardProps {
  meshName: string;
  inviterName: string | null;
  role: "admin" | "member";
  memberCount: number;
  expiresAt: Date;
}

export function InviteCard({
  meshName,
  inviterName,
  role,
  memberCount,
  expiresAt,
}: InviteCardProps) {
  const peerWord = memberCount === 1 ? "peer" : "peers";

  return (
    <section
      aria-labelledby="invite-heading"
      className="relative overflow-hidden rounded-[var(--cm-radius-lg)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/60 p-7 md:p-9"
    >
      {/* Eyebrow */}
      <div
        className="text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
        style={{ fontFamily: "var(--cm-font-mono)" }}
      >
        — invitation
      </div>

      {/* Hero */}
      <h1
        id="invite-heading"
        className="mt-4 text-[clamp(1.9rem,3.6vw,2.65rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
        style={{ fontFamily: "var(--cm-font-serif)" }}
      >
        You&apos;ve been invited to join{" "}
        <span className="italic text-[var(--cm-clay)]">{meshName}</span>
      </h1>

      {/* Inviter + stats row */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <InviterLine inviterName={inviterName} />
        <div
          className="flex items-center gap-2 text-[12.5px] text-[var(--cm-fg-tertiary)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--cm-cactus)]"
          />
          <span>
            {memberCount} {peerWord} · private mesh
          </span>
        </div>
      </div>

      {/* Role badge */}
      <div className="mt-6">
        <RoleBadge role={role} />
      </div>

      {/* Consent bullets */}
      <div className="mt-5">
        <ConsentSummary />
      </div>

      {/* Primary action block */}
      <div className="mt-8 flex flex-col gap-3">
        <a
          href="#install"
          className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--cm-radius-md)] bg-[var(--cm-clay)] px-6 py-4 text-[15px] font-medium text-[var(--cm-gray-050)] transition-colors hover:bg-[var(--cm-clay-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cm-clay)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cm-bg)]"
          style={{ fontFamily: "var(--cm-font-sans)" }}
          aria-label={`Join ${meshName} as ${roleLabel(role)}`}
        >
          Join {meshName} as {roleLabel(role)}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M5 12h14M13 5l7 7-7 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
        <p
          className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[var(--cm-fg-tertiary)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          <span>
            valid until{" "}
            {expiresAt.toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
          <a
            href="/auth/logout"
            className="underline-offset-4 hover:underline"
          >
            Not you? Sign out
          </a>
        </p>
      </div>
    </section>
  );
}
