# Changelog

## 1.34.13 (2026-05-04) — MCP forwards session token on /v1/events

The 1.34.10 SSE demux + 1.34.11 inbox per-recipient column were both
in place but the bug user kept seeing wasn't actually fixed. Cause:
the MCP server's SSE subscription didn't forward the session token,
so the daemon's `/v1/events` route resolved `session` to null, the
SseFilterOptions filter was empty, and every MCP received the
unfiltered global stream. Demux at the bind layer was correct;
the subscriber just wasn't telling the daemon who it was.

`apps/cli/src/mcp/server.ts` — `subscribeEvents` now accepts
`{ sessionToken }` and forwards it as `Authorization: ClaudeMesh-Session
<token>` on the SSE connect, identical to how `daemonGet` and
`daemonMarkSeen` already authenticate. The MCP boot already reads the
token via `readSessionTokenFromEnv()`; this just threads it one more
hop. Without this, A's MCP would render DMs that arrived on B's
session-WS — exact symptom from the 2026-05-04 two-session smoke,
even after restarting the daemon to pick up 1.34.11.

## 1.34.12 (2026-05-04) — `daemon up` detaches by default

Pre-1.34.12 `claudemesh daemon up` ran in the foreground and streamed
JSON logs to the terminal until Ctrl-C. Surprising for users who just
want the daemon "up" — they'd run it, see a wall of broker_status /
broker_ws_open_attempt logs, and not realize the shell was now blocked.

`up` now spawns a detached child re-execing `daemon up --foreground`
with stdout/stderr redirected to `~/.claudemesh/daemon/daemon.log`,
then exits the parent cleanly:

```
$ claudemesh daemon up
  ✔ daemon started (pid 59175)
  → log:  /Users/agutierrez/.claudemesh/daemon/daemon.log
  → stop: claudemesh daemon down
```

Pass `--foreground` for the pre-1.34.12 behavior (debugging, or when
something else owns lifecycle).

The launchd plist + systemd-user unit + `claudemesh launch`'s
auto-spawn helper all explicitly pass `--foreground` because their
parents (launchd / systemd-user / the launch helper) own process
lifecycle and stdio redirection. Without that, the child would
double-fork and orphan a grandchild the parent service couldn't track.

The parent waits up to 3s for the IPC socket to appear before
declaring success; if the child crashes during boot (config read
failed, port bind failed, etc.), the parent surfaces the log path
instead of silently exiting 0.

### Files

- `apps/cli/src/commands/daemon.ts` — `--foreground` flag,
  `spawnDetachedDaemon` helper, updated help text.
- `apps/cli/src/cli/argv.ts` — `foreground` / `no-tcp` / `public-health`
  added to BOOLEAN_FLAGS so the parser doesn't try to consume the
  next positional as their value.
- `apps/cli/src/entrypoints/cli.ts` — threads `foreground` through to
  runDaemonCommand.
- `apps/cli/src/services/daemon/lifecycle.ts` — auto-spawn passes
  `--foreground` (lifecycle helper IS the detacher).
- `apps/cli/src/daemon/service-install.ts` — launchd plist + systemd
  unit pass `--foreground` (launchd / systemd own lifecycle).

## 1.34.11 (2026-05-04) — inbox per-recipient column

Closes the storage half of the per-session scoping story 1.34.10
opened. The SSE demux fixed the live event path; this fixes the inbox
reads. Same bug shape: every session shared one `inbox.db`, so any
session running `claudemesh inbox` (and the MCP welcome calling
`/v1/inbox?unread_only=true`) returned the global table — A's launch
surfaced B's unread DMs as if they were A's, and `markInboxSeen`
flipped seen-state for rows the asking session never owned.

### Schema

`apps/cli/src/daemon/db/inbox.ts`:

- New columns: `recipient_pubkey TEXT`, `recipient_kind TEXT`,
  indexed by recipient_pubkey. Migration is non-destructive — pre-
  1.34.11 rows land with NULL and are visible to every session on
  the same mesh (best-effort back-compat).
- `insertIfNew` now writes both fields; `inbound.ts` populates them
  from the `recipientPubkey` / `recipientKind` already passed for
  the bus event.
- `listInbox` accepts `recipientPubkey` (session) and
  `recipientMemberPubkey` (member), composes a WHERE clause:
  `recipient_pubkey IS NULL OR recipient_pubkey IN (session, member)`.

### IPC

`apps/cli/src/daemon/ipc/server.ts` — `/v1/inbox` resolves the
session bearer token to a session pubkey + the matching mesh's
member pubkey, threads both into `listInbox`. Diagnostic callers
without a token (no session header) still get the unscoped global
view.

The response now surfaces `recipient_pubkey` + `recipient_kind` so
`--json` consumers can tell session DMs apart from member-keyed
broadcasts.

### Welcome auto-fixes

The welcome path already calls `/v1/inbox?unread_only=true` with the
session token; with this scoping in place it now returns ONLY rows
the session is meant to see. No code change needed in
`apps/cli/src/mcp/server.ts`.

### Architecture invariant after 1.34.11

Every shared store / channel on the daemon now scopes by recipient:

- EventBus → SSE demux at bind layer (1.34.10)
- inbox.db → recipient_pubkey / recipient_kind columns + listInbox
  scoping (1.34.11)
- outbox.db → already scoped via `sender_session_pubkey` for routing
  (1.34.0)

Single bus + single tables remain the canonical pattern; demux is
isolated to one chokepoint per layer.

## 1.34.10 (2026-05-04) — per-session SSE demux + universal daemon

The "echo" the user kept seeing across 1.34.7→1.34.9 wasn't a broker-side
echo at all. With two sessions on the same daemon (a + b), the daemon
runs ONE event bus shared across every connected MCP. b's session-WS
receives a's DM, publishes one `message` event to the bus, and BOTH a's
MCP and b's MCP fan that event into a `<channel>` reminder. Result: a
sees its own outbound rendered with `from_pubkey = a.session.pubkey`
because a's MCP indiscriminately renders every bus event.

Fix is per-subscriber demux at the SSE bind layer (`apps/cli/src/daemon/
events.ts`). The bus stays single-shot — it just publishes once with
recipient context attached. Each `/v1/events` subscription scopes via
the session token presented by the MCP, and the bind helper drops
events whose `recipient_pubkey` doesn't match. System events
(peer_join etc.) bypass the recipient check; mesh-scoped events
(broker_status with `data.mesh`) get a mesh-slug filter so a session
on prueba1 doesn't see flexicar's broker reconnect lines.

`handleBrokerPush` (`apps/cli/src/daemon/inbound.ts`) gains
`recipientPubkey` + `recipientKind` on its context. Run.ts wires the
session-WS path with `{ recipientKind: "session", recipientPubkey:
session.pubkey }` and the daemon-WS path with `{ recipientKind:
"member", recipientPubkey: mesh.pubkey }`. SSE bind uses the session
registry to resolve the subscriber's session pubkey + member pubkey
+ mesh from its bearer token.

The 1.34.8/9 "echo guards" (drop pushes whose senderPubkey/Member ===
ours) are kept as defense-in-depth; the actual fix lives in the SSE
demux. Diagnostic callers without a session token (`claudemesh daemon
events`) get the unfiltered legacy stream — backwards compatible.

### Universal daemon (`--mesh` and `--name` deprecated)

`claudemesh daemon up` and `daemon install-service` no longer accept
mesh / name overrides. The daemon attaches to every mesh in
`~/.claudemesh/config.json`, full stop. Single-mesh isolation is
handled by joining only one mesh in that environment (containers,
etc.). Pinning at start time was the source of "I joined a new mesh
but my service still ignores it" — gone.

`--mesh` and `--name` are still parsed for back-compat with existing
launchd plists baked at install time, but ignored with a deprecation
warning. New installs no longer write them. Help text updated.

### Daemon version stamp

`daemon_started` boot log now includes `"version": "1.34.10"` so users
can grep their daemon log to confirm whether the running process
picked up a recent ship. Pairs with the existing `claudemesh launch`
warning that fires when CLI ≠ daemon.

### Files

- `apps/cli/src/daemon/events.ts` — `SseFilterOptions`,
  `shouldDeliver`, `bindSseStream(res, bus, filter)`.
- `apps/cli/src/daemon/inbound.ts` — `recipientPubkey` /
  `recipientKind` on InboundContext; bus event carries them through.
- `apps/cli/src/daemon/run.ts` — both onPush call sites tag with the
  right kind; daemon_started boot log includes version.
- `apps/cli/src/daemon/ipc/server.ts` — `/v1/events` resolves the
  bearer session into a filter and passes it to bindSseStream.
- `apps/cli/src/commands/daemon.ts` — deprecation warnings on `up` /
  `install-service` for `--mesh` / `--name`; help text trimmed.
- `apps/cli/src/entrypoints/cli.ts` — top-level help drops `--mesh
  <slug>` from the daemon section, adds the universal-daemon note.
- `apps/cli/src/commands/launch.ts` — staleness warning copy clean
  (no misleading `--mesh` example).

## 1.34.9 (2026-05-04) — broader self-echo guard + system event polish

Two-session smoke after 1.34.8 surfaced two regressions and one missing
piece: echoes still arrived on the daemon-WS path (the 1.34.8 guard was
too strict — it required BOTH senderPubkey === ownMember AND
senderMemberPubkey === ownMember, but session-attributed echoes carry
the session pubkey on `senderPubkey`); peer_join system events
duplicated because both the member-WS and the session-WS forwarded
them; and the channel reminder collapsed all peer joins to just a
display name with no disambiguation.

### Daemon-WS self-echo guard relaxed

`apps/cli/src/daemon/run.ts` — drop on `senderMemberPubkey === ownMember`
alone. Anything attributed to OUR member is either our own send echoing
back via the broker fan-out OR (theoretically) a peer with the same
pubkey, which is impossible by construction. Sibling-session DMs fan
session-to-session, not via the same member-WS, so they aren't affected.

### Session-WS skips system events

`apps/cli/src/daemon/session-broker.ts` — system pushes (`subtype:
"system"`) are dropped before `onPush` so they don't re-publish on the
bus. The member-WS already handles system events; forwarding through
both paths produced two `[system] Peer "X" joined` channel reminders
per join, plus another set per sibling session.

### Self-join filter on member-WS

`apps/cli/src/daemon/inbound.ts` — new `isOwnPubkey` closure on
`InboundContext`. The broker's peer_joined fan-out excludes the
JOINING connection but our daemon owns multiple connections per mesh
(member-WS + N session-WSs from the same identity), so a session's
own peer_joined arrives at the same daemon's member-WS. The filter
walks `mesh.pubkey` plus every live entry in `sessionBrokersByPubkey`
to recognize "us" and drops the event verbatim. Wired in run.ts.

### Richer peer-join channel content

`apps/cli/src/mcp/server.ts` — `[system] Peer "name" joined the mesh`
becomes `[system] Peer "name" (pubkey-prefix) [groups] joined the
mesh — last seen … · "summary"` (last-seen + summary fields only on
`peer_returned` events). The meta payload now carries `peer_pubkey`,
`peer_groups`, `peer_last_seen_at`, `peer_summary` for downstream
consumers. cwd / role aren't surfaced yet — broker-side change
required.

### Daemon staleness warning

`apps/cli/src/commands/launch.ts` — when `claudemesh launch` finds the
daemon already running with a different version than the CLI, it
surfaces a one-shot warning + restart instructions. Catches the
common "I `npm i -g`d the latest CLI but the launchd service is still
running last week's daemon" footgun.

## 1.34.8 (2026-05-04) — self-echo guard, inbox read-state + TTL prune

Three closely-related fixes shipped together because they all touch the
"what does the user actually see in inbox.db / on the channel" axis.

### Self-echo guard

The 1.34.0 sender-attribution fix routed session-originated DMs through
the per-session WS so the broker's fan-out attributed each push to the
sender's session pubkey. A side effect (visible in the 2026-05-04
two-session smoke): some broker fan-out paths mirror the outbound DM
back to the originating session-WS, so the sender saw their own
message land in inbox.db, publish a `message` bus event, and surface
as `← claudemesh: <self>: <text>` in their own Claude Code session
immediately after typing `claudemesh send`.

Fixed at the WS boundary in two places:

- `apps/cli/src/daemon/session-broker.ts` — drop pushes where
  `senderPubkey === opts.sessionPubkey` before forwarding to
  `handleBrokerPush`. Match on session pubkey only — sibling sessions
  of the same member share `senderMemberPubkey`, so a member-level
  filter would wrongly drop legit sibling DMs.
- `apps/cli/src/daemon/run.ts` — daemon-WS onPush drops pushes where
  BOTH `senderMemberPubkey === mesh.pubkey` AND `senderPubkey ===
  mesh.pubkey` (i.e. an actual member-WS self-echo, not a sibling
  session whose senderPubkey is its session key).

### Inbox read-state (`seen_at`)

Replaces the welcome's "last 24h" window with a proper read-state
filter. New `seen_at INTEGER` column on `inbox`, plus `markInboxSeen`
and `pruneInboxBefore` helpers in `apps/cli/src/daemon/db/inbox.ts`.

Read-state flips on three paths:

1. Interactive listing — `/v1/inbox` GET auto-stamps every returned
   row that was previously NULL. Pass `?mark_seen=false` to peek
   without flipping (used by the welcome — it stamps explicitly only
   AFTER the channel notification succeeds, so a Zod-rejected welcome
   doesn't silently lose unread state).
2. MCP welcome — `/v1/inbox?unread_only=true&mark_seen=false&limit=50`
   surfaces only rows the user hasn't seen, then `POST /v1/inbox/seen`
   stamps the ids the welcome actually rendered.
3. MCP live channel emit — after a successful
   `notifications/claude/channel` for a single inbox row, the MCP
   server calls `/v1/inbox/seen` for that id so the next launch's
   welcome doesn't re-surface it.

CLI surface:

```sh
claudemesh inbox --unread             # only seen_at IS NULL rows
claudemesh inbox --json               # row now includes seen_at
```

### Inbox TTL prune

`apps/cli/src/daemon/inbox-pruner.ts` runs `pruneInboxBefore(db,
Date.now() - 30d)` once at daemon startup and hourly thereafter. Logs
`inbox_prune_completed` whenever rows were removed. No CLI knob — it's
a built-in retention policy that prevents inbox.db from growing
unbounded. Manual override remains `claudemesh inbox flush --before
<iso>`.

### Files

- `apps/cli/src/daemon/db/inbox.ts` — `seen_at` column + migration,
  `unreadOnly` filter, `markInboxSeen`, `pruneInboxBefore`.
- `apps/cli/src/daemon/inbox-pruner.ts` — new file, hourly TTL sweep.
- `apps/cli/src/daemon/run.ts` — wires the pruner into startup +
  shutdown; daemon-WS self-echo guard.
- `apps/cli/src/daemon/session-broker.ts` — session-WS self-echo
  guard.
- `apps/cli/src/daemon/ipc/server.ts` — `unread_only` + `mark_seen`
  query params; new `POST /v1/inbox/seen` route.
- `apps/cli/src/mcp/server.ts` — `daemonMarkSeen` helper; welcome
  switched to `unread_only=true`; mark-seen after channel emit.
- `apps/cli/src/services/bridge/daemon-route.ts` —
  `tryListInboxViaDaemon` accepts `{ unreadOnly, markSeen }`;
  `InboxItem.seen_at` exposed.
- `apps/cli/src/commands/inbox.ts` + `apps/cli/src/entrypoints/cli.ts`
  + `apps/cli/src/cli/argv.ts` — `--unread` flag.
- `apps/cli/skills/claudemesh/SKILL.md` — documents seen_at semantics,
  self-echo guard, TTL prune.

## 1.34.7 (2026-05-04) — inbox flush + delete commands

The CLI had no first-class way to clean the persisted inbox; the only
recourse was `sqlite3 ~/.claudemesh/daemon/inbox.db "DELETE FROM
inbox"`, which bypasses IPC and is invisible to anyone who doesn't
know the schema. Two new verbs:

```sh
claudemesh inbox flush --mesh prueba1
claudemesh inbox flush --before 2026-05-04T18:00:00Z
claudemesh inbox flush --all                # required guard with no other filter
claudemesh inbox delete <message-id>        # alias: rm
claudemesh inbox flush --json               # → { ok: true, removed: N }
```

`flush` without filters refuses with an `--all` confirmation hint —
prevents an accidental "wipe every row on every mesh" from a
fat-fingered command.

### Mechanics

- `apps/cli/src/daemon/db/inbox.ts` gains `deleteInboxRow(id)` and
  `flushInbox({ mesh?, before? })` (returns `changes`).
- IPC: `DELETE /v1/inbox?mesh=…&before=…` + `DELETE /v1/inbox/<id>`.
  Mesh filter honors session-default scoping (same as listing).
- Daemon-route helpers `tryFlushInboxViaDaemon` and
  `tryDeleteInboxRowViaDaemon` mirror the existing
  `tryListInboxViaDaemon` shape.
- New CLI command file `apps/cli/src/commands/inbox-actions.ts`.
- Help and SKILL.md document the verbs.

## 1.34.6 (2026-05-04) — welcome: stringify meta values to pass Zod schema

The 1.34.2 → 1.34.5 timing-race theory was wrong. Reading Claude Code
v2.1.126's binary at the `notifications/claude/channel` schema:

```js
IJ_ = y.object({
  method: y.literal("notifications/claude/channel"),
  params: y.object({
    content: y.string(),
    meta: y.record(y.string(), y.string()).optional(),
  }),
})
```

`meta` is a `record(string, string)` — every value MUST be a string.
Pre-1.34.6 the welcome shipped:

- `peer_count: number` → Zod reject
- `peer_names: string[]` → Zod reject
- `unread_count: number` → Zod reject
- `latest_message_ids: string[]` → Zod reject

The whole notification was dropped at the schema-validation step
BEFORE the channel handler ever ran. No log, no error, no UI surface —
exactly the symptoms 1.34.2 → 1.34.5 chased.

Live peer DMs always worked because every meta value already went
through `String(...)`. The welcome was the only notification shape
with non-string meta, uniquely affected.

### Fix

`emitMeshWelcome` now coerces every meta value to string. Counts
become digit strings (`"3"`, `"16"`); arrays serialize as JSON
(`'["b","c"]'`, parseable on the receiving side). Schema validation
passes, notification reaches the handler, channel reminder surfaces.

The 1.34.5 dual-lane retry is removed — single emit at 3s grace
after `oninitialized` is enough now that the schema is right.

### What changed in `~/.claudemesh/daemon/mcp-<pid>.log`

`welcome_attempt` rows are gone (no more lanes). You'll see
`mcp_started` → `server_initialized` → `welcome_peers_resolved` →
`welcome_emitted` per launch — the same shape as 1.34.4 minus the
`fast`/`slow` lane field.

## 1.34.5 (2026-05-04) — dual-lane welcome retry to defeat handler-registration race

1.34.4 hooked `server.oninitialized` + 2s grace. The MCP-side log
confirmed `welcome_emitted` ran at +2.4s, but the user still saw
nothing in Claude Code. Claude Code's React effect that calls
`setNotificationHandler("notifications/claude/channel", ...)` runs
multiple ticks AFTER its UI state flips to "connected", which happens
after `server.oninitialized` fires. 2s was still inside the dead zone.

We can't directly observe handler-registration timing from the MCP
side (the SDK has no hook for it), so this version emits the welcome
TWICE: 5s post-init (`lane: "fast"`) and 15s post-init (`lane: "slow"`).
Whichever one lands surfaces; the duplicate is acceptable for an
informational welcome. Both attempts log to `mcp-<pid>.log` so we can
see which lane wins in production. If observation shows the slow
path always wins, future versions can drop the fast attempt.

## 1.34.4 (2026-05-04) — welcome triggers on `oninitialized`, peer count fix

### Welcome trigger: post-initialization, not fixed timer

1.34.3's welcome fired on a fixed 5s timer after `server.connect`.
Diagnostic logging confirmed the emit ran (`welcome_emitted` in
`mcp-<pid>.log`) but the user never saw the channel reminder. Cause:
Claude Code only registers its `notifications/claude/channel`
notification handler AFTER the MCP init handshake completes
(initialize request → initialized notification from client →
`server.oninitialized` fires). 5s commonly closed before that
sequence finished, so the welcome notification arrived at a server
that hadn't wired up a handler yet — silently dropped.

Live peer DMs worked because they arrive seconds-to-minutes later,
well past the window. The welcome is the only event with a
deterministic close-to-zero delay, so it was uniquely affected.

The fix gates the welcome on `Server.oninitialized`, then adds 2s of
grace for any pending list_tools / list_prompts round-trips to settle
before emitting. Matches the registration timing exactly — by the
time `oninitialized` fires, Claude Code has already accepted the
server and registered the channel handler.

### Peer count filter mirrors the launch banner

The 1.34.3 welcome used `peerRole !== "control-plane"` to filter the
peer list — that's the new taxonomy from broker M1, but older brokers
still emit only `channel: "claudemesh-daemon"` for control-plane rows.
Result: `peer_count: 0` even when the launch banner showed "2 peers
online". The welcome filter now matches the launch banner exactly
(`channel !== "claudemesh-daemon"`) and additionally honors
`peerRole !== "control-plane"` when present.

Self-exclusion is now opt-in: only filtered when `self_session_pubkey`
is known (from the `/v1/sessions/me` lookup). This prevents over-
filtering when the token route fails and we fall back to the
unauthenticated peer list.

`mcp-<pid>.log` now records `server_initialized`,
`welcome_peers_resolved` (with total / real counts), and
`welcome_peers_status` so a missing welcome can be traced through the
init handshake → peer query → notification chain.

## 1.34.3 (2026-05-04) — welcome always fires + skill / help refresh

### Welcome always emits, regardless of inbox state

The 1.34.2 welcome only fired when there were unread messages, so a
freshly-launched session with an empty inbox saw nothing — no
confirmation that the mesh pipe was live. Now it always emits, and
carries useful launch context:

- **identity** — display name, session pubkey prefix, role
- **mesh** — active mesh slug
- **peers** — live peer count + up to 5 names (control-plane filtered out)
- **inbox** — recent count + up to 3 previews (or "Inbox is empty (last 24h)")
- **CLI hints** — `peer list` · `send` · `inbox`
- **skill pointer** — `📚 Read the claudemesh skill (SKILL.md)…` so the
  model loads the canonical reference if it isn't already in context

Composes from up to three best-effort daemon queries
(`/v1/sessions/me`, `/v1/peers?mesh=…`, `/v1/inbox?mesh=…&since=…`),
each degrading silently. The welcome ALWAYS goes out unless the IPC
socket is unreachable. Meta carries `kind: "welcome"`,
`self_display_name`, `self_session_pubkey`, `self_role`, `mesh_slug`,
`peer_count`, `peer_names`, `unread_count`, and
`latest_message_ids` for downstream consumers.

### `daemonGet` now forwards the session token

The MCP's IPC client gained an optional `sessionToken` field. The
welcome path uses it for `/v1/sessions/me` (which 401s without auth)
and for default-mesh scoping on `/v1/peers` and `/v1/inbox`. Token
read from `CLAUDEMESH_IPC_TOKEN_FILE` set by `claudemesh launch`.

### Skill (`apps/cli/skills/claudemesh/SKILL.md`) refresh

- New section: "Launch welcome (`kind: "welcome"`)" — describes the
  5-second handshake, its meta fields, and that it should NOT be
  replied to like a DM.
- Channel attributes table: clarified that `from_pubkey` is the
  ephemeral session pubkey of the originator (post-1.34.0 attribution
  fix), separated `from_session_pubkey` and `from_member_pubkey`,
  added `client_message_id` and `kind` rows.
- Inbox section: documented `--mesh <slug>`, `--limit N`, and that
  the command reads `~/.claudemesh/daemon/inbox.db` via daemon IPC
  (NOT a fresh broker-WS buffer drain — that path was removed in
  1.34.0).
- Reply behavior: explicit "do NOT reply when `meta.kind` is
  `"welcome"` or `"system"`".

### `claudemesh --help` refresh

`message inbox` line was still labeled "drain pending" from the
pre-1.34.0 cold-path implementation. Updated to "read persisted
inbox" with the new flags (`--mesh`, `--limit`, `--json`) and a
note that it reads from `~/.claudemesh/daemon/inbox.db` via the
daemon.

## 1.34.2 (2026-05-04) — launch welcome push summarizing recent inbox

When a Claude Code session launches via `claudemesh launch`, the user
lands cold — they don't know whether peers messaged them while they
were offline. Real-time pushes only cover messages that arrive AFTER
the SSE subscription is alive, so anything queued at the broker that
drains during the hello-handshake window can land in `inbox.db`
before the MCP subscribes. Without a welcome, the user has to remember
to run `claudemesh inbox` to discover the gap.

The MCP server now fires a one-shot welcome 5s after the transport is
up:

- queries `/v1/inbox?since=<24h-ago>&limit=20` for the recent window;
- skips silently when there are no rows;
- emits a single `notifications/claude/channel` with header
  (`📥 [welcome] N messages from last 24h (mesh-a, mesh-b)`),
  up to three preview lines (sender, mesh, time, 60-char body),
  a remainder count, and the `claudemesh inbox` CLI hint;
- meta carries `kind: "welcome"`, `unread_count`, mesh list, and the
  first 10 message ids so a downstream agent can `claudemesh message
  status <id>` if it wants to inspect.

Why a 5s delay: gives the daemon's session-WS time to reconnect,
re-claim leased rows, drain pending broker queue, and finish writing
to inbox.db before we summarize. Earlier and the welcome would
under-report; later and it stops feeling like a launch handshake.

Why a 24h window: narrow enough to feel relevant on a freshly-launched
session, wide enough to surface overnight messages without dumping
the entire history into the channel.

The welcome flow is fully diagnostic — `welcome_skip` (with reason),
`welcome_emitted`, or `welcome_emit_failed` lands in
`~/.claudemesh/daemon/mcp-<pid>.log` for every launch.

## 1.34.1 (2026-05-04) — declare `claude/channel` capability so Claude Code surfaces pushes

The 1.34.0 ship fixed the daemon-side push pipeline (correct sender
attribution, persistent inbox readable from CLI). Bus events fire,
SSE delivers them to the MCP, and the MCP calls
`server.notification("notifications/claude/channel", ...)` — but
Claude Code v2.1.x stopped surfacing them as `<channel>` reminders.
Real two-session smoke confirmed the silent drop: messages landed
in `inbox.db`, the daemon SSE stream emitted the `message` events,
yet neither Claude Code session got a real-time push.

### Root cause

Claude Code v2.1.x added a capability gate on the channel handler.
Reading `claude` binary at the `notifications/claude/channel`
offsets:

```js
function xJ_(serverName, capabilities, pluginSource) {
  if (!capabilities?.experimental?.["claude/channel"])
    return { action: "skip", kind: "capability",
             reason: "server did not declare claude/channel capability" };
  ...
}
```

`xJ_` is called when the MCP server connects. When it returns
`{action: "skip"}`, Claude Code never calls
`client.setNotificationHandler(IJ_(), ...)` for that server — so
every `notifications/claude/channel` emit falls into the void. The
`--dangerously-load-development-channels server:claudemesh` flag
gets you past the allowlist check that runs LATER in `xJ_`, but the
capability gate runs FIRST and is independent.

Pre-2.1.x clients didn't gate on this key, which is why the same
MCP wire shape "worked" before. There's no error / log / warning
on either side; the notifications just disappear.

### Fix

`apps/cli/src/mcp/server.ts` declares the capability:

```ts
new Server({ name: "claudemesh", version: VERSION }, {
  capabilities: {
    tools: {}, prompts: {}, resources: {},
    experimental: { "claude/channel": {} },
  },
});
```

The empty object is enough — Claude Code only checks for presence,
not contents.

### Diagnostic logging

The MCP server now writes a per-pid log to
`~/.claudemesh/daemon/mcp-<pid>.log` whenever:

- the SSE event arrives (`sse_event_received`),
- a channel notification is emitted (`channel_emitted`), or
- the emit throws (`channel_emit_failed`).

`tail -f ~/.claudemesh/daemon/mcp-*.log` lets users verify the
push pipeline end-to-end without strings-dumping the Claude Code
binary. (MCP stderr is captured by Claude Code and not visible to
the user, so an on-disk log was the only way to surface this
state in the future.)

### Upgrade

```sh
npm i -g claudemesh-cli@latest
# Restart Claude Code so the MCP picks up the capability change.
```

After this version: peer messages surface as `<channel>` reminders
mid-turn the way they did pre-2.1.x.

## 1.34.0 (2026-05-04) — Sender attribution via session-WS + inbox CLI fix

Two regressions surfaced in real two-session smokes that landed
together; both root in the same architectural seam (sender identity
across the daemon ↔ broker ↔ recipient hop).

### Sender attribution: outbox routes via session-WS

Pre-1.34.0, every outbox row drained through the daemon's
member-keyed `DaemonBrokerClient`, regardless of which session typed
`claudemesh send`. The broker's fan-out builds the push envelope from
`conn.sessionPubkey ?? conn.memberPubkey` — for a member-WS that's
always the member pubkey. Result: a real two-session smoke
(`a → b: "123"`, `b → a: "456"`) landed messages in `inbox.db` with
`sender_pubkey = <daemon's member pubkey>` instead of the actual
session sender's ephemeral pubkey. Wrong "from" for every DM.

The fix routes session-originated sends through the matching
`SessionBrokerClient` so the broker sees `conn.sessionPubkey =
<sender session pubkey>` naturally — no broker-side change needed.
Mechanics:

- New `outbox.sender_session_pubkey` column. The IPC `/v1/send`
  handler fills it whenever the request authenticates as a launched
  session (`Authorization: ClaudeMesh-Session …`).
- IPC `/v1/send` now encrypts with the **session secret** (was: mesh
  member secret) when a session token is present. Recipient's
  `inbound.ts` decrypts with `senderSessionPub × recipientSessionSec`
  → matches what the sender wrote.
- `SessionBrokerClient` gains a `send()` method mirroring
  `DaemonBrokerClient.send` (pendingAcks tracking, 15s ack-timeout,
  queue-while-reconnecting via the `opens` array). Composition kept
  intact — both clients share `connectWsWithBackoff`; the
  request/ack bookkeeping is duplicated rather than subclassed.
- Drain worker reads `sender_session_pubkey` and looks up an open
  session-WS via a new `getSessionBrokerByPubkey` accessor on
  `DrainOptions`. Session-attributed rows REQUIRE an open session-WS;
  no fallback to daemon-WS, because the row is encrypted with the
  session secret and silent fallback would break decryption on the
  recipient side. Closed/reconnecting → backoff + retry.
- `apps/cli/src/daemon/run.ts` maintains a parallel
  `sessionBrokersByPubkey` index alongside the existing token-keyed
  map, kept in sync on register/deregister.

Cold-path sends (no session token in IPC headers) keep the legacy
member-key flow unchanged. Pre-1.34.0 outbox rows (NULL session
pubkey) drain via the daemon-WS as before — no migration of in-flight
rows is required.

### `claudemesh inbox` reads `inbox.db` (was: stale broker buffer)

The pre-1.34.0 implementation opened a fresh `BrokerClient`, waited
1s, then drained an in-memory push buffer that would only contain
new pushes received during that 1s window — completely disjoint from
the daemon's persisted `~/.claudemesh/daemon/inbox.db`. So with the
attribution bug above, a real smoke that DID land messages in the
daemon's inbox.db reported "No messages on mesh prueba1" because the
CLI was looking at the wrong source.

Fixed:

- New `tryListInboxViaDaemon(mesh, limit)` daemon-route helper hits
  `/v1/inbox`.
- `listInbox` (DB layer) and the `/v1/inbox` IPC endpoint accept a
  `mesh` filter so the server scopes server-side instead of returning
  all rows and filtering in-process.
- `runInbox` rewritten to call the daemon-route helper. JSON mode
  returns the raw daemon shape; the human renderer formats sender
  name + pubkey prefix + body + receipt time per row.

The cold-path "drain a fresh-broker buffer" was always vestigial —
removed entirely.

### Verifying

`/tmp/cm-bus-trace.mjs` (workshop scratch, not shipped) opens an SSE
listener against `/v1/events`, registers two test sessions, sends
both directions, and asserts the broker `message` events surface
correctly. Used to confirm the daemon's bus.publish path was already
fine — the regression sat upstream in the daemon's outbound
attribution.

After this version: real two-session smokes show
`sender_pubkey = <session pubkey>` (not member pubkey),
`claudemesh inbox --mesh <slug>` lists what the daemon actually
received, and existing MCP `notifications/claude/channel` events
carry the correct sender attribution to Claude Code.

## 1.33.0 (2026-05-04) — Milestone 1: lifecycle cleanups + at-least-once with ack

First milestone of the agentic-comms architecture work
(`.artifacts/specs/2026-05-04-agentic-comms-architecture-v2.md`).
Foundational correctness — no new external surface, but the wire
protocol grows two additions: a `peerRole` field on `peer list`
responses (presence classification) and a new client-→broker
`client_ack` frame.

### Lifecycle helper extraction

`DaemonBrokerClient` and `SessionBrokerClient` now share a single
lifecycle implementation in `apps/cli/src/daemon/ws-lifecycle.ts`
(`connectWsWithBackoff`). Each client supplies `buildHello` /
`isHelloAck` / `onMessage` and keeps its own RPC bookkeeping; the
helper handles connect, hello-ack timeout, close + backoff reconnect.
Composition over inheritance per Codex's review. Eliminates the drift
bug class that produced 1.32.0/1.32.1 (lifecycle copies diverging
silently when one side gained a feature).

### Daemon-WS no longer carries an ephemeral session keypair

Pre-1.33: every daemon-WS reconnect minted a fresh keypair, sent the
pubkey in the hello, and held the secret in memory for "session"
crypto. Vestigial since 1.30.0 introduced the per-launch
`SessionBrokerClient` that owns the real session pubkey. Daemon-WS
now uses the stable mesh member secret directly for outbound
encryption. Inbound on daemon-WS only attempts member-key decryption —
session decryption is the session-WS's job.

### `peerRole` wire field

The broker now emits a `peerRole` field on each `peer list` row —
`'control-plane' | 'session' | 'service'`. `control-plane` rows are
the daemon's own member-keyed presence (infrastructure), `session`
rows are launched Claude Code sessions, `service` rows are reserved
for v2.x service identities (HTTP webhook consumers, voice agents,
etc.).

The CLI hides `peerRole === 'control-plane'` rows from the human
renderer by default and exposes a `--all` flag for debugging. JSON
output emits `peerRole` on every row.

**Why `peerRole` and not just `role`:** 1.31.5 already lifted
`profile.role` (user-supplied string like "lead", "reviewer") to
top-level `role`, and the agent-vibes claudemesh skill consumes that
field. The presence classification is a different axis, so it gets
its own field name. `role` keeps its 1.31.5 semantics; `peerRole` is
the new field.

### `client_ack` and at-least-once delivery

The broker (M1 broker change) now uses two-phase claim/deliver:
`claimed_at` / `claim_id` / `claim_expires_at` columns track lease
ownership; `delivered_at` is set ONLY when the recipient acks. A 15s
sweeper re-claims rows whose 30s lease expired without ack.

The CLI side closes the loop: after `handleBrokerPush` lands a
message in `inbox.db` (or dedupes against an existing row), the
recipient daemon emits a `client_ack { type: "client_ack",
clientMessageId, brokerMessageId? }` frame on whichever WS the push
arrived on. Best-effort — if the WS is closed by ack time, the
broker's lease will naturally re-deliver, and the receiver dedupes
on `clientMessageId`.

Net behavior: at-least-once with idempotent dedupe. Net visible
change: zero, in the steady state. Crash-mid-push test (kill recipient
between broker claim and recipient ack) now redelivers instead of
silently dropping.

### Files

- New: `apps/cli/src/daemon/ws-lifecycle.ts` (234 lines).
- Refactored: `apps/cli/src/daemon/broker.ts`, `session-broker.ts`,
  `inbound.ts`, `run.ts`, `commands/peers.ts`, `ipc/server.ts`.
- Broker side (separate commit): drain race fix, `presence.role`
  column, `client_ack` handler, lease sweeper.
- DB migration `0029_drain_lease_and_presence_role.sql` ships with
  the broker change.



Foundational refactor before the agentic-comms architecture work
(`.artifacts/specs/2026-05-04-agentic-comms-architecture-v2.md`). Three
changes, all behavior-preserving:

- **`connectWsWithBackoff` helper** (`apps/cli/src/daemon/ws-lifecycle.ts`).
  Both `DaemonBrokerClient` and `SessionBrokerClient` now share one
  lifecycle implementation — connect, hello-handshake, ack-timeout,
  close + backoff reconnect. Each client supplies `buildHello` /
  `isHelloAck` / `onMessage` and keeps its own RPC bookkeeping
  (pendingAcks, peerListResolvers, onPush, etc). Composition over
  inheritance per Codex's review; no protocol shape changes.

- **Drop daemon-WS ephemeral session pubkey.** `DaemonBrokerClient` no
  longer mints + sends a per-reconnect ephemeral keypair in its hello.
  Session-targeted DMs land on `SessionBrokerClient` (since 1.32.1),
  not the member-keyed daemon-WS, so the field was vestigial. The
  daemon's send-encrypt path now signs DMs with the stable mesh member
  secret. Inbound on daemon-WS only attempts member-key decryption —
  session decryption is the session-WS's job.

- **Role-aware peer list.** `peer list` now hides peers whose
  broker-emitted `role` is `'control-plane'` (the daemon's own
  member-keyed presence). `--all` opts back in. JSON output emits
  `role` at the top level. Older brokers that don't emit `role` yet
  default to `'session'`, so legacy peer rows stay visible without
  the broker-side change shipped first. Replaces the prior
  `peerType === 'claudemesh-daemon'` channel-name hack.

## 1.32.1 (2026-05-04) — DMs to session pubkeys actually deliver now

Critical fix. Sessions launched via `claudemesh launch` (1.30.0+) hold a
per-launch session WebSocket on the broker, separate from the daemon's
member-keyed WS. The broker correctly fans direct messages targeted at a
session pubkey out over THAT session WS — but the daemon's
`SessionBrokerClient` was constructed without a push handler and silently
dropped every inbound `push` / `inbound` frame. The header docstring
even claimed it handled "inbound DM delivery for messages targeted at
the session pubkey"; the code never wired the callback.

Net effect since 1.30.0: any DM sent to a peer's session pubkey
(everything `peer list` returns these days, since session pubkey is the
canonical routing key) was queued, broker-acked, marked `delivered_at`
on the broker side, and then thrown away by the recipient daemon. The
local `inbox.db` stayed at zero rows forever and `claudemesh inbox`
reported "no messages" no matter what arrived.

Two-session smoke test that surfaced this: peer A sent "hola" to peer
B's session pubkey — sender outbox showed `status=done` with a
`broker_message_id`, recipient inbox stayed empty, both sides confused.

The fix wires `SessionBrokerClient` to forward `push` / `inbound` frames
to the same `handleBrokerPush` the member-keyed broker already uses. The
session's secret key (registered via `/v1/sessions/register`) is passed
as `sessionSecretKeyHex` so `decryptOrFallback` tries it first; the
parent member key remains the fallback for legacy member-targeted
traffic that happens to fan out here.

Files: `apps/cli/src/daemon/session-broker.ts`,
`apps/cli/src/daemon/run.ts`. No broker change required — the broker
half (queue + fan-out + sendToPeer on the session WS) was already
correct; only the daemon-side intake was missing.

## 1.32.0 (2026-05-04) — multi-session UX bundle

Nine UX bugs surfaced from a real two-session interconnect smoke test
shipped together as a single release.

### Self-identity is now visible

- **`peer list` includes the calling session as a row**, marked
  `(this session)`, sorted to the top. The daemon path now resolves the
  caller's session pubkey via `/v1/sessions/me` so `isThisSession`
  is set correctly even when running warm. (Previously the row was
  present but indistinguishable, and the daemon path always set
  `isThisSession=false`.)
- **`whoami` shows in-session identity** when run inside a launched
  session: session pubkey (truncated + full), session id, mesh, role,
  groups, cwd, pid. Previously whoami only reported web sign-in state.

### Sibling-session disambiguation

- **`peer list` rows now carry a `sid:<short>` tag** so two
  visually-identical rows (same name, same cwd) can be told apart at
  a glance.
- **JSON output already had `sessionId`**; the human renderer
  surfaces a short prefix.

### Daemon presence hidden by default

- `claudemesh-daemon` rows used to clutter `peer list` and confused
  users into thinking the daemon counted as a peer. They're now hidden
  in the human renderer; `--all` opts back in for debugging. The header
  line shows `(N peers, M daemon hidden — use --all)` when applicable.
  JSON output is unchanged.

### `--self` flag works end-to-end

- **Argv parser bug fixed.** `--self` was being parsed greedily — every
  `--flag` consumed the next non-`-` arg as its value, so
  `claudemesh send --self <pubkey> "msg"` ate the pubkey as the value
  of `--self` and left zero positionals. A `BOOLEAN_FLAGS` set in
  `cli/argv.ts` now lists known no-value switches (`self`, `json`,
  `all`, `quiet`, `yes`, `strict`, `force`, `dry-run`, etc.).
  `--flag=value` form also recognized for explicit overrides.
- **`message send` subcommand now passes `self`** through to `runSend`
  (only the legacy `send` form had been wired).
- **Help text updated** to list `--self` (and `--priority`, `--mesh`,
  `--json`) under `claudemesh message send`.

### Member-pubkey fan-out

- **Sending to your own member pubkey with `--self` now fans out** to
  every connected sibling session of your member. Previously the broker
  drain query at `apps/broker/src/broker.ts:2408` matched
  `target_spec` only against full session pubkeys, so member-pubkey
  sends queued successfully but no recipient drain ever fetched. The
  CLI now resolves the member pubkey to all sibling session pubkeys
  via the peer list and sends one message per recipient. Output reports
  `fanned out to N sibling sessions` with per-recipient ack/error.

### Broker welcome at launch

- After the launch banner, a single line confirms WS connectivity:

  ```
  ● broker connected · 6 peers online · 0 unread
  ```

  Hits `/v1/health` for broker WS state, `peer list` (daemon-cached)
  for peer count, and `/v1/inbox` for unread. All best-effort — falls
  back gracefully if any call fails so launch never blocks on it.

## 1.31.6 (2026-05-04) — hex-prefix sends actually deliver now

`claudemesh send <16-hex-prefix> "..."` would acknowledge with `sent
to <prefix> (daemon)` but the recipient never received the message.
The broker's pre-flight matched `peer.pubkey === targetSpec` and the
drain query matched `target_spec = <full-pubkey>` — both exact-equal
checks, so a 16-hex prefix queued successfully but no recipient drain
ever fetched the row. Sender saw "sent", recipient saw nothing.

Fix: the CLI now resolves any hex prefix (4-63 chars, not full 64) to
the full pubkey via the daemon's peer list before submitting to the
broker. Three outcomes:

- **Unique match:** prefix is canonicalized to the full 64-char
  pubkey; the rest of the send pipeline is unchanged.
- **No match:** clear error `No peer matches hex prefix "X"` with the
  list of online peers' display names.
- **Multiple matches:** clear error listing the candidates and a hint
  to lengthen the prefix.

The 16-hex prefix shown in `peer list` rows is now safe to copy-paste
into `claudemesh send` — what worked in the docs finally works in the
CLI.

## 1.31.5 (2026-05-04) — JSON peer list lifts profile.role to top-level + skill guides LLMs to render it

Two follow-ups after 1.31.4 made the human renderer show role/groups
but a launched-session LLM still dropped them when it called
`peer list --json` and built its own table.

- **Top-level `role` field on every peer record.** The broker has
  always returned role nested under `profile.role`, but downstream
  consumers (LLMs in launched sessions, jq pipelines, dashboards) kept
  missing it. The CLI now lifts `profile.role` to a top-level `role`
  field at parse time, so it's the second thing visible in JSON after
  `displayName`. The original `profile.role` is preserved for
  backward compatibility.
- **Updated SKILL.md peer-list section** with the full JSON shape
  (including `memberPubkey`, `sessionId`, `role`, `profile`, `isSelf`,
  `isThisSession`) and explicit guidance: when listing peers inside a
  launched session, prefer the human renderer; if you do need JSON,
  always include `role` and `groups` columns. The previous version of
  the skill documented six fields and skipped role + identity entirely.

## 1.31.4 (2026-05-04) — peer list shows roles and groups

`claudemesh peer list` now surfaces each peer's profile-level role
(`claudemesh profile`) and any joined groups inline next to the
display name, e.g.

```
● mou [role:lead, @flexicar:reviewer, @oncall] (ai, claude-code) · 0d215762…
   cwd: /Users/agutierrez/Desktop/claudemesh
```

When both role and groups are empty, an explicit footer is added so
absence is unambiguous instead of looking like the CLI is hiding the
field:

```
● peer [...]
   role: (none)  groups: (none)
```

JSON output is unchanged (the broker has surfaced these fields all
along) — only the human renderer was missing them.

## 1.31.3 (2026-05-04) — clean rebuild of 1.31.2

1.31.2 published with the right code change but a stale baked-in
VERSION string ("1.31.1") because the build ran before the version
bump. Same fix as 1.31.2, rebuilt cleanly.

## 1.31.2 (2026-05-04) — daemon paths no longer follow per-session CLAUDEMESH_CONFIG_DIR

**Production bug observed in real installs:** every CLI verb invoked from
inside a `claudemesh launch`-spawned session printed

```
[claudemesh] warn service-managed daemon not responding within 8000ms
```

even when the launchd-managed daemon was healthy and responding to
direct probes in ~10 ms.

Root cause: `claudemesh launch` exports `CLAUDEMESH_CONFIG_DIR` to a
per-session tmpdir so that joined-mesh state and the session IPC
token stay isolated from the host's shared config. `DAEMON_PATHS`
read its base directory from the same env var, so inside a launched
session the CLI looked for `daemon.sock` at e.g.
`/var/folders/.../claudemesh-XXXX/daemon/daemon.sock` — which never
exists. The CLI declared the daemon down, fell into the
service-managed wait branch, and timed out.

The daemon is a per-machine singleton serving every session; its
files belong at `~/.claudemesh/daemon/` regardless of any per-session
overlay. Fix: pin `DAEMON_PATHS.DAEMON_DIR` to `~/.claudemesh/daemon/`
and ignore `CLAUDEMESH_CONFIG_DIR`. A new `CLAUDEMESH_DAEMON_DIR`
override is preserved for tests / multi-daemon dev setups; production
callers should never set it.

After this fix, all CLI verbs from within a launched session take the
warm-path (~10 ms IPC) again instead of the cold path (~600-1200 ms).

## 1.31.1 (2026-05-04) — hotfix: reaper stops blocking the daemon event loop

1.31.0 shipped a session reaper that called `execFileSync("ps")`
synchronously, once per registered session, every 5 seconds. With ten
or more sessions registered the daemon's event loop stalled for
hundreds of milliseconds at a time — long enough that incoming
`/v1/version` probes from the CLI failed to return within the 2.5 s
budget and the new "service-managed daemon not responding within
8000ms" warning fired against a perfectly healthy daemon.

Fix:

- `getProcessStartTime` is now async (`execFile` + promisify), never
  blocks the event loop.
- New `getProcessStartTimes(pids)` issues a single batched `ps -p
  <p1>,<p2>,...` for every survivor in one fork — sweep cost is fixed
  regardless of session count.
- `registerSession` stays synchronous: the start-time capture runs
  fire-and-forget so the IPC route returns instantly. The reaper falls
  back to bare liveness for the brief window before the start-time
  lands.
- `reapDead` is now async; the setInterval wrapper voids it so a
  rejected sweep can never crash the daemon.

Behavior is otherwise unchanged from 1.31.0 — same 5 s cadence, same
PID-reuse guard semantics, same broker-WS teardown via the registry
hook.

## 1.31.0 (2026-05-04) — session autoclean, install-time broker verification, no more spurious cold-path warnings under service management

**Three operability changes targeting users who installed the daemon as a launchd / systemd service.**

### Session reaper now autocleans dead claude-code sessions

The daemon's session registry already had a 30-second reaper that
deregistered entries whose pid was dead, but it had two gaps:

- **Sweep cadence too slow.** Stale presence on the broker lingered for
  up to half a minute after a session crashed.
- **No PID-reuse guard.** A recycled pid passes `kill(pid, 0)` even
  though the original process is gone, so the registry could trust a
  ghost.

Process-exit IPC from claude-code itself isn't a viable replacement —
exit handlers don't run on `SIGKILL`, OOM, segfault, kernel panic, or
power loss. The reaper has to be the source of truth.

What changed:

- Reaper interval **30 s → 5 s**.
- On register, capture an opaque process start-time (`ps -o lstart=`,
  works on macOS and Linux). Stored alongside the pid.
- On each sweep, an entry is reaped when the pid is dead **or** the
  pid is alive but its start-time no longer matches what we captured.
- Registry hooks already close the per-session broker WS on
  deregister, so `peer list` rebuilds within one sweep of any session
  exit, no matter how the process died.

Local-host scope only — cross-host registrations are skipped (the
daemon can't `kill -0` a remote pid). Best-effort fallback to bare
liveness when start-time capture fails (e.g., process already gone at
register time).

### Service-managed daemon: no more "spawn failed" false alarms

Users who installed via `claudemesh install` (which sets up
launchd/systemd with `KeepAlive=true`) saw spurious warnings:

```
[claudemesh] warn daemon spawn failed: socket did not appear within 3000ms
```

even when the daemon was healthy. Two contributing causes:

1. **Probe timeout was 800 ms.** Tight enough that the first IPC after
   a launchd-driven restart (which migrates SQLite + opens broker
   WSes) routinely tripped it. Bumped to **2500 ms**.
2. **CLI raced launchd on respawn.** When the probe failed, the CLI
   tried to spawn its own detached daemon, which collided with
   launchd's own restart cycle (singleton lock fails, child exits) and
   left the user with a 3-second timeout warning. Now: when the daemon
   is installed as a service unit (`~/Library/LaunchAgents/com.claudemesh.daemon.plist`
   or `~/.config/systemd/user/claudemesh-daemon.service` exist), the
   CLI **does not attempt to spawn**. It waits up to 8 s for the OS to
   bring the socket up, and only fails out with a service-specific
   message pointing at `launchctl print` / `systemctl status` if the
   service genuinely failed.

New state `service-not-ready` distinguishes "OS-managed daemon hasn't
come up yet" from "we tried to spawn and it failed" — the latter no
longer fires when the daemon is service-managed.

### `claudemesh install` now verifies broker connectivity, not just process start

Previously `install` ended once launchctl/systemctl reported the unit
loaded — but a daemon that boots and then can't reach the broker
(blocked outbound :443, expired TLS, DNS failure, broker outage) only
surfaced as a confusing failure on the user's first `peer list` or
`send`, sometimes hours later.

`/v1/health` was extended to include per-mesh broker WS state:

```json
{ "ok": true, "pid": 58837, "brokers": { "flexicar": "open", "openclaw": "connecting" } }
```

After service start, `install` polls `/v1/health` for up to 15 s and
prints either:

```
✔ broker connected (mesh=flexicar, 2 other meshes attaching)
```

or, on timeout:

```
warn  broker did not reach open within 15s (flexicar=connecting, openclaw=connecting)
      Check ~/.claudemesh/daemon/daemon.log for connect errors.
      Common causes: outbound :443 blocked, expired TLS, DNS resolution.
```

The verification is best-effort and doesn't fail the install — it
just surfaces the issue early so the user can fix it before sending
their first message.

### Tests

4 new vitest cases cover the reaper paths: dead pid, live pid +
matching start-time, live pid + mismatched start-time (PID reuse), and
the no-start-time best-effort fallback.

## 1.30.2 (2026-05-04) — daemon service is multi-mesh by default

`claudemesh install` was hardcoding `--mesh <primaryMesh>` into the
launchd plist / systemd unit, which locked the daemon to a single
mesh and contradicted 1.26.0's multi-mesh design (one daemon attaches
to every joined mesh on boot).

Net effect for users with more than one joined mesh: every CLI verb
against a non-primary mesh fell off the daemon path back to cold-WS
and re-handshakes a fresh broker connection on each call. Most
visible symptom is `[claudemesh] warn daemon spawn failed: socket did
not appear within 3000ms` when a launched session asks for peers in
a sibling mesh, plus `peer list --mesh foo` returning peers from
every attached mesh because the server-side filter never ran.

Now: install drops the `--mesh` arg entirely so the unit launches
`claudemesh daemon up` (no flag), which attaches to every joined
mesh. `claudemesh daemon install-service --mesh <slug>` is preserved
for users who want to pin to one mesh (CI, single-mesh hosts).

## 1.30.1 (2026-05-04) — daemon install upgrade-safe + node-pinned

Two install-path fixes that bit on first user upgrade:

- **Pin `node` by absolute path in the launchd plist / systemd unit.**
  The bin script's `#!/usr/bin/env node` shebang resolves against the
  service environment's PATH, which on macOS launchd defaults to
  `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`.
  That picks up whatever Node is installed system-wide instead of the
  Node that ran `claudemesh install` — and Node 22.x doesn't expose
  `node:sqlite` without the experimental flag, so the daemon crashed
  with `db open failed: ERR_UNKNOWN_BUILTIN_MODULE`. Now we write
  `process.execPath` as the first ProgramArgument so the daemon
  always runs under the same Node that installed it.
- **Tear down the old daemon before re-bootstrapping.** `claudemesh
  install` on a machine that already has a running daemon was hitting
  `Bootstrap failed: 5: Input/output error` because launchctl refuses
  to bootstrap a unit that's already loaded, and the old daemon
  process held the singleton lock. The install path now runs
  `launchctl bootout` (or `systemctl --user stop`) first, plus a
  `SIGTERM` to any orphaned daemon pid in `~/.claudemesh/daemon/
  daemon.pid`, so subsequent installs replace cleanly.

## 1.30.0 (2026-05-04) — per-session broker presence

Sprint A Phase 3. Two `claudemesh launch` sessions in the same cwd now
see each other in `peer list`. Each launched session has a long-lived
broker presence row owned by the daemon, identified by a per-launch
ephemeral keypair vouched by the member's stable key (OAuth-refresh-vs-
access shape).

### What landed

- **broker `session_hello`** — new WS message type. Validates a
  parent-vouched `parent_attestation` (≤24h TTL, ed25519 signature by
  the parent member) plus a session-keyed signature on the hello
  itself. Inserts a presence row keyed on `sessionPubkey` but
  `member_id` from the parent, so member-targeted operations stay
  unchanged. Older brokers reply `unknown_message_type` — newer clients
  drop back to the previous behavior.
- **daemon `SessionBrokerClient`** — slim WS variant of
  `DaemonBrokerClient`. Presence-only, no outbox drain. Lifetime tied
  to a registry hook: register opens it, deregister/reaper closes it.
  Reconnect with exponential backoff up to 30 s.
- **session-registry hooks** — `setRegistryHooks({ onRegister,
  onDeregister })` in `apps/cli/src/daemon/session-registry.ts`. Hook
  errors are caught so they never throttle the registry. SessionInfo
  gains an optional `presence` field carrying the per-launch keypair
  + attestation.
- **IPC `POST /v1/sessions/register`** — accepts an optional
  `presence` block on the body (`session_pubkey`, `session_secret_key`,
  `parent_attestation`). Older payloads continue to work.
- **`claudemesh launch`** — generates an ed25519 session keypair and a
  12 h parent attestation per launch (mesh secret key signs it),
  forwards both to the daemon under `body.presence`. Per-session
  presence is always on; older brokers that don't recognize
  `session_hello` reply `unknown_message_type` and the daemon quietly
  drops the per-session WS for that mesh — the regular member-keyed
  WS still covers all functionality, the only loss is sibling-session
  visibility on that mesh.
- **latent 1.29.0 bug fix** — `claudemesh launch` referenced
  `claudeSessionId` before its `const` declaration further down the
  file, hitting the temporal dead zone → `ReferenceError` silently
  swallowed by the surrounding catch. Net: the IPC session-token
  registration has been failing every launch since 1.29.0, falling
  every session back to user-level scope. Hoisted the declaration up
  so the registration actually runs.

### Sequencing

The broker side ships first and bakes for ~24 h. Older CLIs continue
working unchanged (no per-session WS), and the protocol is purely
additive on the wire.

### Verification (smoke)

In two shells, both `cd ~/Desktop/foo`:

```
$ claudemesh launch --name SessionA -y    # shell 1
$ claudemesh launch --name SessionB -y    # shell 2
```

In a third shell:

```
$ claudemesh peer list --json --mesh foo \
    | jq '.[] | {n: .displayName, c: .cwd}'
{ "n": "SessionA", "c": "/.../foo" }    ← persistent, not query-induced
{ "n": "SessionB", "c": "/.../foo" }
```

Inside SessionA, `peer list --mesh foo` now lists SessionB. Kill
SessionB; within ≤30 s the reaper drops it from `peer list`.

### Out of scope (deferred)

- **Attestation auto-refresh** — current 12 h TTL is comfortably
  longer than typical sessions; if a session lives past the TTL and
  the WS reconnects after expiry, the broker rejects with `expired`
  and the SessionBrokerClient quiets. Workaround: `claudemesh launch`
  again. Auto-refresh queued for 1.31.0+ alongside HKDF identity.
- **Per-session policy DSL** — the per-launch WS could carry
  per-session capabilities later. Out of scope here.
- **Cross-machine session sync** — waits on 2.0.0 HKDF identity.
- **Launch-wizard refactor** — bumped to 1.31.0 to keep this release
  scoped to presence.

## 1.29.0 (2026-05-04) — per-session IPC tokens + auto-scoping

Sprint A Phase 2. Every `claudemesh launch`-spawned session gets a
unique 32-byte cryptographic token that the daemon resolves on every
IPC call to identify which session is talking to it. CLI invocations
from inside that session auto-scope to its workspace instead of
aggregating across every joined mesh.

### What landed

- **`services/session/token.ts`** — mint random 32-byte token, write
  to `<tmpdir>/session-token` (mode 0o600). Reader pulls from
  `CLAUDEMESH_IPC_TOKEN_FILE` env (path, not value, to keep the secret
  off `ps eww`). Optional `CLAUDEMESH_IPC_TOKEN` direct-value escape
  hatch for tests.
- **`daemon/session-registry.ts`** — in-memory `Map<token,
  SessionInfo>` keyed by token, secondary index by sessionId. 30 s
  reaper drops entries whose pid is dead; 24 h hard TTL ceiling guards
  forgotten sessions.
- **IPC routes** — `POST /v1/sessions/register`, `DELETE
  /v1/sessions/:token`, `GET /v1/sessions/me`, `GET /v1/sessions`.
- **IPC auth middleware** — parses `Authorization: ClaudeMesh-Session
  <hex>` and attaches the resolved `SessionInfo` to request context.
  Layered on top of the existing local-token auth (used for TCP
  loopback). Backward-compatible: tokenless callers behave exactly
  as before.
- **`services/session/resolve.ts`** — CLI-side helper that asks the
  daemon `GET /v1/sessions/me` once per process and caches the result.
  Used by verbs that iterate meshes client-side.
- **`launch.ts`** — mints a token, registers it with the daemon, sets
  `CLAUDEMESH_IPC_TOKEN_FILE` on the spawned `claude` env. Token file
  lives in the same tmpdir as the session config; gets shredded on
  cleanup. The daemon's reaper handles dead sessions.
- **`peers.ts`** — selection precedence is now `--mesh` flag → session
  token's mesh → all joined meshes.

### Server-side scoping

Every read route that takes `?mesh=<slug>` (peers, state, memory,
skills) now uses a `meshFromCtx()` helper: explicit query/body wins,
session default fills in when missing. Write routes (set state,
remember, deregister, profile-update) follow the same pattern. Pass
`--mesh` to override.

### Verified end-to-end

| Setup | `peer list` returns |
|---|---|
| no token | 3 meshes' peers (aggregate, unchanged) |
| token registered for prueba1 | 4 peers, all `mesh: prueba1` |

### Out of scope (deferred)

- SQLite persistence for the registry — restart loses it; the reaper
  (or callers re-registering) covers most cases.
- `SO_PEERCRED`-strict pid binding — needs a tiny native binding.
- Per-session policy DSL.
- Cross-machine session sync (waiting on 2.0.0 HKDF identity).

## 1.28.0 (2026-05-04) — bridge tier deletion + daemon-policy flags

First Sprint A drop on the way to v2 thin-client. Two structural changes:

### Bridge tier deletion

- `services/bridge/{client,server,protocol}.ts` removed (~600 LoC).
  These were the per-mesh push-pipe sockets that the legacy MCP shim
  used to hold open; the 1.24.0 shim rewrite stopped opening them but
  the orphaned client kept being called as a "warm path" tier between
  daemon and cold. `tryBridge()` always returned `null` in production
  for the last seven releases — pure dead code.
- Each verb now has two paths only: **daemon (with auto-spawn)** →
  **cold WS**. Same pattern shipped in 1.27.3, simpler to follow.
- `commands/{peers,send,broker-actions}.ts` — bridge-tier blocks
  removed; orphaned `unambiguousMesh` helper removed from
  broker-actions.

### `--no-daemon` and `--strict` flags

New per-process daemon policy:

| Flag | Behavior |
|---|---|
| (default) | probe → auto-spawn → retry → cold fallback |
| `--strict` | probe → auto-spawn → retry → **error** if all fail. No cold fallback. |
| `--no-daemon` | skip daemon entirely → straight to cold path. For sandboxed CI / scripts that don't want a daemon. |

Env equivalents: `CLAUDEMESH_STRICT_DAEMON=1`, `CLAUDEMESH_NO_DAEMON=1`.
Flag wins over env. `--no-daemon` and `--strict` are mutually
exclusive (`--no-daemon` wins if both passed).

Strict-mode enforcement lives at `withMesh` (the cold-path entry
point) so a single chokepoint covers every verb. Under `--strict`,
the lifecycle's misleading "using cold path" warning is suppressed
so the user sees one clean error instead of a confusing two-step.

### What's not in this release (planned for the rest of Sprint A)

- 1.29.0: per-session IPC tokens + auto-scoping
- 1.30.0: launch wizard refactor
- 1.31.0: setup wizard refactor
- 1.32.0: full mesh→workspace public-surface rename
- 2.0.0 (separate sprint): HKDF cross-machine identity (security-reviewed)

## 1.27.3 (2026-05-04) — self-healing daemon lifecycle

The CLI now auto-recovers from a dead daemon on every invocation
instead of silently mis-routing through a stale socket.

### What changed

- New `services/daemon/lifecycle.ts` — single helper that probes the
  IPC socket via `/v1/version` (instead of trusting `existsSync`),
  cleans up stale `daemon.sock` / `daemon.pid` files, and auto-spawns
  a detached `claudemesh daemon up` under a file-lock when the daemon
  is missing.
- Polls for socket liveness up to a budget (3 s for ad-hoc verbs,
  10 s for `claudemesh launch`) before falling through.
- Recently-failed marker (`~/.claudemesh/daemon/.spawn-failure`,
  30 s TTL) prevents thundering-herd retries when the daemon
  crash-loops at startup.
- Spawn-lock (`~/.claudemesh/daemon/.spawn.lock`) ensures concurrent
  CLI invocations share one spawn attempt instead of racing.
- Per-process result cache — a script doing 50 sends pays the spawn
  cost at most once, not 50 times.
- Recursion guard via `CLAUDEMESH_INTERNAL_NO_AUTOSPAWN=1` env (set
  on the spawned daemon's env) so nested CLI calls inside the daemon
  process don't re-trigger spawn.

### User-visible behavior

- `peer list`, `send`, `state get`, etc. now restart the daemon
  automatically when invoked while the daemon is down.
- One-line stderr info on auto-restart:
  `[claudemesh] info daemon restarted automatically (took 615ms)`.
- Cold-path fallback fires only when auto-spawn fails or is
  suppressed by the recently-failed marker; in those cases a `warn`
  line points at the daemon log.

### Bug fixed

`claudemesh launch`'s `ensureDaemonRunning` previously checked only
`existsSync(SOCK_FILE)` and returned early on a stale socket left by
a crashed daemon — silently breaking new sessions. Now delegates to
the lifecycle helper which probes the socket and recovers.

### What's not in this patch

- `--strict` and `--no-daemon` flags (deferred to D in 1.28.0).
- Lazy-loading of cold-path code (deferred to 1.28.0).
- Per-session IPC tokens (deferred to 1.28.0 alongside D's
  thin-client conversion).

## 1.27.2 (2026-05-04) — skill: full-flag launch templates

Documentation-only ship. `skills/claudemesh/SKILL.md` gains a canonical
"fully-populated spawn" recipe under "Wizard-free spawn templates" —
every flag set explicitly, with a per-position annotation table — so
agents and humans copy-paste a known-good kitchen-sink command instead
of stitching one together from the flag table.

Also corrects two pre-existing inaccuracies:
- `--system-prompt` was documented as forwarding to
  `claude --append-system-prompt`. It actually forwards to
  `claude --system-prompt` (overrides the default; pass a string, not a
  path).
- `-q` was listed as a synonym for `--quiet`. The argv parser treats
  short flags (`-X`) and long flags (`--xyz`) as separate keys; only
  `--quiet` is wired. `-q` is currently a no-op.

Carries a note that all twelve launch flags are end-to-end wired only as
of `claudemesh-cli@1.27.1`.

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
