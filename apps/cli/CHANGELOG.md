# Changelog

## 1.24.0 (2026-05-03) — daemon required + thin MCP shim

The architectural convergence v0.9.0 was building toward.

### Daemon promoted from optional to required (for in-Claude-Code use)

The CLI itself (`claudemesh send`, `peer list`, `inbox`, `vault`, `watch`,
`webhook`, etc.) keeps working without a daemon. But the MCP server —
which provides Claude Code's mid-turn channel push, slash commands, and
resource browser — now requires the daemon. There is no fallback.

- `claudemesh install` auto-installs and starts the daemon service
  (launchd / systemd-user) for the user's primary mesh. Pass
  `--no-service` to opt out.
- `claudemesh launch` ensures the daemon is running before spawning
  Claude Code; spawns it foreground if absent.
- The MCP shim probes `~/.claudemesh/daemon/daemon.sock` at boot. If
  missing after a 2s grace window, it bails with actionable instructions
  ("run `claudemesh daemon up --mesh <slug>`").

### MCP server: 979 → ~300 LoC of push-pipe code

`apps/cli/src/mcp/server.ts` is now a thin daemon-SSE translator. It
no longer holds a broker WebSocket, decrypts messages, manages mesh
state, or runs reconnection logic. All of that is the daemon's job.

- Subscribes to daemon `/v1/events` SSE; translates each `message`
  event into a `notifications/claude/channel` emit.
- Sources mesh-published skills via daemon `/v1/skills` IPC for
  ListPrompts / GetPrompt / ListResources / ReadResource.
- ListTools returns `[]` (the CLI is the API, taught via the bundled
  skill).
- The mesh-service proxy mode (`claudemesh-cli --service <name>`,
  the sub-MCP-server for proxying a deployed mesh-MCP service) is
  unchanged — separate code path, different lifecycle.

Bundle size: MCP entry dropped from 154KB → 104KB (gzipped 34KB → 19KB).

### Daemon SSE event payload extended

`message` events on `/v1/events` now include plaintext-decrypted body,
sender member pubkey, priority, and subtype — everything the MCP shim
needs to render a complete channel notification without going back to
the broker.

### Daemon IPC: GET /v1/skills (list) and GET /v1/skills/:name (get)

The daemon exposes mesh-published skills over IPC so the MCP shim can
surface them as MCP prompts/resources without holding its own broker
WS. Same wire format as before from Claude Code's perspective.

### Why this is the right architecture

MCP and the daemon are no longer independent broker clients with
duplicated WS, decrypt, and dedupe logic. The daemon owns the broker
relationship; MCP is a Claude-Code-specific UX adapter that reads from
the daemon. Industry-normal shape (Tailscale, Slack, Ollama, Docker)
where the long-lived runtime is required and the per-app integrations
attach to it.

## 1.23.0 (2026-05-03) — close the CLI surface, prune dead MCP stubs

Three previously-MCP-only write verbs land on the CLI, closing every
functional gap between the (defunct since 1.5.0) MCP tool registry and
the CLI:

- `claudemesh vault set <key> <value>` — encrypts client-side via
  `crypto_secretbox_easy` with a fresh symmetric key, then seals the
  key to the member's own pubkey via `crypto_box_seal` (same shape as
  the file-share crypto). Flags: `--type env|file`, `--mount <path>`,
  `--description <text>`. Pairs with the existing `vault list/delete`.
- `claudemesh watch add <url>` — registers a URL change watcher.
  Flags: `--label`, `--interval <sec>`, `--mode`, `--extract <css>`,
  `--notify-on changed|always`. Pairs with `watch list/remove`.
- `claudemesh webhook create <name>` — issues a fresh inbound webhook;
  prints url + one-shot secret. Pairs with `webhook list/delete`.

Cleanup: removed 22 dead stub files under `apps/cli/src/mcp/tools/*`,
the unused `router.ts`, `middleware/*`, and `handlers/*` directories
(~120 LoC). The MCP server in 1.5.0+ has been a tool-less push-pipe;
these stubs were leftover scaffolding that never wired into the
`tools/list` response. The legitimate MCP surfaces stay untouched:

- `<channel source="claudemesh">` push pipe (the irreducible reason
  MCP exists at all — no other Claude Code surface can inject events
  mid-turn).
- Mesh skills exposed as MCP **prompts** (slash commands) and
  **resources** (`skill://claudemesh/<name>`).
- Mesh-deployed MCP services proxied via the sub-process tool
  surface (separate code path under server.ts:855+).

## 1.22.1 (2026-05-03) — daemon docs + help

- Root `claudemesh --help` now lists the `daemon` subcommand suite under
  its own section (was missing in 1.22.0).
- `claudemesh daemon` (no subcommand) now prints a usage block instead of
  silently launching the daemon. `daemon help|--help|-h` work too.
- Bundled SKILL.md gained a "Daemon path (v0.9.0, opt-in, fastest)"
  section explaining the runtime, lifecycle commands, and how it relates
  to `claudemesh install` (independent — not auto-started).

## 1.22.0 (2026-05-03) — daemon v0.9.0

### New: `claudemesh daemon` — long-lived peer mesh runtime

Persistent local process that holds the broker WS, durable outbox/inbox in
SQLite, IPC over UDS (+ optional loopback TCP with bearer token), and SSE
event stream. Surrogates wire-up; `claudemesh send` and friends route
through the daemon when its socket is present, falling back to the
existing bridge / cold paths otherwise.

Subcommands:
- `daemon up|start [--mesh <slug>] [--name ...] [--no-tcp] [--public-health]`
- `daemon status [--json]`, `daemon down|stop`, `daemon version`
- `daemon outbox list [--failed|--pending|--inflight|--done]`
- `daemon outbox requeue <id> [--new-client-id <id>]`
- `daemon accept-host` (per-host fingerprint pin)
- `daemon install-service --mesh <slug>` (macOS launchd / Linux systemd-user)
- `daemon uninstall-service`

Idempotency end-to-end:
- Caller-stable `client_message_id` + canonical `request_fingerprint`
  (sha256 of envelope_version || dest_kind || dest_ref || reply_to ||
  priority || canonical_meta_json || body_hash) attach on every send.
- Broker persists both on `mesh.message_queue` (migration 0028, additive
  + nullable) and echoes them on push, so receiving daemons dedupe their
  inbox by `client_message_id`.
- §4.5.1 IPC duplicate-lookup table (11 cases × no-row / 5 statuses ×
  match/mismatch) covered by 15 unit tests.

Crash recovery:
- Outbox row transitions: `pending` → `inflight` → `done` / `dead` /
  `aborted`. `BEGIN IMMEDIATE` serializes daemon-local writes; the drain
  worker is wakeable via promise-replacement and backs off failed sends.
- Decrypt path tries session secret key, then member secret key, then
  base64 fallback, so legacy unencrypted pushes still inbox cleanly.

Sprint 7 (broker-side dedupe enforcement: partial unique index +
`mesh.client_message_dedupe` atomic-accept table) is intentionally
deferred — see `.artifacts/shipped/2026-05-03-daemon-spec-broker-
hardening-followups.md`.

## 1.0.0-alpha.0 (2026-04-13)

### Architecture
- Complete folder restructure: `entrypoints/`, `cli/`, `commands/`, `services/` (17 feature-folders with facade pattern), `ui/`, `mcp/`, `constants/`, `types/`, `utils/`, `locales/`, `templates/`
- 212 source files, 10,900 lines
- ESM-only, Bun bundler, TypeScript strict mode

### New CLI commands
- `claudemesh register` — account creation via browser handoff
- `claudemesh login` — device-code OAuth
- `claudemesh logout` — revoke session + clear credentials
- `claudemesh whoami` — identity check with `--json` support
- `claudemesh new <name>` — create mesh from CLI (was dashboard-only)
- `claudemesh invite [email]` — generate invite from CLI (was dashboard-only)

### Ported from v1 (full feature parity)
- All 79 MCP tools
- All 85 WS message types (broker protocol unchanged)
- Welcome wizard, launch flow, install/uninstall
- Ed25519 + NaCl crypto (keypairs, crypto_box DMs, file encryption)
- Reconnect with exponential backoff
- Status priority engine, scheduled messages, URL watch
- Doctor checks, Telegram bridge connect wizard

### Security hardening (25 bugs fixed across 4 reviews)
- `execFile` instead of `exec` for browser open (command injection fix)
- ReDoS-safe pattern matching in peer file sharing
- Atomic config writes via temp file + rename
- Auth token stored with `openSync(mode: 0o600)` — no permission race
- Decryption oracle collapsed to generic error in `get_file`
- Download size limit (100MB) on file retrieval
- Path traversal protection with `realpathSync` for symlink escapes
- Callback listener double-resolve guard
- Push buffer 1MB per-message truncation
- `makeReqId` uses `crypto.randomBytes` instead of `Math.random`
- Connect guard prevents double-connect race

### Breaking changes from v0.10.x
- Flat command namespace (no `launch` subcommand, no `advanced` prefix)
- New config shape (same data, cleaner layout)
- New `--json` output format with `schema_version: "1.0"`
- New exit codes (see `constants/exit-codes.ts`)
