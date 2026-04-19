"use client";

import { useState } from "react";

import { Reveal } from "./reveal";

interface IncomingInvite {
  id: string;
  meshId: string;
  meshName: string | null;
  meshSlug: string | null;
  code: string;
  role: "admin" | "member" | null;
  expiresAt: string | Date | null;
  sentAt: string | Date;
  inviterName: string | null;
  inviterEmail: string | null;
  memberCount: number;
}

type CardStatus = "idle" | "declining" | "declined";

const formatExpiry = (d: string | Date | null): string => {
  if (!d) return "NO EXPIRY";
  const date = typeof d === "string" ? new Date(d) : d;
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return "EXPIRED";
  const h = Math.floor(diffMs / 36e5);
  const days = Math.floor(h / 24);
  const hoursRem = h % 24;
  if (days > 0) return `EXPIRES IN ${days}D ${hoursRem}H`;
  return `EXPIRES IN ${h}H`;
};

export const InvitationsSection = ({
  incoming,
  appBaseUrl,
}: {
  incoming: IncomingInvite[];
  appBaseUrl: string;
}) => {
  const [dismissed, setDismissed] = useState<Record<string, CardStatus>>({});

  const visible = incoming.filter((i) => dismissed[i.id] !== "declined");

  if (visible.length === 0) return null;

  const decline = async (id: string) => {
    setDismissed((s) => ({ ...s, [id]: "declining" }));
    try {
      const res = await fetch(`/api/my/invites/incoming/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      setDismissed((s) => ({ ...s, [id]: "declined" }));
    } catch {
      setDismissed((s) => ({ ...s, [id]: "idle" }));
    }
  };

  return (
    <section className="mb-14">
      <Reveal delay={0}>
        <div className="mb-6 flex items-baseline justify-between gap-6">
          <h2
            className="text-[28px] leading-none tracking-tight"
            style={{ fontFamily: "var(--cm-font-serif)", fontWeight: 400 }}
          >
            Invitations <span className="italic text-[var(--cm-clay)]">waiting</span>
          </h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--cm-fg-tertiary)]">
            {visible.length} pending
          </span>
        </div>
      </Reveal>

      <div className="grid gap-4 md:grid-cols-2">
        {visible.map((inv, idx) => {
          const status = dismissed[inv.id] ?? "idle";
          const inviterLabel =
            inv.inviterName ?? inv.inviterEmail ?? "someone";
          const joinHref = `${appBaseUrl}/i/${inv.code}`;

          return (
            <Reveal key={inv.id} delay={idx + 1}>
              <article
                className="group relative overflow-hidden rounded-md border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-6 pb-5 pt-6 transition-colors duration-300 hover:border-[var(--cm-border-hover)]"
                style={{
                  backgroundImage:
                    "linear-gradient(180deg, rgba(196,102,134,0.04), transparent 60%)",
                  opacity: status === "declining" ? 0.5 : 1,
                  pointerEvents: status === "declining" ? "none" : "auto",
                  transition: "opacity 0.3s ease",
                }}
              >
                <span className="absolute left-0 top-0 h-full w-[3px] bg-[var(--cm-fig)]" />

                <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--cm-fg-tertiary)]">
                  From ·{" "}
                  <span
                    className="text-[13px] normal-case tracking-normal text-[var(--cm-fig)]"
                    style={{ fontFamily: "var(--cm-font-sans)" }}
                  >
                    {inviterLabel}
                  </span>
                </div>

                <h3
                  className="mb-1 text-[22px] leading-tight tracking-tight text-[var(--cm-fg)]"
                  style={{ fontFamily: "var(--cm-font-serif)", fontWeight: 400 }}
                >
                  Join{" "}
                  <em className="italic text-[var(--cm-clay)]">
                    {inv.meshName ?? inv.meshSlug ?? "a mesh"}
                  </em>
                </h3>

                <p className="mb-5 text-[13px] text-[var(--cm-fg-secondary)]">
                  {inv.memberCount}{" "}
                  {inv.memberCount === 1 ? "member" : "members"} · you&rsquo;d join as{" "}
                  <strong className="font-medium text-[var(--cm-fg)]">
                    {inv.role ?? "member"}
                  </strong>
                </p>

                <div className="flex items-center gap-3">
                  <a
                    href={joinHref}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-sm bg-[var(--cm-clay)] px-4 py-2 text-[13px] font-medium text-[var(--cm-gray-050)] transition-colors hover:bg-[var(--cm-clay-hover)]"
                  >
                    Accept
                  </a>
                  <button
                    type="button"
                    onClick={() => decline(inv.id)}
                    disabled={status !== "idle"}
                    className="rounded-sm border border-[var(--cm-border)] px-4 py-2 text-[13px] text-[var(--cm-fg-secondary)] transition-colors hover:border-[var(--cm-border-hover)] hover:text-[var(--cm-fg)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === "declining" ? "Declining…" : "Decline"}
                  </button>
                  <span className="ml-auto font-mono text-[11px] tracking-wide text-[var(--cm-fg-tertiary)]">
                    {formatExpiry(inv.expiresAt)}
                  </span>
                </div>
              </article>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
};
