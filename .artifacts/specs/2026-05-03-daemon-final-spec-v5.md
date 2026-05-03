# `claudemesh daemon` — Final Spec v5

> **Round 5.** v4 was reviewed by codex (round 4) and got an architectural
> pass but flagged one blocker plus four polish items.
>
> **Blocker**: §4 called dedupe "permanent" while also saying it disappears
> when retained rows are hard-deleted. Internally inconsistent. Fix: real
> broker-side dedupe/tombstone table independent of message retention.
>
> **Polish**: (a) rename `mode: "permanent"` to `retention_scoped`; (b)
> deterministic duplicate-response shape; (c) feature-parameter schema
> validation rules + per-feature parameter version; (d) drop
> "zeroed/secure-delete" promises in archive cleanup, define malformed-archive
> startup behavior; plus Linux MAC||MAC self-collision noted, RunPod warning
> log on persistent default.
>
> **Intent §0 unchanged from v2.** v5 only revises what changed from v4.

---

## 0. Intent — unchanged, see v2 §0

Pre-launch peer-mesh runtime. Servers/laptops become first-class peers.
Stable identity, persistent WS, local IPC, hooks. Not a webhook gateway, not
a generic broker. We can break anything.

**One claim retracted from v1/v2**: "exactly-once" delivery. Replaced with a
precise contract in §4.

---

## 1. Process model — unchanged from v3 §1 / v2 §1

---

## 2. Identity — accidental-clone detection only

### 2.1 Modes — unchanged from v4 §2.1, RunPod warning added

When `RUNPOD_POD_ID` is set and identity is persistent (the default for
RunPod under v4 §16.3), daemon logs `runpod_persistent_default_assumed` at
INFO. Operators running RunPod as multi-tenant CI surface set `--ephemeral`
explicitly; the warning makes the default visible in case the assumption
doesn't fit their deployment.

### 2.2 Accidental-clone detection — unchanged from v4 §2.2

#### 2.2.1 Fingerprint source precedence — unchanged from v4 §2.2.1, with self-collision note

**Linux MAC-only fallback (NEW note)**: when `/etc/machine-id` is unreadable
and we fall back to MAC-only as `host_id`, the resulting fingerprint is
effectively `sha256(mac || mac)`. This is acceptable for clone detection
(still uniquely identifies *this* host's first-NIC MAC) but reduces entropy
to ~48 bits. Operators who want stronger fingerprinting in degraded
environments can persist a generated UUID via `host_fingerprint.id_override`
in config; documented but not required.

### 2.3 Concurrent-duplicate-identity broker policy — unchanged from v3 §2.3

### 2.4 Rename, key rotation — see §14

---

## 3. IPC surface — unchanged from v4 §3

---

## 4. Delivery contract — at-least-once, **dedupe table**, retention-scoped

Codex round 4 caught: v4 said "permanent" but also said dedupe disappears
when message rows are hard-deleted. That's `retention_scoped`, not
permanent — and worse, the partial-unique-index design fails when the row
itself is gone. v5 introduces a real broker-side dedupe table with its own
retention policy, independent of message retention.

### 4.1 The contract (precise)

> **Local guarantee**: each successful `POST /v1/send` returns a stable
> `client_message_id`. The send is durably persisted to `outbox.db` before
> the response returns.
>
> **Broker guarantee**: the broker maintains a dedupe record for every
> accepted `client_message_id` in a dedicated table
> (`mesh.client_message_dedupe`). The dedupe record outlives the message
> row when the dedupe-retention policy is longer than the
> message-retention policy. While the dedupe record exists, all retries
> with that `client_message_id` collapse to the original
> `broker_message_id` deterministically. After the dedupe record expires,
> a retry would create a new message — but daemon outbox `max_age_hours`
> is configured against the broker's advertised `dedupe_retention_days`
> with margin (§15.1), so this should not happen in practice.
>
> **End-to-end guarantee**: at-least-once delivery to subscribers, with
> `client_message_id` propagated in the inbound envelope. Receiver-side
> dedupe is the receiver's job; the daemon's `inbox.db` provides it for
> daemon-hosted peers.

### 4.2 Daemon-supplied `client_message_id` — unchanged from v3 §4.2

Sources: `Idempotency-Key` header → body `client_message_id` → daemon ulid.
Stored in outbox UNIQUE NOT NULL, propagated to broker, propagated to
receivers in inbound envelope.

### 4.3 Broker schema — dedupe table separate from message rows (v5)

```sql
-- The dedupe authority. One row per (mesh, client_message_id) accepted
-- by the broker. Outlives mesh.topic_message rows when retention >
-- message retention.
CREATE TABLE mesh.client_message_dedupe (
  mesh_id              UUID    NOT NULL REFERENCES mesh.mesh(id) ON DELETE CASCADE,
  client_message_id    TEXT    NOT NULL,
  broker_message_id    UUID    NOT NULL,         -- the original accepted message id
  destination_kind     TEXT    NOT NULL CHECK(destination_kind IN ('topic','dm','queue')),
  destination_ref      TEXT    NOT NULL,         -- topic name, recipient pubkey, etc.
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ,              -- NULL = never expires (operator opt-in)
  status               TEXT NOT NULL CHECK(status IN ('accepted','rejected')),
  history_available    BOOLEAN NOT NULL DEFAULT TRUE,  -- flipped FALSE when message row GC'd
  PRIMARY KEY (mesh_id, client_message_id)
);

CREATE INDEX client_message_dedupe_expires_idx
  ON mesh.client_message_dedupe(expires_at)
  WHERE expires_at IS NOT NULL;

-- Existing tables get the convenience back-pointer (for receiver
-- inclusion in delivered envelopes); UNIQUE NOT enforced here — the
-- dedupe table is the authority.
ALTER TABLE mesh.topic_message ADD COLUMN client_message_id TEXT;
ALTER TABLE mesh.message_queue ADD COLUMN client_message_id TEXT;
```

**Retention semantics**:

- `expires_at = NULL` → dedupe row never expires unless mesh is deleted.
  Operator opts in via mesh setting `dedupeRetentionMode = "permanent"`.
- `expires_at = first_seen_at + dedupe_retention_days` → default
  `retention_scoped` mode. Default value: 365 days. Configurable per-mesh.
- A nightly broker job deletes rows where `expires_at < NOW()`.
- A separate broker job, fired when the message-retention sweep hard-deletes
  a `mesh.topic_message` or `mesh.message_queue` row, sets the corresponding
  dedupe row's `history_available = FALSE`. The dedupe row stays — only the
  payload is gone. Retries still collapse correctly; receiver requests for
  history return "row pruned" deterministically (§4.4 below).

**Migration**: additive-only. Daemon refuses to start unless broker
advertises feature `client_message_id_dedupe` with `mode` of
`retention_scoped` or `permanent` (§15.1).

### 4.4 Duplicate response — deterministic shape (NEW v5 — codex r4)

When the broker sees a send with a `client_message_id` already in
`mesh.client_message_dedupe`, the response is deterministic:

```json
{
  "broker_message_id":   "msg_01HQX...",
  "client_message_id":   "cmid_01HQX...",
  "duplicate":           true,
  "history_available":   true,            // false if message row was GC'd
  "first_seen_at":       "2026-05-03T11:42:00Z",
  "destination_kind":    "topic",
  "destination_ref":     "alerts"
}
```

Daemon outcomes:

- `duplicate: true, history_available: true` → mark outbox row `done`,
  store `broker_message_id`. No re-fanout (broker did the work the first
  time).
- `duplicate: true, history_available: false` → mark outbox row `done` but
  log `cm_daemon_dedupe_history_pruned_total`. The message *did* deliver
  the first time; we just can't show it in history. Receivers who needed
  it have it; receivers who didn't have already missed their window.
- No more `client_id_unknown` — that response code is removed.

### 4.5 Outbox schema — daemon-side max-age derived (v5)

```sql
CREATE TABLE outbox (
  id                  TEXT PRIMARY KEY,
  client_message_id   TEXT NOT NULL UNIQUE,
  payload             BLOB NOT NULL,
  enqueued_at         INTEGER NOT NULL,
  attempts            INTEGER DEFAULT 0,
  next_attempt_at     INTEGER NOT NULL,
  status              TEXT CHECK(status IN ('pending','inflight','done','dead')),
  last_error          TEXT,
  delivered_at        INTEGER,
  broker_message_id   TEXT
);
CREATE INDEX outbox_pending ON outbox(status, next_attempt_at);
```

Daemon `max_age_hours` is **derived** from the broker-advertised
`dedupe_retention_days` parameter:
- `permanent` → daemon default 168h (7d), capped at 30d. (Daemon doesn't
  hold sends forever — that's an outbox bug surface.)
- `retention_scoped, dedupe_retention_days = N` → daemon
  `max_age_hours = (N * 24) - safety_margin_hours`. Default
  `safety_margin_hours = 24`.
- Operator override permitted but logged as
  `outbox_max_age_above_broker_window` if it exceeds broker safe range.

### 4.6 Inbox schema — unchanged from v3 §4.5

### 4.7 Crash recovery — unchanged from v3 §4.6

### 4.8 Failure modes — corrected for dedupe-table model

- **`dead` rows**: surface in `claudemesh daemon outbox --failed`. Same as v4.
- **Receiver-side dedupe**: only daemon-hosted receivers dedupe. Same as v4.
- **Daemon retry after dedupe row expired AND message row GC'd**: in
  `retention_scoped` mode this can only happen if the daemon outbox row
  was older than `dedupe_retention_days - safety_margin`. Daemon will
  refuse to send rows older than its computed `max_age_hours` (§4.5) —
  they go to `dead` first, surfaced for human action. So this edge is
  closed by daemon-side gating, not broker-side dedupe.
- **Daemon retry after dedupe row expired BUT message row still alive**:
  doesn't happen by design — dedupe retention is always ≥ message
  retention in operator-sane configs. If misconfigured, message row
  persists with NULL `client_message_id` reference, retry creates a new
  message, broker emits `cm_broker_dedupe_misconfig_total` with
  `(mesh_id, retention_dedupe_days, retention_message_days)` labels.

---

## 5. Inbound — unchanged from v3 §5

---

## 6. Hooks — unchanged from v4 §6

---

## 7-13. Multi-mesh, auto-routing, service install, observability, SDKs, security model, configuration — unchanged from v4

---

## 14. Lifecycle — archive cleanup wording corrected (codex r4)

### 14.1 Key rotation — unchanged crypto from v4 §14.1

### 14.1.1 Archive record format — corrected wording (v5)

`keypair-archive.json` (mode 0600, atomic-rename writes):

```json
{
  "schema_version": 1,
  "max_archived_keys": 8,
  "keys": [
    {
      "ed25519_pubkey":    "base64...",     // metadata only; matches the rotated-out signing key for that key_id
      "x25519_pubkey":     "base64...",     // matches the retained private key
      "x25519_privkey":    "base64...",     // sensitive; whole file is 0600
      "key_id":            "k_01HQX...",
      "created_at":        "2026-04-12T11:00:00Z",
      "rotated_out_at":    "2026-05-03T16:00:00Z",
      "expires_at":        "2026-05-10T16:00:00Z"
    }
  ]
}
```

**Field clarifications (codex r4)**:
- `ed25519_pubkey` is metadata — the daemon does not retain the old ed25519
  *private* key. Stored to bind `key_id` ↔ old signing identity for audit
  reconstruction (e.g. "this archived x25519 was the recipient half of a
  member who at the time signed messages with the matching ed25519").
- `x25519_pubkey` MUST match the public half of `x25519_privkey`. Daemon
  validates on archive load; mismatch → quarantine (see corruption rules).

**Cleanup wording (codex r4)**:
- On `expires_at < now`: entry is removed from the live archive file via
  atomic-rename rewrite. **Secure deletion of the prior file's data is not
  guaranteed** on modern filesystems (journals, COW snapshots, SSD wear
  leveling, atomic-rename leaving stale inodes). Operators who need
  cryptographic erasure must operate on encrypted volumes or reissue
  hardware. Documented in threat model §16.
- "Force-expiry" when `max_archived_keys` is exceeded uses the same
  removal mechanism; same caveat applies. Counter
  `cm_daemon_archive_force_expired_total{key_id}` exposed.

**Duplicate `key_id` handling (NEW v5)**:
- Archive load rejects any file whose `keys[]` contains two records with
  the same `key_id`. Quarantine to `keypair-archive.json.malformed-<ts>`,
  start with empty archive, log `keypair_archive_duplicate_key_id`. Daemon
  continues to start (we don't want archive corruption to be a permanent
  outage). Old in-flight messages encrypted to the lost archived keys
  fail to decrypt and are counted in `cm_daemon_decrypt_stale_total`.

**Malformed archive on startup (NEW v5)**:
- File present but JSON parse fails OR schema fails OR pubkey/privkey pair
  fails validation: quarantine as above, start with empty archive, log
  `keypair_archive_malformed`. Same continue-startup behavior.
- File missing entirely: treated as empty archive (normal first run /
  post-cleanup state), no warning.
- File present but mode != 0600: log `keypair_archive_perms` warning,
  read anyway. Operators surfaced; daemon doesn't auto-chmod (they should
  fix their pipeline).

### 14.2 Backup — unchanged from v4 §14.2

### 14.3 Local token rotation, compromised host revocation, image-clone, uninstall, recovery — unchanged

---

## 15. Version compat — feature-bit schema validation (v5)

Codex r4: feature parameters need explicit schema-validation rules and
per-feature versioning so we don't paint ourselves into a corner when a
parameter shape evolves.

### 15.1 Feature bits with parameters and versions

Each feature bit's parameters are versioned independently of broker version:

| Bit | `params.version` | Required parameters | Optional parameters |
|---|---|---|---|
| `client_message_id_dedupe` | `1` | `mode: "retention_scoped"\|"permanent"`, `dedupe_retention_days: int (>= 1)` (when mode=retention_scoped) | `tombstone_history_pruned_window_days: int` |
| `concurrent_connection_policy` | `1` | (no parameters) | `default_policy: "prefer_newest"\|"prefer_oldest"\|"allow_concurrent"` |
| `member_keypair_rotated_event` | `1` | (no parameters) | — |
| `key_epoch` | `1` | `max_concurrent_epochs: int (>= 1)` | — |
| `max_payload` | `1` | `inline_bytes: int (>= 1024)`, `blob_bytes: int (>= 1024)` | — |
| `mesh_skill_share` | future | — | — |
| `mcp_host` | future | — | — |

**Validation rules (NEW v5)**:

When the broker advertises feature parameters in
`feature_negotiation_response`, the daemon validates against the
parameter schema for that `params.version`. Validation failures:

- **Required parameter missing**: treated identically to "feature missing
  from `supported`" — if the feature is in daemon's `require[]`, daemon
  closes WS with code 4010 `feature_unavailable` and exits non-zero.
- **Required parameter out of bounds** (e.g. `dedupe_retention_days = -5`,
  `inline_bytes = 0`): same — treated as "feature missing from
  `supported`."
- **Unknown `params.version`**: if daemon doesn't recognize the version,
  treated as "feature missing." Daemon does NOT silently degrade.
- **Optional parameter missing or invalid**: daemon uses its own default,
  logs `feature_optional_param_invalid{feature, param, reason}`, continues.
- **Unknown `mode` for `client_message_id_dedupe`** (not "retention_scoped"
  or "permanent"): treated as "feature missing." Future modes require a
  `params.version` bump.

Validation is NOT silent: every feature_negotiation_response is logged
fully (with sensitive parameters redacted, though we don't currently have
any) at DEBUG, and a single line at INFO summarizes negotiated capabilities
on each successful negotiation.

### 15.2 Negotiation handshake — shape updated (v5)

```
→ daemon:  feature_negotiation_request
           {
             require:  ["client_message_id_dedupe",
                        "concurrent_connection_policy"],
             optional: ["mesh_skill_share","mcp_host","max_payload"]
           }

← broker:  feature_negotiation_response
           {
             supported: {
               "client_message_id_dedupe": {
                 "params": {
                   "version": 1,
                   "mode": "retention_scoped",
                   "dedupe_retention_days": 365,
                   "tombstone_history_pruned_window_days": 30
                 }
               },
               "concurrent_connection_policy": {
                 "params": { "version": 1, "default_policy": "prefer_newest" }
               },
               "member_keypair_rotated_event": { "params": { "version": 1 } },
               "max_payload": {
                 "params": { "version": 1, "inline_bytes": 65536, "blob_bytes": 524288000 }
               }
             },
             missing_required: []
           }
```

If `missing_required` is non-empty after broker's response OR after daemon
parameter validation, daemon closes with 4010 and exits non-zero.

### 15.3 IPC negotiation — unchanged from v3 §15.3

### 15.4 Compatibility matrix — unchanged from v3 §15.4

---

## 16. Threat model — unchanged from v4 §16

Plus archive-secure-delete clarification under §14.1.1.

---

## 17. Migration — broker dedupe table is the new prereq

Broker side, deploy order:
1. `CREATE TABLE mesh.client_message_dedupe` + supporting indexes
   (additive, online-safe).
2. `ALTER TABLE mesh.topic_message ADD COLUMN client_message_id` (already
   in v3/v4 plan).
3. Broker code: every `INSERT` into `topic_message` / `message_queue` first
   `INSERT ... ON CONFLICT DO UPDATE RETURNING` into
   `client_message_dedupe`. The conflict path returns existing
   `broker_message_id` instead of creating a new row.
4. Broker code: nightly job to delete `client_message_dedupe` rows where
   `expires_at < NOW()`.
5. Broker code: hook into the existing message-retention sweep to set
   `history_available = FALSE` on dedupe rows whose message row has been
   pruned.
6. Broker advertises `client_message_id_dedupe` feature bit in negotiation
   response.
7. Daemon refuses to start unless that feature bit is advertised with valid
   params.

---

## What changed v4 → v5 (codex round-4 actionable items)

| Codex r4 item | v5 fix | Section |
|---|---|---|
| Dedupe must be retention-scoped, not "permanent" with row-deletion gap | Real `mesh.client_message_dedupe` table; retention independent of message rows; `permanent` becomes opt-in mode meaning "no expires_at" | §4.1, §4.3 |
| Rename misleading mode | `retention_scoped` is the default; `permanent` reserved for explicit opt-in | §4.3, §15.1 |
| Deterministic duplicate response | New shape with `duplicate`, `broker_message_id`, `history_available`; removed `client_id_unknown` | §4.4 |
| Feature parameter validation rules | `params.version` per feature; required-param failure = treated as missing-required-feature; daemon closes WS 4010, exits non-zero | §15.1 |
| Drop "zeroed/secure-delete" promise | Replaced with "removed from live archive; secure deletion not guaranteed"; threat model documents | §14.1.1 |
| Duplicate `key_id` handling | Archive load rejects, quarantine, start empty, continue | §14.1.1 |
| Malformed archive startup behavior | Quarantine, start empty, continue; mode-mismatch warns but reads | §14.1.1 |
| Linux MAC||MAC self-collision | Documented; `host_fingerprint.id_override` escape hatch | §2.2.1 |
| RunPod warning on persistent default | Logged at INFO so default is visible | §2.1 |

---

## What needs review (round 5)

1. **Dedupe table design (§4.3)** — is `(mesh_id, client_message_id)`
   PRIMARY KEY enough, or do we need versioning of the dedupe row itself
   (e.g. when destination changes mid-retry)? Is `destination_kind` /
   `destination_ref` needed at all, or just for audit?
2. **`history_available = FALSE` semantics (§4.4)** — does it actually fix
   the case where receivers ask for history of a pruned message? Or does
   the receiver need its own dedupe-with-history-pruned pathway?
3. **Daemon outbox max-age math (§4.5)** — is `dedupe_retention_days * 24
   - 24` margin correct? Should the margin be a percentage instead of a
   fixed 24h?
4. **Feature param validation (§15.1)** — does treating "invalid required
   param" as "missing required feature" lose useful diagnostic detail?
   Should we have a 4011 `feature_param_invalid` close code separately?
5. **Archive quarantine (§14.1.1)** — is "continue startup with empty
   archive" the right call, or should it be opt-in / refuse-by-default?
6. **Anything else still wrong?** Read it as if you were going to operate
   this for a year.

Three options:
- **(a) v5 is shippable**: lock the spec, start coding the frozen core.
- **(b) v6 needed**: list the must-fix items.
- **(c) the architecture itself is wrong**: what would you do differently?

Be ruthless.
