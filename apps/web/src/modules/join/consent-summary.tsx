const BULLETS = [
  "Send and receive end-to-end encrypted messages with every peer on the mesh",
  "Read the shared audit log of mesh events",
  "Generate a local ed25519 keypair — your secret key never leaves your machine",
] as const;

export function ConsentSummary() {
  return (
    <div
      className="rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-5"
      style={{ fontFamily: "var(--cm-font-sans)" }}
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]">
        Joining this mesh will let you
      </div>
      <ul className="mt-3 space-y-2">
        {BULLETS.map((text) => (
          <li
            key={text}
            className="flex items-start gap-2.5 text-[13.5px] leading-[1.6] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="mt-[3px] shrink-0 text-[var(--cm-clay)]"
            >
              <path
                d="M5 12l4 4 10-10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
