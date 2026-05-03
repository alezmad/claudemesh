# `claudemesh daemon` — Implementation spec v0.9.0

> **Implementation target.** Locked from the v1–v10 codex-reviewed spec
> series. This document is what we build for v0.9.0 of the daemon.
>
> **Base**: v6 (the round where the architecture passed codex's
> structural review — request_fingerprint, dedupe table, atomicity
> contract, feature-bit negotiation, key archive format).
>
> **Pulled in from v7–v9**: six cheap, load-bearing fixes that close
> real v0.9.0-era bugs (not future-scale concerns):
>
> 1. `aborted` outbox status + audit columns (operator recovery without
>    destroying audit trail) — v7 §4.5.2
> 2. `BEGIN IMMEDIATE` for daemon-local SQLite serialization (v6's
>    `SELECT FOR UPDATE` is invalid SQLite anyway) — v7 §4.5.1
> 3. Daemon-local IPC duplicate lookup table over outbox states ×
>    fingerprint match/mismatch — v8 §4.5.1
> 4. Phase B1/B2/B3 broker validation split (the concept; we don't need
>    the elaborate phase tables) — v7 §4.6.2
> 5. Side-effect inventory (in-tx vs async) as an implementation comment
>    block — v8 §4.7.1
> 6. Two-layer ID model wording: daemon-consumed iff outbox row,
>    broker-consumed iff dedupe row — v9 §4.1
>
> **Deferred to broker-hardening followups** (see
> `2026-05-03-daemon-spec-broker-hardening-followups.md` for the full list and
> rationale): B0 dedupe fast-path, Lua-scripted idempotent rate
> limiter, in-tx mention_index, 4011/4012 close-code split, per-OS
> fingerprint precedence table, request-fingerprint schema-v2 in
> feature negotiation. These are real improvements but not v0.9.0
> blockers; they land as the broker matures.
>
> **Intent §0 unchanged from v2.**

---

## 0. Intent — unchanged, see v2 §0

---

## 1. Process model — unchanged from v3 §1 / v2 §1

---

## 2. Identity — unchanged from v5 §2

---

## 3. IPC surface — unchanged from v4 §3

---

## 4. Delivery contract — at-least-once with **request-fingerprinted** dedupe

Codex r5: dedupe must compare the *whole request shape*, not just
`(mesh, client_message_id)`. Otherwise a caller who reuses an idempotency
key with a different destination or body silently drops the new send and
gets the old send's metadata back.

### 4.1 The contract (precise)

> **Two-layer ID rule** (from v9): a `client_message_id` is
> **daemon-consumed** iff an outbox row exists for it; **broker-consumed**
> iff a dedupe row exists in `mesh.client_message_dedupe`. The two layers
> are independent: a daemon-consumed id may or may not be broker-consumed
> (depending on whether the send reached broker commit). In v0.9.0 there
> are no daemon-bypass clients, so for practical purposes "daemon-consumed"
> is the operative rule.
>
> **Local guarantee**: each successful `POST /v1/send` returns a stable
> `client_message_id`. The send is durably persisted to `outbox.db` before
> the response returns. The daemon enforces request-fingerprint
> idempotency at the IPC layer (§4.5).
>
> **Local audit guarantee**: a `client_message_id` once written to
> `outbox.db` is never released. Operator recovery via `requeue` always
> mints a fresh id; the old row stays in `aborted` for audit. There is
> no daemon-side path to free a used id.
>
> **Broker guarantee**: the broker maintains a dedupe record per accepted
> `(mesh_id, client_message_id)` in `mesh.client_message_dedupe`. Each
> dedupe record carries a canonical `request_fingerprint`. Retries with
> the same id AND matching fingerprint collapse to the original
> `broker_message_id`. Retries with mismatched fingerprint return
> `409 idempotency_key_reused` and do **not** create a new message.
>
> **Atomicity guarantee**: dedupe row insertion, message row insertion,
> and history row insertion happen in one broker DB transaction. Either
> all land, or none do. No orphan dedupe rows.
>
> **End-to-end guarantee**: at-least-once delivery, with
> `client_message_id` propagated to receivers' inboxes.

### 4.2 Daemon-supplied `client_message_id` — unchanged from v3 §4.2

### 4.3 Broker schema — request fingerprint added (v6)

```sql
CREATE TABLE mesh.client_message_dedupe (
  mesh_id              UUID    NOT NULL REFERENCES mesh.mesh(id) ON DELETE CASCADE,
  client_message_id    TEXT    NOT NULL,

  -- The original accepted message; FK NOT enforced because the message row
  -- may be GC'd by retention sweeps before the dedupe row expires.
  broker_message_id    UUID    NOT NULL,

  -- Canonical fingerprint of the original request. Recomputed on every
  -- duplicate retry; mismatch → 409 idempotency_key_reused. Schema in §4.4.
  request_fingerprint  BYTEA   NOT NULL,                    -- 32-byte sha256

  destination_kind     TEXT    NOT NULL CHECK(destination_kind IN ('topic','dm','queue')),
  destination_ref      TEXT    NOT NULL,
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ,                          -- NULL = `permanent` mode
  history_available    BOOLEAN NOT NULL DEFAULT TRUE,        -- flipped FALSE when message row GC'd

  PRIMARY KEY (mesh_id, client_message_id)
);

CREATE INDEX client_message_dedupe_expires_idx
  ON mesh.client_message_dedupe(expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE mesh.topic_message ADD COLUMN client_message_id TEXT;
ALTER TABLE mesh.message_queue ADD COLUMN client_message_id TEXT;
```

**`status` column dropped (codex r5)**. Rejected requests do **not**
consume idempotency keys. Rationale below in §4.6.

### 4.4 Request fingerprint — canonical form (NEW v6)

The fingerprint covers everything that makes a send semantically distinct.
A retry must reproduce the same fingerprint bit-for-bit; anything else is
a different send and must not be collapsed.

```
request_fingerprint = sha256(
  envelope_version || 0x00 ||
  destination_kind || 0x00 ||
  destination_ref  || 0x00 ||
  reply_to_id_or_empty || 0x00 ||
  priority         || 0x00 ||
  meta_canonical_json || 0x00 ||
  body_hash
)
```

Where:
- `envelope_version`: integer string (e.g. `"1"`). Bumps when the envelope
  shape changes.
- `destination_kind`: `topic`, `dm`, or `queue`.
- `destination_ref`: topic name, recipient ed25519 pubkey hex, or queue id.
- `reply_to_id_or_empty`: original `broker_message_id` or empty string.
- `priority`: `now`, `next`, or `low`.
- `meta_canonical_json`: the `meta` field, serialized with sorted keys,
  no whitespace, escape-canonical (RFC 8785 JCS). Empty meta = empty string.
- `body_hash`: sha256(body bytes), hex.

The fingerprint is computed:
1. **Daemon-side** before durable outbox persistence — stored as
   `outbox.request_fingerprint` (NEW column) so retries always produce
   the same fingerprint regardless of caller behavior.
2. **Broker-side** on first receipt — stored in
   `client_message_dedupe.request_fingerprint`.
3. **Broker-side** on every duplicate retry — recomputed and compared
   byte-equal to the stored value.

If the daemon and broker disagree on the canonical form (e.g. JCS
implementation drift), the broker emits
`cm_broker_dedupe_fingerprint_mismatch_total{client_id, mesh_id}` and
returns `409 idempotency_key_reused` with a body that includes the
broker's fingerprint hex for debugging. Daemons that see this should
log it loudly and stop retrying that outbox row (it goes to `dead`).

### 4.5 Daemon-local idempotency at the IPC layer (from v8)

The daemon enforces fingerprint idempotency **before** the request hits
`outbox.db` so a caller bug never creates duplicate-key/mismatch-payload
state at all.

#### 4.5.1 IPC accept algorithm

On `POST /v1/send`:

1. Validate request envelope (auth, schema, size limits, destination
   resolvable). Failures here return `4xx` immediately. **No outbox
   row is written; the `client_message_id` is not consumed.**
2. Compute `request_fingerprint` (§4.4).
3. Open a SQLite transaction with `BEGIN IMMEDIATE` so a concurrent IPC
   accept on the same id serializes against this one. `BEGIN IMMEDIATE`
   acquires the RESERVED lock at transaction start; SQLite has no
   row-level lock and `SELECT FOR UPDATE` is not supported.
4. `SELECT id, request_fingerprint, status, broker_message_id,
   last_error FROM outbox WHERE client_message_id = ?`.
5. Apply the lookup table below. For the "(no row)" case, INSERT inside
   the same transaction.
6. COMMIT.

| Existing row state | Fingerprint | Daemon response |
|---|---|---|
| (no row) | — | INSERT new outbox row `pending`; return `202 accepted, queued` |
| `pending` | match | Return `202 accepted, queued`. No mutation |
| `pending` | mismatch | Return `409`, `conflict: "outbox_pending_fingerprint_mismatch"` |
| `inflight` | match | Return `202 accepted, inflight`. No mutation |
| `inflight` | mismatch | Return `409`, `conflict: "outbox_inflight_fingerprint_mismatch"` |
| `done` | match | Return `200 ok, duplicate: true, broker_message_id, history_id`. No broker call |
| `done` | mismatch | Return `409`, `conflict: "outbox_done_fingerprint_mismatch", broker_message_id` |
| `dead` | match | Return `409`, `conflict: "outbox_dead_fingerprint_match", reason: "<last_error>"` |
| `dead` | mismatch | Return `409`, `conflict: "outbox_dead_fingerprint_mismatch"` |
| `aborted` | match | Return `409`, `conflict: "outbox_aborted_fingerprint_match"`. Operator-retired id, never reusable |
| `aborted` | mismatch | Return `409`, `conflict: "outbox_aborted_fingerprint_mismatch"` |

Every `409` carries the daemon's `request_fingerprint` (8-byte hex
prefix) for client/server canonical-form-drift debugging. A
`client_message_id` written to `outbox.db` is permanently bound to that
row's lifecycle — the only "free" state is "no row exists".

#### 4.5.2 Outbox table

```sql
CREATE TABLE outbox (
  id                  TEXT PRIMARY KEY,
  client_message_id   TEXT NOT NULL UNIQUE,
  request_fingerprint BLOB NOT NULL,                          -- 32 bytes
  payload             BLOB NOT NULL,
  enqueued_at         INTEGER NOT NULL,
  attempts            INTEGER DEFAULT 0,
  next_attempt_at     INTEGER NOT NULL,
  status              TEXT CHECK(status IN
                        ('pending','inflight','done','dead','aborted')),
  last_error          TEXT,
  delivered_at        INTEGER,
  broker_message_id   TEXT,
  aborted_at          INTEGER,                                -- v7
  aborted_by          TEXT,                                   -- v7: operator/auto
  superseded_by       TEXT                                    -- v7: id of requeue successor
);
CREATE INDEX outbox_pending ON outbox(status, next_attempt_at);
CREATE INDEX outbox_aborted ON outbox(status, aborted_at) WHERE status = 'aborted';
```

`aborted_at` / `aborted_by` / `superseded_by` give operators a clear
audit trail. `superseded_by` lets `outbox inspect` show the chain when
a row is requeued multiple times. `request_fingerprint` is computed
once at IPC accept time and frozen for the row's lifecycle.

#### 4.5.3 Operator recovery via `requeue`

```
claudemesh daemon outbox requeue --id <outbox_row_id>
                                  [--new-client-id <id> | --auto]
                                  [--patch-payload <path>]
```

Atomically (single SQLite transaction):
1. Marks the existing row `aborted`, sets `aborted_at = now`,
   `aborted_by = "operator"`. Row is **never deleted** — audit trail
   permanent.
2. Mints a fresh `client_message_id` (caller-supplied or auto-ulid).
3. Inserts a new outbox row `pending` with the fresh id and the same
   payload (or patched if `--patch-payload`).
4. Sets `superseded_by = <new_row_id>` on the old row.

The old `client_message_id` is permanently dead. There is no path for
an id to become free again.

### 4.5b Broker duplicate response — three cases

| Case | HTTP/WS code | Body |
|---|---|---|
| First insert | `201 created` | `{ broker_message_id, client_message_id, history_id, duplicate: false }` |
| Duplicate, fingerprint match | `200 ok` | `{ broker_message_id, client_message_id, history_id, duplicate: true, history_available, first_seen_at }` |
| Duplicate, fingerprint mismatch | `409 idempotency_key_reused` | `{ client_message_id, conflict: "request_fingerprint_mismatch", broker_fingerprint_prefix: "ab12cd34..." }` (first 8 bytes hex) |

Daemon outcomes:
- `201` → mark outbox row `done`, store `broker_message_id`.
- `200 duplicate` with `history_available: true` → mark `done`, log INFO.
- `200 duplicate` with `history_available: false` → mark `done`, log WARN.
- `409 idempotency_key_reused` → mark outbox row `dead`. Operator runs
  `outbox requeue` (§4.5.3); old id stays `aborted`, new id is fresh.

### 4.6 Rejected-request semantics — id consumed iff outbox row written

> **Rule**: a `client_message_id` is daemon-consumed iff the daemon
> writes an outbox row. Anything that fails before outbox insertion
> (auth, schema, size, destination not resolvable) leaves the id
> untouched and freely reusable.

#### 4.6.1 Daemon-side rejection phasing

| Phase | When daemon rejects | Outbox row? | Caller may reuse id? |
|---|---|---|---|
| **A. IPC validation** (auth, schema, size, destination resolvable) | Before §4.5.1 step 3 | No | Yes — id never consumed |
| **B. Outbox stored, broker network/transient failure** | After IPC accept, broker `5xx` or timeout | `pending` → retried | N/A — daemon owns retries |
| **C. Outbox stored, broker permanent rejection** | Broker returns `4xx` after IPC accept | `dead` | No — rotate via `requeue` |
| **D. Operator retirement** | Operator runs `requeue` on `dead` or `pending` row | `aborted` (audit) + new row with fresh id | Old id NEVER reusable; new id is fresh |

#### 4.6.2 Broker-side rejection phasing (B1 / B2 / B3)

The broker validates in three phases relative to dedupe-row insertion:

| Phase | Validation | Side effects | Result for direct broker callers (none in v0.9.0) |
|---|---|---|---|
| **B1. Pre-dedupe-claim** | Auth (mesh membership), schema, size, mesh exists, member exists, destination kind valid, payload bytes ≤ `max_payload.inline_bytes`, rate limit not exceeded | None | `4xx`. No dedupe row. Direct broker caller may retry with same id |
| **B2. Post-dedupe-claim** (in-tx) | destination_ref existence (topic exists, member subscribed, etc.) | INSERT into dedupe rolled back | `4xx`, transaction rolled back, no dedupe row remains. Direct broker caller may retry with same id |
| **B3. Accepted** | All side effects commit atomically | Dedupe row, message row, history row, delivery_queue rows | `201` with `broker_message_id` |

**Daemon-mediated callers (the only path in v0.9.0)** see only the
daemon-layer rules of §4.6.1: any broker `4xx` after IPC accept lands
the outbox row in `dead`. Daemon-mediated callers MUST rotate via
`requeue` (§4.5.3); the daemon-consumed id is never reusable
regardless of whether the broker layer sees a dedupe row. The "may
retry with same id" wording above describes broker-bypass callers
only, which v0.9.0 does not have.

**Critical guarantee**: there is no broker code path where a permanent
4xx leaves a dedupe row behind. Either the request committed and a
dedupe row exists (B3), or it didn't and no dedupe row exists (B1, B2).
"Dedupe row exists" is the unambiguous signal of "id consumed at the
broker layer."

If the broker decides post-commit that an accepted message is invalid
(async content-policy job), that's NOT a permanent rejection — it's a
follow-up moderation event that operates on the `broker_message_id`,
not on the dedupe key.

Net result: `client_message_dedupe` rows only exist when the broker
**successfully** accepted a message and committed it. The single source
of truth for "was this idempotency key consumed?" is the existence of
the dedupe row. No status enum, no ambiguous states.

### 4.7 Broker atomicity contract

#### 4.7.1 Side-effect inventory

Every successful broker accept atomically commits these durable state
changes in **one transaction**:

| Effect | Table | Why in-tx |
|---|---|---|
| Dedupe record | `mesh.client_message_dedupe` | Idempotency authority |
| Message body | `mesh.topic_message` / `mesh.message_queue` | Authoritative store |
| History row | `mesh.message_history` | Replay log; lost-on-rollback breaks ordered replay |
| Fan-out work | `mesh.delivery_queue` | Each recipient must see exactly committed messages |

**Outside the transaction** (non-authoritative or rebuildable):
- WS push to live subscribers — best-effort live notifications.
- Webhook fan-out — async via `delivery_queue` workers.
- Rate-limit counters — telemetry only; authority is the external
  limiter checked in B1.
- Audit log entries — append-only stream; rebuildable from history.
- Search/FTS index updates — async via outbox-pattern worker.
- Mention index updates — async (deferred in-tx promotion to followups
  doc).
- Metrics — Prometheus, pull-based.

If any in-transaction insert fails, the transaction rolls back
completely. The accept is `5xx` to daemon; daemon retries. No partial
state.

#### 4.7.2 Pseudocode

```sql
-- Pre-generate broker_message_id (ulid) in code, pass in.
BEGIN;

-- Step 1: try to claim the idempotency key.
INSERT INTO mesh.client_message_dedupe
  (mesh_id, client_message_id, broker_message_id, request_fingerprint,
   destination_kind, destination_ref, expires_at)
  VALUES ($mesh_id, $client_id, $msg_id, $fingerprint,
          $dest_kind, $dest_ref, $expires_at)
  ON CONFLICT (mesh_id, client_message_id) DO NOTHING;

-- Step 2: inspect what's actually there now (ours or someone else's).
SELECT broker_message_id, request_fingerprint, destination_kind,
       destination_ref, history_available, first_seen_at
  FROM mesh.client_message_dedupe
  WHERE mesh_id = $mesh_id AND client_message_id = $client_id
  FOR SHARE;

-- Branch:
--   row.broker_message_id == $msg_id  → first insert; continue.
--   row.broker_message_id != $msg_id  → duplicate. Compare fingerprints:
--     match    → ROLLBACK; return 200 duplicate.
--     mismatch → ROLLBACK; return 409 idempotency_key_reused.

-- Step 3: validate Phase B2 (destination_ref existence — topic exists,
-- member subscribed, etc.). If B2 fails → ROLLBACK; return 4xx (no
-- dedupe row remains).

-- Step 4: insert in-tx side effects (§4.7.1).
INSERT INTO mesh.topic_message (id, mesh_id, client_message_id, body, ...)
  VALUES ($msg_id, $mesh_id, $client_id, ...);

INSERT INTO mesh.message_history (broker_message_id, mesh_id, ...)
  VALUES ($msg_id, $mesh_id, ...);

INSERT INTO mesh.delivery_queue (broker_message_id, recipient_pubkey, ...)
  SELECT $msg_id, member_pubkey, ...
    FROM mesh.topic_subscription
    WHERE topic = $dest_ref AND mesh_id = $mesh_id;

COMMIT;
```

The branch logic determines the response shape (`201` / `200 duplicate`
/ `409 idempotency_key_reused`) before COMMIT. The duplicate and 409
branches always ROLLBACK because nothing else needs to commit.
`SELECT … FOR SHARE` blocks concurrent writers from upgrading the same
dedupe row mid-transaction.

#### 4.7.3 Failure modes

- Crash before `COMMIT`: all rows roll back. Next daemon retry inserts
  cleanly.
- Crash after `COMMIT` but before WS ACK: dedupe row exists. Daemon
  retries → fingerprint matches → `200 duplicate`. Net: exactly one
  broker-accepted row, one daemon `done` transition.
- Constraint violation on message row insert: rolls back the whole tx.
  `5xx` to daemon. Same fingerprint reproduces; daemon eventually
  marks `dead`. No orphan dedupe row.

Counter `cm_broker_dedupe_orphan_check_total` runs nightly and
validates that every `client_message_dedupe` row has a matching
`topic_message` / `message_queue` row OR the matching row has been
retention-pruned (`history_available = FALSE`). Inconsistencies logged
as `cm_broker_dedupe_orphan_found{mesh_id}` for human review.

### 4.8 Outbox schema

The authoritative outbox schema for v0.9.0 is in §4.5.2 (includes
`aborted` status and audit columns from the v7 pull). `request_fingerprint`
is computed at IPC accept time and frozen for the row's lifecycle —
the daemon never recomputes from `payload` post-enqueue (would produce
drift if envelope_version changes between daemon runs).

### 4.9 Outbox max-age math — bounded (v6)

Codex r5: the v5 formula `(dedupe_retention_days * 24) - 24h_margin`
breaks at `dedupe_retention_days = 1` (yields zero) and is undefined
behavior at `<= 1`.

v6 formula and bounds:

- **Minimum supported broker dedupe retention**: 3 days. Daemon refuses
  to start if broker advertises `dedupe_retention_days < 3` (treats it
  as `feature_param_invalid`, exits 4010).
- **Daemon `max_age_hours` derivation**:
  - `permanent` mode → daemon uses config default (168h = 7d), cap 720h
    (30d).
  - `retention_scoped` mode → daemon `max_age_hours = max(72,
    (dedupe_retention_days * 24) - safety_margin_hours)` where
    `safety_margin_hours = max(24, ceil(dedupe_retention_days * 0.1 *
    24))`. For `dedupe_retention_days=3` this gives
    `max(72, 72-24) = 72h`. For 30 days: `max(72, 720-72) = 648h`. For
    365 days: `max(72, 8760-876) = 7884h`.
  - The 72h floor prevents the daemon outbox from being uselessly short
    — three days is enough margin for normal operator response to a
    paged outage.

- Operator override allowed via `[outbox] max_age_hours_override = N`,
  but if `N` exceeds `dedupe_retention_days * 24 - 1` daemon refuses to
  start with `outbox_max_age_above_dedupe_window`. The override exists
  for the rare case of a much-shorter-than-default outbox; it does not
  exist to circumvent the broker's dedupe window.

### 4.10 Inbox schema — unchanged from v3 §4.5

### 4.11 Crash recovery — unchanged from v3 §4.6

### 4.12 Failure modes — corrected for fingerprint model (v6)

- **Fingerprint mismatch on retry** (`409 idempotency_key_reused`): outbox
  row marked `dead`. Surfaced in `--failed` view. Operator command
  `outbox requeue --new-id <id>` rotates `client_message_id` and retries.
- **Daemon retry after dedupe row hard-deleted by retention sweep**: in
  `retention_scoped` mode, daemon `max_age_hours` is bounded inside the
  retention window (§4.9), so this can only happen via operator override.
  In that case the retry creates a NEW dedupe row + new message — the
  caller chose this risk explicitly. Counter
  `cm_daemon_retry_after_dedupe_expired_total`.
- **Daemon retry after dedupe row hard-deleted in `permanent` mode**:
  cannot happen by definition — `permanent` means no `expires_at`. Only
  mesh deletion removes dedupe rows.
- **Duplicate row, history pruned**: as v5 §4.4. Mark `done`, log
  `cm_daemon_dedupe_history_pruned_total`.

---

## 5. Inbound — unchanged from v3 §5

---

## 6. Hooks — unchanged from v4 §6

---

## 7-13. Multi-mesh, auto-routing, service install, observability, SDKs, security model, configuration — unchanged from v4

---

## 14. Lifecycle — unchanged from v5 §14

---

## 15. Version compat — feature param updated for new dedupe semantics

### 15.1 Feature bits with parameters (v6 update)

| Bit | `params.version` | Required parameters | Optional parameters |
|---|---|---|---|
| `client_message_id_dedupe` | `1` | `mode: "retention_scoped"\|"permanent"`, `dedupe_retention_days: int (>= 3)` (when mode=retention_scoped), `request_fingerprint: bool == true` | `tombstone_history_pruned_window_days: int` |
| `concurrent_connection_policy` | `1` | (no parameters) | `default_policy: "prefer_newest"\|"prefer_oldest"\|"allow_concurrent"` |
| `member_keypair_rotated_event` | `1` | (no parameters) | — |
| `key_epoch` | `1` | `max_concurrent_epochs: int (>= 1)` | — |
| `max_payload` | `1` | `inline_bytes: int (>= 1024)`, `blob_bytes: int (>= 1024)` | — |

`client_message_id_dedupe` ships at `params.version = 1` with
`request_fingerprint: bool == true` as a required parameter. A broker
that doesn't advertise the feature, or advertises it without
`request_fingerprint: true`, is treated as "feature missing" and the
daemon refuses to start. That's intentional — v0.9.0 daemons require
fingerprint enforcement for safe idempotency.

The schema-version-2 evolution (parameters that need versioning) is
deferred (see followups doc).

`dedupe_retention_days` minimum is 3 (matches the §4.9 floor).

### 15.2 Negotiation handshake — unchanged shape from v5 §15.2

### 15.3 IPC negotiation — unchanged from v3 §15.3

### 15.4 Compatibility matrix — unchanged from v3 §15.4

### 15.5 Diagnostic close code (v0.9.0)

v0.9.0 ships a single WebSocket close code with a structured
`close_reason` JSON payload that distinguishes the underlying cause:

| Code | Reason | `close_reason.kind` values |
|---|---|---|
| `4010` | `feature_unavailable` | `feature_unavailable` (feature missing from broker's `supported`) · `feature_param_invalid` (params fail validation: missing required, out of bounds, unknown version) · `feature_param_below_floor` (param below daemon's hard floor, e.g. `dedupe_retention_days < 3`) |

`close_reason` payload shape:
```json
{
  "kind": "feature_unavailable" | "feature_param_invalid" | "feature_param_below_floor",
  "feature": "client_message_id_dedupe",
  "detail": "..."
}
```

Daemon logs the full negotiation payload at WARN before exiting;
supervisor + alerting catches the restart loop. The split into
4011/4012 codes is deferred (see followups doc).

---

## 16. Threat model — unchanged from v4 §16

---

## 17. Migration — broker dedupe table + atomicity (v6)

Broker side, deploy order:

1. `CREATE TABLE mesh.client_message_dedupe` with v6 schema (additive,
   online-safe).
2. `ALTER TABLE mesh.topic_message ADD COLUMN client_message_id`.
3. `ALTER TABLE mesh.message_queue ADD COLUMN client_message_id`.
4. Broker code refactor: every accept path wraps dedupe insert + message
   insert in **one transaction** (§4.7). Pre-generated
   `broker_message_id` (ulid in code) passed in.
5. Broker code: nightly job to delete dedupe rows where `expires_at <
   NOW()` (skip in `permanent` mode).
6. Broker code: hook into the message-retention sweep — when a
   `topic_message` or `message_queue` row is hard-deleted, find the
   matching dedupe row by `client_message_id` and set `history_available
   = FALSE`. (Note: `client_message_id` is nullable on those tables for
   legacy traffic; nullable rows have no dedupe row to update.)
7. Broker code: nightly orphan-check job (§4.7); alerts on non-zero.
8. Broker advertises `client_message_id_dedupe` feature with
   `params.version = 1` and `request_fingerprint: true`.
9. Daemon refuses to start unless that feature bit is advertised with
   valid v1 params.

Rollback plan: feature flag disables fingerprint enforcement broker-side
(falls back to existing pre-v6 behavior — no dedupe). Daemons that
require fingerprint refuse to start. Operator switches off the feature
flag, reverts the daemon, restarts. No data loss; pending dedupe rows
remain in place for the next forward roll.

---

## v0.9.0 lock — what's in vs deferred

**In** (this document): everything codex r1–r4 ratified plus the six
sweet-spot pulls from v7–v9 enumerated at the top — `aborted` outbox
status, `BEGIN IMMEDIATE`, IPC duplicate lookup table, B1/B2/B3 phasing
concept, side-effect inventory, two-layer ID model.

**Deferred** (see `2026-05-03-daemon-spec-broker-hardening-followups.md`):
- B0 dedupe fast-path before rate-limit (v10).
- Lua-scripted idempotent rate limiter keyed by
  `(mesh, client_id, window)` (v10).
- In-tx `mesh.mention_index` (v8).
- 4011 / 4012 close-code split (v6 §15.5 — collapsed to 4010 with
  structured reason JSON for v0.9.0).
- Per-OS fingerprint precedence elaborate table (v8 §2.2.1).
- `request_fingerprint` schema-version-2 in feature negotiation (v6
  §15.1 ships at version 1 with `request_fingerprint: bool`).
- Force-expiry / quarantine semantics for `keypair-archive.json`
  (v8 §14.1.1).

These deferrals are real improvements but not v0.9.0 blockers. They
land as the broker matures and we have actual scale-load to optimize
against.

---

## Cross-spec note: §15.5 close-code collapse

For v0.9.0 we ship a single `4010 feature_unavailable` close code with
a structured `close_reason` JSON payload that distinguishes the
underlying cause:

```json
{
  "close_reason": {
    "kind": "feature_unavailable" | "feature_param_invalid" | "feature_param_below_floor",
    "feature": "client_message_id_dedupe",
    "detail": "..."
  }
}
```

The 4011/4012 split is deferred to followups.

---

## NON-NORMATIVE: round-6 review trailer (preserved for audit only)

> **Not part of the v0.9.0 contract.** Preserved verbatim from the
> v6 source spec as a record of the open questions at the time of the
> codex round-6 review. Items below have either been resolved in this
> merged document, deferred to the followups doc, or superseded.
> Do NOT use this section as a checklist for implementation.

1. **Request fingerprint canonical form (§4.4)** — does JCS work
   cross-language for `meta_canonical_json` (Python json.dumps,
   Go encoding/json, JS JSON.stringify all behave differently)? Should
   we ship a vetted JCS lib in each SDK or fall back to a simpler
   "sorted keys + no spaces + escape-as-stored" rule with conformance
   tests?
2. **Atomicity contract (§4.7)** — is the orphan-check sufficient, or
   does a violation mean we need a "broker rebuild dedupe from messages"
   recovery tool? The latter is destructive but useful for ops emergencies.
3. **Max-age formula (§4.9)** — is the 72h floor correct? Is the
   percentage-based safety margin (`max(24, ceil(0.1 * dedupe_window))`)
   the right shape? Or simpler to say "always 24h"?
4. **`409 idempotency_key_reused` recovery flow (§4.5)** — is sending the
   row to `dead` and surfacing it via `outbox --failed` enough? Should
   the daemon emit a high-priority event for the SSE stream so operators
   are paged immediately?
5. **Diagnostic close codes (§15.5)** — is splitting 4010/4011/4012
   useful, or does it just push complexity onto operators? Should we
   collapse to 4010 with structured close-reason JSON instead?
6. **Anything else still wrong?** Read it as if you were going to
   operate this for a year. What falls down?

Three options:
- **(a) v6 is shippable**: lock the spec, start coding the frozen core.
- **(b) v7 needed**: list the must-fix items.
- **(c) the architecture itself is wrong**: what would you do differently?

Be ruthless.
