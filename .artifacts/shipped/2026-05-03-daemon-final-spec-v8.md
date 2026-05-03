# `claudemesh daemon` — Final Spec v8

> **Round 8.** v7 was reviewed by codex (round 7) which found four
> remaining correctness problems, one of them new in v7:
>
> 1. **`aborted` semantics not in §4.5.1** and contradiction with `UNIQUE`
>    constraint — v7 said the old id "becomes free again at the daemon
>    layer," but `client_message_id TEXT NOT NULL UNIQUE` makes that
>    impossible without DELETE.
> 2. **Broker permanent-rejection ordering underspec** — v7 didn't state
>    when (relative to dedupe insertion) permanent 4xx fires.
> 3. **SQLite `SELECT FOR UPDATE`** — SQLite doesn't support it; needs
>    `BEGIN IMMEDIATE` for daemon-local serialization.
> 4. **Side-effect inventory still ambiguous** — rate-limit counters,
>    audit logs, mention/search indexes need explicit
>    in-tx/non-authoritative classification.
>
> v8 fixes all four. **Intent §0 unchanged from v2.** v8 only revises §4
> (delivery contract).

---

## 0. Intent — unchanged, see v2 §0

## 1. Process model — unchanged

## 2. Identity — unchanged from v5 §2

## 3. IPC surface — unchanged from v4 §3

---

## 4. Delivery contract — `aborted` clarified, broker phasing, SQLite locking

### 4.1 The contract (precise — v8)

> **Local guarantee**: each successful `POST /v1/send` returns a stable
> `client_message_id`. The send is durably persisted to `outbox.db` before
> the response returns. The daemon enforces request-fingerprint
> idempotency at the IPC layer: a duplicate `POST` with the same
> `client_message_id` returns `409 idempotency_key_reused` if the
> fingerprint mismatches, regardless of outbox row state.
>
> **Local audit guarantee (NEW v8)**: a `client_message_id` once written
> to `outbox.db` is **never released**. Operator recovery via
> `requeue --new-client-id` always mints a fresh id; the old row stays
> in `aborted` for audit. There is no daemon-side path to free a used
> id.
>
> **Broker guarantee**: same as v7 §4.1. Dedupe row exists iff the
> broker reached the post-validation accept phase (§4.7.1).
>
> **Atomicity guarantee**: same as v7 §4.1.
>
> **End-to-end guarantee**: at-least-once.

### 4.2 Daemon-supplied `client_message_id` — unchanged from v3 §4.2

### 4.3 Broker schema — unchanged from v6 §4.3

### 4.4 Request fingerprint canonical form — unchanged from v6 §4.4

### 4.5 Daemon-local idempotency at the IPC layer (v8 — `aborted` added, SQLite locking)

#### 4.5.1 IPC accept algorithm (v8)

On `POST /v1/send`:

1. Validate request envelope (auth, schema, size limits, destination
   resolvable). Failures here return `4xx` immediately. **No outbox row
   is written; the `client_message_id` is not consumed.**
2. Compute `request_fingerprint` (§4.4).
3. Open a SQLite transaction with `BEGIN IMMEDIATE` (v8 — codex r7) so
   a concurrent IPC accept on the same id serializes against this one.
   `BEGIN IMMEDIATE` acquires the RESERVED lock at transaction start,
   preventing any other writer from beginning a transaction on the same
   database; SQLite has no row-level lock and `SELECT FOR UPDATE` is not
   supported.
4. `SELECT id, request_fingerprint, status, broker_message_id,
   last_error FROM outbox WHERE client_message_id = ?`.
5. Apply the lookup table below. For the "(no row)" case, INSERT the
   new row inside the same transaction.
6. COMMIT.

| Existing row state | Fingerprint match? | Daemon response |
|---|---|---|
| (no row) | — | INSERT new outbox row in `pending`; return `202 accepted, queued` |
| `pending` | match | Return `202 accepted, queued`. No mutation |
| `pending` | mismatch | Return `409 idempotency_key_reused`, `conflict: "outbox_pending_fingerprint_mismatch"`. No mutation |
| `inflight` | match | Return `202 accepted, inflight`. No mutation |
| `inflight` | mismatch | Return `409 idempotency_key_reused`, `conflict: "outbox_inflight_fingerprint_mismatch"` |
| `done` | match | Return `200 ok, duplicate: true, broker_message_id, history_id`. No broker call |
| `done` | mismatch | Return `409 idempotency_key_reused`, `conflict: "outbox_done_fingerprint_mismatch", broker_message_id` |
| `dead` | match | Return `409 idempotency_key_reused`, `conflict: "outbox_dead_fingerprint_match", reason: "<last_error>"`. Same id never auto-retried |
| `dead` | mismatch | Return `409 idempotency_key_reused`, `conflict: "outbox_dead_fingerprint_mismatch"` |
| **`aborted`** (NEW v8) | **match** | Return `409 idempotency_key_reused`, `conflict: "outbox_aborted_fingerprint_match"`. The id was retired by operator action; never reusable |
| **`aborted`** (NEW v8) | **mismatch** | Return `409 idempotency_key_reused`, `conflict: "outbox_aborted_fingerprint_mismatch"` |

**Rule (v8 — codex r7)**: every IPC `409` carries the daemon's
`request_fingerprint` (8-byte hex prefix) so callers can debug
client/server canonical-form drift. **Every state in the table returns
something deterministic, including `aborted`.** A `client_message_id`
written to `outbox.db` is permanently bound to that row's lifecycle —
the only "free" state is "no row exists".

#### 4.5.2 Outbox table — fingerprint required

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
  aborted_at          INTEGER,                                -- NEW v8
  aborted_by          TEXT,                                   -- NEW v8: operator/auto
  superseded_by       TEXT                                    -- NEW v8: id of the requeue successor row, if any
);
CREATE INDEX outbox_pending ON outbox(status, next_attempt_at);
CREATE INDEX outbox_aborted ON outbox(status, aborted_at) WHERE status = 'aborted';
```

`aborted_at`, `aborted_by`, `superseded_by` give operators a clear
audit trail. `superseded_by` lets `outbox inspect` show the chain when
a row was requeued multiple times.

`request_fingerprint` is computed once at IPC accept time and frozen
forever for the row's lifecycle. Daemon never recomputes from
`payload`.

### 4.6 Rejected-request semantics — phasing made explicit (v8 — codex r7)

> **Single rule, phased**: a `client_message_id` is consumed iff a
> dedupe row exists. The dedupe row is the durable evidence that a
> request reached the post-validation accept phase. Pre-validation
> failures consume nothing — caller may freely retry the same id with
> a fixed payload.

#### 4.6.1 Daemon-side rejection phasing

| Phase | When daemon rejects | Outbox row? | Caller may reuse id? |
|---|---|---|---|
| **A. IPC validation** (auth, schema, size, destination resolvable) | Before §4.5.1 step 3 | No | Yes — id never consumed |
| **B. Outbox stored, broker network/transient failure** | After IPC accept, broker `5xx` or timeout | `pending` → retried | N/A — daemon owns retries |
| **C. Outbox stored, broker permanent rejection** | Broker returns `4xx` after IPC accept | `dead` | No — rotate via `requeue --new-client-id` |
| **D. Operator retirement** | Operator runs `requeue --new-client-id` on `dead` or `pending` row | `aborted` (audit) + new row with fresh id | Old id NEVER reusable; new id is fresh |

#### 4.6.2 Broker-side rejection phasing (NEW v8 — codex r7)

The broker validates in two phases relative to dedupe-row insertion:

| Phase | Validation | Result |
|---|---|---|
| **B1. Pre-dedupe-claim** (NEW — explicit) | Auth (mesh membership), schema, size, mesh exists, member exists, destination kind valid, payload bytes ≤ `max_payload.inline_bytes` | `4xx` returned. **No dedupe row inserted.** Caller may retry with same id and corrected payload. |
| **B2. Post-dedupe-claim** | Anything that requires the dedupe-claim transaction to be in progress: destination_ref existence (topic exists, member subscribed, etc.), per-mesh rate limit not exceeded | `4xx` returned, transaction rolled back, **no dedupe row remains**. Caller may retry with same id. |
| **B3. Accepted** | All side effects (dedupe row, message row, history row, delivery_queue rows) commit atomically | `201` returned with `broker_message_id` |

**Critical guarantee (v8)**: there is no broker code path where a
permanent rejection (4xx) leaves a dedupe row behind. Either the
request committed and a dedupe row exists (B3), or it didn't and no
dedupe row exists (B1, B2). This makes "dedupe row exists" the single
unambiguous signal of "id consumed at the broker layer."

If broker decides post-commit that an accepted message is invalid
(e.g. an async content-policy job runs on accepted messages), that's
NOT a permanent rejection — that's a follow-up moderation event that
operates on the broker_message_id, not on the dedupe key.

#### 4.6.3 Operator recovery via `requeue` (corrected v8)

To unstick a `dead` or `pending`-but-stuck row, operator runs:

```
claudemesh daemon outbox requeue --id <outbox_row_id>
                                  [--new-client-id <id> | --auto]
                                  [--patch-payload <path>]
```

This atomically (single SQLite transaction):

1. Marks the existing row's status to `aborted`, sets `aborted_at = now`,
   `aborted_by = "operator"`. Row is **never deleted** — audit trail
   permanent.
2. Mints a fresh `client_message_id` (caller-supplied via `--new-client-id`
   or auto-ulid'd via `--auto`).
3. Inserts a new outbox row in `pending` with the fresh id and the same
   payload (or patched payload if `--patch-payload` was given).
4. Sets `superseded_by = <new_row_id>` on the old row so
   `outbox inspect <old_id>` displays the chain.

**The old `client_message_id` is permanently dead** — `outbox.db` still
holds it via the `aborted` row's `UNIQUE` constraint, and any caller
re-using it gets `409 outbox_aborted_*` per §4.5.1.

If broker had ever accepted the old id (it reached B3), the broker's
dedupe row is also permanent — duplicate sends to broker with the old
id would also `409` for fingerprint mismatch (or return the original
`broker_message_id` for matching fingerprint). Daemon-side
`aborted` and broker-side dedupe row are independent records of "this
id was used," neither releases the id.

This is the resolution to v7's contradiction: there is **no path** for
an id to "become free again." If the operator wants to retry the
payload, they get a new id. The old id stays buried.

### 4.7 Broker atomicity contract — side-effect classification (v8 — codex r7)

#### 4.7.1 Side effects (v8 — explicit classification)

Every successful broker accept atomically commits these durable
state changes in **one transaction**:

| Effect | Table | In-tx? | Why |
|---|---|---|---|
| Dedupe record | `mesh.client_message_dedupe` | **Yes** | Idempotency authority |
| Message body | `mesh.topic_message` / `mesh.message_queue` | **Yes** | Authoritative store |
| History row | `mesh.message_history` | **Yes** | Replay log; lost-on-rollback would break ordered replay |
| Fan-out work | `mesh.delivery_queue` | **Yes** | Each recipient must see exactly the messages that committed |
| Mention index entries | `mesh.mention_index` | **Yes** | Reads off mention queries must match committed messages |

**Outside the transaction** — non-authoritative or rebuildable, with
explicit rationale per item:

| Effect | Where | Why outside |
|---|---|---|
| WS push to live subscribers | Async after COMMIT | Live notifications are best-effort; receivers re-fetch from history on reconnect |
| Webhook fan-out | Async via `delivery_queue` workers | Off-band; consumes committed `delivery_queue` rows |
| Rate-limit counters | Async, eventually consistent | Counters are an estimate; over-counting on retry > under-counting |
| Audit log entries | Async append-only stream | Audit log can be rebuilt from message history; in-tx writes hurt p99 |
| Search/FTS index updates | Async via outbox-pattern worker | Index can be rebuilt from authoritative tables |
| Metrics | Prometheus, pull-based | Always non-authoritative |

If any in-transaction insert fails, the transaction rolls back
completely. The accept is `5xx` to daemon; daemon retries. No partial
state.

The async side effects are driven off the in-transaction
`delivery_queue` and `message_history` rows, so they cannot get ahead
of committed state — only lag behind.

#### 4.7.2 Pseudocode — corrected and final (v8)

```sql
BEGIN;

-- Phase B1 already passed (see §4.6.2).

-- Phase B2 + B3: try to claim the idempotency key.
INSERT INTO mesh.client_message_dedupe
  (mesh_id, client_message_id, broker_message_id, request_fingerprint,
   destination_kind, destination_ref, expires_at)
  VALUES ($mesh_id, $client_id, $msg_id, $fingerprint,
          $dest_kind, $dest_ref, $expires_at)
  ON CONFLICT (mesh_id, client_message_id) DO NOTHING;

-- Inspect the row that's actually there now (ours or someone else's).
SELECT broker_message_id, request_fingerprint, destination_kind,
       destination_ref, history_available, first_seen_at
  FROM mesh.client_message_dedupe
  WHERE mesh_id = $mesh_id AND client_message_id = $client_id
  FOR SHARE;

-- Branch:
--   row.broker_message_id == $msg_id  → first insert; continue to step 3.
--   row.broker_message_id != $msg_id  → duplicate. Compare fingerprints:
--     fingerprint match    → ROLLBACK; return 200 duplicate.
--     fingerprint mismatch → ROLLBACK; return 409 idempotency_key_reused.

-- Step 3: validate Phase B2 (subscribers exist, rate limit not exceeded, etc.)
-- If B2 fails → ROLLBACK; return 4xx (no dedupe row remains).

-- Step 4: insert all in-tx side effects (§4.7.1).
INSERT INTO mesh.topic_message (id, mesh_id, client_message_id, body, ...)
  VALUES ($msg_id, $mesh_id, $client_id, ...);

INSERT INTO mesh.message_history (broker_message_id, mesh_id, ...)
  VALUES ($msg_id, $mesh_id, ...);

INSERT INTO mesh.delivery_queue (broker_message_id, recipient_pubkey, ...)
  SELECT $msg_id, member_pubkey, ...
    FROM mesh.topic_subscription
    WHERE topic = $dest_ref AND mesh_id = $mesh_id;

INSERT INTO mesh.mention_index (broker_message_id, mentioned_pubkey, ...)
  SELECT $msg_id, mention_pubkey, ...
    FROM unnest($mention_list);

COMMIT;

-- After COMMIT, async workers consume delivery_queue and update
-- search indexes, audit logs, rate-limit counters, etc.
```

#### 4.7.3 Orphan check — same as v7 §4.7.3

Extended over the side-effect inventory to verify in-tx items consistency.

### 4.8 Outbox max-age math — unchanged from v7 §4.8

Min `dedupe_retention_days = 7`; derived `max_age_hours = window -
safety_margin` strictly < window; safety_margin floor 24h.

### 4.9 Inbox schema — unchanged from v3 §4.5

### 4.10 Crash recovery — unchanged from v3 §4.6

### 4.11 Failure modes — `aborted` semantics added (v8)

- **IPC accept fingerprint-mismatch on duplicate id** (any state):
  returns 409 with `conflict` field per §4.5.1. Caller must use a new id.
- **IPC accept against `aborted` row, fingerprint match**: returns 409
  per §4.5.1 (NEW v8). Caller must use a new id; the old id is
  permanently retired.
- **Outbox row stuck in `dead`**: operator runs `outbox requeue` per
  §4.6.3; old id stays in `aborted`, new id is fresh.
- **Broker fingerprint mismatch on retry**: as v6/v7. Daemon marks
  `dead`; operator requeue path.
- **Daemon retry after dedupe row hard-deleted by broker retention
  sweep**: cannot happen unless operator overrode `max_age_hours`.
- **Broker phase B2 rejection on retry**: same id, same fingerprint,
  but B2 condition has changed (e.g. mesh rate-limit now exceeded).
  Daemon receives 4xx → marks `dead`. Operator can `requeue` once
  conditions clear.
- **Atomicity violation found by orphan check**: alerts ops.

---

## 5-13. — unchanged from v4

## 14. Lifecycle — unchanged from v5 §14

## 15. Version compat — unchanged from v7 §15

## 16. Threat model — unchanged

---

## 17. Migration — v8 outbox columns + broker phase B2 (v8)

Broker side, deploy order: same as v7 §17, with one addition:
- Step 4.5: explicitly split broker accept into Phase B1 (pre-dedupe
  validation, returns 4xx without writing) and Phase B2/B3 (within the
  accept transaction). Implementation: refactor handler to validate
  Phase B1 conditions before opening the DB transaction.

Daemon side:
- Outbox schema gains `aborted_at`, `aborted_by`, `superseded_by`
  columns and the `aborted` enum value (§4.5.2). Migration applies via
  `INSERT INTO new SELECT * FROM old` recreation if needed; v0.9.0 is
  greenfield.
- IPC accept switches to `BEGIN IMMEDIATE` for SQLite serialization
  (§4.5.1 step 3).
- IPC accept handles `aborted` rows per §4.5.1 (always 409).
- `claudemesh daemon outbox requeue` always mints a fresh
  `client_message_id`; never frees the old id. `--new-client-id <id>`
  and `--auto` are the only modes; the old `client_message_id`
  argument is removed.

---

## What changed v7 → v8 (codex round-7 actionable items)

| Codex r7 item | v8 fix | Section |
|---|---|---|
| `aborted` not in §4.5.1; `UNIQUE` contradiction | Added two `aborted` rows (match/mismatch) to lookup table; old id never reusable; new audit columns `aborted_at`/`aborted_by`/`superseded_by` | §4.5.1, §4.5.2, §4.6.3 |
| Broker permanent-rejection ordering vague | Three-phase model B1 (pre-dedupe), B2 (post-claim, in-tx), B3 (accepted); permanent 4xx never leaves dedupe row | §4.6.2 |
| SQLite `SELECT FOR UPDATE` invalid | Replaced with `BEGIN IMMEDIATE` for daemon-local serialization | §4.5.1 |
| Side-effect inventory ambiguous on rate-limit/audit/search | Explicit in-tx vs outside-tx table with rationale per item | §4.7.1 |
| Operator id reuse semantics | Old id permanently retired in `aborted`; requeue always mints fresh id; no daemon-side path to release used ids | §4.6.3 |

---

## What needs review (round 8)

1. **`aborted` permanence (§4.5.1, §4.6.3)** — is "old id permanently
   dead" correct, or is there a real operational case where releasing
   an id (e.g. caller mistyped a uuid) is worth the audit-trail loss?
2. **Phase B1/B2/B3 split (§4.6.2)** — clean enough? Is rate-limiting
   in B2 (in-tx) the right call, or should it be B1 (cheaper to enforce
   pre-tx)?
3. **In-tx mention_index (§4.7.1)** — agree it should be in-tx, or
   should mention indexing be async like search?
4. **`BEGIN IMMEDIATE` (§4.5.1)** — correct SQLite primitive, or should
   it be `BEGIN EXCLUSIVE` to also block readers? (Probably not — readers
   should see committed-pending rows, but worth confirming.)
5. **Anything else still wrong?** Read it as if you were going to
   operate this for a year.

Three options:
- **(a) v8 is shippable**: lock the spec, start coding the frozen core.
- **(b) v9 needed**: list the must-fix items.
- **(c) the architecture itself is wrong**: what would you do differently?

Be ruthless.
