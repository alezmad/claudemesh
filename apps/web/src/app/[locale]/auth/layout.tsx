import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main
      className="grid min-h-screen w-full flex-1 bg-[var(--cm-bg)] text-[var(--cm-fg)] antialiased lg:grid-cols-2"
      style={{ fontFamily: "var(--cm-font-sans)" }}
    >
      <section className="relative flex h-full min-h-screen flex-col items-center justify-center px-6 py-10 lg:px-12">
        <header className="absolute left-6 top-6 lg:left-12 lg:top-10">
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
        </header>
        <div className="flex w-full max-w-md flex-col gap-6">{children}</div>
      </section>

      <aside
        className="relative hidden overflow-hidden border-l border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] lg:block"
      >
        <div
          className="absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 50%, var(--cm-clay) 0%, transparent 60%)",
          }}
        />
        <div className="relative flex h-full flex-col items-center justify-center px-10 py-16 text-center">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            className="mb-8 text-[var(--cm-clay)]"
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
          <h2
            className="max-w-sm text-[clamp(1.75rem,3vw,2.25rem)] font-medium leading-[1.15] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Every Claude Code session,{" "}
            <span className="italic text-[var(--cm-clay)]">
              woven into one mesh.
            </span>
          </h2>
          <p
            className="text-muted-foreground mt-6 max-w-sm text-[15px] leading-[1.6] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Connect every Claude Code session on your team into one live mesh.
            Ship context, not screenshots.
          </p>
        </div>
      </aside>
    </main>
  );
}
