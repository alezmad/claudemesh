# `claudemesh daemon` — Final Spec

> Context for the reviewer: claudemesh is a peer mesh runtime for Claude Code
> sessions. Existing infrastructure: a managed broker (`wss://ic.claudemesh.com/ws`,
> Bun + Drizzle + Postgres) that handles routing, presence, topics, files,
> per-mesh apikeys, etc. There is also a CLI (`claudemesh-cli`, npm) and a web
> dashboard. Each session today is short-lived: `claudemesh launch` opens a WS,
> stays up while Claude Code is running, then closes. Server-side
> integrations (RunPod handlers, Temporal workers, CI jobs) currently have no
> first-class way to participate in a mesh — they'd either curl an apikey-auth
> REST endpoint (one-way) or shell out to the CLI cold-path (slow, no inbound).
>
> This spec proposes a `claudemesh daemon` mode that turns any host (laptop,
> server, RunPod pod) into a persistent, addressable peer with a local IPC
> surface that apps can talk to without dealing with the broker directly.
>
> The user has explicitly said: pre-launch, no users yet, optimize for the
> right architecture not the smallest first cut. They want the FINAL spec, not
> phased MVPs.

---

## 1. Process model

**One daemon per (user, mesh)**. Persistent. Survives reboots via OS supervisor (systemd / launchd / SCM). Serves multiple local apps concurrently.

```
~/.claudemesh/daemon/<mesh-slug>/
  pid                       0600    pidfile, cleaned on shutdown
  sock                      0600    unix domain socket (primary IPC)
  http.port                 0644    auto-allocated loopback port (Windows / Docker fallback)
  keypair.json              0600    persistent ed25519 + x25519 — daemon identity
  config.toml               0644    user-editable runtime tuning
  outbox.db                 0600    SQLite — durable outbound queue + dedupe ledger
  inbox.db                  0600    SQLite — 30-day inbound history, FTS-indexed
  daemon.log                0644    JSON-lines, rotating (100 MB / 14 d)
  hooks/                    0700    user-managed event scripts
```

Single binary. No external runtime beyond the existing CLI dependencies. The daemon *is* the CLI in long-running mode — `claudemesh daemon up` is a flag on the same binary.

## 2. Identity — persistent member, not ephemeral session

The daemon mints a stable ed25519 + x25519 keypair on first startup, stored in `keypair.json`. Registers with the broker as a **persistent member** — same identity across restarts, reconnects, host migrations. `runpod-worker-3` is `runpod-worker-3` forever, until you `claudemesh daemon reset` or revoke the keypair.

`--name` is taken at first `daemon up`; subsequent runs read the keypair file and ignore `--name` unless `--rename` is passed (which produces a `member_renamed` event the broker propagates to peers).

This is the default. It's the right thing for servers. There is no `--ephemeral` mode.

## 3. IPC surface — single versioned API, three transports

**Transports**, all serving identical JSON:
- **UDS** at `~/.claudemesh/daemon/<slug>/sock` (primary, default)
- **TCP loopback** on auto-allocated port written to `http.port` (Docker / Windows clients)
- **Server-Sent Events** stream at `GET /v1/events` for push (real-time inbound)

**No auth on local IPC.** Trust boundary is the OS — UDS is mode 0600, TCP listens on 127.0.0.1 only. If you can reach the socket, you're already running as the right user; the daemon's `keypair.json` is also reachable, so adding a token would be theatre.

**Endpoint surface — exactly mirrors CLI verbs:**

```
# messaging
POST   /v1/send                     {to, message, priority?, meta?, replyToId?}
POST   /v1/topic/post               {topic, message, priority?, mentions?}
POST   /v1/topic/subscribe          {topic}
GET    /v1/topic/list
GET    /v1/inbox                    ?since=<iso>&topic=<n>&from=<peer>&limit=<n>
POST   /v1/broadcast                {message, scope: "*"|"@group"|...}

# peers + presence
GET    /v1/peers                    ?mesh=<slug>
POST   /v1/profile                  {summary?, status?, visible?, avatar?, ...}
POST   /v1/groups/join              {name, role?}
POST   /v1/groups/leave             {name}

# state, memory, vector, graph — full mesh-services platform
POST   /v1/state/set                {key, value, scope?: "mesh"|"member"}
GET    /v1/state/get                ?key=...
GET    /v1/state/list
POST   /v1/memory/remember          {content, tags?}
GET    /v1/memory/recall            ?q=<query>
POST   /v1/vector/store             {collection, text, metadata?}
GET    /v1/vector/search            ?collection=<c>&q=<query>&limit=<n>
POST   /v1/graph/query              {cypher, params?}

# files
POST   /v1/file/share               {path, to?, message?, persistent?}
GET    /v1/file/get                 ?id=<fileId>&out=<path>
GET    /v1/file/list

# tasks + scheduling
POST   /v1/task/create              {title, assignee?, priority?, tags?}
POST   /v1/task/claim               {id}
POST   /v1/task/complete            {id, result?}
POST   /v1/scheduling/remind        {at|in|cron, message, to?}

# skills + MCP services (full peer participation)
POST   /v1/skill/deploy             {path}
POST   /v1/skill/share              {name, manifest}
POST   /v1/mcp/register             {server_name, description, tools, transport}
POST   /v1/mcp/call                 {server, tool, args}

# events (push)
GET    /v1/events                   text/event-stream
       events: message, peer_join, peer_leave, file_shared, task_assigned,
               state_changed, mcp_deployed, skill_shared, hook_executed,
               disconnect, reconnect

# control plane
GET    /v1/health                   {connected, lag_ms, queue_depth, mesh, member_pubkey, uptime_s}
GET    /v1/metrics                  Prometheus exposition
POST   /v1/heartbeat                {} (caller asserts it's alive — daemon may set status="working")
```

Every CLI verb the platform offers has a daemon endpoint. No second-class features. Apps written against the daemon get the same surface as Claude Code itself.

## 4. Outbound — exactly-once via SQLite + idempotency keys

Sends route through `outbox.db` first, then to the broker. Schema:

```sql
CREATE TABLE outbox (
  id              TEXT PRIMARY KEY,         -- ulid
  idempotency_key TEXT UNIQUE,              -- caller-provided or autogen
  payload         BLOB NOT NULL,            -- serialized envelope
  enqueued_at     INTEGER NOT NULL,
  attempts        INTEGER DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  status          TEXT CHECK(status IN ('pending','inflight','done','dead')),
  last_error      TEXT,
  delivered_at    INTEGER
);
CREATE INDEX outbox_pending ON outbox(status, next_attempt_at);
```

- WAL mode, `synchronous=NORMAL` — durable enough, ~10k inserts/sec.
- Caller-supplied `Idempotency-Key` header dedupes retries (24h window).
- Exponential backoff with jitter; 7-day max retention; `dead` rows surface in `claudemesh daemon outbox --failed`.
- `delivered_at` set when broker ACKs the queue row, not when daemon sends — gives true at-least-once with explicit dedupe → effectively exactly-once.

## 5. Inbound — durable history with FTS

Every inbound message is written to `inbox.db` before any hook fires:

```sql
CREATE VIRTUAL TABLE inbox USING fts5(
  message_id UNINDEXED, mesh UNINDEXED, topic, sender_pubkey UNINDEXED,
  sender_name, body, meta, received_at UNINDEXED, replied_to_id UNINDEXED
);
```

- 30-day rolling retention (configurable).
- `claudemesh daemon search "OOM"` queries the FTS index (instant, offline-capable).
- Apps that connect mid-stream replay history via `?since=<iso>`.
- Exposed in metrics: `cm_daemon_inbox_rows`, `cm_daemon_inbox_bytes`.

## 6. Hooks — first-class scripted reactions

Hooks turn the daemon from a passive relay into an autonomous peer. Files in `hooks/`:

```
hooks/
  on-message.sh         every inbound message (DM + topic)
  on-dm.sh              DMs only
  on-mention.sh         when @<my-name> appears anywhere
  on-topic-<name>.sh    a specific topic (e.g. on-topic-alerts.sh)
  on-file-share.sh      file shared with me
  on-task-assigned.sh   task assigned to me
  on-disconnect.sh      WS dropped (informational)
  on-reconnect.sh       reconnected (informational)
  on-startup.sh         daemon up
  pre-send.sh           filter / mutate outbound (last gate)
```

**Contract:**
- Stdin: full event JSON.
- Stdout (if non-empty, JSON object): used as a structured response. For inbound messages, `{reply: "..."}` posts a reply automatically.
- Exit 0 = success; non-zero logs + counts but does not retry.
- Timeout: 30s default, override via `# claudemesh:timeout=120s` shebang comment.
- Env: `PATH=/usr/bin:/bin`, `CLAUDEMESH_MESH=<slug>`, `CLAUDEMESH_MEMBER=<pubkey>`, `CLAUDEMESH_HOME=<config-dir>`, plus the daemon's own broker session token in `CLAUDEMESH_TOKEN` so the script can call `claudemesh send` without re-authenticating.
- Concurrent execution: bounded pool (default 8) — overflow queues, never blocks the WS reader.

This makes a server a real participant: it auto-replies to "@worker-3 status?", auto-acks file shares, auto-claims tasks, escalates errors to oncall — all configured by dropping shell scripts in a directory.

## 7. Multi-mesh — one daemon per mesh, coordinated by a supervisor

Multi-mesh handled by **one daemon per mesh** (no shared state, no cross-mesh leakage). Coordinated by:

```
claudemesh daemon up --all              # spawns one daemon per joined mesh
claudemesh daemon down --all
claudemesh daemon status --all          # JSON table of every daemon
claudemesh daemon ps                    # alias of status
```

CLI verbs without `--mesh` continue to do their existing aggregator routing (`/v1/me/...`) and additionally each daemon contributes inbound state to the aggregator.

## 8. Auto-routing — every CLI verb prefers the daemon

The CLI's `withMesh` helper is replaced by `viaDaemonOrMesh`:

1. Read `~/.claudemesh/daemon/<slug>/pid`.
2. If alive → call the daemon's UDS endpoint.
3. Else → cold path (existing `withMesh` flow, opens its own short-lived WS).

Transparent to the user. `claudemesh send X "msg"` from a script becomes a sub-millisecond local UDS call when a daemon is up, instead of a 1-second broker handshake.

## 9. Service installation

```bash
claudemesh daemon install-service       # writes systemd unit / launchd plist / Windows SC
claudemesh daemon uninstall-service
```

Generated unit:
- `Restart=on-failure`, `RestartSec=5s`
- `MemoryMax=512M` (will rarely use this)
- `StandardOutput/Error=journal`
- For systemd, runs as the invoking user (no root needed).

`claudemesh install` (the existing setup verb) gains an opt-in prompt: *"Install as a background service that always runs?"* For interactive users this is opt-in; for `--yes` it defaults to yes on Linux servers (detected by absence of TTY + presence of systemd).

## 10. Observability

```
claudemesh daemon status         human-readable: connected, lag, queue, hooks fired
claudemesh daemon status --json  machine-readable
claudemesh daemon logs [-f]      tail daemon.log
claudemesh daemon outbox         pending sends + dead-letter queue
claudemesh daemon inbox          recent received messages (FTS-searchable)
claudemesh daemon metrics        prints /v1/metrics

# Prometheus counters/gauges:
cm_daemon_connected{mesh}                       0/1
cm_daemon_reconnects_total{mesh,reason}
cm_daemon_lag_ms{mesh}                          last broker round-trip
cm_daemon_outbox_depth{mesh}
cm_daemon_outbox_dead_total{mesh}
cm_daemon_send_total{mesh,kind=topic|dm|broadcast,status}
cm_daemon_recv_total{mesh,kind=topic|dm,from_type=peer|apikey|webhook}
cm_daemon_hook_invocations_total{hook,exit}
cm_daemon_hook_duration_seconds{hook}            histogram
cm_daemon_ipc_request_total{endpoint,status}
cm_daemon_ipc_duration_seconds{endpoint}         histogram
```

Tracing: optional OpenTelemetry export (`config.toml: [otel] endpoint = ...`) — emits spans for every IPC request + downstream broker call.

## 11. SDKs — three, all thin

The daemon's HTTP+UDS surface is the API; SDKs are convenience wrappers, not new surfaces.

**Python** (single file, stdlib only — no `requests`, no `aiohttp`):
```python
from claudemesh import Daemon
cm = Daemon()                       # auto-discovers running daemon for current cwd's mesh
cm.send("@oncall", "OOM detected")
cm.topic.post("alerts", "build done", mentions=["alice"])
for evt in cm.events():             # SSE stream, blocking iterator
    if evt.kind == "message" and "@me" in evt.body:
        cm.send(evt.from_pubkey, "got it, on it")
```

**Go** (single file, stdlib only — no third-party deps):
```go
cm, _ := claudemesh.Connect()
cm.Send(ctx, "@oncall", "OOM detected")
for evt := range cm.Events(ctx) { ... }
```

**TypeScript / Node** (zero runtime deps, ESM only):
```ts
import { Daemon } from "@claudemesh/daemon-client";
const cm = await Daemon.connect();
await cm.send("@oncall", "OOM detected");
for await (const evt of cm.events()) { ... }
```

Each is ~300 lines. All three are versioned in lockstep with the daemon's `/v1` surface. A `/v2` surface (when it eventually exists) keeps `/v1` alive indefinitely — old SDKs never break.

## 12. Security model — explicit boundaries

| Boundary | Trust | Mechanism |
|---|---|---|
| App ↔ Daemon (local) | OS user | UDS 0600, TCP loopback only |
| Daemon ↔ Broker | Mesh keypair | WSS + ed25519 hello sig + crypto_box DM envelopes + per-topic keys (existing model) |
| Hook ↔ Daemon (env) | OS user + filesystem | `hooks/` dir mode 0700; only files there execute; no remote install |
| Daemon ↔ Disk | OS user | All daemon files mode 0600/0644 under `~/.claudemesh/daemon/` |

**No new attack surface introduced by the daemon** — apps that previously could read `~/.claudemesh/config.json` directly already had full mesh access; the daemon just adds an IPC layer on top.

**Hook RCE consideration**: a peer cannot install a hook on your daemon. Hooks are files YOU put on disk. Inbound messages can only trigger hooks that already exist with content you wrote. The broker has no path to your hook directory.

## 13. Configuration — `config.toml`

```toml
[daemon]
mesh = "prod"                           # set on `daemon up --mesh`; immutable thereafter
display_name = "runpod-worker-3"
log_level = "info"

[ipc]
http_port = 0                           # 0 = auto-allocate
http_bind = "127.0.0.1"                 # never 0.0.0.0; explicit if you know what you're doing
uds_mode = "0600"

[outbox]
max_queue_size = 10000
max_age_hours = 168                     # 7 days
fsync_mode = "batched_50ms"             # 'strict' | 'batched_50ms' | 'off'

[inbox]
retention_days = 30
fts_enabled = true

[reconnect]
initial_backoff_ms = 500
max_backoff_ms = 30000
backoff_multiplier = 2.0
jitter_pct = 25

[hooks]
enabled = true
concurrency = 8
default_timeout_s = 30

[metrics]
prometheus_enabled = true
otel_endpoint = ""                      # empty = disabled
```

User-editable. `claudemesh daemon reload` re-reads it without dropping the WS.

## 14. Migration — what changes for existing users

- `claudemesh launch` (Claude Code mode) is unchanged. It can optionally `--via-daemon` to share the WS with a running daemon, but defaults to its own session (preserves "ephemeral session" semantics that Claude Code expects).
- `claudemesh send X "msg"` and every other cold-path verb gets a transparent speedup when a daemon is up. No flag, no opt-in, no behavior difference visible to the user.
- Existing `~/.claudemesh/config.json` is consumed unchanged by the daemon.
- No DB migration. No broker changes. The daemon talks to the existing `/v1` HTTPS + WSS surfaces — broker doesn't even know whether a connection is `claudemesh launch` or `claudemesh daemon`.

---

## What needs review

Please critically review this spec for the v0.9.0 anchor. Specifically I want
your hardest pushback on:

1. **Identity model** — persistent member by default vs ephemeral session. Have I
   missed a case where ephemeral is the right answer for a daemon? Should
   `--ephemeral` exist?
2. **No-auth local IPC** — UDS 0600 + TCP loopback. Is "OS-trust is enough"
   actually safe in shared-tenant Linux (multi-user host, container
   side-channel)? Should there be a per-daemon token even locally?
3. **SQLite outbox/inbox** — single writer, WAL, batched fsync. Is the
   exactly-once-via-idempotency-key claim defensible? What's the failure mode
   I'm glossing over?
4. **Hooks fork-execing scripts** — RCE/data-exfil concerns I'm dismissing too
   easily? Should hooks be sandboxed (seccomp, no network, …)?
5. **Auto-routing CLI verbs through daemon** — does this break composability
   with existing `claudemesh launch`? Race conditions when both are running?
   What about pidfile-stale detection?
6. **One daemon per mesh** — why not one daemon serving all meshes, with mesh
   selection per-request? What does single-daemon actually buy beyond "fewer
   processes"?
7. **The IPC surface duplicates the broker REST surface** — am I solving a
   problem the broker REST + per-mesh apikey already solves, with extra
   complexity for caching + queueing?
8. **What's missing entirely** — auth boundaries, recovery flows, on-disk
   secret rotation, anything else a production daemon shipped with this spec
   would lack?

Score the spec on each axis: 1 = serious flaw, 5 = sound. Then list the
top 3 changes you'd insist on before I write any code. Be ruthless — pre-launch
window means I can break anything.
