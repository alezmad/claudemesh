type Role = "admin" | "member";

const ROLE_CONFIG: Record<
  Role,
  {
    label: string;
    description: string;
    icon: React.ReactNode;
    accent: string;
    dot: string;
  }
> = {
  admin: {
    label: "Admin",
    description:
      "Full control: invite and remove peers, manage settings, send and receive messages.",
    // subtle warning treatment — fig (pinkish) accent, not alarming
    accent: "#c46686",
    dot: "#c46686",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1 3-6z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  member: {
    label: "Member",
    description:
      "Send and receive messages, read the shared audit log, participate in mesh traffic.",
    accent: "var(--cm-clay)",
    dot: "var(--cm-clay)",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M4 20c0-4 4-6 8-6s8 2 8 6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
};

interface RoleBadgeProps {
  role: Role;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const cfg = ROLE_CONFIG[role];
  return (
    <div
      className="flex items-start gap-3 rounded-[var(--cm-radius-md)] border p-4"
      style={{
        borderColor: cfg.accent,
        backgroundColor:
          "color-mix(in srgb, var(--cm-bg-elevated) 70%, transparent)",
      }}
    >
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{
          color: cfg.accent,
          backgroundColor: "color-mix(in srgb, var(--cm-bg) 60%, transparent)",
          border: `1px solid ${cfg.accent}`,
        }}
      >
        {cfg.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="flex items-center gap-2 text-[13px] font-medium"
          style={{ color: cfg.accent, fontFamily: "var(--cm-font-sans)" }}
        >
          <span className="uppercase tracking-[0.14em]">
            You&apos;ll join as {cfg.label}
          </span>
        </div>
        <p
          className="mt-1 text-[13.5px] leading-[1.55] text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          {cfg.description}
        </p>
      </div>
    </div>
  );
}

export function roleLabel(role: Role) {
  return ROLE_CONFIG[role].label;
}
