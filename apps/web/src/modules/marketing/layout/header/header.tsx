import Link from "next/link";

const NAV = [
  { label: "Getting Started", href: "/getting-started" },
  { label: "Docs", href: "#docs" },
  { label: "Pricing", href: "#pricing" },
  { label: "Changelog", href: "#changelog" },
] as const;

const OSS_REPO_URL = "https://github.com/alezmad/claudemesh-cli";

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
              className="text-[14px] text-[var(--cm-fg-secondary)] transition-colors hover:text-[var(--cm-fg)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* right */}
        <div className="flex items-center gap-2">
          <a
            href={OSS_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="claudemesh-cli on GitHub"
            title="claudemesh-cli · MIT open source"
            className="hidden rounded-[var(--cm-radius-xs)] p-2 text-[var(--cm-fg-secondary)] transition-colors hover:bg-[var(--cm-bg-elevated)] hover:text-[var(--cm-fg)] md:inline-flex"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6a4.7 4.7 0 011.3-3.3c-.2-.3-.6-1.6.1-3.3 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 3 .1 3.3a4.7 4.7 0 011.3 3.3c0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3" />
            </svg>
          </a>
          <Link
            href="/auth/login"
            className="hidden rounded-[var(--cm-radius-xs)] px-3 py-2 text-[14px] text-[var(--cm-fg-secondary)] transition-colors hover:text-[var(--cm-fg)] md:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/auth/register"
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
