interface InviterLineProps {
  inviterName: string | null;
}

export function InviterLine({ inviterName }: InviterLineProps) {
  const initial = (inviterName ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className="flex items-center gap-3"
      style={{ fontFamily: "var(--cm-font-sans)" }}
    >
      <div
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] text-[13px] font-medium text-[var(--cm-fg-secondary)]"
        style={{ fontFamily: "var(--cm-font-serif)" }}
      >
        {initial}
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--cm-fg-tertiary)]">
          Invited by
        </span>
        <span className="text-[14.5px] font-medium text-[var(--cm-fg)]">
          {inviterName ?? "the mesh owner"}
        </span>
      </div>
    </div>
  );
}
