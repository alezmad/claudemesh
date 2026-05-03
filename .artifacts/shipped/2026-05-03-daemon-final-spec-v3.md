# `claudemesh daemon` — Final Spec v3

> **Round 3.** v2 of this spec was reviewed by another model and pushed back on
> identity/clone semantics (boot-id false-positives), delivery contract (broker
> must dedupe on client-supplied id — protocol change), CI shared-runner threat
> model, version negotiation (need feature bits, not ranges), key rotation
> crypto, hook scope granularity, inbox schema correctness, and ~7 smaller
> polish items. v3 incorporates all of them.
>
> **The intent §0 from v2 is unchanged and still authoritative — read it
> there.** v3 only revises what changed.

---

## 0. Intent — unchanged, see v2 §0

Pre-launch peer-mesh runtime. Servers/laptops become first-class peers.
Stable identity, persistent WS, local IPC, hooks. Not a webhook gateway, not
a generic broker. We can break anything.

**One claim retracted from v1/v2**: "exactly-once" delivery. Replaced with a
precise contract in §4 below.

---

## 1. Process model — same as v2 §1

Resource caps, file layout, single-binary unchanged.

---

## 2. Identity — accidental-clone detection only, plus broker dedupe

Codex was right: v2's clone detection was both too weak (anyone copying
`host_fingerprint.json` along with `keypair.json` defeats it) and too noisy
(boot-id flips every reboot → false-positives on every legitimate restart).

### 2.1 Modes

```
claudemesh daemon up                       # default: persistent member
claudemesh daemon up --ephemeral           # in-memory keypair, never written
claudemesh daemon up --ephemeral --ttl 2h  # auto-shutdown after duration
```

**CI auto-detection** (NEW): if any of the following env vars are set
(`CI=true`, `GITHUB_ACTIONS`, `GITLAB_CI`, `BUILDKITE`, `CIRCLECI`,
`JENKINS_URL`, `RUNPOD_POD_ID`, `KUBERNETES_SERVICE_HOST`), AND `--persistent`
is not explicitly passed, daemon defaults to `--ephemeral`. Rationale in §16.

### 2.2 Accidental-clone detection (NOT attacker-grade)

Frame change: this catches **image clones, restored backups, copy-pasted
homedirs** — accidents made by humans operating at human speed. It does not
defend against an attacker who copies both `keypair.json` and
`host_fingerprint.json`. The threat model (§16) says this explicitly.

Persisted fingerprint = `sha256(machine-id || first-stable-mac)`. Notably:
- **No boot-id** — that flips on every reboot and would false-positive
  every legitimate restart.
- **No hostname** — laptops legitimately rename themselves.
- **`first-stable-mac`** = MAC of the lexicographically first non-loopback,
  non-virtual interface present at first daemon boot. Frozen at first run;
  not recomputed.

Behavior on mismatch:
- Default policy: refuse to start. Print: *"This keypair was created on a
  different host. If you legitimately moved hardware, run
  `claudemesh daemon accept-host` (writes a fresh fingerprint, keeps keypair).
  If this is a clone of an existing daemon, run `claudemesh daemon remint`
  (mints fresh keypair, registers as a new member)."*
- `[clone] policy = "refuse" | "warn" | "allow"` overrides per host.

### 2.3 Concurrent-duplicate-identity broker policy (NEW — protocol change)

When the broker receives two WS connections claiming the same member pubkey:

- **`prefer_newest`** (default): older connection is closed with code 4003
  `replaced_by_newer_connection`. New connection takes over presence/inbox
  delivery. Daemon-side: receives the close code, logs forensic event, exits
  with non-zero status (lets supervisor restart it; if the *other* host is
  the legitimate one, supervisor restart-loops are noisy enough to alert).
- **`prefer_oldest`**: new connection is rejected with code 4004
  `member_already_connected`. The new daemon refuses to start.
- **`allow_concurrent`** (new mode, server-side feature flag): both
  connections accepted; broker tracks both as sibling sessions of the same
  member (same model as `claudemesh launch` siblings today). Useful when a
  user really does want one keypair on multiple hosts (e.g. failover pairs).

Configured per-mesh in `mesh.cloneConcurrencyPolicy`. Default:
`prefer_newest`. Broker emits `member_concurrent_connection` audit event in
all cases.

### 2.4 Rename, key rotation — see §14

---

## 3. IPC surface — frozen core, hardened auth

### 3.1 Frozen core (v0.9.0) — slight cut from v2

Codex agreed v2's cut was mostly right, except: defer FTS-search to a
capability gate, keep `peer list` in core, drop redundancies.

```
# Messaging
POST   /v1/send              {to, message, priority?, meta?, replyToId?,
                              client_message_id?}
POST   /v1/topic/post        {topic, message, priority?, mentions?,
                              client_message_id?}
POST   /v1/topic/subscribe   {topic}
POST   /v1/topic/unsubscribe {topic}
GET    /v1/topic/list
GET    /v1/inbox             ?since=<iso>&topic=<n>&from=<peer>&limit=<n>
                             # plain SQL paging; NO FTS in v0.9.0

# Peers + presence (kept in core — central to "first-class peer")
GET    /v1/peers             ?mesh=<slug>
POST   /v1/profile           {summary?, status?, visible?}

# Files (already production)
POST   /v1/file/share        {path, to?, message?, persistent?}
GET    /v1/file/get          ?id=<fileId>&out=<path>
GET    /v1/file/list

# Events — push
GET    /v1/events            text/event-stream
       core events: message, peer_join, peer_leave, file_shared,
                    daemon_disconnect, daemon_reconnect, hook_executed,
                    feature_negotiation_failed

# Control plane
GET    /v1/health            (auth required by default — see §3.3)
GET    /v1/metrics           (auth required by default)
GET    /v1/version           (auth required by default)
POST   /v1/heartbeat         {}
```

`inbox/search` with FTS deferred to v0.9.x capability gate `inbox_fts`.

### 3.2 Capability-gated future surface (v0.9.x)

Same as v2 §3.2 — state, memory, vector, graph, tasks, scheduling,
mcp_host, skill_share, plus new `inbox_fts`. None enabled in v0.9.0.

### 3.3 Local IPC authentication — tightened

Same shape as v2 §3.3 but with codex's polish folded in:

| Transport | Auth | Notes |
|---|---|---|
| UDS | None (FS perms 0600) | Reaching socket = same UID |
| TCP loopback | `Authorization: Bearer <local_token>` REQUIRED | 127.0.0.1 only |
| SSE | `Authorization: Bearer <local_token>` REQUIRED | same |

**Token plumbing rules (NEW):**
- `local_token` MUST be in the `Authorization` header. **Never** accepted in
  query string. Endpoint that sees a `?token=...` query param logs a security
  event and returns 400.
- `local_token` MUST be redacted from access logs (`Authorization: Bearer
  ***` in logs).
- `local_token` rotation atomically writes a new file; SDKs hold the OLD
  token valid for 60s grace, then it's rejected.

**Endpoint default auth (NEW — codex):**
- Every IPC endpoint requires the local token by default, **including**
  `/v1/health`, `/v1/metrics`, `/v1/version`. `[ipc] public_health_check =
  true` opts in to public `/v1/health` for k8s probes etc.

**Container default (NEW — codex):**
- If `KUBERNETES_SERVICE_HOST` is set OR `/.dockerenv` exists OR
  `/proc/1/cgroup` indicates a container OR explicit `--container` flag,
  daemon defaults to **UDS-only** (`[ipc] tcp_enabled = false`). Containers
  share host loopback when `network_mode: host`; UDS-only avoids the
  side-channel.

**Origin/Host policy:**
- `Host` header must be `localhost`, `127.0.0.1`, `[::1]` or empty. Else 403.
- `Origin` header: explicit allowlist (default: empty). SSRF-from-browser
  bounce-attack defense.
- `User-Agent` requirement DROPPED (codex called it theatre — correct).
- CORS: never echo `Access-Control-Allow-Origin`; preflight returns 403.

### 3.4 Request limits & backpressure — same as v2

---

## 4. Delivery contract — at-least-once, broker-dedupes-on-client-id

Codex caught the real protocol gap: idempotency only works if the broker
dedupes on the **caller's** id, not its own. This requires a broker change.

### 4.1 The contract (precise)

> **Local guarantee**: each successful `POST /v1/send` returns a stable
> `client_message_id`. The send is durably persisted to `outbox.db` before
> the response returns.
>
> **Broker guarantee**: the broker dedupes on `client_message_id` for a
> 24h window. Multiple inflight retries from the daemon for the same
> `client_message_id` produce **at most one** broker-accepted row.
>
> **End-to-end guarantee**: at-least-once delivery to subscribers, with
> `client_message_id` propagated in the inbound envelope so receivers can
> dedupe locally on their side. We do **not** guarantee at-most-once
> end-to-end — that requires receiver-side dedupe, which the daemon's
> inbox.db provides for daemon-hosted peers.

### 4.2 Daemon-supplied `client_message_id` (NEW — broker protocol change)

Every send has a stable id minted **on the daemon**, not the broker:
- Caller-supplied via `Idempotency-Key` header → wins.
- Caller-supplied in body as `client_message_id` field → second.
- Else daemon mints a `ulid` → last.

The id is:
- Returned in the IPC response.
- Stored in `outbox.db` as a UNIQUE NOT NULL column (real dedupe, not
  `INSERT OR IGNORE` on nullable — codex caught this).
- Propagated to the broker on every retry (`client_message_id` field in the
  WS send envelope and in `POST /v1/messages`).
- Stored in the broker's `meshTopicMessage.client_message_id` column with a
  `UNIQUE` constraint scoped to `(meshId, client_message_id)`.
- Propagated in the inbound delivery to receivers' inboxes.

**Broker behavior on duplicate `client_message_id`**: returns the
already-stored `messageId` and `historyId` from the prior insertion. No new
row, no new fan-out, idempotent.

### 4.3 Broker schema delta (NEW)

```sql
ALTER TABLE mesh.topic_message
  ADD COLUMN client_message_id TEXT;
ALTER TABLE mesh.message_queue
  ADD COLUMN client_message_id TEXT;

CREATE UNIQUE INDEX topic_message_client_id_idx
  ON mesh.topic_message(mesh_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE UNIQUE INDEX message_queue_client_id_idx
  ON mesh.message_queue(mesh_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
```

Partial unique index — legacy traffic without `client_message_id` (from
`claudemesh launch`, dashboard chat, web posts) is unaffected.

### 4.4 Outbox schema (corrected)

```sql
CREATE TABLE outbox (
  id                  TEXT PRIMARY KEY,                -- ulid (local row id)
  client_message_id   TEXT NOT NULL UNIQUE,            -- propagated to broker
  payload             BLOB NOT NULL,
  enqueued_at         INTEGER NOT NULL,
  attempts            INTEGER DEFAULT 0,
  next_attempt_at     INTEGER NOT NULL,
  status              TEXT CHECK(status IN ('pending','inflight','done','dead')),
  last_error          TEXT,
  delivered_at        INTEGER,
  broker_message_id   TEXT                              -- set on ACK
);
CREATE INDEX outbox_pending ON outbox(status, next_attempt_at);
```

`UNIQUE NOT NULL` on `client_message_id`: caller retries with the same id
collide locally and become a no-op.

### 4.5 Inbox schema (corrected — content table + FTS index)

Codex caught: FTS5 virtual tables are not where you put `CREATE INDEX`.
Real shape:

```sql
-- Content table — the durable store
CREATE TABLE inbox (
  id                  TEXT PRIMARY KEY,                -- ulid (local row id)
  client_message_id   TEXT NOT NULL UNIQUE,            -- dedupe key
  broker_message_id   TEXT,
  mesh                TEXT NOT NULL,
  topic               TEXT,
  sender_pubkey       TEXT NOT NULL,
  sender_name         TEXT NOT NULL,
  body                TEXT,
  meta                TEXT,                            -- JSON
  received_at         INTEGER NOT NULL,
  reply_to_id         TEXT
);
CREATE INDEX inbox_received_at ON inbox(received_at);
CREATE INDEX inbox_topic       ON inbox(topic);
CREATE INDEX inbox_sender      ON inbox(sender_pubkey);

-- FTS5 index — gated behind capability `inbox_fts` (deferred to v0.9.x)
-- When enabled, populated via triggers; absent in v0.9.0.
```

Insert path: `INSERT INTO inbox(...) ON CONFLICT(client_message_id) DO
NOTHING RETURNING id`. The `RETURNING` clause tells us whether a new row
landed; only new rows trigger hooks.

### 4.6 Crash recovery — explicit semantics

On daemon startup:
1. Rows in `inflight` reset to `pending` with `attempts++`,
   `next_attempt_at = now + min_backoff`. **Note:** these may double-deliver
   if the broker actually accepted before the local ACK persisted. The
   `client_message_id` propagation ensures the broker dedupes the retry —
   net result: exactly one broker-accepted row, possibly two daemon-side
   `inflight → done` transitions.
2. `outbox.db` PRAGMA integrity_check; failure → daemon refuses to start,
   point at `claudemesh daemon recover`.
3. `inbox.db` integrity check; failure → move to `inbox.db.corrupt-<ts>`,
   create fresh empty inbox, log `inbox_corruption_recovered`. Inbox is a
   cache; recoverable from broker history.

### 4.7 Failure modes the spec is honest about

- **Broker dedupe window expired**: daemon retries a 25h-old send. Broker
  accepts again as if new (no dedupe). Daemon's outbox `max_age_hours`
  (default 168h = 7d) is longer than broker dedupe (24h), so this is
  possible. Default daemon `max_age_hours` REDUCED to **23h** to stay inside
  broker dedupe window. Configurable up only if the operator accepts the
  risk explicitly.
- **`dead` rows**: surface in `claudemesh daemon outbox --failed`. User
  manually requeues (`outbox requeue <id>`) or drops (`outbox drop <id>`).
- **Receiver-side dedupe failure**: only daemon-hosted receivers dedupe.
  `claudemesh launch` and dashboard chat clients DO NOT dedupe today —
  fixing them is post-v0.9.0.

---

## 5. Inbound — schema corrected (see §4.5), retention as v2

30-day rolling retention (configurable). Weekly VACUUM.
`claudemesh daemon search` deferred to `inbox_fts` capability.

---

## 6. Hooks — scopes tightened, exfiltration acknowledged

Codex was right: capability tokens removed the broad-token footgun, not
exfiltration. Untrusted hook payload + `network_policy=deny` not reliable
across platforms. Spec is now honest about that.

### 6.1 Hooks contract — same shape as v2 §6, with tighter defaults

### 6.2 Capability scopes — narrowed for v0.9.0

Codex pushed: scopes were too coarse. v0.9.0 scopes are exactly:

| Scope | Capability | Notes |
|---|---|---|
| `reply:event` | Reply to the specific event that triggered this hook | Bound to `event_id`; daemon validates target; expires on hook exit |
| `dm:send:<sender_pubkey>` | Send DM only to the specific sender | Bound to one pubkey from event; not a write to anyone |
| `topic:<name>:post` | Post to the specific topic that fired | Bound to topic from event; can't write elsewhere |

**No read scopes in v0.9.0.** A hook cannot read state, inbox, peers, etc.
If a hook wants to consult mesh data to compose its reply, it does so via
the *event payload* (which the daemon redacted appropriately) or via shell
out to a fresh `claudemesh <verb>` call (which uses the user's existing
config and is subject to its own auth). No daemon-mediated read tokens.

### 6.3 Sandboxing — supported, not promised

Codex caught: "network_policy=deny" sounds reliable but isn't cross-platform.
Spec now says explicitly:

- `network_policy = "deny"` is **best-effort**:
  - Linux: enforced via `unshare --net` if available; else firewall rule via
    `iptables -m owner` if available; else daemon logs warning that policy
    cannot be enforced and the hook STILL runs.
  - macOS: enforced via `sandbox-exec` profile if available; else warning + run.
  - Windows: not enforced; warning + run.
- Operators on hostile networks should set `enabled = false` for hooks they
  don't trust.
- Daemon `cm_daemon_hook_unenforceable_total` counter exposes the count of
  hooks that ran with weakened sandbox.

### 6.4 Payload size & truncation — NEW

Stdin payloads to hooks capped at 256 KB (configurable). Larger payloads
truncated with `_truncated: true` flag in the JSON event. Hook stdout
captured up to `output_size_limit` (default 64 KB).

### 6.5 Audit log + killpg — same as v2

---

## 7. Multi-mesh — same as v2 §7

---

## 8. Auto-routing — same as v2 §8 (codex agreed it was clarified correctly)

---

## 9. Service installation — same as v2 §9

Add: when `claudemesh daemon install-service` runs in CI-detected
environment, prints `Refusing to install persistent service in CI; ephemeral
mode only.` and exits non-zero unless `--allow-ci-persistent` is passed.

---

## 10. Observability — same as v2 §10

Add metric: `cm_daemon_hook_unenforceable_total{hook,reason}` (§6.3).

---

## 11. SDKs — same shape as v2, bound to frozen core only

---

## 12. Security model — same boundaries, plus dedupe + feature negotiation

| Boundary | Trust | Mechanism |
|---|---|---|
| App ↔ Daemon (UDS) | OS user | UDS 0600 |
| App ↔ Daemon (TCP/SSE) | OS user + bearer token | 127.0.0.1 + `local_token` + Origin/Host |
| Hook ↔ Daemon | Capability scope | Short-lived token bound to event; no read scopes |
| Daemon ↔ Broker | Mesh keypair + feature bits | WSS + ed25519 + crypto_box + per-topic keys + feature negotiation (§15) |
| Daemon ↔ Disk | OS user | All files 0600/0644 |
| Cloned identity | First-mac fingerprint | Accidental-clone detection only; broker concurrent-policy on §2.3 |

---

## 13. Configuration — same shape as v2 §13, plus `[features]`

```toml
[features]
require = ["client_message_id_dedupe", "concurrent_connection_policy"]
optional = ["mesh_skill_share", "mcp_host"]
# Daemon refuses to start if broker doesn't advertise all `require` bits.
```

---

## 14. Lifecycle — key rotation crypto fixed

### 14.1 Key rotation (CORRECTED — codex)

v2 said: *"old pubkey held server-side for 24h grace (decrypts in-flight
messages encrypted to old pubkey)"*. **Wrong** — only the daemon has the
private key. Broker can't decrypt.

Real semantics:

- `claudemesh daemon rotate-keypair` mints fresh ed25519 + x25519, registers
  the new pubkey with the broker as `member_keypair_rotated`.
- Broker associates the new pubkey with the same member id, marks the old
  pubkey as `rotated_out` (not revoked).
- **Daemon-side**: the OLD x25519 private key is retained in
  `keypair-archive.json` (mode 0600, durable) for a `key_grace_period`
  (default 7 days). During the grace window, daemon will attempt to decrypt
  inbound messages with the new private key first, falling back to archived
  keys (one or more). Messages encrypted to the old pubkey by senders who
  haven't yet seen the rotation event continue to decrypt cleanly.
- After the grace period, archived keys are zeroed and the file is deleted.
  Messages encrypted to a stale pubkey after the grace window fail to
  decrypt and are logged as `cm_daemon_decrypt_stale_total`.

### 14.2 Backup includes topic state (CORRECTED)

`claudemesh daemon backup` now packages:
- `keypair.json` (current)
- `keypair-archive.json` (any in-grace-window archived keys)
- `host_fingerprint.json`
- `config.toml`
- `local_token` (NOT — token is rotated on restore)
- `topic_subscriptions.json` (which topics this daemon subscribes to)
- `topic_keys.json` (per-topic symmetric keys this member holds)
- `key_epoch.json` (current epoch number per topic; relevant when the mesh
  rotates topic keys)
- `schema_version`

Backup file: encrypted with a passphrase (Argon2id KDF + crypto_secretbox).
Restore writes everything except `local_token` (regenerated). On first run
after restore, daemon performs `accept-host` if fingerprint mismatches
(restore is by definition a host change).

### 14.3 Local token rotation, compromised host revocation, image-clone, uninstall, recovery — same as v2 §14

---

## 15. Version compat — feature-bit negotiation (REPLACES v2 §15)

Codex was right: version ranges aren't enough when daemon depends on
specific broker capabilities (client-supplied IDs, concurrent-connection
policy, key epochs).

### 15.1 Feature bits

Each protocol-relevant capability gets a stable string identifier:

```
client_message_id_dedupe       broker dedupes on client_message_id (§4.2)
concurrent_connection_policy   broker honours mesh.cloneConcurrencyPolicy (§2.3)
member_keypair_rotated_event   broker emits the event (§14.1)
key_epoch                      per-topic key epochs supported (§14.2)
mesh_skill_share               post-v0.9, future
mcp_host                       post-v0.9, future
```

### 15.2 Negotiation handshake

On WS connect (after hello, before normal traffic):

```
→ daemon:  feature_negotiation_request
           { require:  ["client_message_id_dedupe",
                        "concurrent_connection_policy"],
             optional: ["mesh_skill_share","mcp_host"] }

← broker:  feature_negotiation_response
           { supported: ["client_message_id_dedupe",
                         "concurrent_connection_policy",
                         "member_keypair_rotated_event"],
             missing_required: [] }
```

If `missing_required` is non-empty, daemon closes the connection with code
4010 `feature_unavailable`, logs forensic event, exits with non-zero status.
Supervisor sees a restart-loop → operator alerted via configured
mechanisms.

### 15.3 IPC negotiation (CLI/SDK ↔ daemon)

`GET /v1/version` returns:
```json
{
  "daemon_version": "0.9.0",
  "ipc_api": "v1",
  "ipc_features": ["send","topic","peers","files","events","health"],
  "schema_version": 7,
  "broker_features_negotiated": ["client_message_id_dedupe", ...]
}
```

CLI/SDK matches `ipc_features` against required. Missing required →
fall-back to cold-path with warning OR fail explicitly (CLI verb's choice).

### 15.4 Compatibility matrix — published

```json
GET /v1/compat
{
  "daemon": "0.9.0",
  "compatible_brokers": ["0.7.x","0.8.x","0.9.x"],
  "required_broker_features": ["client_message_id_dedupe",
                               "concurrent_connection_policy"],
  "compatible_clis": ["0.9.x"],
  "compatible_sdks": {
    "python": ">=0.9.0,<1.0.0",
    "go":     ">=0.9.0,<1.0.0",
    "ts":     ">=0.9.0,<1.0.0"
  }
}
```

---

## 16. Threat model — shared-CI reality folded in

### 16.1 Attacker classes — same matrix as v2 §16, plus:

| Attacker | Has | Wants | Mitigations |
|---|---|---|---|
| **Shared CI runner** (NEW) | Same Unix UID as other untrusted jobs | Read this user's persistent keypair across job boundaries | Auto-detect CI envs (§2.1) → ephemeral default + UDS-only + isolated `$HOME`. If operator overrides with `--persistent`, log warning `persistent_keypair_in_ci_environment`. |
| **Malicious mesh peer** (PROMOTED from out-of-scope to in-scope) | Mesh membership | Send malformed payload to crash daemon | Every inbound shape validated against schema before any processing. Daemon refuses unknown fields (defense-in-depth) and emits `cm_daemon_invalid_inbound_total`. Crashes from inbound payloads are bugs. |

### 16.2 Stated explicitly out of scope

- Root attacker on daemon host (can read keypair directly).
- Compromised broker (E2E content protection still holds; metadata is not
  protected by daemon — that's mesh-level).
- Sophisticated attacker who copies BOTH `keypair.json` and
  `host_fingerprint.json` (§2.2 calls this out).
- Receivers other than daemon-hosted peers deduping inbound traffic
  (post-v0.9.0).

### 16.3 Container & CI defaults table (NEW)

| Environment | Identity | IPC | Hooks |
|---|---|---|---|
| Bare metal / VM (default) | Persistent (clone-detected) | UDS + TCP loopback | Enabled |
| Docker container (`/.dockerenv`) | Persistent | UDS-only by default | Enabled |
| Kubernetes (`KUBERNETES_SERVICE_HOST`) | Persistent | UDS-only | Enabled |
| CI (`CI=true`, `GITHUB_ACTIONS`, etc.) | Ephemeral | UDS-only | Disabled by default (`[hooks] enabled = false` until opted-in) |
| RunPod (`RUNPOD_POD_ID`) | Ephemeral | UDS-only | Enabled |

Operator overrides any default with explicit flags; warning logged for
non-default-secure choices.

---

## 17. Migration — same as v2 §17, plus broker schema add

Broker needs the schema delta in §4.3 (additive, partial unique indexes —
safe for online migration). Coordinated with daemon rollout: broker first,
then daemon. Daemon refuses to start against a broker that lacks
`client_message_id_dedupe` feature bit (§15).

---

## What needs review (round 3)

Round 1 → identity, IPC auth, exactly-once lie, hook tokens, surface bloat,
missing rotation/recovery/migration/threat-model.

Round 2 → boot-id false-positive, broker must dedupe on client id (protocol
change), CI shared-runner reality, feature-bit negotiation, key rotation
crypto, hook scopes, FTS schema, ~7 polish items.

This v3 attempts to address all of those. Specifically critique:

1. **Accidental-clone framing (§2.2)** — does the honest framing close the
   issue, or does removing boot-id make the detection so weak it's not worth
   shipping at all? Should we drop fingerprint detection entirely and rely on
   broker concurrent-connection policy?
2. **Broker schema delta (§4.3)** — is this the smallest correct change?
   Partial unique indexes feel right; anything else needed (audit table,
   gc job)?
3. **`max_age_hours` reduced to 23h** — codex's logic says daemon outbox TTL
   must be inside broker dedupe window. Is 23h vs 24h tight enough? Should
   the broker advertise its dedupe window as a feature parameter so the
   daemon configures itself?
4. **Hook scopes (§6.2)** — too tight? `reply:event` + `dm:send:<sender>` +
   `topic:<name>:post`. Does this cover real use cases for v0.9.0 hooks
   (auto-reply, escalate-to-oncall, file-receipt-ack)?
5. **Feature-bit negotiation (§15)** — is the scheme right? Should
   feature-bits be string identifiers (current) or numeric bit positions in
   a bitmask (denser, more brittle)?
6. **CI defaults (§16.3)** — is the table accurate? Anything wrong about
   defaulting hooks-disabled in CI?
7. **Key rotation grace-key archive (§14.1)** — is 7d the right default? Is
   storing archived private keys on disk (mode 0600) acceptable, or should
   they be encrypted at rest with a passphrase?
8. **Anything still wrong?** Read it as if you were going to operate this
   daemon for a year — what falls down?

Three options after this review:
- **(a) v3 is shippable**: lock the spec, start coding the frozen core.
- **(b) v4 needed**: list the must-fix items.
- **(c) the architecture itself is wrong**: what would you do differently?

Be ruthless. We can break anything.
