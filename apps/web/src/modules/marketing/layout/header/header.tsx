import Link from "next/link";

const NAV = [
  { label: "Docs", href: "#docs" },
  { label: "Pricing", href: "#pricing" },
  { label: "Changelog", href: "#changelog" },
  {
    label: "GitHub",
    href: "https://github.com/claudemesh/claudemesh",
    external: true,
  },
];

export const Header = () => {
  return (
    <header
      className="sticky top-0 z-40 w-full border-b border-[var(--cm-border)] bg-[var(--cm-bg)]/85 backdrop-blur-md"
      style={{ fontFamily: "var(--cm-font-sans)" }}
    >
      <div className="mx-auto flex h-16 max-w-[var(--cm-max-w)] items-center justify-between px-6 md:px-10">
        {/* wordmark */}
        <Link
          href="/"
          aria-label="claudemesh home"
          className="group flex shrink-0 items-center gap-2.5"
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
            className="text-[17px] font-medium tracking-tight text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            claudemesh
          </span>
        </Link>

        {/* center nav */}
        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              {...(item.external
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
              className="text-[14px] text-[var(--cm-fg-secondary)] transition-colors hover:text-[var(--cm-fg)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* right */}
        <div className="flex items-center gap-2">
          <Link
            href="/auth/login"
            className="hidden rounded-[var(--cm-radius-xs)] px-3 py-2 text-[14px] text-[var(--cm-fg-secondary)] transition-colors hover:text-[var(--cm-fg)] md:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="https://github.com/claudemesh/claudemesh"
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-[var(--cm-radius-xs)] bg-[var(--cm-clay)] px-4 py-2 text-[14px] font-medium text-[var(--cm-fg)] transition-colors hover:bg-[var(--cm-clay-hover)]"
          >
            Start free
            <span className="hidden sm:inline">→</span>
          </Link>
        </div>
      </div>
    </header>
  );
};
