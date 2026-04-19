import { Reveal } from "./reveal";

interface WelcomeProps {
  name: string;
  meshCount: number;
  inviteCount: number;
}

export const UniverseWelcome = ({ name, meshCount, inviteCount }: WelcomeProps) => {
  const inviteLine =
    inviteCount === 0
      ? null
      : inviteCount === 1
        ? "1 invitation"
        : `${inviteCount} invitations`;

  const firstName = name.split(" ")[0] ?? name;

  return (
    <header className="mb-14 grid gap-10 border-b border-[var(--cm-border-soft,rgba(217,119,87,0.1))] pb-10 md:mb-16 md:grid-cols-[1fr_auto] md:items-end md:gap-16 md:pb-14">
      <div>
        <Reveal delay={0}>
          <h1
            className="text-[clamp(2.25rem,1.8rem+3vw,3.75rem)] leading-[1.02] tracking-tight"
            style={{ fontFamily: "var(--cm-font-serif)", fontWeight: 400 }}
          >
            Welcome back,{" "}
            <span className="italic text-[var(--cm-clay)]">{firstName}</span>.
            <br />
            <span className="italic text-[var(--cm-fg-tertiary)]">Your universe is</span>{" "}
            active.
          </h1>
        </Reveal>

        <Reveal delay={1}>
          <p
            className="mt-5 max-w-2xl text-[17px] leading-[1.6] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            You own or belong to{" "}
            <strong className="font-medium text-[var(--cm-fg)]">
              {meshCount} {meshCount === 1 ? "mesh" : "meshes"}
            </strong>
            {inviteLine ? (
              <>
                {" "}— and{" "}
                <strong className="font-medium text-[var(--cm-clay)]">
                  {inviteLine}
                </strong>{" "}
                waiting for an answer.
              </>
            ) : (
              "."
            )}
          </p>
        </Reveal>
      </div>

      <Reveal delay={2}>
        <div className="text-right font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--cm-fg-tertiary)]">
          <span
            className="mb-1 block text-right text-[42px] leading-none text-[var(--cm-fg)] tabular-nums"
            style={{ fontFamily: "var(--cm-font-serif)", fontWeight: 400 }}
          >
            {meshCount}
            <span className="not-italic text-[var(--cm-clay)] italic"> / {meshCount + inviteCount}</span>
          </span>
          <span className="mt-2 block">
            <span className="mr-2 inline-block size-[7px] animate-pulse rounded-full bg-[var(--cm-cactus)] align-middle" />
            meshes · your reach
          </span>
          <span className="mt-1 block">updated just now</span>
        </div>
      </Reveal>
    </header>
  );
};
