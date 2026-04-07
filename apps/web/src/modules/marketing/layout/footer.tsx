import Link from "next/link";

import { BuiltWith } from "@turbostarter/ui-web/built-with";
import { Icons } from "@turbostarter/ui-web/icons";

import { appConfig } from "~/config/app";
import { pathsConfig } from "~/config/paths";
import { I18nControls } from "~/modules/common/i18n/controls";

const REPO_URL = "https://github.com/alezmad/claudemesh";
const OSS_URL = "https://github.com/alezmad/claude-intercom";

const columns = [
  {
    label: "product",
    items: [
      { title: "Getting Started", href: pathsConfig.marketing.gettingStarted },
      { title: "Docs", href: "#docs" },
      { title: "Pricing", href: pathsConfig.marketing.pricing },
      { title: "Changelog", href: "#changelog" },
      { title: "Contact", href: pathsConfig.marketing.contact },
    ],
  },
  {
    label: "protocol",
    items: [
      { title: "GitHub", href: REPO_URL },
      { title: "claude-intercom (OSS)", href: OSS_URL },
      { title: "Protocol spec", href: `${OSS_URL}#protocol` },
      { title: "Self-host broker", href: `${REPO_URL}#self-host` },
    ],
  },
];

export const Footer = () => {
  return (
    <footer
      className="mt-auto w-full border-t border-[var(--cm-border)] bg-[var(--cm-bg)] px-6 pt-12 pb-8 md:px-12 md:pt-16"
      style={{ fontFamily: "var(--cm-font-sans)" }}
    >
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <div className="flex flex-col gap-10 lg:flex-row lg:gap-16">
          {/* wordmark + tagline */}
          <div className="flex flex-col gap-4 lg:w-80">
            <Link
              href={pathsConfig.index}
              className="group flex items-center gap-2.5"
              aria-label="claudemesh home"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                className="text-[var(--cm-clay)]"
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
            <p
              className="text-sm leading-[1.55] text-[var(--cm-fg-secondary)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              Peer mesh for Claude Code. Messaging, files, databases, vectors,
              graphs — E2E encrypted. Every session, woven into one mesh.
            </p>
            <I18nControls />
            <div className="mt-2 flex items-center gap-2.5">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="claudemesh on GitHub"
                className="text-[var(--cm-fg-tertiary)] transition-colors hover:text-[var(--cm-fg)]"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6a4.7 4.7 0 011.3-3.3c-.2-.3-.6-1.6.1-3.3 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 3 .1 3.3a4.7 4.7 0 011.3 3.3c0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3" />
                </svg>
              </a>
            </div>
          </div>

          {/* link columns */}
          <div className="grid flex-1 grid-cols-2 gap-8 md:grid-cols-2 lg:gap-12">
            {columns.map((col) => (
              <div key={col.label} className="flex flex-col gap-3">
                <span
                  className="text-[11px] uppercase tracking-[0.18em] text-[var(--cm-clay)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  {col.label}
                </span>
                <ul className="flex flex-col gap-2">
                  {col.items.map((item) => {
                    const external = item.href.startsWith("http");
                    return (
                      <li key={item.title}>
                        <Link
                          href={item.href}
                          {...(external
                            ? { target: "_blank", rel: "noopener noreferrer" }
                            : {})}
                          className="text-sm text-[var(--cm-fg-secondary)] transition-colors hover:text-[var(--cm-fg)]"
                        >
                          {item.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* bottom bar */}
        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-[var(--cm-border)] pt-6 sm:flex-row sm:items-center">
          <p
            className="text-xs text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            © {new Date().getFullYear()} {appConfig.name} · MIT licensed
          </p>
          <BuiltWith />
        </div>
      </div>
    </footer>
  );
};
