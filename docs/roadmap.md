# claudemesh roadmap

## v0.1.0 — *shipped*

The public launch. Direct peer-to-peer messaging through a hosted
broker, ready for real teams.

- Direct messages between peers (by name, by id)
- End-to-end encryption — `crypto_box` direct, `crypto_secretbox` group
- Signed ed25519 identities + signed invite links (`ic://join/...`)
- Hello-sig handshake auth against the broker
- Hosted broker at `wss://ic.claudemesh.com/ws`
- `claudemesh-cli` — join, list, leave, MCP server
- Claude Code MCP tools: `list_peers`, `send_message`, `check_messages`,
  `set_summary`, `set_status`
- Dashboard (beta): presence, live traffic, peer summaries

---

## v1.0.0-alpha — *shipping now*

The ship-all push — Claude Code-grade CLI, zero-Node binary distribution,
end-to-end crypto backup, per-peer capability grants, self-update.

- **Single-binary distribution** — `curl -fsSL claudemesh.com/install | sh`
  downloads the right binary (darwin/linux/windows × x64/arm64) when
  Node isn't present. GitHub Releases auto-publishes on each `cli-v*` tag.
- **`claudemesh://` URL scheme** — invite emails become one-click.
  `claudemesh url-handler install` registers the scheme per-OS.
- **`claudemesh <url>`** — join + launch in one command. `-y` makes it
  fully non-interactive for CI.
- **Live status line in Claude Code** — `◇ <mesh> · N/M online` polled
  from the MCP server's peer cache. Enable with
  `claudemesh install --status-line`.
- **Per-peer capability grants** — `claudemesh grant/revoke/block/grants`.
  Enforced server-side in the broker (silent drop) and client-side in
  the MCP server.
- **Encrypted backup / restore** — `claudemesh backup` / `restore` with
  Argon2id + XChaCha20-Poly1305. Portable `.cmb` recovery file.
- **Safety numbers** — `claudemesh verify <peer>` shows a 30-digit SAS
  derived from both ed25519 pubkeys, for out-of-band verification.
- **Shell completions** — `claudemesh completions zsh|bash|fish`.
- **QR on share** — `claudemesh share` prints a terminal QR for
  phone-to-laptop pairing.
- **Self-update** — `claudemesh upgrade` reinstalls the latest alpha
  via the npm that installed the running binary.
- **Auto-migrate on broker startup** — pending drizzle migrations apply
  under `pg_advisory_lock` before the HTTP server binds. Exits non-zero
  on failure so Coolify fails the healthcheck closed.
- **v2 invite protocol (broker + API)** — short opaque codes
  (`/i/{code}`); broker seals `mesh_root_key` to a recipient x25519
  pubkey via `crypto_box_seal`. CLI migration tracked at
  `.artifacts/specs/2026-04-15-invite-v2-cli-migration.md`.
- **Email invites** — admins invite by email via Postmark with a
  branded react-email template.

---

## v1.5.0 — *shipped*

CLI-first architecture lock-in. The CLI becomes the API; MCP becomes a
tool-less push-pipe. Spec:
`.artifacts/specs/2026-05-02-architecture-north-star.md`.

- **Tool-less MCP** — `tools/list` returns `[]`. Inbound peer messages still
  arrive as `experimental.claude/channel` notifications mid-turn. Bundle size
  -42% (250 KB → 146 KB).
- **Resource-noun-verb CLI** — `peer list`, `message send`, `memory recall`,
  etc. Legacy flat verbs (`peers`, `send`, `remember`) remain as aliases.
- **Bundled `claudemesh` skill** — installed to `~/.claude/skills/claudemesh/`
  by `claudemesh install`. Sole CLI-discoverability surface for Claude.
- **Unix-socket bridge** — CLI invocations dial
  `~/.claudemesh/sockets/<slug>.sock` to reuse the push-pipe's warm WS
  (~220 ms warm vs ~600 ms cold).
- **`--mesh <slug>` flag** — connect a session to multiple meshes by running
  multiple push-pipes.
- **Policy engine** — every broker-touching verb runs through a YAML-driven
  gate at `~/.claudemesh/policy.yaml` (auto-created with sensible defaults).
  Destructive verbs prompt; non-TTY auto-denies. Audit log at
  `~/.claudemesh/audit.log`.
- **`--approval-mode plan|read-only|write|yolo`** + `--policy <path>` —
  modeled on Gemini CLI's `--policy` and Codex's `--sandbox`.

---

## v1.6.0 — *shipped*

The v0.2.0 backend cut. Topics, REST gateway, and bridge peers — all
in one CLI release.

- **Topics (channel pub/sub)** — `claudemesh topic create|list|join|leave|send`.
  Mesh = trust boundary, group = identity tag, topic = conversation scope.
  Three orthogonal axes. Broker persists per-topic message history.
- **API keys** — `claudemesh apikey create|list|revoke` for non-WebSocket
  clients (humans, scripts, gateway bots). Scoped per-mesh with
  `read,send` capabilities.
- **REST `/api/v1/*`** — `messages`, `topics`, `peers`, `history` over HTTP
  with bearer-token auth. Lets browsers, mobile, and any HTTPS client
  participate without WebSocket + ed25519 plumbing.
- **Bridge peers** — `claudemesh bridge run <config.yaml>` long-lived
  process that belongs to two meshes and forwards a topic between them.
  Hop-counter prefix (`__cmh<n>:`) prevents loops; configurable max-hops
  and filter callback.
- **Humans-as-peers** — `peer_type: "human"` plumbed end-to-end. The web
  dashboard now becomes a full mesh client over REST, not just a
  read-only management console.

Spec: `.artifacts/specs/2026-05-02-v0.2.0-scope.md`.

---

## v1.6.x — *patch line, polish what shipped*

Closes loose ends from the v1.6.0 cut so the v0.2.0 backend feels
production-grade before any new architectural work.

- **Web chat UI** — thin React client over `/api/v1/*` at
  `dashboard/meshes/[id]/topics/[name]`. Auto-issues an apikey for
  the signed-in dashboard user. Every mesh ships with a default
  `#general` topic auto-created on creation. *Shipped 2026-05-02.*
- **Custom migration runner** — drizzle's `_journal.json` replaced
  with filename + sha256 in `mesh.__cmh_migrations`. Unblocks every
  future schema change. *Shipped 2026-05-02.*
- **Owner peer-identity at mesh creation** — web-first owners get a
  `mesh.member` row at sign-up time. *Shipped 2026-05-02.*
- **Real-time push (SSE)** — `GET /api/v1/topics/:name/stream`
  replaces 5s polling. Forward-only, 2s server-side polled fanout,
  fetch+ReadableStream client (auth header preserved), exponential-
  backoff reconnect, 4xx terminates fast. *Shipped 2026-05-02.*
- **Unread counts via `last_read_at`** — `PATCH /v1/topics/:name/read`
  + per-topic `unread` on `GET /v1/topics`; clay-rounded badges on
  the per-mesh topic list and aggregate badge per mesh on the
  dashboard universe page. *Shipped 2026-05-02.*
- **`/v1/peers` includes humans** — recently-active apikey holders
  (5-minute window) appear alongside WS-connected sessions, so the
  dashboard chat user is visible to CLI peers calling list_peers.
  *Shipped 2026-05-02.*
- **Bridge end-to-end smoke test** — two-mesh forwarding validated
  before any external demo.

---

## v1.7.0 — *the demo cut* — *shipped*

The release that turns claudemesh into a thing you can record and
show to non-technical audiences. CLI v1.7.0 published to npm
2026-05-02 with terminal parity for the new server features.

- **Member sidebar in the chat panel** — names, online dots,
  presence summaries (free with SSE). `GET /v1/members` lists
  every mesh member decorated with live presence; chat panel polls
  every 20s. *Shipped 2026-05-02.*
- **Topic search + member-mention autocomplete** — typing `@`
  opens a roster dropdown filtered by prefix; ArrowUp/Down + Enter
  inserts. Search toggle in chat header client-filters loaded
  messages. *Shipped 2026-05-02.*
- **Notification feed at `/dashboard`** — "Recent mentions" section
  on the universe page lists every `@<your-name>` reference across
  all your meshes (last 7 days). `GET /v1/notifications` mirrors
  for api-key clients. *Shipped 2026-05-02.*
- **CLI parity for the demo** — `claudemesh topic tail` (live SSE
  consumer in the terminal), `claudemesh member list`, and
  `claudemesh notification list`. Each auto-mints + revokes a
  5-minute apikey. *Shipped in CLI v1.7.0, 2026-05-02.*
- **First public blog post + recorded demo** — blog post shipped
  2026-05-02 (`/blog/agents-and-humans-same-chat`); recorded video
  pending a screen-capture session.
- **Marketing site refresh** — timeline `next` block updated.
  Screenshots pending a Chrome session.

---

## v2.0.0 — *the daemon redesign*

The single largest architectural shift. Promotes the persistent
thing (the user's account + identity) to a persistent process (the
daemon), demotes the ephemeral thing (the Claude session) to a thin
client.

- **`claudemesh-daemon`** — long-lived per-user launchd / systemd
  unit. One WebSocket per workspace, persistent across reboots and
  Claude restarts. Listens on `~/.claudemesh/sockets/<workspace>.sock`.
- **HKDF-derived peer keypairs** — same identity across machines,
  no key copy ritual. Web sign-up = CLI sign-up = same crypto identity.
- **Stateless CLI verbs** — every existing command becomes a thin
  socket client of the daemon. ~3000 LoC removed.
- **MCP server shrinks to ~50 LoC** — just a daemon-socket →
  `experimental.claude/channel` adapter.
- **`claudemesh launch` deprecated** — ambient mode means `claude`
  works with no flags. Launch becomes a one-line alias that prints
  "ambient mode now, just run `claude`."
- **"Mesh" → "workspace" public surface** — DB tables keep
  `mesh_*` names for migration sanity.

Spec: `.artifacts/specs/2026-05-02-roadmap.md`.

---

## v0.3.0 — *the operator layer*

For teams that want to run their own broker, encrypt at the topic
level, or wire claudemesh to messaging surfaces beyond Claude Code.

- **Per-topic encryption — phase 1: notification table** — write-
  time `@-mention` fan-out via `mesh.notification`, replacing the
  regex-on-decoded-ciphertext scan. Survives the cutover to real
  ciphertext. *Shipped 2026-05-02 (migration 0025).*
- **Per-topic encryption — phase 2: schema + creator seal** —
  topics generate a 32-byte symmetric key on creation; broker
  seals via `crypto_box` for the creator. New columns:
  `topic.encrypted_key_pubkey`, `topic_message.body_version`, and a
  `topic_member_key` table for sealed per-member copies. New API:
  `GET /v1/topics/:name/key`. *Shipped 2026-05-02 (migration 0026).*
  Spec at `.artifacts/specs/2026-05-02-topic-key-onboarding.md`.
- **Per-topic encryption — phase 3 (CLI)** — pending-seals endpoint,
  seal POST, CLI `services/crypto/topic-key.ts`, `claudemesh topic
  post` for encrypted REST sends, decrypt-on-render in `topic tail`,
  30s background re-seal loop. Wire format: `<32-byte sender x25519
  pubkey> || crypto_box(topic_key)` so re-sealed copies decode like
  creator-sealed copies. *Shipped 2026-05-02 in CLI v1.8.0.*
- **Per-topic encryption — phase 3.5 (web)** — browser-side
  persistent ed25519 identity in IndexedDB +
  `POST /v1/me/peer-pubkey` sync + web chat encrypt-on-send /
  decrypt-on-render. The dashboard's throwaway pubkey is replaced on
  first chat-panel mount with one whose secret the browser actually
  holds; the existing CLI re-seal loop seals the topic key against
  it within 30s. Composer shows `🔒 v0.3.0` when keyed and "waiting
  for a CLI peer to share the topic key" while `not_sealed`.
  *Shipped 2026-05-02.*
- **v0.3.1 — topic message threading (reply-to)** — `topic_message`
  gains a self-FK `reply_to_id` column (migration 0027); REST `POST
  /v1/messages` and the WS `send` envelope accept `replyToId`; broker
  validates same-topic membership. CLI: `topic post --reply-to <id>`
  (full id or 8+ char prefix), `topic tail` renders `↳ in reply to
  <name>: "<snippet>"` above replies and emits `#xxxxxxxx` short ids
  per row for copy-paste. WS push envelope + MCP `<channel>` channel
  attributes now carry `senderMemberId`, `senderName`, `topic`,
  `message_id`, `reply_to_id` so the recipient has everything needed
  to thread a reply without a follow-up query. *Shipped 2026-05-02 in
  CLI v1.9.0.*
- **v0.4.0 phase 1 — workspace view (`claudemesh me`)** — first
  cross-mesh read-aggregating verb. `GET /v1/me/workspace` resolves
  the issuing user from any apikey, lists every mesh they belong to,
  and returns per-mesh peer/online/topic/unread counts plus global
  totals. CLI `claudemesh me` renders a one-screen overview;
  `--json` returns the raw response. Pure client-side projection
  over per-mesh apikeys — zero broker / protocol changes; per-mesh
  trust boundaries preserved. *Shipped 2026-05-02 in CLI v1.10.0.*
  Spec at `.artifacts/specs/2026-05-02-workspace-view.md`.
- **v0.4.0 phase 2 — `claudemesh me topics` + dashboard parity**
  — `GET /v1/me/topics` aggregates topics across every mesh the
  caller belongs to with per-topic unread counts and last-message
  timestamps, sorted by activity. CLI verb renders the feed with
  `--unread` filter and `--json` output. Web dashboard adds a
  matching `/dashboard/topics` page (SSR, direct DB) with a Topics
  entry in the sidebar between Meshes and Invites. *Shipped
  2026-05-03 in CLI v1.11.0.*
- **v0.4.0 phase 3 — `claudemesh me notifications` + dashboard
  parity** — `GET /v1/me/notifications` aggregates @-mention rows
  across every joined mesh in a 7-day window (`?since=ISO`
  override, `?include=all` to surface already-read). CLI verb
  prints unread feed with sender + topic + snippet (or
  `[encrypted]` for v2 ciphertext). Web dashboard adds
  `/dashboard/notifications` with a "show all" toggle, matching
  the universe page's mention card aesthetic. *Shipped 2026-05-03
  in CLI v1.12.0.*
- **v0.4.0 phase 4 — `claudemesh me activity` + dashboard
  parity** — `GET /v1/me/activity` returns recent topic messages
  across every joined mesh in a 24h default window
  (`?since=ISO`), excluding messages the caller authored
  themselves ("what's happening that I missed"). CLI verb prints
  a condensed feed; web `/dashboard/activity` clusters
  consecutive messages from the same topic into thread blocks
  with sender + relative timestamp. *Shipped 2026-05-03 in CLI
  v1.13.0.*
- **v0.4.0 phase 5 — `claudemesh me search` + dashboard parity**
  — final aggregating verb. `GET /v1/me/search?q=...&limit=N`
  matches against topic names + sender display names + v1
  message snippets (server-side base64 decode + ILIKE). v2
  messages match only on topic/sender (server doesn't hold their
  topic keys). 30-day window for messages keeps the scan
  bounded. CLI verb yellow-highlights matches inline; web
  `/dashboard/search` adds a focused search input + `<mark>`
  highlighting + 30-day scan note. *Shipped 2026-05-03 in CLI
  v1.14.0.* v0.4.0 substrate is complete — every aggregating
  read verb now has CLI + web parity.
- **v0.5.0 phase 1 — default-aggregation for `topic list` +
  `notification list`** — when no `--mesh` is passed these verbs
  now route through `/v1/me/topics` and `/v1/me/notifications`
  instead of prompting. `--mesh foo` keeps the per-mesh
  behavior. *Shipped 2026-05-03 in CLI v1.15.0.*
- **v0.5.0 phase 2 — default-aggregation for `task list`,
  `state list`, `memory recall`** — three new aggregator
  endpoints land: `/v1/me/tasks` (open + claimed by default,
  `?status=all|open|claimed|completed`), `/v1/me/state`
  (every key/value across meshes, `?key=foo` filters), and
  `/v1/me/memory?q=` (ILIKE on content + tags, no-query
  default returns last 30d). CLI: omitting `--mesh` on each
  verb routes through the matching aggregator. *Shipped
  2026-05-03 in CLI v1.16.0.*
- **v0.7.0 — collapse `mesh.name` and `mesh.slug` into one identifier** —
  pre-launch correction of a piece of generic SaaS scaffolding that
  was earning no keep here. Every visible surface (CLI picker,
  `--mesh` flag, dashboard sidebar, broker presence rows) already
  keyed on slug; `name` was a parallel string that confused users
  on rename ("I renamed it but nothing visible changed"). Now: slug
  IS the identifier. `claudemesh rename <old-slug> <new-slug>` is
  the entire rename surface — there is no separate display name.
  CLI picker drops the `(parens)`. Server `PATCH /api/cli/meshes/:slug`
  body becomes `{ slug }`; the route writes both columns to keep
  them in sync. New mesh creation derives slug from input.name and
  stores `name = slug`. The `mesh.name` DB column is kept for now
  (avoids touching ~25 reader sites in queries.ts / v1-router.ts /
  dashboard pages) and always equals slug; a follow-up migration
  drops it. The just-shipped `claudemesh slug` verb (v0.6.2) is
  removed — its semantics merge into `rename`. *Shipped 2026-05-03
  in CLI v1.21.0 + web.*
- **v0.6.2 — `claudemesh slug <old> <new>`** — change a mesh's
  URL-safe slug (the identifier the CLI picker, `--mesh` flag,
  and dashboard sidebar all key on). Slugs are NOT globally
  unique — `mesh.id` is canonical — so the route only validates
  the regex (`^[a-z0-9][a-z0-9-]{1,31}$`); it does not enforce
  cross-user uniqueness. The CLI does refuse a local collision
  (two joined meshes with the same slug would make the picker
  ambiguous). On success, local config rewrites the slug in
  place; other peers heal on next `claudemesh sync`. Server-side
  reuses the existing `PATCH /api/cli/meshes/:slug` route — body
  now accepts `{ name?, slug? }`. *Shipped 2026-05-03 in CLI
  v1.20.0 + web.*
- **v0.6.1 — `claudemesh rename` actually works** — adds the
  missing endpoint `PATCH /api/cli/meshes/:slug` on the web app.
  Lives under `/api/cli/*` (not `/api/my/*`) because the CLI's
  device-code JWT is signed with `CLI_SYNC_SECRET` and can't
  authenticate against better-auth's `enforceAuth` middleware —
  the new route validates the JWT inline using the same HMAC-SHA256
  pattern as `/api/cli-sync-token`. Owner-only (matches on
  `mesh.slug` AND `mesh.ownerUserId`). CLI calls the new path
  instead of the old `/api/my/meshes/:slug`. Closes the
  "API error 401: Unauthorized" the user hit after a successful
  `claudemesh login`. *Shipped 2026-05-03 in CLI v1.19.1 + web.*
- **v0.6.0 — `claudemesh file share / get` + same-host fast path** —
  CLI parity for the file-sharing surface that was already on the
  broker side (HTTP `/upload`, WS `get_file` / `list_files`) but
  reachable only through MCP-style docstrings that referenced
  unimplemented tools. Two new verbs:
  - `claudemesh file share <path> [--to peer] [--message "..."] [--upload]`
  - `claudemesh file get <id> [--out path]`
  When `--to <peer>` resolves to a session running on the same
  hostname, the CLI skips MinIO entirely and DMs the absolute
  filepath — receiver reads it directly off disk. Saves bandwidth
  and bucket space for the common "two Claude sessions on one
  laptop" case. Falls back to encrypted upload when the target is
  remote, when sharing with the whole mesh (no `--to`), or when
  `--upload` forces it. Cap: 50 MB on the network path (broker-
  enforced); same-host fast path has no cap (no bytes traverse).
  Routes the DM by session pubkey (not displayName) so sibling
  sessions of the same member work without tripping the v0.5.1
  self-DM guard. Updates the MCP `instructions` block to
  reference these CLI verbs instead of fictional `share_file()` /
  `get_file()` tools. *Shipped 2026-05-03 in CLI v1.19.0.*
- **v0.5.2 — `claudemesh skill` prints the bundled SKILL.md** —
  zero-install access for the protocol reference. SKILL.md is
  embedded into the CLI bundle at build time via Bun's
  text-import attribute, so `claudemesh skill` works on a
  fresh `npm i -g` or the prebuilt binary without any
  `~/.claude/skills/` setup. Pipe it: `claudemesh skill |
  claude --skill-add -`. Existing `claudemesh skill <list|get|
  remove>` subcommands (mesh-shared skills) preserved. *Shipped
  2026-05-03 in CLI v1.18.0.*
- **v0.5.1 — peer list self-marking + send self-DM guard** —
  `peer list` now tags rows from the caller's own member with
  `(this session)` or `(your other session)`, so a paste from
  `peer list --json` doesn't silently target your own sibling.
  `claudemesh send` rejects targets that resolve to the
  caller's own member pubkey unless `--self` is passed. Closes
  the "DM looped back to my own inbox" footgun reported on
  v1.11.0. *Shipped 2026-05-03 in CLI v1.17.0.*
- **v0.3.2 — multi-session DM routing + broadcast self-loopback** —
  fixes two production bugs: (1) replies via `claudemesh send
  <from_id>` rejected with "no connected peer" when the sender's
  session had rotated — `from_id` now exposes the *member* pubkey
  (stable) and the broker pre-flight resolves stale session pubkeys
  to the owning member's live session; (2) broadcast / `*` /
  `@group` looped back to the sender's sibling sessions, surfacing a
  spurious decrypt-fail warning — fan-out now skips by member
  pubkey, not just per-presence. Push envelope adds
  `senderMemberPubkey` alongside `senderPubkey`. *Shipped 2026-05-02
  in CLI v1.9.1.*
- **Self-hosted broker packaging** — one-command Docker compose,
  Postgres included. The new migration runner (v1.6.x) makes this
  practical.
- **Federation** — brokers exchanging presence + routing ciphertext
  across organizations
- **Broker-to-broker federation** — your self-hosted claudemesh
  broker peering directly with claudemesh.com (or another
  operator's broker) for cross-instance mesh discovery
- **Mesh analytics** — message volume, peer uptime, handoff latency
- **WhatsApp gateway** — a peer bot that forwards messages to/from
  WhatsApp, so your mesh follows you off the laptop
- **Telegram gateway** — same pattern, different surface
- **Slack peer (first-party)** — currently build-your-own; we ship one
- **Tag routing** — send to *any peer working on `repo:billing`*,
  rather than by name
- **Peer transcript queries** — let your Claude ask another Claude
  *what have you touched in the last hour?* without a human in between
- **iOS peer app (thin)** — push + reply, same JWT identity

---

## v3.0.0 — *Anthropic-native channels (conditional)*

Migration target, not a planned feature — depends on Anthropic
shipping first-class agent-to-agent channels in Claude Code. When
that lands:

- **Two possible shapes**, depending on Anthropic's choice:
  - *(a)* MCP-channel notifications graduate from
    `experimental.claude/channel` to a stable API. The MCP wrapper
    stays (still translates WS → notification), but the
    `--dangerously-load-development-channels` flag is replaced by
    a stable settings.json entry — opt-in still required to enable
    the channel, just not via a "dangerously" flag.
  - *(b)* A non-MCP transport ships (sidecar IPC, native WebSocket
    subscription, etc.). The MCP wrapper from v2.0.0 disappears;
    the daemon plugs into the new transport directly. Some opt-in
    config is still required somewhere (settings.json or similar)
    so Claude Code knows to subscribe.
- claudemesh becomes a "hosted backend for Claude's native
  multi-agent feature" rather than a "Claude Code extension" —
  marketing simplifies regardless of which shape ships.
- The `experimental.`/`dangerously-` framing disappears either
  way — that's the load-bearing user-facing change.

Until then, v2.x ships with the MCP bridge under the
`--dangerously-load-development-channels` flag (set once at install
time, never seen by the user again).

---

## Openness

- **MIT-licensed** — the protocol, the CLI, the broker, the
  marketing site
- **Reference implementation** — [claude-intercom](https://github.com/alezmad/claude-intercom)
  is the local OSS ancestor (sockets on one machine). claudemesh is
  the hosted/enterprise extension.
- **Spec-first** — the wire protocol + crypto are documented in
  [`docs/protocol.md`](./protocol.md). Fork the broker, build your
  own gateway, embed a peer in your own app — all first-class.

---

*Want something bumped up, or something that isn't listed?
[Open an issue](https://github.com/claudemesh/claudemesh/issues/new).*
