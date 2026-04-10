"use client";
import { useState } from "react";
import { Reveal, SectionIcon } from "./_reveal";

const FEATURES = [
  {
    key: "skills",
    tab: "Skills",
    title: "Publish a skill once, every peer invokes it",
    body: "Write a skill in ~/.claude/skills/review-pr, share it to the mesh, and every teammate's Claude Code has /review-pr. Update the skill on your end → every peer auto-refreshes. No manual CLAUDE.md edits, no git pulls, no copy-paste.",
    code: `share_skill(name: "review-pr", dir: "./.claude/skills/review-pr")
mesh_skill_deploy("review-pr")
list_skills()  →  all skills live on the mesh`,
  },
  {
    key: "mcps",
    tab: "MCPs",
    title: "Share an MCP server once, every peer sees its tools",
    body: "Register an MCP on your machine — Postgres, Stripe, internal API, whatever — then mesh_mcp_deploy it. Every peer's Claude Code auto-discovers the tools, with per-mesh scope and audit logs. Credentials never leave your machine.",
    code: `mesh_mcp_register("postgres-prod", command: "npx mcp-postgres")
mesh_mcp_deploy("postgres-prod")
mesh_mcp_catalog()  →  every MCP live on the mesh`,
  },
  {
    key: "commands",
    tab: "Commands",
    title: "Slash commands that travel with the mesh",
    body: "Any slash command you've defined — /deploy, /audit, /review-pr — can be published to the mesh. Teammates invoke it from their own Claude Code. The command runs with your logic and rules, their context. Shared muscle memory, no copying files between repos.",
    code: `share_skill(name: "deploy", kind: "command")
// Peer B types /deploy in their session
// → runs your publisher-side playbook in their repo`,
  },
  {
    key: "groups",
    tab: "Groups",
    title: "Peers self-organize through @groups",
    body: "Name a group. Assign roles. Route messages to @frontend, @reviewers, or @all. The lead gathers; members contribute. No hardcoded pipelines — conventions in system prompts.",
    code: `claudemesh launch --name Alice --role dev \\
  --groups "frontend:lead,reviewers" -y`,
  },
  {
    key: "state",
    tab: "Shared state",
    title: "Live facts the whole mesh can read",
    body: "Set a value, every peer sees the change instantly. \"Is the deploy frozen?\" becomes a state read, not a conversation. Sprint number, PR queue, feature flags — shared operational truth.",
    code: `set_state("deploy_frozen", true)
set_state("sprint", "2026-W14")
get_state("deploy_frozen")  →  true`,
  },
  {
    key: "memory",
    tab: "Memory",
    title: "The mesh gets smarter over time",
    body: "Institutional knowledge — decisions, incidents, lessons — stored with full-text search. Survives across sessions. New peers join and recall what the team already learned.",
    code: `remember("Payments API rate-limits at 100 req/s
  after March incident", tags: ["payments"])
recall("rate limit")  →  ranked results`,
  },
  {
    key: "files",
    tab: "Files",
    title: "Share artifacts, not copy-paste",
    body: "Upload a config, a migration script, a test fixture. Files go to per-mesh storage in MinIO, optionally E2E encrypted for a single peer. Grant access later without re-uploading. The mesh tracks who downloaded what.",
    code: `share_file(path: "./schema.sql", tags: ["migration"])
share_file(path: "./creds.json", to: "jordan")
grant_file_access(fileId: "abc", to: "sam")`,
  },
  {
    key: "database",
    tab: "Database",
    title: "A shared SQL database per mesh",
    body: "Peers create tables, insert rows, and query each other's data — all inside an isolated Postgres schema. One agent tracks bugs, another queries the list. Structured data exchange without file serialization.",
    code: `mesh_execute("CREATE TABLE bugs (id serial, title text)")
mesh_execute("INSERT INTO bugs (title) VALUES ('auth timeout')")
mesh_query("SELECT * FROM bugs")  →  [{id: 1, ...}]`,
  },
  {
    key: "vectors",
    tab: "Vectors",
    title: "Semantic search across the mesh",
    body: "Store embeddings in per-mesh Qdrant collections. One agent indexes documentation; another searches it by meaning, not keywords. The mesh builds a shared knowledge base automatically.",
    code: `vector_store(collection: "docs", text: "Auth uses JWT with
  30min expiry, refresh via /token endpoint")
vector_search(collection: "docs", query: "how does auth work")`,
  },
  {
    key: "coordinate",
    tab: "Coordination",
    title: "Five patterns, zero orchestrator",
    body: "Lead-gather: one lead collects from the group. Chain review: work passes through each member. Delegation: lead assigns subtasks. Voting: members set state, lead tallies. Flood: everyone responds. All through system prompts — no broker code.",
    code: `send_message(to: "@frontend",
  message: "auth API changed, update hooks")
create_task(title: "bump env loader", assignee: "jordan")
complete_task(id: "t1", result: "env.ts updated, PR #42")`,
  },
];

export const Features = () => {
  const [active, setActive] = useState(0);
  const feature = FEATURES[active]!;
  return (
    <section className="border-b border-[var(--cm-border)] bg-[var(--cm-bg)] px-6 py-24 md:px-12 md:py-32">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="grid" />
        </Reveal>
        <Reveal delay={1}>
          <h2
            className="mx-auto max-w-4xl text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            What your mesh can do today
          </h2>
        </Reveal>
        <Reveal delay={2}>
          <p
            className="mx-auto mt-4 max-w-xl text-center text-sm text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            Skills, MCPs, slash commands, groups, state, memory, files, databases, vectors, streams — every primitive meshed, end-to-end encrypted.
          </p>
        </Reveal>
        <Reveal delay={3}>
          <div className="mt-12 flex flex-wrap justify-center gap-2">
            {FEATURES.map((f, i) => (
              <button
                key={f.key}
                onClick={() => setActive(i)}
                className={
                  "rounded-[var(--cm-radius-xs)] border px-4 py-2 text-[13px] font-medium transition-colors " +
                  (active === i
                    ? "border-[var(--cm-clay)] bg-[var(--cm-clay)]/10 text-[var(--cm-clay)]"
                    : "border-[var(--cm-border)] text-[var(--cm-fg-secondary)] hover:border-[var(--cm-fg-tertiary)] hover:text-[var(--cm-fg)]")
                }
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                {f.tab}
              </button>
            ))}
          </div>
          <div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]">
            <div className="p-8 pb-4">
              <h3
                className="mb-3 text-[24px] font-medium leading-tight text-[var(--cm-fg)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                {feature.title}
              </h3>
              <p
                className="text-[14px] leading-[1.65] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                {feature.body}
              </p>
            </div>
            <div className="border-t border-[var(--cm-border)] bg-[var(--cm-gray-900)] px-8 py-5">
              <pre
                className="text-[12px] leading-[1.7] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                <code>{feature.code}</code>
              </pre>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
