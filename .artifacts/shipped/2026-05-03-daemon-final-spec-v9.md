# `claudemesh daemon` — Final Spec v9

> **Round 9.** v8 was reviewed by codex (round 8) which closed
> aborted/UNIQUE (5/5) and SQLite locking (5/5) cleanly, but flagged
> three spec-level correctness problems:
>
> 1. **Cross-layer ID-consumed authority contradiction** — v8 §4.1
>    said "id consumed iff dedupe row exists" while §4.6.1 says a
>    daemon-rejected id stays consumed locally with no broker dedupe
>    row. Two incompatible authorities.
> 2. **Rate-limit authority muddled** — v8 listed rate limit in B2
>    (in-tx authoritative) but classified rate-limit counters as
>    async/non-authoritative in §4.7.1.
> 3. **§4.1 broker guarantee wording** — "post-validation accept
>    phase" was fuzzy because B2 rolls back. Tighten to "accept
>    committed."
>
> v9 fixes all three with **two-layer ID rules** (daemon vs broker),
> rate-limit moved to B1 via an external atomic limiter, and §4.1
> tightened. **Intent §0 unchanged from v2.** v9 only revises §4.

---

## 0. Intent — unchanged, see v2 §0

## 1. Process model — unchanged

## 2. Identity — unchanged from v5 §2

## 3. IPC surface — unchanged from v4 §3

---

## 4. Delivery contract — `aborted` clarified, broker phasing, SQLite locking

### 4.1 The contract (precise — v9, two-layer ID model)

> **Two-layer ID rules** (NEW v9 — codex r8):
>
> - **Daemon-layer**: a `client_message_id` is **daemon-consumed** iff an
>   outbox row exists for it. Daemon-mediated callers can never reuse a
>   daemon-consumed id, regardless of whether the broker ever saw it.
>   The daemon's outbox is the single authority for "this id was issued
>   by my caller against this daemon."
> - **Broker-layer**: a `client_message_id` is **broker-consumed** iff a
>   dedupe row exists for `(mesh_id, client_message_id)` in
>   `mesh.client_message_dedupe`. Direct broker callers (none in
>   v0.9.0; reserved for future SDK paths that bypass the daemon) can
>   reuse a broker-non-consumed id freely.
> - In v0.9.0 there are no daemon-bypass clients, so for practical
>   purposes "daemon-consumed" is the operative rule.
>
> **Local guarantee**: each successful `POST /v1/send` returns a stable
> `client_message_id`. The send is durably persisted to `outbox.db`
> before the response returns. The daemon enforces request-fingerprint
> idempotency at the IPC layer (§4.5.1).
>
> **Local audit guarantee**: a `client_message_id` once written to
> `outbox.db` is **never released** (daemon-layer rule). Operator
> recovery via `requeue` always mints a fresh id; the old row stays in
> `aborted` for audit. There is no daemon-side path to free a used id.
>
> **Broker guarantee** (v9 — tightened): a dedupe row exists iff the
> broker accept transaction **committed** (Phase B3 reached). Phase B1
> rejections never insert dedupe rows. Phase B2 rejections roll the
> transaction back, so any partial dedupe row is unwound. Direct
> broker callers retrying after B1/B2 rejection see no dedupe row and
> may reuse the id.
>
> **Atomicity guarantee**: same as v8 §4.1.
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

### 4.6 Rejected-request semantics — two-layer rules + rate-limit moved to B1 (v9 — codex r8)

> **Two-layer rule (v9)**: a `client_message_id` is **daemon-consumed**
> iff an outbox row exists for it; **broker-consumed** iff a dedupe row
> exists. Daemon-mediated callers see daemon-layer authority (the only
> path in v0.9.0). Pre-validation failures at any layer consume nothing
> at that layer. The two layers are independent: a daemon-consumed id
> may or may not be broker-consumed (depending on whether the send
> reached B3); a daemon-non-consumed id can never be broker-consumed
> (no outbox row ⇒ no broker call from the daemon).

#### 4.6.1 Daemon-side rejection phasing (v9)

| Phase | When daemon rejects | Outbox row? | Daemon-consumed? | Same daemon caller may reuse id? |
|---|---|---|---|---|
| **A. IPC validation** (auth, schema, size, destination resolvable) | Before §4.5.1 step 3 | No | No | Yes — id never written locally |
| **B. Outbox stored, broker network/transient failure** | After IPC accept, broker `5xx` or timeout | `pending` → retried | Yes | N/A — daemon owns retries |
| **C. Outbox stored, broker permanent rejection** | Broker returns `4xx` after IPC accept | `dead` | Yes | No — rotate via `requeue` |
| **D. Operator retirement** | Operator runs `requeue` on `dead` or `pending` row | `aborted` (audit) + new row with fresh id | Yes (still consumed) | Old id NEVER reusable; new id is fresh |

The "daemon-consumed?" column is the daemon-layer authority. It does
not depend on whether the broker ever saw the request — phase C above
shows the broker has not committed a dedupe row, but the daemon still
holds the id in `dead` state.

#### 4.6.2 Broker-side rejection phasing (v9 — rate limit moved to B1)

The broker validates in two phases relative to dedupe-row insertion:

| Phase | Validation | Side effects | Result for direct broker callers |
|---|---|---|---|
| **B1. Pre-dedupe-claim** (atomic, external) | Auth (mesh membership), schema, size, mesh exists, member exists, destination kind valid, payload bytes ≤ `max_payload.inline_bytes`, **rate limit not exceeded** (atomic external limiter — see §4.6.4) | None | `4xx` returned. No dedupe row, no broker-consumed id. Caller may retry with same id once condition clears |
| **B2. Post-dedupe-claim** (in-tx) | Conditions that require the accept transaction to be in progress: destination_ref existence (topic exists, member subscribed, etc.) | INSERT into dedupe rolled back | `4xx` returned, transaction rolled back, no dedupe row remains. Caller may retry with same id |
| **B3. Accepted** | All side effects commit atomically | Dedupe row, message row, history row, delivery_queue rows, mention_index rows | `201` returned with `broker_message_id`. Id is broker-consumed |

**Daemon-mediated callers**: in v0.9.0 the daemon is the only B-phase
caller. Daemon-mediated callers see only the daemon-layer rules
(§4.6.1). The broker's "may retry with same id" wording in the table
above applies to direct broker callers only (none in v0.9.0; reserved
for future SDK paths).

**Critical guarantee (v9 — tightened from v8)**: a dedupe row exists
**iff the broker accept transaction committed (B3)**. There is no
broker code path where a permanent 4xx leaves a dedupe row behind.

If the broker decides post-commit that an accepted message is invalid
(async content-policy job, async moderation, etc.), that's NOT a
permanent rejection — it's a follow-up event that operates on the
`broker_message_id`, not on the dedupe key.

#### 4.6.4 Rate limiter — atomic, external, B1 (NEW v9 — codex r8)

Codex r8 caught: v8 listed rate-limit enforcement in B2 (in-tx) but
classified rate-limit *counters* as async/non-authoritative. Both
can't be true. v9 resolves it by moving rate-limit enforcement to B1
backed by an atomic external limiter:

- **Authority**: the broker's existing Redis (or equivalent
  fixed-window limiter) used for `claudemesh launch` rate-limiting is
  the authority for accept-time rate-limit enforcement. `INCR` with
  TTL is atomic; the broker checks the result before committing the
  Phase B2/B3 transaction.
- **Idempotency interaction**: rate-limit `INCR` happens **before** the
  dedupe-claim INSERT. If the limiter rejects, no DB transaction is
  opened, no dedupe row exists. If the limiter accepts but the in-tx
  Phase B2 then rejects (e.g. topic not found), the limiter `INCR` is
  not refunded. This is intentional: refunding would require a
  reliable distributed counter, and the over-counting risk is
  acceptable. Counter
  `cm_broker_rate_limit_consumed_then_rejected_total` exposes the
  delta for ops awareness.
- **Retries**: a daemon retry with the same `client_message_id` after a
  B1 rate-limit rejection produces another `INCR`. To avoid burning
  rate-limit budget on retries-of-rejected-ids, the broker can
  optionally short-circuit `INCR` if the rate-limit subsystem can
  cheaply detect "this exact `client_message_id` was rejected for
  rate-limit in the last N seconds" — but this is an optimization,
  not a correctness requirement.
- **Async counters**: `mesh.rate_limit_counter` (or any DB-resident
  view of "messages-per-mesh-per-window") is **non-authoritative** —
  it's metrics/telemetry rebuilt from the authoritative limiter and
  from message-history. Used for dashboards, not for accept decisions.

This split — atomic external limiter for enforcement, async DB
counters for telemetry — matches how every other rate-limited
subsystem in claudemesh works (`claudemesh launch`, dashboard chat
posts, etc.). No new infrastructure required.

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

### 4.7 Broker atomicity contract — side-effect classification (v9)

#### 4.7.1 Side effects (v9 — rate limit moved to B1 external)

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
| Rate-limit **counters** (telemetry only) | Async, eventually consistent | Authoritative limiter is the external Redis-style INCR in B1 (§4.6.4); the DB counter is rebuilt for dashboards, not consulted for accept |
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
-- Phase B1 already passed (see §4.6.2). This includes:
--   - schema/auth/size validation
--   - external atomic rate-limit INCR (§4.6.4)
-- Anything that fails B1 returns 4xx without ever opening this tx.

BEGIN;

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

-- Step 3: validate Phase B2 (destination_ref existence: topic exists,
-- member subscribed, etc.). Rate limit is NOT here — it was checked
-- atomically in B1 via the external limiter (§4.6.4) before this
-- transaction opened.
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

## What changed v8 → v9 (codex round-8 actionable items)

| Codex r8 item | v9 fix | Section |
|---|---|---|
| Cross-layer ID-consumed authority contradiction | Two-layer model: daemon-consumed iff outbox row; broker-consumed iff dedupe row committed; daemon-mediated callers see only daemon-layer authority | §4.1, §4.6.1, §4.6.2 |
| Rate-limit authority muddled (B2 vs async counters) | Rate limit moved to B1 via external atomic limiter (Redis-style INCR with TTL); DB rate-limit counters demoted to telemetry-only | §4.6.2, §4.6.4, §4.7.1 |
| §4.1 broker guarantee fuzzy | Tightened: "dedupe row exists iff broker accept transaction committed (B3)" | §4.1, §4.6.2 |

(Earlier rounds' fixes preserved unchanged.)

---

## What needs review (round 9)

1. **Two-layer ID model (§4.1, §4.6.1)** — is the daemon-vs-broker
   authority split clear, or does it create more confusion for
   operators reading "consumed" in different contexts? Should we use
   different verbs (e.g. "claimed" at daemon, "committed" at broker)?
2. **Rate-limit external limiter (§4.6.4)** — is "atomic external
   limiter" specified concretely enough? Is the over-counting on
   limiter-accepted-then-B2-rejected acceptable?
3. **B2 contents after rate-limit move** — B2 now only has
   `destination_ref existence`. Worth keeping a B2 phase at all, or
   collapse into B1+B3?
4. **Anything else still wrong?** Read it as if you were going to
   operate this for a year.

Three options:
- **(a) v9 is shippable**: lock the spec, start coding the frozen core.
- **(b) v10 needed**: list the must-fix items.
- **(c) the architecture itself is wrong**: what would you do differently?

Be ruthless.
