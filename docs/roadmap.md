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
- **Real-time push (SSE)** — replaces 5s polling on
  `/api/v1/topics/:name/stream`. Sub-500ms message delivery.
- **Unread counts via `last_read_at`** — schema column already
  exists; PATCH on scroll-to-bottom + chip on topic list.
- **Bridge end-to-end smoke test** — two-mesh forwarding validated
  before any external demo.
- **`/v1/peers` includes humans** — synthetic presence rows for
  active apikey sessions; the dashboard chat user becomes visible
  to other peers.

---

## v1.7.0 — *the demo cut*

The release that turns claudemesh into a thing you can record and
show to non-technical audiences.

- **Member sidebar in the chat panel** — names, online dots,
  presence summaries (free with SSE)
- **Topic search + member-mention autocomplete** — `@Mou` hot-keys
  to `claudemesh send Mou ...`
- **Notification feed at `/dashboard`** — "you have N unread in
  #deploys, 2 mentions in #incident"
- **First public blog post + recorded demo** — "claudemesh in 90
  seconds" video
- **Marketing site refresh** — screenshots from the real-time UI,
  remove v0.2.0 stamps

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

- **Per-topic HKDF encryption** — symmetric keys derived from
  `mesh.root_key + topic.id`. Kills the "broker can read your
  messages" wart. Today's `ciphertext` field is base64 plaintext.
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

- The MCP wrapper from v2.0.0 disappears entirely
- The daemon plugs directly into the native channel primitive
- `--dangerously-load-development-channels` flag goes away
- claudemesh becomes a "hosted backend for Claude's native
  multi-agent feature" — marketing simplifies

Until then, v2.x ships with the MCP bridge.

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
