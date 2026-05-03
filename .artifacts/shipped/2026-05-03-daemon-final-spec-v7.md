# `claudemesh daemon` — Final Spec v7

> **Round 7.** v6 was reviewed by codex (round 6) which found the broker
> layer largely correct but caught five daemon-side and broker-tx
> correctness gaps:
>
> 1. **Daemon-local duplicate POST semantics** undefined — local fingerprint
>    comparison missing across `pending` / `inflight` / `done` / `dead`.
> 2. **§4.6 rejected-request contradiction** — talked about both "fix and
>    retry" and "fingerprint mismatch → 409". Only one of those can be true.
> 3. **§4.7 pseudocode bug** — `ON CONFLICT DO NOTHING RETURNING` returns
>    nothing on conflict; the fingerprint comparison was in the wrong branch.
> 4. **Max-age math floor consumes margin** — at min retention (3 days),
>    daemon max-age 72h equals broker window 72h. Not inside the window.
> 5. **Broker transaction boundary incomplete** — fan-out/queue/history side
>    effects not stated as in-transaction; "optional" wording was wrong.
>
> v7 fixes all five. **Intent §0 unchanged from v2.** v7 only revises §4
> (delivery contract) and §15 (feature param min) and §17 (migration).

---

## 0. Intent — unchanged, see v2 §0

---

## 1. Process model — unchanged

## 2. Identity — unchanged from v5 §2

## 3. IPC surface — unchanged from v4 §3

---

## 4. Delivery contract — at-least-once, fingerprinted at IPC and broker layers

### 4.1 The contract (precise — v7)

> **Local guarantee**: each successful `POST /v1/send` returns a stable
> `client_message_id`. The send is durably persisted to `outbox.db` before
> the response returns. The daemon enforces request-fingerprint
> idempotency at the IPC layer: a duplicate `POST` with the same
> `client_message_id` and matching `request_fingerprint` returns the
> stable prior result; with a mismatched fingerprint it returns local
> `409 idempotency_key_reused` and the new request is **not** persisted.
>
> **Broker guarantee**: the broker maintains a dedupe record per
> accepted `(mesh_id, client_message_id)` in `mesh.client_message_dedupe`
> with `request_fingerprint`. Retries with matching fingerprint collapse;
> retries with mismatched fingerprint return `409
> idempotency_key_reused` without creating a new message.
>
> **Atomicity guarantee**: every durable side effect of a successful
> accept (dedupe row, message row, fan-out work, history row, queue
> insertion) lands in the same broker DB transaction. Either all commit
> or none do.
>
> **End-to-end guarantee**: at-least-once delivery, with
> `client_message_id` propagated to receivers' inboxes.

### 4.2 Daemon-supplied `client_message_id` — unchanged from v3 §4.2

### 4.3 Broker schema — unchanged from v6 §4.3

(`mesh.client_message_dedupe` table with `request_fingerprint BYTEA`, no
`status` column.)

### 4.4 Request fingerprint canonical form — unchanged from v6 §4.4

### 4.5 Daemon-local idempotency at the IPC layer (NEW v7 — codex r6)

The daemon enforces fingerprint idempotency **before** the request hits
`outbox.db` so a caller bug never creates duplicate-key/mismatch-payload
state at all.

#### 4.5.1 IPC accept algorithm

On `POST /v1/send`:

1. Validate request envelope (auth, schema, size limits). Failures
   here return `4xx` immediately. **No outbox row is written.** The
   `client_message_id` (whether caller-supplied or daemon-minted) is
   **not consumed** — the same id may be reused by the caller for a
   subsequent valid send.
2. Compute `request_fingerprint` (§4.4).
3. Look up existing outbox row by `client_message_id`:

| Existing row state | Fingerprint match? | Daemon response |
|---|---|---|
| (no row) | — | Insert new outbox row in `pending`; return `202 accepted, queued` with `client_message_id` |
| `pending` | match | Return `202 accepted, queued` with the existing `client_message_id`. No new row. Idempotent retry of an in-progress send |
| `pending` | mismatch | Return `409 idempotency_key_reused` with `conflict: "outbox_pending_fingerprint_mismatch"`. **No mutation of the existing row.** |
| `inflight` | match | Return `202 accepted, inflight`. No new row. Caller is retrying mid-broker-roundtrip |
| `inflight` | mismatch | Return `409 idempotency_key_reused` with `conflict: "outbox_inflight_fingerprint_mismatch"` |
| `done` | match | Return `200 ok, duplicate: true, broker_message_id, history_id`. No new row, no broker call |
| `done` | mismatch | Return `409 idempotency_key_reused` with `conflict: "outbox_done_fingerprint_mismatch", broker_message_id` |
| `dead` | match | Return `409 idempotency_key_reused` with `conflict: "outbox_dead_fingerprint_match", reason: "<last_error>"`. Caller must rotate the id (see §4.6.3) — daemon refuses to re-attempt a dead row's exact bytes. |
| `dead` | mismatch | Return `409 idempotency_key_reused` with `conflict: "outbox_dead_fingerprint_mismatch"` |

Rule: any IPC `409` carries the daemon's `request_fingerprint` (8-byte
hex prefix) so callers can debug client/server canonical-form drift.

#### 4.5.2 Outbox table — fingerprint required, atomic UPSERT removed

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

Insertion is `BEGIN; SELECT FOR UPDATE; if-no-row INSERT; COMMIT;` —
explicit lock + check + insert, not `INSERT OR IGNORE`. The daemon
never auto-mutates an existing row's `request_fingerprint` or
`payload`; mismatches are 409s, not silent overwrites.

`request_fingerprint` is computed once at IPC accept time and frozen.
Retries to the broker re-send the same bytes from `payload` and the
same `request_fingerprint`. Daemon does not recompute post-enqueue.

### 4.6 Rejected-request semantics — pick one rule (NEW v7 — codex r6)

> **Rule: the `client_message_id` is consumed iff the daemon writes an
> outbox row. Anything that fails before outbox insertion (validation,
> auth, size) leaves the id untouched and freely reusable.**

This makes §4.6 internally consistent with §4.5:

#### 4.6.1 IPC validation failure (no outbox row written)

- Schema/auth/size/destination-not-resolvable failures return `4xx`
  immediately. The `client_message_id` is **not** stored anywhere on
  the daemon. Caller may re-send with the same id and a fixed payload;
  it will be treated as a fresh request because no outbox row exists.

#### 4.6.2 Outbox row exists, broker permanent rejection (4xx response)

- Daemon receives `4xx` from broker (e.g. payload size delta between
  daemon and broker advertised limits, mesh-level reject). Outbox row
  transitions to `dead` with `last_error` populated.
- Caller retrying with same `client_message_id` → daemon returns
  `409 idempotency_key_reused, conflict: "outbox_dead_*"` per §4.5.1.
- The id is consumed (row is locked in `dead`) until operator action.

#### 4.6.3 Operator recovery: rotating an idempotency key

To unstick a `dead` row whose payload needs to change, operator runs:

```
claudemesh daemon outbox requeue --id <outbox_id> --new-client-id [auto|<id>]
```

This atomically:
1. Marks the existing `dead` row as `aborted` (terminal, never retried).
2. Creates a new outbox row with a fresh `client_message_id` (caller-
   supplied or daemon-ulid'd) and the SAME or a CALLER-PATCHED payload.
3. The old `client_message_id` becomes free again at the daemon layer
   but is still locked at the broker layer if the broker had ever
   accepted it (its dedupe row stays). For a row that died before
   broker acceptance, the id is fully reusable end-to-end.

Operators see a clear distinction between `dead` (needs operator
attention) and `aborted` (intentionally retired). Add `aborted` to the
status CHECK constraint:

```sql
status TEXT CHECK(status IN ('pending','inflight','done','dead','aborted'))
```

### 4.7 Broker atomicity contract — corrected pseudocode + side-effect inventory (v7 — codex r6)

#### 4.7.1 Side effects inside the transaction

Every successful broker accept atomically commits the following durable
state in **one transaction**:

| Effect | Table | Notes |
|---|---|---|
| Dedupe record | `mesh.client_message_dedupe` | NEW row keyed by `(mesh_id, client_message_id)` |
| Message body | `mesh.topic_message` OR `mesh.message_queue` | NEW row keyed by `broker_message_id` (pre-generated ulid) |
| History row | `mesh.message_history` | NEW row pointing at `broker_message_id` for ordered replay |
| Fan-out work | `mesh.delivery_queue` | One row per intended recipient (member subscribed to topic, recipient of DM, etc.) |

Effects **outside** the transaction (committed after ACK to daemon):
- WebSocket pushes to currently-connected subscribers — these are best-
  effort live notifications; on failure subscribers fetch from history
  on next connect.
- Webhook fan-out (post-v0.9.0 feature) — runs asynchronously off the
  `delivery_queue` rows committed inside the transaction.

If any in-transaction insert fails (constraint violation, DB error),
the transaction rolls back: no dedupe row, no message row, no history,
no delivery queue rows. Broker returns `5xx` to daemon; daemon retries.

#### 4.7.2 Corrected pseudocode (codex r6)

The fingerprint comparison must happen on the conflict-select branch,
not the `RETURNING` branch:

```sql
BEGIN;

-- Pre-generate broker_message_id (ulid) outside the transaction, pass in.

-- Step 1: try to claim the idempotency key.
INSERT INTO mesh.client_message_dedupe
  (mesh_id, client_message_id, broker_message_id, request_fingerprint,
   destination_kind, destination_ref, expires_at)
  VALUES ($mesh_id, $client_id, $msg_id, $fingerprint,
          $dest_kind, $dest_ref, $expires_at)
  ON CONFLICT (mesh_id, client_message_id) DO NOTHING;

-- Step 2: was it our insert?
SELECT broker_message_id, request_fingerprint, destination_kind,
       destination_ref, history_available, first_seen_at
  FROM mesh.client_message_dedupe
  WHERE mesh_id = $mesh_id AND client_message_id = $client_id
  FOR SHARE;

-- If returned.broker_message_id == $msg_id (our pre-generated id),
--   this was the first insert. Continue to step 3.
-- If returned.broker_message_id != $msg_id AND
--    returned.request_fingerprint == $fingerprint,
--   this is a duplicate retry. ROLLBACK; return 200 duplicate.
-- If returned.broker_message_id != $msg_id AND
--    returned.request_fingerprint != $fingerprint,
--   ROLLBACK; return 409 idempotency_key_reused.

-- Step 3: insert message row, history, fan-out queue.
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

The branch logic determines the response shape (`201` vs `200
duplicate` vs `409 idempotency_key_reused`) before COMMIT. The
duplicate and 409 branches always ROLLBACK because nothing else
needs to commit on those paths.

`SELECT … FOR SHARE` blocks concurrent writers from upgrading the
same dedupe row mid-transaction; a concurrent insert with the same
key will block until our transaction completes.

#### 4.7.3 Orphan check — covers full inventory now

The nightly `cm_broker_dedupe_orphan_check_total` job (v6 §4.7) is
extended to verify all four in-transaction effects. For each
`client_message_dedupe` row:
- Either the corresponding `topic_message` / `message_queue` row exists,
  OR `history_available = FALSE` AND a deleted-tombstone is recorded.
- AND a corresponding `message_history` row exists (or has been pruned
  per history retention).
- AND zero outstanding `delivery_queue` rows older than fan-out timeout
  reference a `broker_message_id` whose dedupe row is missing.

Any inconsistency logged as `cm_broker_atomicity_violation_found` for
human review. Should be zero in steady state.

### 4.8 Outbox max-age math — strictly inside broker window (v7 — codex r6)

Codex r6: at v6's 3-day minimum, daemon max_age (72h) **equaled** broker
window (72h). That isn't "inside the window."

v7 raises the floor and tightens the formula:

- **Minimum supported broker `dedupe_retention_days`**: **7** (was 3 in
  v6). Below this, daemon refuses to start with `4012
  feature_param_below_floor`.
- **Daemon `max_age_hours` derivation** (`retention_scoped` mode):
  ```
  safety_margin_hours = max(24, ceil(dedupe_retention_days * 0.1 * 24))
  max_age_hours       = (dedupe_retention_days * 24) - safety_margin_hours
  ```
  At minimum (7 days): `safety_margin = max(24, 17) = 24h`; `max_age =
  168 - 24 = 144h`. Daemon outbox ≤144h, broker window ≥168h, gap ≥24h.
- **Daemon `max_age_hours` derivation** (`permanent` mode):
  ```
  max_age_hours = config.outbox.max_age_hours_default  (168h)
                  capped at config.outbox.max_age_hours_cap  (720h)
  ```
- **Operator override**: `[outbox] max_age_hours_override = N` accepted
  iff `N <= dedupe_retention_days * 24 - 24`. Above that → daemon
  refuses to start with `outbox_max_age_above_dedupe_window` clear text.
- The 72h floor from v6 is **dropped** because the new 7-day broker
  minimum already produces a 144h derived max-age — well above any
  realistic floor concern.

### 4.9 Inbox schema — unchanged from v3 §4.5

### 4.10 Crash recovery — unchanged from v3 §4.6

### 4.11 Failure modes — unchanged from v6 §4.12, with §4.5/§4.6 added

- **IPC accept fingerprint-mismatch on duplicate id**: returns 409 with
  `conflict` field per §4.5.1. Caller must rotate id.
- **Outbox row stuck in `dead`**: operator runs `outbox requeue
  --new-client-id` per §4.6.3.
- **Broker fingerprint mismatch on retry**: as v6 §4.5. Daemon marks
  `dead`, surfaces in `outbox --failed`.
- **Daemon retry after dedupe row hard-deleted by broker retention
  sweep**: cannot happen unless operator overrode `max_age_hours`
  beyond the safety margin. In `permanent` mode cannot happen at all.
- **Atomicity violation found by orphan check**: alerts ops; broker
  team investigates. Should be zero.

---

## 5. Inbound — unchanged from v3 §5

## 6. Hooks — unchanged from v4 §6

## 7-13. — unchanged from v4

## 14. Lifecycle — unchanged from v5 §14

---

## 15. Version compat — minimum dedupe_retention_days raised

### 15.1 Feature bits with parameters (v7 update)

Only one row changes from v6 §15.1:

| Bit | `params.version` | Required parameters | Optional parameters |
|---|---|---|---|
| `client_message_id_dedupe` | `2` | `mode: "retention_scoped"\|"permanent"`, `dedupe_retention_days: int (>= 7)` (when mode=retention_scoped), `request_fingerprint: bool == true` | `tombstone_history_pruned_window_days: int` |

`dedupe_retention_days` minimum raised from 3 to 7 to keep daemon
outbox max-age strictly inside the broker window with margin (§4.8).

### 15.2 — 15.5 unchanged from v6 §15

(`feature_negotiation_request/response`, IPC negotiation, compat
matrix, diagnostic close codes 4010 / 4011 / 4012.)

---

## 16. Threat model — unchanged from v4 §16

---

## 17. Migration — broker dedupe + atomicity + corrected pseudocode (v7)

Broker side, deploy order:

1. `CREATE TABLE mesh.client_message_dedupe` (v6 §4.3 schema, unchanged
   in v7).
2. `ALTER TABLE mesh.topic_message ADD COLUMN client_message_id`.
3. `ALTER TABLE mesh.message_queue ADD COLUMN client_message_id`.
4. Broker code refactor: every accept path runs the v7 §4.7.2 corrected
   pseudocode in **one transaction** with the side-effect inventory
   from §4.7.1 — dedupe row, message row, history row, delivery_queue
   rows all in-tx.
5. Broker code: existing fan-out workers consume `delivery_queue` rows
   committed by the accept transaction.
6. Broker code: nightly retention sweep + `history_available` flip on
   message-row pruning (unchanged from v6 §17 step 5+6).
7. Broker code: extended orphan-check job (v7 §4.7.3) — alerts on
   atomicity violations across full inventory.
8. Broker advertises `client_message_id_dedupe` feature with
   `params.version = 2`, `request_fingerprint: true`,
   `dedupe_retention_days >= 7` (was 3).
9. Daemon refuses to start unless above is advertised.

Daemon side:
- Outbox table gains `aborted` status (§4.6.3); migration ALTER on the
  CHECK constraint at startup if SQLite version <DDL works without
  a recreate; else table recreate via `INSERT INTO new SELECT * FROM
  old`. v0.9.0 daemons are fresh installs by definition; existing
  outboxes don't exist.
- IPC accept path implements §4.5.1 lookup table.
- IPC error envelope adds `conflict` and `daemon_fingerprint_prefix`
  fields for 409 responses.
- New CLI verb `claudemesh daemon outbox requeue --id <id>
  --new-client-id [auto|<id>]` (§4.6.3).

---

## What changed v6 → v7 (codex round-6 actionable items)

| Codex r6 item | v7 fix | Section |
|---|---|---|
| Daemon-local duplicate POST semantics undefined | Full lookup table for pending/inflight/done/dead × match/mismatch; `409 idempotency_key_reused` at IPC layer with `conflict` field | §4.5 |
| §4.6 rejected-request contradiction | Single rule: id consumed iff outbox row written; pre-outbox failures leave id untouched; broker-rejected outbox row goes to `dead`, requires `requeue --new-client-id` | §4.6 |
| §4.7 pseudocode wrong | Corrected: `INSERT ON CONFLICT DO NOTHING`, then `SELECT FOR SHARE`, then branch on returned `broker_message_id` and `fingerprint` | §4.7.2 |
| Max-age math equals window at min | Min `dedupe_retention_days` raised to 7; safety margin always >= 24h; derived max-age strictly < window | §4.8, §15.1 |
| Broker atomicity scope incomplete | Side-effect inventory: dedupe + message + history + delivery_queue all in-tx; WS push and webhook fan-out explicitly outside-tx; orphan check extended | §4.7.1, §4.7.3 |
| New `aborted` outbox status | Distinguishes operator-retired rows from dead rows | §4.6.3 |

---

## What needs review (round 7)

1. **IPC lookup table (§4.5.1)** — does it cover all the realistic
   client races? The "inflight + match" return is `202 accepted,
   inflight` — should it be `200 ok` with the broker response if the
   broker has already responded? Or does the daemon prefer to respond
   from local state always?
2. **Aborted vs dead vs done (§4.6.3)** — is the three-state terminal
   distinction useful, or noisy? Would `dead` + an `aborted_at`
   timestamp suffice?
3. **§4.7.2 transaction shape** — `SELECT FOR SHARE` after `INSERT ON
   CONFLICT DO NOTHING` is two round-trips. Could it be one with
   `INSERT ... ON CONFLICT DO UPDATE SET ... RETURNING xmax = 0` or
   similar Postgres-specific trick? Worth optimizing here?
4. **Max-age formula at higher windows** — at 365 days,
   `safety_margin = ceil(0.1 * 365 * 24) = 876h ≈ 36.5 days`. Daemon
   max-age = `8760 - 876 = 7884h ≈ 328 days`. Is that the right shape,
   or should the safety margin be capped (e.g. `min(72, ceil(0.1 * w))`)?
5. **Side-effect inventory (§4.7.1)** — anything missing? E.g. broker-
   side rate-limit counters, audit-log entries, mention-fanout-search?
6. **Anything else still wrong?** Read it as if you were going to
   operate this for a year. What falls down?

Three options:
- **(a) v7 is shippable**: lock the spec, start coding the frozen core.
- **(b) v8 needed**: list the must-fix items.
- **(c) the architecture itself is wrong**: what would you do differently?

Be ruthless.
