/**
 * Single source of truth for the curated release log surfaced on:
 *   - /changelog (full timeline)
 *   - / (Latest Releases compact strip)
 *
 * Lives outside `app/.../page.tsx` because Next.js's app-router type generator
 * rejects non-conforming exports from route files (only `default`, `metadata`,
 * `dynamic`, etc. are allowed). Importing data from a plain module sidesteps
 * the constraint without changing route semantics.
 *
 * Hand-picked load-bearing ships, newest first. For the byte-level history
 * see `apps/cli/CHANGELOG.md` in the repo.
 */

export type ChangelogEntry = {
  version: string;
  date: string;
  type: "feat" | "fix" | "docs" | "perf" | "infra";
  title: string;
  summary: string;
};

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    version: "1.34.15",
    date: "2026-05-04",
    type: "fix",
    title: "peer list --mesh scopes; kick refuses control-plane",
    summary:
      "Two follow-ups from the multi-session correctness train. peer list --mesh now forwards the slug to the daemon (was aggregating across all attached meshes). The broker refuses no-op kicks against control-plane connections (daemon, dashboard) — they auto-reconnected within seconds — and surfaces them in a new additive ack field. Soft `disconnect` keeps old behavior.",
  },
  {
    version: "1.34.14",
    date: "2026-05-04",
    type: "fix",
    title: "stale CLAUDEMESH_CONFIG_DIR falls back",
    summary:
      "When the launched-session env leaked into a later CLI invocation and pointed at a tmpdir that no longer existed, the resolver silently used the dead path and showed “No meshes joined”. Now memoized: env unset → default; env points at a real dir → trust; env set but dir gone → TTY-only stderr warning + fallback to ~/.claudemesh.",
  },
  {
    version: "1.34.7 → 1.34.13",
    date: "2026-05-04",
    type: "fix",
    title: "multi-session correctness train",
    summary:
      "Seven releases over a few hours that took claudemesh from “works for one session” to “internally consistent for N sessions on one daemon.” Per-session SSE demux at the bind layer, inbox per-recipient column, daemon detached by default, MCP forwards session token on /v1/events. Architecture invariant: every shared store / channel scopes by recipient.",
  },
  {
    version: "1.32.0",
    date: "2026-05-04",
    type: "feat",
    title: "multi-session UX bundle",
    summary:
      "Self-identity via session pubkey, `--self` fan-out for member-pubkey targeting, broker welcome on launch (broker state + peer count + unread inbox). Resolves hex prefixes to full pubkeys before send.",
  },
  {
    version: "1.30.0",
    date: "2026-05-04",
    type: "feat",
    title: "per-session broker presence",
    summary:
      "Two `claudemesh launch` sessions in the same cwd finally see each other in `peer list`. Each session has a long-lived broker presence row owned by the daemon, identified by a per-launch ephemeral keypair vouched by the member's stable key. Broker `session_hello` handler with parent-attestation TTL and session-signature checks.",
  },
  {
    version: "1.26.0 → 1.29.0",
    date: "2026-05-04",
    type: "feat",
    title: "multi-mesh daemon · per-session IPC tokens",
    summary:
      "One daemon process attaches to every joined mesh simultaneously. Aggregate read routes (/v1/peers, /v1/skills) tag each record with its mesh; explicit ?mesh=<slug> narrows server-side. Per-session IPC tokens scoped to tmpdir mode-0600 so CLI invocations from inside a launched session auto-attribute to its workspace. Self-healing daemon lifecycle (auto-spawn under file-lock, version probe).",
  },
  {
    version: "1.24.0",
    date: "2026-05-03",
    type: "feat",
    title: "daemon required + thin MCP",
    summary:
      "MCP server shrinks from 979 LoC to ~200 LoC of push-pipe. The daemon owns the broker WS and feeds the MCP push channel over IPC SSE. `claudemesh install` auto-installs and starts the daemon service. `claudemesh launch` ensures daemon is running before spawning Claude.",
  },
  {
    version: "0.9.0 (1.22.0)",
    date: "2026-05-03",
    type: "feat",
    title: "daemon foundation",
    summary:
      "Long-lived process holding one broker WS per attached mesh, durable outbox/inbox in SQLite, IPC over UDS (+ optional loopback TCP w/ bearer), SSE event stream. Caller-stable idempotency on every send. Service install (launchd / systemd-user). Outbox CLI with atomic abort+insert on requeue. Host-fingerprint pin on first run.",
  },
  {
    version: "0.7.0 (1.21.0)",
    date: "2026-05-03",
    type: "infra",
    title: "slug = identifier",
    summary:
      "Pre-launch correction of generic SaaS scaffolding. mesh.name and mesh.slug collapse — slug IS the identifier. `claudemesh rename <old-slug> <new-slug>` is the entire rename surface. CLI picker drops the (parens). Server PATCH /api/cli/meshes/:slug body becomes `{ slug }`.",
  },
  {
    version: "0.4.0 → 0.5.2 (1.10.0–1.18.0)",
    date: "2026-05-03",
    type: "feat",
    title: "me/* cross-mesh aggregation",
    summary:
      "First cross-mesh read-aggregating verbs. /v1/me/workspace, /v1/me/topics, /v1/me/notifications, /v1/me/activity, /v1/me/search — every aggregating read verb has CLI + web parity. Default-aggregation for `topic list`, `notification list`, `task list`, `state list`, `memory recall` when no --mesh is passed. file share / get with same-host fast path.",
  },
  {
    version: "0.3.0 (1.8.0)",
    date: "2026-05-02",
    type: "feat",
    title: "per-topic encryption (CLI + web)",
    summary:
      "Topics generate a 32-byte symmetric key on creation; broker seals via crypto_box for the creator. Pending-seals endpoint, seal POST, claudemesh topic post for encrypted REST sends, decrypt-on-render in topic tail, 30s background re-seal loop. Web side: browser-side persistent ed25519 identity in IndexedDB + encrypt-on-send / decrypt-on-render.",
  },
  {
    version: "1.7.0",
    date: "2026-05-02",
    type: "feat",
    title: "demo cut: topic tail, member list, notifications",
    summary:
      "Member sidebar in chat panel with names, online dots, presence summaries. Topic search + member-mention autocomplete. Notification feed at /dashboard listing every @<your-name> reference across all meshes (last 7 days). CLI parity: `claudemesh topic tail` (live SSE consumer), `claudemesh member list`, `claudemesh notification list`.",
  },
  {
    version: "0.2.0 (1.6.0)",
    date: "2026-05-02",
    type: "feat",
    title: "topics + REST gateway + bridge peers",
    summary:
      "Topics (channel pub/sub) with mesh = trust boundary, group = identity tag, topic = conversation scope — three orthogonal axes. API keys for non-WebSocket clients. REST /api/v1/* with bearer-token auth (messages, topics, peers, history). Bridge peers belonging to two meshes forwarding a topic between them. Humans-as-peers — peer_type: human plumbed end-to-end.",
  },
  {
    version: "1.5.0",
    date: "2026-05-02",
    type: "feat",
    title: "CLI-first architecture lock-in",
    summary:
      "Tool-less MCP — tools/list returns []. Inbound peer messages still arrive as experimental.claude/channel notifications mid-turn. Bundle size −42%. Resource-noun-verb CLI (peer list, message send, memory recall). Bundled claudemesh skill installed to ~/.claude/skills/. Unix-socket bridge for warm WS reuse (~220 ms warm vs ~600 ms cold). Policy engine + audit log.",
  },
  {
    version: "1.0.0-alpha",
    date: "2026-04-15",
    type: "feat",
    title: "single-binary distribution + per-peer caps",
    summary:
      "curl -fsSL claudemesh.com/install | sh downloads the right binary (darwin/linux/windows × x64/arm64). claudemesh:// URL scheme makes invite emails one-click. Per-peer capability grants: claudemesh grant/revoke/block/grants enforced server-side. Encrypted backup / restore with Argon2id + XChaCha20-Poly1305. Safety numbers (`claudemesh verify <peer>`).",
  },
  {
    version: "0.1.0",
    date: "2026-04-04",
    type: "feat",
    title: "public launch",
    summary:
      "Direct peer-to-peer messaging through a hosted broker, ready for real teams. End-to-end encryption — crypto_box direct, crypto_secretbox group. Signed ed25519 identities + signed invite links (ic://join/...). Hello-sig handshake auth. Hosted broker at wss://ic.claudemesh.com/ws. Claude Code MCP tools: list_peers, send_message, check_messages, set_summary, set_status.",
  },
];

export const CHANGELOG_TYPE_LABELS: Record<ChangelogEntry["type"], string> = {
  feat: "Feature",
  fix: "Fix",
  docs: "Docs",
  perf: "Perf",
  infra: "Infra",
};

export const CHANGELOG_TYPE_COLOR: Record<ChangelogEntry["type"], string> = {
  feat: "var(--cm-clay)",
  fix: "var(--cm-cactus)",
  docs: "var(--cm-oat)",
  perf: "var(--cm-fig)",
  infra: "var(--cm-fg-tertiary)",
};
