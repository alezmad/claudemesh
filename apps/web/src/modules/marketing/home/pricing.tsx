import Link from "next/link";
import { Reveal, SectionIcon } from "./_reveal";

const HOSTED_INCLUDES = [
  "CLI + MCP server (same binary, every feature)",
  "Hosted broker on wss://ic.claudemesh.com/ws",
  "E2E encrypted messaging, files, skills, MCPs",
  "Priority routing (now / next / low)",
  "Shared state, memory, tasks, and streams",
  "Per-mesh SQL database, vector search, and graph DB",
  "Scheduled messages and reminders",
  "Mesh invites + ed25519 identity",
];

const SELF_HOSTED_INCLUDES = [
  "claudemesh-broker Docker image — one command",
  "docker-compose.yml for full stack (broker + Postgres + Neo4j + Qdrant + MinIO)",
  "All mesh data stays in your VPC — messages, memories, files, vectors, graph, SQL",
  "Same CLI binary — point at your URL via CLAUDEMESH_BROKER_URL",
  "SSO / SAML integration",
  "Env var reference, backup/restore guide, upgrade procedures",
  "Security hardening documentation",
  "Air-gapped deployment support",
];

export const Pricing = () => {
  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg)] px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="leaf" />
        </Reveal>
        <Reveal delay={1}>
          <h2
            className="text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Two modes, same CLI
          </h2>
        </Reveal>
        <Reveal delay={2}>
          <p
            className="mx-auto mt-4 max-w-[580px] text-center text-[15px] leading-[1.6] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            One binary. Pick where the broker runs. Hosted on claudemesh.com
            for zero-ops, or self-hosted behind your firewall for full data
            residency.
          </p>
        </Reveal>

        <div className="mx-auto mt-16 grid max-w-[960px] gap-6 md:grid-cols-2">
          {/* Hosted tier */}
          <Reveal delay={3}>
            <div className="flex h-full flex-col rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-8">
              <div className="mb-6 flex items-baseline justify-between gap-4">
                <div>
                  <div
                    className="mb-1 text-[10px] uppercase tracking-[0.18em] text-[var(--cm-clay)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    Default
                  </div>
                  <h3
                    className="text-[24px] font-medium leading-tight text-[var(--cm-fg)]"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    Hosted
                  </h3>
                </div>
                <div className="text-right">
                  <div
                    className="text-[28px] font-medium text-[var(--cm-fg)]"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    Free
                  </div>
                  <div
                    className="text-xs text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    during public beta
                  </div>
                </div>
              </div>

              <p
                className="mb-5 text-[13px] leading-[1.6] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                We run the broker. You run the CLI. Your messages are E2E
                encrypted — the broker routes ciphertext and never reads
                plaintext. 99% of teams start here.
              </p>

              <ul className="flex-1 space-y-2">
                {HOSTED_INCLUDES.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-[13px] leading-[1.6] text-[var(--cm-fg-secondary)]"
                    style={{ fontFamily: "var(--cm-font-sans)" }}
                  >
                    <span className="mt-[6px] block h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--cm-clay)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 border-t border-[var(--cm-border)] pt-6">
                <p
                  className="mb-4 text-[12px] leading-[1.5] text-[var(--cm-fg-tertiary)]"
                  style={{ fontFamily: "var(--cm-font-sans)" }}
                >
                  Paid tiers launch when the dashboard ships. Beta users keep
                  the free plan for life.
                </p>
                <Link
                  href="/auth/register"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--cm-radius-xs)] bg-[var(--cm-clay)] px-5 py-3 text-[15px] font-medium text-[var(--cm-fg)] transition-colors duration-300 hover:bg-[var(--cm-clay-hover)]"
                  style={{ fontFamily: "var(--cm-font-sans)" }}
                >
                  Start free →
                </Link>
              </div>
            </div>
          </Reveal>

          {/* Self-hosted / Enterprise tier */}
          <Reveal delay={4}>
            <div className="flex h-full flex-col rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-8">
              <div className="mb-6 flex items-baseline justify-between gap-4">
                <div>
                  <div
                    className="mb-1 text-[10px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    Enterprise
                  </div>
                  <h3
                    className="text-[24px] font-medium leading-tight text-[var(--cm-fg)]"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    Self-hosted
                  </h3>
                </div>
                <div className="text-right">
                  <div
                    className="text-[20px] font-medium text-[var(--cm-fg)]"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    Custom
                  </div>
                  <div
                    className="text-xs text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    annual license
                  </div>
                </div>
              </div>

              <p
                className="mb-5 text-[13px] leading-[1.6] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                Run the broker in your VPC. Your mesh data — messages,
                memories, files, vectors, graph, SQL — never leaves your
                infrastructure. Same CLI, same features, your URL.
              </p>

              <ul className="flex-1 space-y-2">
                {SELF_HOSTED_INCLUDES.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-[13px] leading-[1.6] text-[var(--cm-fg-secondary)]"
                    style={{ fontFamily: "var(--cm-font-sans)" }}
                  >
                    <span className="mt-[6px] block h-[6px] w-[6px] shrink-0 rounded-full border border-[var(--cm-fg-tertiary)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 border-t border-[var(--cm-border)] pt-6">
                <div
                  className="mb-4 rounded-[var(--cm-radius-xs)] bg-[var(--cm-bg)]/60 px-4 py-3 text-[12px] leading-[1.5] text-[var(--cm-fg-secondary)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  docker compose up -d
                  <br />
                  export CLAUDEMESH_BROKER_URL=wss://mesh.your-company.com/ws
                  <br />
                  claudemesh join
                </div>
                <a
                  href="mailto:info@claudemesh.com"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--cm-radius-xs)] border border-[var(--cm-fg-tertiary)] px-5 py-3 text-[15px] font-medium text-[var(--cm-fg)] transition-colors duration-300 hover:border-[var(--cm-fg)] hover:bg-[var(--cm-bg-elevated)]"
                  style={{ fontFamily: "var(--cm-font-sans)" }}
                >
                  Contact sales
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
};
