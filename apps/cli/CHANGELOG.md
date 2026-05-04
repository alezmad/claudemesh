# Changelog

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
