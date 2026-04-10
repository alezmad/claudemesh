import Link from "next/link";

import {
  publicInviteResponseSchema,
  type PublicInviteResponse,
} from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";

import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";
import { InstallToggle } from "~/modules/join/install-toggle";
import { InviteCard } from "~/modules/join/invite-card";

export const generateMetadata = getMetadata({
  title: "Join a mesh",
  description: "You've been invited to a claudemesh mesh.",
});

const ERROR_COPY: Record<
  Extract<PublicInviteResponse, { valid: false }>["reason"],
  { title: string; body: (inviter: string | null) => string }
> = {
  expired: {
    title: "This invite expired",
    body: (inviter) =>
      `The invite is no longer valid. Ask ${inviter ?? "the person who sent it"} for a fresh link.`,
  },
  revoked: {
    title: "This invite was revoked",
    body: (inviter) =>
      `${inviter ?? "The mesh owner"} revoked this invite. Ask for a new one if you still need access.`,
  },
  exhausted: {
    title: "This invite has no uses left",
    body: (inviter) =>
      `Every allowed use has been redeemed. Ask ${inviter ?? "the person who sent it"} for a new link.`,
  },
  mesh_archived: {
    title: "This mesh is no longer active",
    body: () => "The mesh was archived. There is nothing to join.",
  },
  bad_signature: {
    title: "This invite is invalid",
    body: () =>
      "The signature does not verify. The link was modified or forged — ask for a fresh one through a trusted channel.",
  },
  malformed: {
    title: "This invite is unreadable",
    body: () =>
      "The token could not be decoded. Check the link you received — it may be truncated.",
  },
  not_found: {
    title: "This invite does not exist",
    body: () =>
      "Nothing matches this token. It may have been deleted, or the link was mis-pasted.",
  },
};

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await handle(api.public.invite[":token"].$get, {
    schema: publicInviteResponseSchema,
  })({ param: { token } }).catch(
    () =>
      ({
        valid: false,
        reason: "malformed",
        meshName: null,
        inviterName: null,
        expiresAt: null,
      }) as const,
  );

  return (
    <main
      className="min-h-screen bg-[var(--cm-bg)] text-[var(--cm-fg)] antialiased"
      style={{ fontFamily: "var(--cm-font-sans)" }}
    >
      <header className="border-b border-[var(--cm-border)] px-6 py-5 md:px-12">
        <Link
          href="/"
          aria-label="claudemesh home"
          className="group flex w-fit items-center gap-2.5"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            className="text-[var(--cm-clay)] transition-transform duration-300 group-hover:rotate-180"
          >
            <circle cx="12" cy="4" r="2" fill="currentColor" />
            <circle cx="4" cy="12" r="2" fill="currentColor" />
            <circle cx="20" cy="12" r="2" fill="currentColor" />
            <circle cx="12" cy="20" r="2" fill="currentColor" />
            <path
              d="M12 4L4 12M12 4L20 12M4 12L12 20M20 12L12 20M4 12L20 12M12 4L12 20"
              stroke="currentColor"
              strokeWidth="1.2"
              opacity="0.45"
            />
          </svg>
          <span
            className="text-[17px] font-medium tracking-tight"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            claudemesh
          </span>
        </Link>
      </header>

      <div className="mx-auto w-full max-w-2xl px-6 py-12 md:px-12 md:py-20">
        {invite.valid ? (
          <>
            <InviteCard
              meshName={invite.meshName}
              inviterName={invite.inviterName}
              role={invite.role}
              memberCount={invite.memberCount}
              expiresAt={new Date(invite.expiresAt)}
            />

            <div id="install" className="mt-14 scroll-mt-24">
              <div
                className="mb-4 text-[11px] uppercase tracking-[0.22em] text-[var(--cm-fg-tertiary)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                — to accept, run this in your terminal
              </div>
              <InstallToggle token={invite.token} />
            </div>

            <div
              className="mt-12 rounded-[var(--cm-radius-md)] border border-dashed border-[var(--cm-border)] p-5 text-[13px] leading-[1.65] text-[var(--cm-fg-tertiary)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              By joining, you&apos;ll be known as a peer with an ed25519
              keypair generated locally. You keep your keys. claudemesh sees
              ciphertext only. Leave anytime with{" "}
              <code
                className="rounded bg-[var(--cm-bg-elevated)] px-1.5 py-0.5 text-[12px] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                claudemesh leave {invite.meshSlug}
              </code>
              .
            </div>

            <p
              className="mt-6 text-xs text-[var(--cm-fg-tertiary)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              {invite.maxUses - invite.usedCount} of {invite.maxUses} uses
              remaining
            </p>
          </>
        ) : (
          <section
            aria-labelledby="invite-error-heading"
            className="rounded-[var(--cm-radius-lg)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/60 p-7 md:p-9"
          >
            <div
              className="text-[11px] uppercase tracking-[0.22em] text-[#c46686]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              — invitation unavailable
            </div>
            <h1
              id="invite-error-heading"
              className="mt-4 text-[clamp(1.75rem,3.5vw,2.25rem)] font-medium leading-[1.15] text-[var(--cm-fg)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              {ERROR_COPY[invite.reason].title}
            </h1>
            <p
              className="mt-4 text-base leading-[1.6] text-[var(--cm-fg-secondary)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              {ERROR_COPY[invite.reason].body(invite.inviterName)}
            </p>
            {invite.meshName && (
              <p
                className="mt-2 text-sm text-[var(--cm-fg-tertiary)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                mesh: {invite.meshName}
                {invite.expiresAt &&
                  ` · expired ${new Date(invite.expiresAt).toLocaleDateString()}`}
              </p>
            )}
            <div className="mt-10">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-fg-tertiary)] px-5 py-3 text-sm font-medium text-[var(--cm-fg)] transition-colors hover:border-[var(--cm-fg)] hover:bg-[var(--cm-bg-elevated)]"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                ← claudemesh.com
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
