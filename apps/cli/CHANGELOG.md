# Changelog

## 1.27.1 (2026-05-04) — wire missing launch flags

Fixes a wiring bug in `apps/cli/src/entrypoints/cli.ts` where six flags
declared on `LaunchFlags` were silently dropped on the way to
`runLaunch`. They were honored *inside* `runLaunch` if they ever arrived,
but the four `runLaunch({...})` call sites in the CLI entrypoint each
forwarded a hardcoded 5-key subset (`mesh, name, join, yes, resume`).

Now forwarded at every entry point (bare command, bare invite URL,
`launch`/`connect`, `workspace launch`):

- `--role <r>` — sets session role; previously only settable via wizard.
- `--groups "frontend:lead,reviewers"` — comma-separated groups string.
- `--message-mode push|inbox|off` — message delivery mode.
- `--system-prompt <text>` — passes through to `claude`.
- `--continue` — passes through to `claude` to continue last session.
- `--quiet` — actually suppresses the wizard and banner now. Previously
  it was a complete no-op flag at the CLI layer.

No internal logic changed; the launch internals already read these.
This is a pure plumbing fix.

## 1.27.0 (2026-05-04) — state + memory through the daemon, workspace alias

Two more verb families now route through the local daemon's IPC for the
warm path: `state get/set/list` and `remember/recall/forget`. Same
pattern as 1.25.0 for peers/skills — try the socket first (~1 ms warm),
fall back to the cold WS path when the daemon isn't running.

### What changed

- `claudemesh state get|set|list` route through `/v1/state` when the
  daemon socket is present. `--mesh <slug>` forwards as a query/body
  field. Single-mesh daemons auto-pick; multi-mesh daemons require
  `--mesh` for `state set`.
- `claudemesh remember`, `claudemesh recall`, `claudemesh forget`
  (and `claudemesh memory <sub>`) route through `/v1/memory`.
  Aggregates across attached meshes for `recall`; requires `--mesh`
  for `remember`/`forget` when ambiguous.
- New `claudemesh workspace <verb>` alias surface — early teaser for
  the 1.28.0 mesh→workspace public rename. Mirrors `list`, `info`,
  `create`, `join`, `delete`, `rename`, `share`, `launch`, `overview`.
  No-arg `claudemesh workspace` falls through to `launch` (same as
  bare `claudemesh`).

### IPC surface

- `GET /v1/state` — list (`?mesh=<slug>` filter) or single key lookup
  (`?key=<k>&mesh=<slug>`). Returns 404 with `{ error: "state_not_found" }`
  when missing.
- `POST /v1/state` — `{ key, value, mesh? }`. 400 + attached list when
  multi-mesh and no `mesh` field.
- `GET /v1/memory?q=<query>&mesh=<slug>` — recall. Aggregates across
  meshes, each match tagged with its `mesh` field.
- `POST /v1/memory` — `{ content, tags?, mesh? }`. Returns
  `{ id, mesh }`.
- `DELETE /v1/memory/:id?mesh=<slug>` — forget.
- `ipc_features` gains `state` and `memory` keys.

### Why this matters

State and memory were the last verbs that opened a fresh broker WS on
every invocation. Now they reuse the daemon's existing connection — the
warm-path latency cliff (~150 ms cold WS handshake → ~1 ms IPC) extends
to two more flows agents poll heavily.

The `workspace` alias is cosmetic but lays the groundwork for 1.28.0's
documented rename without breaking anyone's muscle memory.

## 1.26.0 (2026-05-04) — multi-mesh daemon

The daemon now attaches to **all joined meshes simultaneously** by
default. Ambient mode (raw `claude` after `claudemesh install`) finally
delivers what v2.0.0 promised: one daemon process, one PID per user,
all your meshes available concurrently with no manual switching.

### What changed

- `claudemesh daemon up` (no `--mesh` flag) attaches to every joined
  mesh. One `DaemonBrokerClient` per mesh, all in one process. Pass
  `--mesh <slug>` to scope to a single mesh (legacy mode).
- `daemon_started` log line now reports `meshes: [...]` (array) instead
  of `mesh: <slug>` (single).
- Outbox dispatch picks the broker via the `mesh` column added in
  1.25.0. Legacy rows (mesh=NULL) fall back to the only broker if
  there's exactly one; otherwise mark dead with a clear error.

### IPC surface

- `GET /v1/peers` aggregates across all attached meshes; each peer
  record gains a `mesh` field. `?mesh=<slug>` narrows server-side.
- `GET /v1/skills` aggregates similarly. `GET /v1/skills/:name` walks
  attached meshes and returns the first match (or `?mesh=<slug>` to
  scope).
- `POST /v1/send` requires `mesh` field when the daemon is attached
  to multiple meshes; auto-picks the only one in single-mesh mode.
  Returns 400 with the attached mesh list if ambiguous.
- `POST /v1/profile` accepts optional `mesh` field — without it,
  applies the update to every attached mesh (presence stays
  consistent across meshes by default).

### CLI integration

- `claudemesh send --mesh <slug>` forwards the mesh in the daemon
  request body. The CLI's `expectedMesh` argument was previously
  informational; now it's authoritative for routing.
- `claudemesh peer list` already aggregates because the IPC endpoint
  does — no change needed in the verb.
- Verified end-to-end: `claudemesh send --mesh A` and
  `claudemesh send --mesh B` from the same CLI invocation both reach
  `outbox.status=done` with broker-issued IDs, dispatched to the
  correct broker per row.

### What this unlocks

Ambient mode for users with N meshes. Run `claudemesh install` once,
then `claude` from anywhere — channel push, slash commands, and
resources flow through the daemon for every joined mesh
simultaneously. No more "which mesh is the daemon attached to?"
mental overhead.

## 1.25.0 (2026-05-04) — Sprint 4 outbound routing + ambient mode

### Daemon outbound routing (Sprint 4)

The v0.9.0 daemon shipped outbox infrastructure but its drain worker
was a placeholder — every queued send went out as a broadcast (`*`).
That's now fixed. Outbound resolution and `crypto_box` encryption
happen at IPC accept time, then the drain worker just forwards the
already-encrypted ciphertext to the broker.

- Outbox schema additions (additive, NULL allowed for legacy rows):
  `mesh`, `target_spec`, `nonce`, `ciphertext`, `priority`. Existing
  v0.9.0 rows keep draining via the broadcast fallback.
- IPC `/v1/send` resolves the user-friendly `to` (display name, hex
  prefix, full pubkey, `@group`, `*`, `#topicId`) into a broker-format
  `target_spec` and encrypts the plaintext using `crypto_box` for DMs
  (against recipient pubkey + sender session secret) or base64 for
  broadcast / topic / group targets.
- Drain worker reads `target_spec`, `nonce`, `ciphertext`, `priority`
  from the row and dispatches as-is. No per-row resolution at drain
  time means peer-presence flicker doesn't affect in-flight sends.
- Pubkey prefix matching: 16+ char hex prefix matches against
  `peer.pubkey` and `peer.memberPubkey` of connected peers. Ambiguous
  prefixes return 502 with a clear error.

Smoke test verified end-to-end: `claudemesh send --self <prefix> "..."`
through daemon resolves, encrypts, and delivers. Outbox reaches
`status=done` with broker-issued `broker_message_id`.

### CLI thin-client routing extensions

`claudemesh peer list` and `claudemesh skill list/get` now route
through the daemon when its socket is present, mirroring the
`trySendViaDaemon` pattern from `send.ts`. Same fall-back chain:
daemon → bridge → cold path.

New helpers in `services/bridge/daemon-route.ts`:
- `tryListPeersViaDaemon()`
- `tryListSkillsViaDaemon()`
- `tryGetSkillViaDaemon(name)`

### Ambient mode

After `claudemesh install` (which now installs and starts the daemon
service), **raw `claude` Just Works** for the daemon's attached mesh.
No `claudemesh launch` ceremony needed for the common case. Channel
push, slash commands, and resources flow through the daemon-backed
MCP shim.

`claudemesh launch` remains the override path: explicit mesh
selection, fresh display name, headless modes, system-prompt injection,
or multi-mesh users who want to spawn into a non-default mesh.

### Roadmap spec

`.artifacts/specs/2026-05-04-v2-roadmap-completion.md` documents
exactly what's done vs. what remains for the full v2.0.0 endpoint:
multi-mesh daemon (1.26.0), full CLI-to-thin-client conversion
(1.27.0), mesh→workspace rename (1.28.0), HKDF identity (2.0.0).

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
