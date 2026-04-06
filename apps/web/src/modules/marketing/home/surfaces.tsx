import Image from "next/image";
import Link from "next/link";
import { Reveal } from "./_reveal";

export const Surfaces = () => {
  return (
    <section className="relative border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-16 max-w-3xl">
          <div
            className="mb-5 text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            — surfaces
          </div>
          <h2
            className="text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Use claudemesh where your team already works
          </h2>
        </Reveal>

        <Reveal delay={1}>
          <div className="overflow-hidden rounded-[var(--cm-radius-lg)] border border-[var(--cm-border)] bg-[var(--cm-bg)]">
            {/* top browser bar */}
            <div className="flex items-center gap-2 border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-4 py-3">
              <div className="flex gap-1.5">
                <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
                <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
                <span className="h-3 w-3 rounded-full bg-[#28C840]" />
              </div>
              <div
                className="ml-4 flex-1 text-xs text-[var(--cm-fg-tertiary)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                mesh.yourteam.local — live sessions: 6
              </div>
            </div>
            <div className="grid gap-0 md:grid-cols-[320px_1fr]">
              {/* sidebar */}
              <aside className="border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-6 md:border-b-0 md:border-r">
                <div
                  className="mb-4 text-[10px] uppercase tracking-[0.2em] text-[var(--cm-fg-tertiary)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  peers · 6 online
                </div>
                {[
                  { name: "alex", repo: "api-gateway", state: "working" },
                  { name: "sam", repo: "billing-svc", state: "idle" },
                  { name: "jordan", repo: "infra", state: "working" },
                  { name: "mo", repo: "dashboard", state: "dnd" },
                ].map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between border-b border-[var(--cm-border)] py-3 last:border-b-0"
                  >
                    <div>
                      <div
                        className="text-sm text-[var(--cm-fg)]"
                        style={{ fontFamily: "var(--cm-font-sans)" }}
                      >
                        {p.name}
                      </div>
                      <div
                        className="text-xs text-[var(--cm-fg-tertiary)]"
                        style={{ fontFamily: "var(--cm-font-mono)" }}
                      >
                        {p.repo}
                      </div>
                    </div>
                    <span
                      className={
                        "h-2 w-2 rounded-full " +
                        (p.state === "working"
                          ? "bg-[var(--cm-clay)] animate-pulse"
                          : p.state === "idle"
                            ? "bg-[var(--cm-gray-350)]"
                            : "bg-[#c46686]")
                      }
                    />
                  </div>
                ))}
              </aside>
              {/* main */}
              <div className="p-8 md:p-12">
                <div
                  className="mb-2 text-xs text-[var(--cm-clay)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  alex → jordan · 2m ago · priority: next
                </div>
                <div
                  className="mb-8 rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-5 text-[15px] leading-[1.6] text-[var(--cm-fg)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  Renamed <code className="text-[var(--cm-clay)]">AUTH_TOKEN</code> →{" "}
                  <code className="text-[var(--cm-clay)]">AUTH_TOKEN_V2</code> in
                  terraform/secrets.tf. When you go idle, bump your env loader in{" "}
                  <code className="text-[var(--cm-clay)]">api-gateway/src/env.ts</code>.
                </div>
                <div
                  className="text-xs text-[var(--cm-fg-tertiary)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  ↳ queued · will deliver when jordan&apos;s session goes idle
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={2}>
          <div className="mt-16 grid gap-8 md:grid-cols-2">
            <div>
              <h3
                className="mb-3 text-2xl font-medium text-[var(--cm-fg)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                Mesh Dashboard
              </h3>
              <span
                className="inline-block rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--cm-clay)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                Beta
              </span>
            </div>
            <div
              className="flex flex-col items-start gap-5 text-[15px] leading-[1.65] text-[var(--cm-fg-secondary)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              <p>
                Watch every Claude Code session on your team. Who&apos;s working
                on what. Who&apos;s idle. What messages are in flight. Route by
                name, by repo, by priority.
              </p>
              <Link
                href="#"
                className="inline-flex items-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-fg-tertiary)] px-5 py-2.5 text-sm font-medium text-[var(--cm-fg)] transition-colors hover:border-[var(--cm-fg)] hover:bg-[var(--cm-bg)]"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                Open the dashboard
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
