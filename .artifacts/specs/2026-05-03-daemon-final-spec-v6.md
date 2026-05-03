# `claudemesh daemon` — Final Spec v6

> **Round 6.** v5 was reviewed by codex (round 5) which found the dedupe
> table architecture sound but called out four idempotency-correctness
> issues that would silently corrupt sends in production:
>
> 1. **Idempotency key reuse with different payload/destination** — v5
>    silently collapsed a different send onto the original. Need a request
>    fingerprint.
> 2. **`status = 'rejected'` underspecified** — schema allowed it, semantics
>    didn't. Either fully define or drop.
> 3. **Outbox max-age math edges** — `dedupe_retention_days = 1` minus 24h
>    margin = 0 hours, which is undefined.
> 4. **Broker atomicity not stated** — dedupe insert and message insert
>    must be one transaction or you produce orphan dedupe rows.
>
> v6 fixes all four. **Intent §0 unchanged from v2.** v6 only revises
> idempotency semantics in §4 and migration in §17.

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

### 4.1 The contract (precise — v6)

> **Local guarantee**: each successful `POST /v1/send` returns a stable
> `client_message_id`. The send is durably persisted to `outbox.db` before
> the response returns.
>
> **Broker guarantee**: the broker maintains a dedupe record per accepted
> `(mesh_id, client_message_id)` in `mesh.client_message_dedupe`. Each
> dedupe record carries a canonical `request_fingerprint`. Retries with
> the same `client_message_id` AND matching fingerprint collapse to the
> original `broker_message_id`. Retries with the same `client_message_id`
> but a different fingerprint return a deterministic conflict
> (`409 idempotency_key_reused`) and do **not** create a new message.
>
> **Atomicity guarantee**: dedupe row insertion and message row insertion
> happen in one broker DB transaction. Either both land, or neither. No
> orphan dedupe rows. If the broker crashes between dedupe insert and
> message insert, the rollback unwinds both.
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

### 4.5 Duplicate response — three cases (v6)

| Case | HTTP/WS code | Body |
|---|---|---|
| First insert | `201 created` | `{ broker_message_id, client_message_id, history_id, duplicate: false }` |
| Duplicate, fingerprint match | `200 ok` | `{ broker_message_id, client_message_id, history_id, duplicate: true, history_available, first_seen_at }` |
| Duplicate, fingerprint mismatch | `409 idempotency_key_reused` | `{ client_message_id, conflict: "request_fingerprint_mismatch", broker_fingerprint_prefix: "ab12cd34..." }` (first 8 bytes hex) |

Daemon outcomes:
- `201` → mark outbox row `done`, store `broker_message_id`. Normal path.
- `200 duplicate` with `history_available: true` → mark `done`, no
  re-fanout, log at INFO.
- `200 duplicate` with `history_available: false` → mark `done`, log at
  WARN. The original delivery succeeded; receivers got it.
- `409 idempotency_key_reused` → mark outbox row `dead`, surface in
  `claudemesh daemon outbox --failed`. Operator must rotate the
  idempotency key by hand and resubmit (`outbox requeue --new-id <id>`,
  NEW v6 subcommand). Daemon does NOT auto-rotate to avoid masking caller
  bugs.

### 4.6 Why rejected requests don't consume idempotency keys (v6)

`status` was in v5's schema but underspecified. Two scenarios:

- **Transient broker error** (DB down, queue full, network blip): daemon
  retries. If we'd persisted a `rejected` row on the first attempt, the
  retry would fail forever. Bad.
- **Permanent validation error** (payload too large, destination not
  found, auth missing): broker returns the appropriate `4xx` immediately
  without inserting a dedupe row. Daemon either fixes the request and
  retries (different fingerprint → fingerprint mismatch → `409` per §4.5)
  or marks dead. Persisting a "rejected" row buys nothing — the daemon
  isn't going to send the same broken request again with the same key.

Net result: `client_message_dedupe` rows only exist when the broker
**successfully** accepted a message and committed it. The single source
of truth for "was this idempotency key consumed?" is the existence of
the dedupe row. No status enum, no ambiguous states.

### 4.7 Broker atomicity contract (NEW v6)

Every accept path runs in one DB transaction with the following shape:

```sql
BEGIN;
  -- Pre-generate broker_message_id outside the transaction; pass in.
  INSERT INTO mesh.client_message_dedupe
    (mesh_id, client_message_id, broker_message_id, request_fingerprint,
     destination_kind, destination_ref, expires_at)
    VALUES ($mesh_id, $client_id, $msg_id, $fingerprint,
            $dest_kind, $dest_ref, $expires_at)
    ON CONFLICT (mesh_id, client_message_id) DO NOTHING
    RETURNING broker_message_id, request_fingerprint, history_available, first_seen_at;

  -- If RETURNING was empty (conflict), do a SELECT to fetch the original
  -- and exit the transaction with a duplicate response.
  -- If RETURNING produced a row AND $fingerprint != returned.fingerprint,
  -- that's the §4.5 mismatch path — also exit with 409.

  -- Otherwise, this is the first insert. Insert the message row.
  INSERT INTO mesh.topic_message (id, mesh_id, client_message_id, body, ...)
    VALUES ($msg_id, $mesh_id, $client_id, ...);

  -- Optional: enqueue fan-out work, etc.
COMMIT;
```

Failure modes:
- Crash before `COMMIT`: both rows roll back. Next daemon retry inserts
  cleanly.
- Crash after `COMMIT` but before WS ACK: dedupe row exists, message row
  exists. Daemon retries → fingerprint matches → `200 duplicate`. Net:
  exactly one broker-accepted row, one daemon `done` transition.
- Constraint violation on message row insert (e.g. unique violation on
  some other column): rolls back the dedupe insert. Returns `5xx` to
  daemon. Daemon retries; same fingerprint reproduces the same constraint
  violation; daemon eventually marks `dead`. No orphan dedupe row.

Counter `cm_broker_dedupe_orphan_check_total` runs nightly and validates
that every `client_message_dedupe` row has a matching `topic_message` or
`message_queue` row OR the matching message row has been retention-pruned
(in which case `history_available = FALSE` was set). Any row failing both
conditions is logged as `cm_broker_dedupe_orphan_found{mesh_id}` for
human review. Should be zero in steady state.

### 4.8 Outbox schema — fingerprint stored alongside (v6)

```sql
CREATE TABLE outbox (
  id                  TEXT PRIMARY KEY,
  client_message_id   TEXT NOT NULL UNIQUE,
  request_fingerprint BLOB NOT NULL,                          -- 32 bytes
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

`request_fingerprint` is computed at IPC accept time and stored. Every
retry sends the same bytes. The daemon never recomputes from `payload`
post-enqueue (would produce drift if envelope_version changes between
daemon runs).

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
| `client_message_id_dedupe` | `2` | `mode: "retention_scoped"\|"permanent"`, `dedupe_retention_days: int (>= 3)` (when mode=retention_scoped), `request_fingerprint: bool == true` | `tombstone_history_pruned_window_days: int` |
| `concurrent_connection_policy` | `1` | (no parameters) | `default_policy: "prefer_newest"\|"prefer_oldest"\|"allow_concurrent"` |
| `member_keypair_rotated_event` | `1` | (no parameters) | — |
| `key_epoch` | `1` | `max_concurrent_epochs: int (>= 1)` | — |
| `max_payload` | `1` | `inline_bytes: int (>= 1024)`, `blob_bytes: int (>= 1024)` | — |

`client_message_id_dedupe` bumped to `params.version = 2` because it now
requires `request_fingerprint = true`. A broker still on version 1
(no fingerprint comparison) is treated as "feature missing" and the
daemon refuses to start. That's intentional — v0.9.0 daemons require
fingerprint enforcement for safe idempotency.

`dedupe_retention_days` minimum raised to 3 (matches the §4.9 floor).

### 15.2 Negotiation handshake — unchanged shape from v5 §15.2

### 15.3 IPC negotiation — unchanged from v3 §15.3

### 15.4 Compatibility matrix — unchanged from v3 §15.4

### 15.5 Diagnostic close codes (NEW v6 — codex r5)

WebSocket close codes are split for diagnostic clarity:

| Code | Reason | When |
|---|---|---|
| `4010` | `feature_unavailable` | Required feature missing from broker's `supported` |
| `4011` | `feature_param_invalid` | Required feature present but parameters fail validation (missing required, out of bounds, unknown version) |
| `4012` | `feature_param_below_floor` | Required feature parameter below daemon's hard floor (e.g. `dedupe_retention_days < 3`) |

Daemon logs the full negotiation payload at WARN before exiting; supervisor
+ alerting catches the restart loop.

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
   `params.version = 2` and `request_fingerprint: true`.
9. Daemon refuses to start unless that feature bit is advertised with
   valid v2 params.

Rollback plan: feature flag disables fingerprint enforcement broker-side
(falls back to existing pre-v6 behavior — no dedupe). Daemons that
require fingerprint refuse to start. Operator switches off the feature
flag, reverts the daemon, restarts. No data loss; pending dedupe rows
remain in place for the next forward roll.

---

## What changed v5 → v6 (codex round-5 actionable items)

| Codex r5 item | v6 fix | Section |
|---|---|---|
| Idempotency key reuse with different payload silently collapses | `request_fingerprint` BYTEA in dedupe table; canonical form per §4.4; 409 on mismatch | §4.3, §4.4, §4.5 |
| `status='rejected'` underspecified | Dropped `status` column; rejected requests don't consume keys; existence of dedupe row = "key consumed" | §4.3, §4.6 |
| Outbox max-age math edges at low retention | 72h floor; min `dedupe_retention_days = 3`; percentage-based safety margin; explicit override gating | §4.9, §15.1 |
| Broker atomicity not stated | One transaction per accept path; orphan-check job; rollback semantics | §4.7 |
| Diagnostic detail on feature param failures | New close codes 4011 / 4012 separate from 4010 | §15.5 |
| Outbox stores fingerprint | NEW column `outbox.request_fingerprint` BLOB; computed once at IPC accept | §4.8 |
| Operator command for fingerprint-mismatch recovery | NEW `outbox requeue --new-id <id>` to rotate idempotency key | §4.5 |

---

## What needs review (round 6)

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
