# `claudemesh daemon` — Final Spec v2

> **Round 2 after a critical first-pass review.** v1 of this spec was reviewed
> by another model and pushed back on identity model, no-auth IPC, "exactly-once"
> overclaim, hook credentials, surface bloat, and missing operational flows
> (rotation, image clones, schema migration, threat model). v2 incorporates all
> of those.

---

## 0. Intent — what this is, what it isn't

### 0.1 The product reality

claudemesh today is a **peer mesh runtime for Claude Code sessions**. Each
session runs `claudemesh launch`, opens a WebSocket to a managed broker, gets
ephemeral identity, sends/receives DMs and topic messages with other Claude Code
sessions, posts to shared state, deploys MCP servers / skills / files,
participates in tasks, schedules reminders. Everything is E2E encrypted with
crypto_box envelopes for DMs and per-topic symmetric keys for topics. The broker
is a routing/persistence layer; peers do the actual work.

The CLI is the canonical surface — every operation is a `claudemesh <verb>`.
The MCP server is a "tool-less push pipe" that surfaces inbound messages to
Claude Code as channel notifications. There is also a web dashboard, an `/v1/*`
REST API, and an existing apikey auth model for external integrations.

### 0.2 The gap

Anything that **isn't a Claude Code session** is a second-class citizen:

- A RunPod handler that wants to alert a peer when an OOM happens has only
  one option: curl an apikey-authed REST endpoint. One-way only. The handler
  is not a peer — it can't be DM'd back, can't be `@-mentioned`, can't be in
  `peer list`, can't claim a task assigned to it, can't host an MCP service or
  share a skill. It's a webhook spoke, not a participant.

- A Temporal worker that wants to track its own progress in shared mesh state,
  publish to a `#alerts` topic, and listen for "retry now" instructions has
  no good shape. Either it shells out to `claudemesh send` cold-path
  (a fresh WS handshake per message — ~1s latency, broker churn, no inbound
  path) or it speaks the WS protocol manually (significant code, no SDK).

- A long-running CI runner, an IoT box, a phone app, a future Python or Go
  service — none can be **first-class peers** without writing the same WS
  reconnect / queue / encryption / presence code that the existing CLI already
  has, plus an IPC surface so the host's apps can use it without re-implementing
  any of that.

### 0.3 What this daemon is

A long-running process — the same `claudemesh-cli` binary in `daemon` mode —
that turns any host into a **first-class peer**:

- Stable identity across restarts (the host *is* a member of the mesh, not a
  series of disconnected sessions).
- Persistent WS to the broker, with reconnect, queue, dedupe.
- Local IPC surface (UDS + loopback HTTP + SSE) that any local app can hit
  to send, subscribe, query — without learning the broker protocol or carrying
  long-lived secrets in app code.
- Hooks: shell scripts that fire on events. Server replies to DMs, auto-claims
  tasks, escalates errors — without the app being involved.
- Same security primitives as `claudemesh launch` (mesh keypair, crypto_box,
  per-topic keys). No new auth model toward the broker.

The daemon **is the runtime**. The CLI in cold-path mode is a fallback. The
Claude Code MCP integration is one client of the daemon (eventually).

### 0.4 What this daemon is NOT

- **Not a webhook gateway.** `/v1/notify` and apikeys remain the path for
  systems that can't host the runtime (third-party SaaS, monitoring tools).
  The daemon is for systems that *can* run a process — code you control.

- **Not a generic message broker.** It speaks claudemesh protocol to one
  managed broker. It is not a substitute for NATS, Redis, Kafka, RabbitMQ.

- **Not a Slack replacement.** Topics, DMs, mentions exist because *AI
  sessions* use them. Humans interact via the dashboard or a Claude Code
  session, not by reading the daemon's inbox directly.

- **Not a fleet manager.** One daemon manages one mesh on one host. Multi-mesh
  on one host is supported (one daemon per mesh, supervised). Cross-host
  supervision is an external concern (systemd, k8s, etc.) — the daemon doesn't
  reach across hosts.

### 0.5 Who deploys this

- A developer running `claudemesh daemon up` on their laptop so their open
  Claude Code sessions all share one persistent connection (instead of each
  opening its own ephemeral WS).
- The same developer running `claudemesh daemon install-service` on their VPS,
  RunPod pod, Temporal worker, CI runner — turning each into an
  addressable peer that scripts on that host can talk to via local IPC.
- Eventually: language SDKs (Python / Go / TypeScript) talking to the daemon
  on `localhost`, exposing claudemesh as a first-class API for any app the
  developer writes.

### 0.6 Pre-launch posture

No users yet. We can break protocol, schema, surface, anything. Optimize for
the architecture we want to live with for years, not for the smallest
shippable cut. Codex pushed back on v1 on this exact axis: do not ship
graph/vector/MCP/skills/tasks on day one — freeze a small, hardened core,
expand deliberately.

---

## 1. Process model

**One daemon per (user, mesh)**. Persistent. Survives reboots via OS
supervisor. Serves multiple local apps concurrently.

```
~/.claudemesh/daemon/<mesh-slug>/
  pid                       0600    pidfile, cleaned on shutdown
  sock                      0600    unix domain socket (primary IPC)
  http.port                 0644    auto-allocated loopback port
  local_token               0600    per-daemon bearer for HTTP/TCP transports
  keypair.json              0600    persistent ed25519 + x25519 — daemon identity
  host_fingerprint.json     0600    machine-id + boot-id + interface mac digest
  config.toml               0644    user-editable runtime tuning
  outbox.db                 0600    SQLite — durable outbound queue
  inbox.db                  0600    SQLite — N-day inbound history, FTS-indexed
  schema_version            0644    integer; gates online migrations
  daemon.log                0644    JSON-lines, rotating (100 MB / 14 d)
  hooks/                    0700    user-managed event scripts
```

**Resource caps (defaults, configurable):**

| Resource | Default | Why |
|---|---|---|
| RSS | 256 MB | Most workloads stay under 50 MB; cap protects multi-mesh hosts |
| CPU | unlimited | Hook fan-out can spike briefly; rely on OS scheduler |
| Outbox DB | 5 GB | At 1KB avg msg, that's 5M queued. Disk-full handling at 90% |
| Inbox DB | 5 GB | Same |
| File descriptors | 1024 | UDS clients + SSE streams + DB handles + WS |
| SSE concurrent | 32 streams | DoS protection; configurable up |
| IPC concurrent | 64 in-flight | Backpressure beyond this returns `429 daemon_busy` |
| Hook concurrency | 8 | Bounded pool; overflow queues |

Single binary. Same `claudemesh-cli` package; `daemon` is one of its modes.

## 2. Identity — persistent member by default, ephemeral on opt-in, clone-aware

### 2.1 Modes

```
claudemesh daemon up                          # default: persistent member
claudemesh daemon up --ephemeral              # session-shaped, no keypair persisted
claudemesh daemon up --ephemeral --ttl=2h     # auto-shutdown after TTL
```

- **Persistent (default)**: ed25519 + x25519 keypair stored in `keypair.json`.
  Same identity across restarts, reconnects, supervisor cycles. Right for
  servers, workers, addressable peers.
- **Ephemeral**: keypair generated in memory, never written. Daemon exits =
  identity gone. Right for CI jobs, preview environments, disposable RunPod
  pods, test harnesses, build agents, anything that should not leave a peer
  ghost in the broker after teardown.
- **`--ttl <duration>`** on ephemeral mode: auto-shutdown after the duration,
  or after `claudemesh daemon down`, whichever first. Broker member record
  cleaned up on shutdown.

### 2.2 Image-clone detection

Two daemons booting with the same `keypair.json` (VM image clone, container
copy, restored backup) is a serious failure mode — broker sees connection
collisions, presence flickers, encrypted messages route to the wrong host.

Handled in three places:

1. **Daemon side**: `host_fingerprint.json` is written on first startup —
   `sha256(machine-id || boot-id || mac-of-default-iface || hostname)`. On every
   subsequent startup, the fingerprint is recomputed and compared. If it
   differs, the daemon **refuses to start** unless `--accept-cloned-identity`
   is passed (writes a fresh fingerprint and continues with the same keypair —
   for legitimate hardware migrations) or `--remint` is passed (mints fresh
   keypair, registers as a new member, broker reaps the old member after
   grace period).
2. **Broker side**: tracks `lastSeenHostFingerprint` per member. On
   reconnection from a different fingerprint, broker emits a
   `member_clone_suspected` security event to the mesh owner's dashboard.
   Connection itself is allowed (legitimate hardware swaps happen) but visible
   for audit.
3. **Mesh owner**: `claudemesh member revoke <pubkey>` revokes the keypair
   server-side; daemon receives `keypair_revoked` push event on next
   connection and self-disables.

### 2.3 Rename

`--name` is taken at first `daemon up`; subsequent runs read the keypair file
and ignore `--name` unless `--rename` is passed (which produces a
`member_renamed` event the broker propagates to peers).

## 3. IPC surface — stable core only in v0.9.0

### 3.1 Frozen core surface (v0.9.0)

Codex's feedback: do not ship every CLI verb on day one. A small hardened core
first, expand under explicit capability gates.

```
# Messaging — durable, tested
POST   /v1/send              {to, message, priority?, meta?, replyToId?}
POST   /v1/topic/post        {topic, message, priority?, mentions?}
POST   /v1/topic/subscribe   {topic}                            (idempotent)
POST   /v1/topic/unsubscribe {topic}
GET    /v1/topic/list
GET    /v1/inbox             ?since=<iso>&topic=<n>&from=<peer>&limit=<n>
GET    /v1/inbox/search      ?q=<fts-query>&limit=<n>           (FTS5)

# Peers + presence — read-only on day one
GET    /v1/peers             ?mesh=<slug>
POST   /v1/profile           {summary?, status?, visible?}      (limited fields)

# Files — already production in CLI
POST   /v1/file/share        {path, to?, message?, persistent?}
GET    /v1/file/get          ?id=<fileId>&out=<path>
GET    /v1/file/list

# Events — push
GET    /v1/events            text/event-stream
       core events: message, peer_join, peer_leave, file_shared,
                    daemon_disconnect, daemon_reconnect, hook_executed

# Control plane
GET    /v1/health            {connected, lag_ms, queue_depth, inflight,
                              mesh, member_pubkey, uptime_s, schema_version,
                              daemon_version, broker_version}
GET    /v1/metrics           Prometheus exposition
GET    /v1/version           {daemon, schema, ipc_api}            (negotiation)
POST   /v1/heartbeat         {} (caller-side liveness signal)
```

That's it. ~20 endpoints. Battle-test these before adding more.

### 3.2 Capability-gated future surface (v0.9.x roadmap)

Behind explicit feature flags in `config.toml`, post-v0.9.0:

```toml
[capabilities]
state = false        # /v1/state/{set,get,list}
memory = false       # /v1/memory/{remember,recall}
vector = false       # /v1/vector/{store,search,delete}
graph = false        # /v1/graph/query
tasks = false        # /v1/task/{create,claim,complete}
scheduling = false   # /v1/scheduling/remind
mcp_host = false     # /v1/mcp/{register,call} (LARGEST surface; treat as v1.0)
skill_share = false  # /v1/skill/{deploy,share}
```

Each capability is its own ship: design review, security review, test
coverage, capability-token model, then enable. None enabled in v0.9.0.

### 3.3 Local IPC authentication

Codex was right: loopback TCP without auth is an attack surface (browser SSRF,
container side-channels, sandboxed apps with network but no FS access, WSL
host-shared loopback).

| Transport | Auth | Rationale |
|---|---|---|
| UDS | None (relies on FS perms 0600) | Reaching the socket = same UID = can read keypair anyway |
| TCP loopback | **Required**: `Authorization: Bearer <local_token>` | Browser/container/sandbox can reach loopback without FS access |
| SSE | Required: `Authorization: Bearer <local_token>` | Same |

`local_token` is 32 bytes of `crypto.randomBytes` (~256 bits), encoded base64url,
written to `local_token` mode 0600 at daemon init. Rotated on `claudemesh
daemon rotate-token`. SDKs auto-discover the token by reading the file (same
mechanism as discovering the socket path).

**Additional defenses:**
- HTTP listener binds **127.0.0.1 only**. Refuses to bind elsewhere unless
  `[ipc] http_bind = "..."` is set explicitly **and** `[ipc] http_external_auth = "..."`
  points to a separate token file (escape hatch for advanced users; never the default).
- `Origin` header check: rejects requests with `Origin` set unless it's
  explicitly allowlisted in config (default: empty allowlist). Defends against
  browser SSRF.
- `Host` header check: must be `localhost` or `127.0.0.1`. Defends against DNS
  rebinding.
- CORS: `Access-Control-Allow-Origin` never echoed; preflight returns `403`.
- `User-Agent` required (rejects empty UA — mild signal against simple SSRF).

### 3.4 Request limits + backpressure

- Max request body: **1 MB** (override per endpoint; file uploads use a separate
  streaming endpoint).
- Max response body: **10 MB**; truncated with `Link: rel=next` cursor.
- Max in-flight IPC requests: **64**. Beyond → `429 daemon_busy`.
- Max SSE concurrent streams: **32**. Beyond → `429 too_many_streams`.
- Per-token rate limit: **100 req/sec** sustained, 1000/sec burst (token
  bucket). Tunable.

## 4. Delivery contract — durable at-least-once with idempotent send

Codex was right: "exactly-once" is a lie. Replacing the claim with a precise
contract.

### 4.1 The contract

> **The daemon guarantees: each successful send call enqueues exactly one row
> to the broker eventually, identified by a stable `messageId`. The daemon
> does not guarantee that downstream peers process the message exactly once —
> that is the receiver's responsibility, aided by the propagated
> `idempotency_key`.**

Concretely:

- **Caller → daemon**: caller may supply `Idempotency-Key`; daemon dedupes
  identical keys for 24h. Without one, daemon mints `ulid` and returns it as
  `messageId`.
- **Daemon → broker**: each outbox row has at-most-one inflight transmit.
  Daemon retries with exponential backoff until broker ACKs OR row hits TTL
  (7d default → moves to `dead`).
- **Broker → peer**: existing claudemesh delivery semantics. Broker dedupes by
  `messageId`. Peer receives ≥1 copy.
- **Peer hooks**: hooks see `idempotency_key` in the event JSON. Idempotent
  hook implementations are the receiver's responsibility.

### 4.2 Outbox row state machine

```
                ┌────────────┐
   send call →  │  pending   │
                └─────┬──────┘
                      │ daemon picks up batch
                      ▼
                ┌────────────┐
                │  inflight  │  ← attempts++, last_error written
                └─┬────┬─────┘
                  │    │ broker NACK / network err
       broker ACK │    └──────────► back to pending (with exp. backoff)
                  ▼
                ┌────────────┐
                │    done    │  ← delivered_at set, broker_message_id stored
                └────────────┘

   age > max_age_hours:
                ┌────────────┐
                │    dead    │  ← surfaces in `daemon outbox --failed`
                └────────────┘
```

### 4.3 Crash recovery

On daemon startup:

1. Any rows in `inflight` are reset to `pending` with `attempts++` and
   `next_attempt_at = now + min_backoff`. Note: this MAY cause double-delivery
   of a message that was actually ACK'd by the broker but the ACK didn't
   persist locally before crash. The `idempotency_key` propagates to broker
   (via message `meta`) so the broker dedupes by key.
2. `outbox.db` integrity check (`PRAGMA integrity_check`); if fails, daemon
   refuses to start, points user at `claudemesh daemon recover`.
3. `inbox.db` integrity check; on failure, drops to `inbox.db.corrupt-<ts>`,
   creates fresh empty inbox, logs `inbox_corruption_recovered` (does not
   block startup — inbox is a cache).

### 4.4 Disk-full

- At 80% of `outbox.max_queue_size` or 80% of `[disk] reserved_bytes`: daemon
  emits `outbox_pressure_high` event + Prometheus gauge. Sends still accept.
- At 95%: new sends return `507 insufficient_storage`. Existing inflight
  drains.
- At 100%: daemon enters degraded mode — refuses sends, refuses new SSE
  streams, holds open WS for inbound only. `daemon status` shows degraded.
- Recovery: drain via broker reconnect (drains `done` rows older than
  retention window) or `claudemesh daemon outbox prune --confirm`.

### 4.5 Schema migration

`schema_version` file holds an integer. On startup:
1. If `schema_version` matches binary's expected version → continue.
2. If version is older → run `apps/cli/src/daemon/migrations/<from>-<to>.sql`
   in a transaction, write new version on success.
3. If version is newer (downgrade) → daemon refuses to start, error points at
   re-installing matching version.

Migrations are forward-only. Each migration is ≤ 1 transaction. Test coverage
required: every migration has a snapshot test from prior schema.

## 5. Inbound — durable history with FTS

Every inbound message is written to `inbox.db` before any hook fires:

```sql
CREATE VIRTUAL TABLE inbox USING fts5(
  message_id UNINDEXED, mesh UNINDEXED, topic, sender_pubkey UNINDEXED,
  sender_name, body, meta, idempotency_key UNINDEXED,
  received_at UNINDEXED, replied_to_id UNINDEXED
);
CREATE INDEX inbox_received_at ON inbox(received_at);
CREATE INDEX inbox_idem ON inbox(idempotency_key);
```

- **Receiver-side dedupe**: on insert, `INSERT OR IGNORE` on `idempotency_key`.
  Duplicate broker delivery becomes a no-op locally + `cm_daemon_dedupe_total`
  counter increments.
- 30-day rolling retention (configurable). `VACUUM` weekly during low-traffic
  window.
- `claudemesh daemon search "OOM"` queries the FTS index.
- Apps connecting mid-stream replay history via `?since=<iso>`.

## 6. Hooks — first-class but tightly bounded

Codex was right: hooks were underspecified, and putting `CLAUDEMESH_TOKEN` in
every hook env was a serious exfil footgun.

### 6.1 Hook directory & contract

```
hooks/
  on-message.sh         every inbound message (DM + topic)
  on-dm.sh              DMs only
  on-mention.sh         when @<my-name> appears anywhere
  on-topic-<name>.sh    a specific topic
  on-file-share.sh      file shared with me
  on-disconnect.sh      WS dropped
  on-reconnect.sh       reconnected
  on-startup.sh         daemon up
  pre-send.sh           filter / mutate outbound (last gate)
  hooks.toml            per-hook policy (auth, redaction, env, timeout)
```

`hooks.toml` (mandatory; daemon refuses to invoke hooks without it):

```toml
[on-mention]
enabled = true
timeout_s = 30
output_size_limit = 65536
redact_payload = ["body.password", "meta.api_key"]   # JSONPath
allow_reply = true                                    # if false, stdout reply ignored
capability_token_scope = ["topic:alerts:post"]        # scoped, NOT broker session token
network_policy = "deny"                               # 'deny' | 'allow' | 'allowlist'
network_allowlist = []                                # only if policy = 'allowlist'
fs_policy = "readonly"                                # 'readonly' | 'rw' | 'sandbox'
killpg_on_timeout = true                              # SIGTERM process group, not just child
audit = true                                          # log every invocation
```

### 6.2 Credentials passed to hooks

**Default: nothing.** No `CLAUDEMESH_TOKEN`, no broker session, nothing that
lets the hook impersonate the daemon's identity broadly.

**Opt-in per hook**: `capability_token_scope = ["topic:alerts:post"]` mints a
**short-lived (5 min) capability token** scoped to exactly that capability.
The hook can use it to call back into the daemon's IPC ("post a reply to
#alerts") but cannot use it to read state, read inbox, deploy MCP, etc. Token
expires when hook process exits OR after 5 min, whichever first.

Capability tokens are local-only — they authorize against the daemon's IPC
surface, never the broker directly. Daemon translates capability calls into
broker calls.

Env variables the hook DOES get:
- `CLAUDEMESH_MESH=<slug>`
- `CLAUDEMESH_HOOK_NAME=on-mention`
- `CLAUDEMESH_EVENT_ID=<ulid>`
- `CLAUDEMESH_CAPABILITY_TOKEN=<token>` (only if scope was configured; else absent)
- `CLAUDEMESH_DAEMON_SOCK=<path>` (so SDKs can connect for capability calls)
- `PATH=/usr/bin:/bin` (locked down)

### 6.3 Payload redaction

Hook stdin receives event JSON minus paths listed in `redact_payload`. Default
redaction: nothing. Mesh owner / daemon admin opts in.

### 6.4 Timeout & cleanup

- Per-hook `timeout_s` (default 30s). On timeout, daemon sends SIGTERM to the
  hook's process group (`killpg_on_timeout=true`), waits 5s, then SIGKILL.
  Catches forked grandchildren that were trying to keep things alive.
- Hook stdout/stderr captured, truncated at `output_size_limit`. Larger
  outputs log a warning and discard the overflow.

### 6.5 Audit log

Every hook invocation logs:
```json
{"hook":"on-mention","event_id":"01H8…","exit":0,"duration_ms":47,
 "stdout_bytes":120,"stderr_bytes":0,"replied":true,"capability_calls":1,
 "ts":"2026-05-03T14:00:00Z"}
```

Stored in `daemon.log`; metrics exposed via `cm_daemon_hook_*`.

### 6.6 Sandboxing — supported, not required

The contract supports sandboxing without mandating it (mandating breaks too
many real workflows):

- Linux: opt-in `sandbox = "bubblewrap"` in `hooks.toml` runs the hook under
  `bwrap` with no network (unless `network_policy != "deny"`), readonly FS
  except `/tmp/<hook-id>`, no DBus, no /proc.
- macOS: opt-in `sandbox = "sandbox-exec"` with similar profile.
- Default: no sandbox; rely on Unix permissions + `network_policy=deny` (which
  is enforced via `unshare --net` on Linux when available, otherwise
  best-effort firewall rule).

## 7. Multi-mesh — daemon-per-mesh, supervised by a thin shell

### 7.1 The decision

One daemon per mesh, coordinated by a supervisor script. Codex pushed back —
"why not one daemon serving all meshes?". Going daemon-per-mesh because:

- **Crash isolation**: a panic in `prod` mesh's WS reader can't corrupt
  `dev` mesh's outbox.
- **Resource accounting**: per-mesh RSS, per-mesh metrics, per-mesh disk
  budget — easy to attribute, easy to cap.
- **Independent identity**: each mesh has its own keypair, host fingerprint,
  capability gates. Conflating into one process forces shared trust.
- **Independent upgrades**: rolling daemon restarts per mesh, no downtime
  across all meshes.
- **Simpler code**: zero cross-mesh routing logic in the daemon body.

The cost (process count, log fan-out) is real but bounded: typical user has
1–3 meshes. Heavy users (10–20) get a `claudemesh daemon ps` + `--all` UX that
treats them as a fleet.

### 7.2 Resource caps for fleet hosts

`config.toml` has `[fleet]` section read by `daemon up --all`:

```toml
[fleet]
max_daemons = 10
total_memory_budget = "2GB"     # divided across daemons; each gets budget/N RSS cap
total_disk_budget = "20GB"      # divided across outbox + inbox per daemon
```

If a user hits `max_daemons`, `daemon up <next>` errors with a clear message
pointing at the cap.

### 7.3 Commands

```
claudemesh daemon up        --mesh <slug>     # one mesh
claudemesh daemon up --all                    # all joined meshes (respects fleet caps)
claudemesh daemon down      --mesh <slug>
claudemesh daemon down --all
claudemesh daemon status                      # all daemons, table view
claudemesh daemon status --json               # machine-readable
claudemesh daemon ps                          # alias of status
claudemesh daemon logs --mesh <slug> [-f]
claudemesh daemon restart --mesh <slug>
```

## 8. Auto-routing — clarified, not transparent

Codex pushed back: "no behavior difference" was hand-waving. Persistent
identity, queueing, hooks, profile state — these legitimately change behavior.

### 8.1 What changes when a daemon is up

| Behavior | Cold-path CLI | Daemon-routed CLI |
|---|---|---|
| Sender attribution | Ephemeral session pubkey for that invocation | Daemon's persistent member pubkey |
| Latency | ~1s (fresh WS handshake) | <10ms (local UDS round-trip) |
| Send durability | None — if broker is unreachable, command fails | Outbox queue retries until TTL |
| Inbound visibility | Not available (cold path closes WS) | `claudemesh inbox` reads daemon's inbox.db |
| Hooks | Not invoked | Invoked on every event |
| Presence | Brief flicker as session connects+disconnects | Continuous; daemon's status reflected |
| `peer list` shows me as | A new ephemeral session each invocation | The daemon's persistent member |

### 8.2 Detection logic — connect, don't trust pidfile

```
1. Check ~/.claudemesh/daemon/<slug>/sock exists.
2. attempt UDS connect with 100ms timeout.
3. If connect succeeds: send GET /v1/version.
4. If response is well-formed AND mesh matches AND daemon_version is
   compatible → use this daemon.
5. Otherwise → cold path.
```

PID liveness check is unreliable (PID reuse, process orphaned). Socket
handshake is canonical.

### 8.3 Coexistence with `claudemesh launch`

Both can be running for the same mesh:
- Daemon connected as persistent member `runpod-worker-3`.
- A separate `claudemesh launch` connects as ephemeral session of the same
  member. Visible to peers as "another session of runpod-worker-3"
  (sibling-session relationship via `memberPubkey`).
- CLI verbs from inside `claudemesh launch` route through the launch session,
  NOT the daemon (preserves "this Claude Code session has its own ephemeral
  identity" semantics).
- CLI verbs from a separate shell route through the daemon (faster, durable).

This is consistent with the v0.5.1 self-DM guard and sibling-session
semantics already shipped.

## 9. Service installation

```bash
claudemesh daemon install-service                 # writes systemd unit / launchd plist / Windows SC
claudemesh daemon uninstall-service
claudemesh daemon install-service --user          # user-scope unit (default; no root)
claudemesh daemon install-service --system        # system-scope unit (root; multi-user host)
```

Unit defaults:
- `Restart=on-failure`, `RestartSec=5s`, `StartLimitBurst=5/5min`
- `MemoryMax=<resource cap>`, `TasksMax=128`, `LimitNOFILE=4096`
- `StandardOutput/Error=journal`
- `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectSystem=strict`,
  `ProtectHome=read-only` with `ReadWritePaths=~/.claudemesh`
- For systemd `--user`, runs as the invoking user (no root needed).

`claudemesh install` (the existing setup verb) gains an opt-in prompt:
*"Install as a background service that always runs?"* Defaults differently
based on detected environment (TTY vs no-TTY, presence of systemd, etc.).

## 10. Observability

Standard CLI surface unchanged from v1, with the new gauges/counters:

```
cm_daemon_connected{mesh}                  0/1
cm_daemon_reconnects_total{mesh,reason}
cm_daemon_lag_ms{mesh}                     last broker round-trip
cm_daemon_outbox_depth{mesh,status}        pending|inflight|dead
cm_daemon_outbox_age_seconds{mesh}         oldest pending row
cm_daemon_dedupe_total{mesh,direction}     out|in
cm_daemon_disk_pct{mesh,kind}              outbox|inbox
cm_daemon_send_total{mesh,kind,status}
cm_daemon_recv_total{mesh,kind,from_type}
cm_daemon_hook_invocations_total{hook,exit}
cm_daemon_hook_duration_seconds{hook}      histogram
cm_daemon_hook_capability_calls_total{hook,scope}
cm_daemon_ipc_request_total{endpoint,status,transport}
cm_daemon_ipc_duration_seconds{endpoint}   histogram
cm_daemon_local_token_rotations_total
cm_daemon_clone_suspected_total
```

Tracing: optional OpenTelemetry export.

## 11. SDKs — three, slim, core-API only

Same shape as v1 but only target the **frozen core surface** (§3.1). State /
memory / vector / graph / tasks / MCP / skills are NOT in v0.9.0 SDKs — they
ship per capability gate.

Each SDK auto-discovers the daemon: reads `sock` path, `http.port`,
`local_token`. SDKs versioned in lockstep with the daemon's `/v1` surface.

## 12. Security model — explicit boundaries

| Boundary | Trust | Mechanism |
|---|---|---|
| App ↔ Daemon (UDS) | OS user, FS perms | UDS 0600 |
| App ↔ Daemon (TCP/SSE) | OS user + bearer token | 127.0.0.1 only + `local_token` + Origin/Host check |
| Hook ↔ Daemon | Capability scope | Short-lived capability token, never broker session |
| Daemon ↔ Broker | Mesh keypair | WSS + ed25519 hello + crypto_box DM + per-topic keys |
| Daemon ↔ Disk | OS user | All daemon files mode 0600/0644 under `~/.claudemesh/daemon/` |
| Cloned identity | Host fingerprint check | Daemon refuses to start; dashboard audit event |

## 13. Configuration

`config.toml` — same shape as v1 plus:
- `[capabilities]` (§3.2)
- `[fleet]` (§7.2)
- `[disk] reserved_bytes` (§4.4)
- `[clone] policy = "refuse" | "warn" | "allow"` (§2.2)

User-editable. `claudemesh daemon reload` re-reads it without dropping the WS.

## 14. Lifecycle — the operational flows v1 was missing

### 14.1 Key rotation

```
claudemesh daemon rotate-keypair
```

Mints fresh ed25519 + x25519. Registers new pubkey with broker as a `member_keypair_rotated` operation (broker associates new pubkey with same member id). Old pubkey is held server-side for 24h grace (decrypts in-flight messages encrypted to old pubkey), then revoked.

### 14.2 Local token rotation

```
claudemesh daemon rotate-token
```

Atomically writes a new `local_token`, returns the old one alongside the new
one for 60s grace. SDKs that already have the old token finish in-flight
requests; new requests use the new token. After 60s, old token is rejected.

### 14.3 Compromised host revocation

From the dashboard or another mesh-owner session:

```
claudemesh member revoke <pubkey>
```

Broker marks member as revoked. Connected daemon receives `member_revoked`
push, self-disables (refuses new IPC, closes WS), exits with non-zero status,
logs forensic event.

### 14.4 Image-clone lifecycle

Covered in §2.2. Three policies (`refuse`, `warn`, `allow` — settable per-host
via `config.toml`).

### 14.5 Backup & restore

```
claudemesh daemon backup --out <path>          # dumps keypair, config, schema_version
claudemesh daemon restore --in <path>          # writes them; refuses if a daemon is running
```

Backup is encrypted with a passphrase (Argon2id KDF + crypto_secretbox). The
intent: "I'm reformatting my laptop, I want my mesh memberships back without
re-joining." NOT for "deploy this same identity on 10 servers" (that's the
clone problem above).

### 14.6 Uninstall / reset

```
claudemesh daemon uninstall                  # full purge: stops, deregisters from broker, wipes ~/.claudemesh/daemon/<slug>
claudemesh daemon reset                      # wipes local state, keeps broker member registration (for restoring)
```

Uninstall calls broker's `POST /v1/me/members/:pubkey/leave` so member doesn't
linger as ghost. Reset is local-only, no broker contact.

### 14.7 Disk corruption recovery

```
claudemesh daemon recover                    # interactive: integrity check + offer rebuild paths
```

Detects corrupt `outbox.db` / `inbox.db`. Options:
- Restore from local journal-only inbox (read-only mode; sends disabled).
- Wipe + rebuild from broker (fetches last N days of message history if
  available; topics need re-subscribe; outbox is irrecoverable, queued sends are
  lost).
- Wipe + start fresh.

## 15. Version compatibility

### 15.1 Negotiation handshake

On daemon connect to broker AND on every IPC request:

```
GET /v1/version
{
  "daemon_version": "0.9.0",
  "ipc_api": "v1",
  "ipc_minor": 3,                  # additive minor
  "schema_version": 7,
  "broker_protocol_min": "0.7",
  "broker_protocol_max": "0.9"
}
```

### 15.2 Compat policy

| Across | Policy |
|---|---|
| Daemon ↔ Broker | Daemon refuses to connect if broker version < daemon's `broker_protocol_min`. Broker logs warning. Pre-1.0 we may break this with notice; post-1.0 we maintain backward compat for ≥6 months. |
| CLI ↔ Daemon | CLI checks daemon's `ipc_api`. Same major = OK. Different major = CLI falls back to cold-path with warning. |
| SDK ↔ Daemon | SDK negotiates `ipc_minor`; uses minimum of (SDK's, daemon's). |
| Daemon binary ↔ schema | Binary refuses to start on unknown schema; migrations run forward-only; no automatic downgrade. |

### 15.3 Compatibility matrix (published in docs, machine-readable JSON at /v1/compat)

```json
{
  "daemon": "0.9.0",
  "compatible_brokers": ["0.7.x", "0.8.x", "0.9.x"],
  "compatible_clis": ["0.9.x"],
  "compatible_sdks": {
    "python": ">=0.9.0,<1.0.0",
    "go":     ">=0.9.0,<1.0.0",
    "ts":     ">=0.9.0,<1.0.0"
  }
}
```

## 16. Threat model

### 16.1 Attacker classes

| Attacker | Has | Wants | Mitigations |
|---|---|---|---|
| Local same-user shell | OS user creds | Send / read mesh messages | None needed — they already have FS access to keypair; daemon is no worse |
| Local different-user shell | Different OS user | Read this user's daemon | UDS 0600 + TCP loopback + token. Requires OS exploit to escalate |
| Browser SSRF | Loopback HTTP | Send messages, read inbox | `local_token` + Origin/Host check + non-default port. SSRF without token cannot succeed |
| Container side-channel | Same loopback namespace | Read another container's daemon | Containers share host loopback only if explicitly net=host. `local_token` defends. Recommended: bind UDS only inside containers |
| Compromised hook | Capability token in env | Use that scope | Capability tokens are scoped + short-lived; cannot escalate |
| Compromised broker | Full mesh visibility on its side | Deliver malicious messages, identity-impersonate | E2E encryption (crypto_box DMs, per-topic keys) — broker can't read content. Out-of-scope for daemon |
| Cloned VM image | Same keypair on two hosts | Identity collision | Host fingerprint detection + dashboard audit + `--remint` flow |
| Stolen laptop | Disk access | Mesh impersonation forever | `member revoke` from dashboard. Without disk encryption, this is the user's laptop security; documented in security guide |
| Untrusted hook author | Hook script content | Exfil mesh data | Hook is on disk YOU control. If you ran `git pull` on a malicious hooks/ repo, that's a code-supply-chain attack out of scope for the daemon |

### 16.2 Out of scope

- Defending against an attacker with root on the daemon host. They can read
  `keypair.json` directly.
- Defending against malicious peers in the same mesh sending malformed
  payloads. Daemon validates structure but trusts mesh members.
- Defending against compromised broker. Out-of-scope for daemon; mesh-level
  E2E protects content but not metadata.

## 17. Migration — what changes for existing users

Same as v1. Additive. No DB migration on broker. Existing
`~/.claudemesh/config.json` consumed unchanged. `claudemesh launch` keeps
working; daemon is opt-in.

---

## What needs review (round 2)

Round 1 produced: identity model needs `--ephemeral` + clone-detect, IPC needs
local token, "exactly-once" was a lie, hooks needed scoped credentials, surface
needed shrinking, missing rotation/recovery/migration/threat-model.

This v2 attempts to address all of them. Specifically critique:

1. **Has the identity model fully closed the clone problem?** Refuses-on-fingerprint-mismatch
   plus broker audit plus mesh-owner revoke — does this catch a sophisticated
   attacker who copies `host_fingerprint.json` along with the keypair?
2. **Is the local-token model sufficient for browser-SSRF defense?**
   Token + Origin + Host checks + 127.0.0.1-only. Anything else needed?
3. **The delivery contract** (§4) — is it now defensible? Does the inflight-recovery
   semantics + idempotency-key propagation produce the guarantees claimed?
4. **Hook capability tokens** (§6.2) — short-lived, scoped, expire on hook exit.
   Does this fully eliminate the exfil footgun? What capability scopes are
   actually needed for v0.9.0 hooks?
5. **Frozen v0.9.0 surface** (§3.1) — is the cut right? Should `peer list` be
   in core or capability-gated? Should `inbox/search` ship in v0.9.0?
6. **Threat model** (§16) — anything missing? Specifically thinking about CI
   environments where the daemon's host is a fleet shared across many users'
   builds.
7. **Lifecycle flows** (§14) — image clones, key rotation, host moves, disk
   corruption, uninstall semantics. Anything still missing?
8. **Version compat** (§15) — is the negotiation handshake sufficient, or do
   we need stronger guarantees (e.g. semver-strict, or a feature-bit
   negotiation rather than version numbers)?

Score 1–5 each. Top 3 changes you'd insist on for v3, if any. If you think v2
is shippable, say so explicitly — over-engineering is a real risk.
