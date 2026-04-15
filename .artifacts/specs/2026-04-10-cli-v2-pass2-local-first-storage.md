# claudemesh-cli v2 Pass 2 — Local-first storage

> ⚠️ **This document describes v2 Pass 2 work entirely — NOT the Pass 1 scope.**
>
> For the v2 Pass 1 implementation target, see **`2026-04-11-cli-v2-pass1.md`**.
>
> Pass 1 has NO local SQLite source of truth, NO Lamport clock, NO sync daemon, NO write queue, NO conflict resolution, NO publish transaction. v2 Pass 1 uses the broker as the authority for all mesh data (same as v1). Local caching, if any, is ephemeral and read-only.
>
> This entire document describes Pass 2 work that ships later — when the local-first architectural improvement is prioritized over other backlog items. Until then, do not reference this spec for Pass 1 implementation decisions.

**Status:** Pass 2 future reference — NOT the Pass 1 implementation target
**Created:** 2026-04-10
**Consolidated:** 2026-04-10 (post-reviews, critical bugs fixed inline)
**Companion to:** `2026-04-10-cli-v2-final-vision.md` (§7 defers to this document for all storage details)
**Purpose:** Complete specification of the local SQLite store, sync protocol, conflict resolution, and broker integration. Every distributed-systems correctness concern lives here.

This document has been reviewed twice (generic architecture review + GPT-5.3-Codex distributed systems review) and all critical bugs are fixed inline below. When the architecture spec body conflicts with this document, this document wins for storage concerns.

---

## Table of contents

1. Design principles
2. Runtime and dependencies
3. File layout and permissions
4. Lamport clock algorithm (atomic, race-free)
5. Schema (complete, with all constraints)
6. Vector storage with model fingerprinting
7. Memory recall semantics
8. File blob storage and garbage collection
9. Personal → shared publish upgrade protocol
10. Task claim semantics and audit events
11. Single-writer concurrency model
12. Sync protocol (outbox, inbox, broker epoch, ordering)
13. Conflict resolution per tool family
14. Offline behavior
15. Error recovery
16. Migration between schema versions
17. Bundle size accounting (honest)
18. Shutdown and drain protocol
19. Testing strategy
20. Operational concerns
21. Open questions deferred to v1.1+

---

## 1. Design principles

### P1 — SQLite is the source of truth for mesh data

Every stateful operation writes locally first. The broker is a sync channel. When the broker is unreachable, the CLI is fully functional for data the user already has.

### P2 — Single writer, many readers

SQLite WAL mode + a single-writer queue. No "database is locked" errors. No nested transactions across daemon and tool handlers.

### P3 — Last-writer-wins with total order via (lamport, peer_id_bytes)

Cross-peer conflicts resolved by comparing `(lamport, peer_id_bytes)` tuples. `peer_id` is compared **byte-wise** on canonical UTF-8 (not `localeCompare`) to guarantee deterministic ordering across hosts with different locales or ICU versions.

### P4 — Idempotency at every boundary

Inbox operations are deduplicated by `(broker_epoch, broker_seq)`. Outbox operations carry a stable `client_op_id` (UUIDv7) that the broker honors for dedupe. Retry is always safe.

### P5 — Append-only where possible

Vectors, audit events, and message history are append-only. Deletes are tombstones, not row removal.

### P6 — Content-addressed blobs

Files over 64 KB live outside SQLite, addressed by SHA256. Refcounted for GC.

### P7 — Explicit over implicit

Every query that could cross peers has an explicit scope (`self`, `peer:<id>`, `all`). No magic global queries.

### P8 — Fail-safe to offline

Tool handlers always succeed locally. If the sync daemon dies, the tool surface still works. If SQLite dies, the CLI surfaces a clear error and refuses to proceed (no corrupted-state operations).

### P9 — Every write is inside a transaction, through the queue

No "loose" writes. Every state-changing SQL statement runs inside a transaction enqueued on the single-writer queue. The lamport tick is part of the same transaction.

### P10 — Sync durability via outbox, not "fire and forget"

An operation is not "done" until its outbox row is `synced_at != null`. Broker acks include a stable server identifier that the outbox records. Crash-after-send-before-ack replays are idempotent on the broker side via `client_op_id`.

---

## 2. Runtime and dependencies

### 2.1 SQLite engine

**`better-sqlite3`** for the tool handler path. Synchronous API, WAL-friendly, no native async overhead per call.

Rejected alternatives:
- `node:sqlite` — experimental in Node 22, release cadence unclear
- `bun:sqlite` — Bun-only, but distribution target is Node
- `libsql` — larger, more deps

### 2.2 Vector extension

**`sqlite-vec`** (not `sqlite-vss`):
- Actively maintained (vss is stale)
- Smaller binary (~200KB vs ~2MB)
- Pure C, no FAISS dependency
- Simpler `vec0` virtual table API

Loaded at runtime via `db.loadExtension('sqlite-vec')`. The extension binary is bundled per-platform in the npm package under `node_modules/claudemesh-cli/vendor/sqlite-vec-<platform>.<ext>`.

### 2.3 Schema migration runner

Custom, not `drizzle-kit`. The migration surface is tiny (~5 migrations for v1.0.0), deterministic at startup, and we already write types by hand.

### 2.4 No ORM

Hand-written SQL with parameterized placeholders. Typed query wrappers live in `services/store/query.ts`.

### 2.5 UUID generation

`uuidv7` from a small pure-JS lib (≈ 2KB). UUIDv7 gives temporal ordering in IDs, which helps index locality and debugging.

---

## 3. File layout and permissions

```
~/.claudemesh/
├── data.db                    # 0600 — main SQLite database
├── data.db-wal                # 0600 — write-ahead log (created by SQLite)
├── data.db-shm                # 0600 — shared memory file (created by SQLite)
├── blobs/                     # 0700 — content-addressed blob store
│   ├── a1/
│   │   └── a1b2c3...sha256    # 0600
│   └── f5/
│       └── f5e4d3...sha256    # 0600
└── ...
```

**Permission enforcement**:
- At startup, `services/store/db.ts` verifies file modes match baseline; fixes drift with a logged warning
- New files created with umask `077` (0600 files, 0700 dirs)
- `blobs/` subdirectory naming uses first two hex chars of SHA256 to keep per-directory file counts manageable

---

## 4. Lamport clock algorithm

This is the part the original spec had wrong. The canonical rules here are **load-bearing for correctness**. Every storage write MUST follow them.

### 4.1 The invariant

Every peer maintains a per-mesh Lamport counter in `lamport_clocks(mesh_slug, value)`. The counter MUST satisfy:

```
∀ local_event: counter_after = counter_before + 1
∀ merged_event (from remote peer with lamport L):
    counter_after = max(counter_before, L) + 1
```

### 4.2 Atomic tick implementation

The original `SELECT` then `INSERT OR REPLACE` pattern races between concurrent writers. The correct implementation uses a single atomic `UPDATE ... RETURNING`:

```ts
// services/store/lamport.ts

export class LamportRaceError extends Error {
  readonly code = 'LAMPORT_RACE';
  constructor(meshSlug: string) {
    super(`tickLamport: mesh ${meshSlug} row disappeared between INSERT and UPDATE`);
  }
}

export class LamportUnknownMeshError extends Error {
  readonly code = 'LAMPORT_UNKNOWN_MESH';
  constructor(meshSlug: string) {
    super(`tickLamport: mesh ${meshSlug} does not exist in mesh table`);
  }
}

/**
 * Atomically tick the lamport clock for a mesh. MUST be called inside the
 * transaction that writes the domain row it's stamping, AND that transaction
 * MUST be enqueued on the single-writer queue.
 *
 * Defensive: validates the mesh exists, validates the UPDATE affected exactly
 * one row, and throws clearly-typed errors on any anomaly.
 *
 * @param db  The writer connection (use write queue)
 * @param meshSlug  The mesh whose clock to tick
 * @param incomingLamport  The remote event's lamport (for merge) or undefined for local
 * @returns The new lamport value to stamp on the row
 * @throws LamportUnknownMeshError  if the mesh slug does not exist
 * @throws LamportRaceError         if the UPDATE matched zero rows (should never happen)
 */
export function tickLamport(
  db: Database,
  meshSlug: string,
  incomingLamport?: number,
): number {
  // Validate the mesh exists before touching the clock
  const meshExists = db.prepare('SELECT 1 FROM mesh WHERE slug = ?').get(meshSlug);
  if (!meshExists) {
    throw new LamportUnknownMeshError(meshSlug);
  }

  // Ensure the lamport_clocks row exists for this mesh
  db.prepare(`
    INSERT INTO lamport_clocks (mesh_slug, value)
    VALUES (?, 0)
    ON CONFLICT(mesh_slug) DO NOTHING
  `).run(meshSlug);

  // Atomic UPDATE ... RETURNING: compute max(current, incoming) + 1 in SQL
  const base = incomingLamport ?? 0;
  const result = db.prepare(`
    UPDATE lamport_clocks
    SET value = MAX(value, ?) + 1
    WHERE mesh_slug = ?
    RETURNING value
  `).get(base, meshSlug) as { value: number } | undefined;

  // Defensive: RETURNING may yield nothing if the row was deleted between
  // the INSERT and UPDATE (e.g. concurrent mesh deletion outside the queue).
  // This should be impossible under the single-writer contract, but we check
  // anyway and throw a clear error rather than crashing on .value of undefined.
  if (!result) {
    throw new LamportRaceError(meshSlug);
  }
  return result.value;
}
```

### 4.3 Caller contract

**Every caller of `tickLamport` MUST**:

1. Be inside a `db.transaction(() => { ... })` block
2. Enqueue the transaction through the single-writer queue
3. Stamp the returned value on the domain row in the same transaction
4. Never call `tickLamport` twice in the same transaction (one tick per logical event)

**Failure mode if rule 1 is violated**: the counter updates but the domain row write races separately, breaking the invariant. CI tests enforce this by mocking the write queue and asserting `tickLamport` is always called inside `queue.enqueue(...)`.

### 4.4 Rollback semantics

If the enclosing transaction rolls back, the lamport update rolls back with it. The counter goes back to its previous value, and the logical event is treated as if it never happened. This is correct **only if no external effect escaped the transaction** — e.g. no network call was made, no file was written outside the DB. The sync daemon guarantees this by enqueueing outbox rows inside the same transaction as the domain write.

### 4.5 Tiebreaker: bytewise peer_id comparison on NFC-normalized UTF-8

When two operations have the same lamport value, the tiebreaker is byte-wise comparison of the **NFC-normalized** UTF-8 representation of `peer_id`.

**Normalization is mandatory.** Without NFC normalization, two peers with visually-identical display names encoded differently (NFC vs NFD — e.g. "café" as `café` vs `cafe\u0301`) produce different byte sequences and thus different conflict winners. NFC is enforced at peer registration and before every comparison.

```ts
// services/store/conflict.ts

/** Normalize a peer_id to NFC before any comparison or storage. */
export function normalizePeerId(peerId: string): string {
  return peerId.normalize('NFC');
}

export function compareOps(
  a: { lamport: number; peer_id: string },
  b: { lamport: number; peer_id: string },
): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  // Both peer_ids MUST be NFC-normalized; this is enforced at write time.
  // Buffer.compare is stable across Node/Bun, little-endian/big-endian, and
  // platform-independent because UTF-8 byte sequence is canonical.
  return Buffer.compare(
    Buffer.from(a.peer_id, 'utf8'),
    Buffer.from(b.peer_id, 'utf8'),
  );
}

/** Returns true if A wins over B (A is "more recent"). */
export function aWins(
  a: { lamport: number; peer_id: string },
  b: { lamport: number; peer_id: string },
): boolean {
  return compareOps(a, b) > 0;
}
```

**Enforcement at write time**: every code path that inserts a `peer_id` into the database calls `normalizePeerId()` first. This includes:
- Mesh join (new peer registration)
- Outbox ops being enqueued with `peer_id`
- Inbox ops being applied
- Profile updates
- Any schema that has a `peer_id` column (memory, state_kv, vectors, files, tasks, peers)

A database trigger enforces this at the SQL layer as a backup:

```sql
-- On every INSERT/UPDATE of peer_id columns, reject if not NFC-normalized
-- (actual NFC check must be done in application code; SQLite has no NFC function)
-- Instead, we validate at the single-writer queue's entry point via a helper.
```

Since SQLite doesn't have a native NFC function, the check is in `services/store/normalize.ts` which wraps every writer with an NFC assertion. The application-level enforcement is the primary defense.

**Never** use `localeCompare` for conflict resolution — it depends on the host's ICU version and locale, which differs across peers and causes divergent winners for the same conflict.

### 4.6 Hybrid logical clocks (NOT in v1.0.0)

HLC combines physical time with a logical counter for better causality approximation. Rejected for v1.0.0:
- Physical clock skew introduces new failure modes
- Debugging HLC behavior requires deep familiarity
- Plain Lamport + bytewise tiebreaker is sufficient for LWW
- HLC can be added later as an additive migration (new column, not a replacement)

### 4.7 Vector clocks (NOT shipped)

Storage cost (one int per peer per row) and complexity cost. Permanently rejected. If causal consistency becomes a hard requirement for some feature, that feature uses server-side ordering via the broker.

---

## 5. Schema

### 5.1 Meshes

```sql
CREATE TABLE IF NOT EXISTS mesh (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'shared_owner', 'shared_guest')),
  broker_url TEXT,
  server_id TEXT,
  broker_epoch INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_sync_at INTEGER,
  schema_version INTEGER NOT NULL DEFAULT 1,
  sync_paused INTEGER NOT NULL DEFAULT 0,
  CHECK (
    (kind = 'personal' AND broker_url IS NULL AND server_id IS NULL) OR
    (kind IN ('shared_owner', 'shared_guest') AND broker_url IS NOT NULL AND server_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS lamport_clocks (
  mesh_slug TEXT PRIMARY KEY REFERENCES mesh(slug) ON DELETE CASCADE,
  value INTEGER NOT NULL DEFAULT 0
);
```

**`broker_epoch`**: monotonically increasing, managed by the broker. When the broker restarts and reassigns sequence numbers, it increments its epoch. The inbox unique constraint uses `(mesh_slug, broker_epoch, broker_seq)` so a new epoch cannot collide with prior deliveries.

**Broker epoch ack protocol**: every broker ack message includes the broker's **current** epoch (not the epoch the op was processed under). The CLI updates `mesh.broker_epoch` from the current epoch on every ack. This handles the restart race:

- CLI sends op under epoch N
- Broker restarts mid-op, becomes epoch N+1
- Broker replays the op (or the CLI retries) under epoch N+1
- Ack comes back with `current_epoch: N+1`
- CLI updates `mesh.broker_epoch = N+1`
- Next send uses epoch N+1

If an ack arrives with an epoch LOWER than the CLI's current recorded epoch (shouldn't happen, but defensive), the CLI logs a warning and ignores the epoch update but still accepts the ack (the server-seq is valid).

If the CLI tries to send an op tagged with an old epoch and the broker has moved on, the broker responds with `epoch_mismatch` + current epoch, and the CLI re-tags the outbox op with the new epoch before retrying (no data loss, just a retry delay).

**`sync_paused`**: set to 1 when the outbox has accumulated too many failed ops for a mesh. Cleared by `claudemesh doctor --resume-sync`.

### 5.2 Memory

```sql
CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  mesh_slug TEXT NOT NULL REFERENCES mesh(slug) ON DELETE CASCADE,
  peer_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  lamport INTEGER NOT NULL,
  tombstone INTEGER NOT NULL DEFAULT 0,
  UNIQUE(mesh_slug, peer_id, key)
);

CREATE INDEX memory_mesh_key_live ON memory(mesh_slug, key) WHERE tombstone = 0;
CREATE INDEX memory_mesh_peer_live ON memory(mesh_slug, peer_id) WHERE tombstone = 0;
```

**Upsert logic (NOT `INSERT OR REPLACE`)**: `INSERT ... ON CONFLICT(mesh_slug, peer_id, key) DO UPDATE SET` with an explicit `WHERE` clause comparing `(lamport, peer_id)` tuples. This preserves LWW semantics and avoids losing concurrent writes.

```ts
export function upsertMemory(db: Database, row: MemoryRow): void {
  db.prepare(`
    INSERT INTO memory (id, mesh_slug, peer_id, key, value, tags, created_at, updated_at, lamport, tombstone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mesh_slug, peer_id, key) DO UPDATE SET
      value = excluded.value,
      tags = excluded.tags,
      updated_at = excluded.updated_at,
      lamport = excluded.lamport,
      tombstone = excluded.tombstone,
      id = excluded.id
    WHERE excluded.lamport > memory.lamport
       OR (excluded.lamport = memory.lamport AND excluded.peer_id > memory.peer_id)
  `).run(row.id, row.mesh_slug, row.peer_id, row.key, row.value,
         row.tags ?? null, row.created_at, row.updated_at, row.lamport, row.tombstone);
}
```

Note: `excluded.peer_id > memory.peer_id` uses SQLite's default binary comparison, which is byte-wise for BLOB and TEXT. That matches the application-level bytewise rule.

### 5.3 State KV

```sql
CREATE TABLE IF NOT EXISTS state_kv (
  mesh_slug TEXT NOT NULL REFERENCES mesh(slug) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  lamport INTEGER NOT NULL,
  tombstone INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mesh_slug, key)
);

CREATE INDEX state_kv_lamport ON state_kv(mesh_slug, lamport);
```

**Upsert with LWW predicate**:

```ts
export function upsertStateKv(db: Database, row: StateKvRow): void {
  db.prepare(`
    INSERT INTO state_kv (mesh_slug, key, value, updated_by, updated_at, lamport, tombstone)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mesh_slug, key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at,
      lamport = excluded.lamport,
      tombstone = excluded.tombstone
    WHERE excluded.lamport > state_kv.lamport
       OR (excluded.lamport = state_kv.lamport AND excluded.updated_by > state_kv.updated_by)
  `).run(row.mesh_slug, row.key, row.value, row.updated_by, row.updated_at, row.lamport, row.tombstone);
}
```

### 5.4 Vectors

```sql
CREATE TABLE IF NOT EXISTS vector_models (
  id TEXT PRIMARY KEY,                    -- fingerprint: sha256(provider:model:version:dim:quant)
  provider TEXT NOT NULL,                 -- e.g. 'voyage-ai', 'openai', 'sentence-transformers'
  model TEXT NOT NULL,                    -- e.g. 'voyage-3-large'
  model_version TEXT NOT NULL,            -- e.g. '1.0' or 'unknown'
  dim INTEGER NOT NULL,
  quantization TEXT NOT NULL DEFAULT 'float32',
  vec_table TEXT NOT NULL,                -- e.g. 'vectors_a1b2c3'
  created_at INTEGER NOT NULL,
  UNIQUE(provider, model, model_version, dim, quantization)
);

CREATE TABLE IF NOT EXISTS vector_metadata (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  mesh_slug TEXT NOT NULL REFERENCES mesh(slug) ON DELETE CASCADE,
  peer_id TEXT NOT NULL,
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  model_id TEXT NOT NULL REFERENCES vector_models(id),
  vec_rowid INTEGER NOT NULL,
  lamport INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  tombstone INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX vector_metadata_mesh_model ON vector_metadata(mesh_slug, model_id) WHERE tombstone = 0;
CREATE INDEX vector_metadata_peer ON vector_metadata(mesh_slug, peer_id) WHERE tombstone = 0;

-- vec tables are created dynamically, one per model fingerprint:
-- CREATE VIRTUAL TABLE vectors_<hash> USING vec0(embedding FLOAT[<dim>]);
```

**Model fingerprint**: `sha256(provider + ':' + model + ':' + model_version + ':' + dim + ':' + quantization)`. This catches provider-specific model revisions, tokenizer changes, and quantization differences that would silently corrupt cross-machine semantic compatibility.

### 5.5 Files

```sql
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  mesh_slug TEXT NOT NULL REFERENCES mesh(slug) ON DELETE CASCADE,
  peer_id TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('inline', 'blob')),
  inline_content BLOB,
  blob_path TEXT,
  shared_with TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  lamport INTEGER NOT NULL,
  tombstone INTEGER NOT NULL DEFAULT 0,
  CHECK (
    (storage_kind = 'inline' AND inline_content IS NOT NULL AND blob_path IS NULL) OR
    (storage_kind = 'blob' AND inline_content IS NULL AND blob_path IS NOT NULL)
  )
);

CREATE INDEX files_mesh_peer_live ON files(mesh_slug, peer_id) WHERE tombstone = 0;
CREATE INDEX files_sha256 ON files(sha256);

CREATE TABLE IF NOT EXISTS blob_refs (
  sha256 TEXT PRIMARY KEY,
  ref_count INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL,
  pending_unlink INTEGER NOT NULL DEFAULT 0
);
```

**`storage_kind`** is explicit instead of inferring from nullable fields. Eliminates the earlier `(inline != null) XOR (blob != null)` check condition.

**`pending_unlink`** marks blobs whose refcount has dropped to 0 but whose filesystem unlink has not yet completed. A GC sweep retries any rows still `pending_unlink = 1`.

### 5.6 Tasks

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  mesh_slug TEXT NOT NULL REFERENCES mesh(slug) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'completed', 'cancelled')),
  claimed_by TEXT,
  claimed_at INTEGER,
  completed_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  lamport INTEGER NOT NULL,
  tombstone INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX tasks_mesh_status ON tasks(mesh_slug, status) WHERE tombstone = 0;

CREATE TABLE IF NOT EXISTS task_claim_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mesh_slug TEXT NOT NULL REFERENCES mesh(slug) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  peer_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'claimed',            -- peer successfully claimed an open task
    'superseded',         -- peer's claim lost to another peer's concurrent claim
    'rejected_terminal',  -- late claim for a task already completed/cancelled
    'released',           -- peer voluntarily released their claim
    'completed',          -- peer marked task complete
    'cancelled'           -- task cancelled
  )),
  lamport INTEGER NOT NULL,
  event_time INTEGER NOT NULL,           -- sender-provided, not receiver wall time
  applied_at INTEGER NOT NULL,           -- receiver wall time for debug only
  conflict_peer_id TEXT,
  conflict_lamport INTEGER
);

CREATE INDEX task_claim_events_task ON task_claim_events(task_id, lamport);
```

**`event_time` vs `applied_at`**: `event_time` is the sender-provided timestamp, used for replication equality. `applied_at` is the receiver wall time, used only for logs and debugging, never for conflict resolution.

### 5.7 Peers (cache)

```sql
CREATE TABLE IF NOT EXISTS peers (
  mesh_slug TEXT NOT NULL REFERENCES mesh(slug) ON DELETE CASCADE,
  peer_id TEXT NOT NULL,
  display_name TEXT,
  status TEXT,
  summary TEXT,
  last_seen_at INTEGER,
  PRIMARY KEY (mesh_slug, peer_id)
);
```

### 5.8 Outbox (local → broker)

```sql
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mesh_slug TEXT NOT NULL REFERENCES mesh(slug) ON DELETE CASCADE,
  op_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  client_op_id TEXT NOT NULL UNIQUE,     -- UUIDv7, broker dedupes on this
  server_ack_id TEXT,
  broker_epoch INTEGER,                  -- recorded from the ack
  broker_seq INTEGER,                    -- recorded from the ack
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at INTEGER,
  synced_at INTEGER
);

CREATE INDEX outbox_pending ON outbox(mesh_slug, id) WHERE synced_at IS NULL;
```

**The broker MUST honor `client_op_id` for dedupe**. If the CLI sends the same `client_op_id` twice (crash-between-send-and-ack), the broker returns the original `server_ack_id`, epoch, and seq without applying the op a second time. This is the exactly-once delivery contract.

### 5.9 Inbox (broker → local)

```sql
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mesh_slug TEXT NOT NULL REFERENCES mesh(slug) ON DELETE CASCADE,
  broker_epoch INTEGER NOT NULL,
  broker_seq INTEGER NOT NULL,
  op_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  applied_at INTEGER
);

CREATE UNIQUE INDEX inbox_epoch_seq ON inbox(mesh_slug, broker_epoch, broker_seq);
CREATE INDEX inbox_pending ON inbox(mesh_slug, id) WHERE applied_at IS NULL;
```

**Composite uniqueness `(mesh_slug, broker_epoch, broker_seq)`** guards against broker restarts that reset sequence numbers. When a new epoch begins, seq starts at 1 again but collides with nothing because the epoch differs.

### 5.10 Migrations tracking

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

---

## 6. Vector storage with model fingerprinting

### 6.1 Model fingerprint

```ts
// services/store/vector-fingerprint.ts

export interface ModelIdentity {
  provider: string;        // 'voyage-ai' | 'openai' | 'sentence-transformers' | 'custom'
  model: string;           // 'voyage-3-large'
  modelVersion: string;    // '1.0' or 'unknown' if unversioned
  dim: number;             // 1024
  quantization: string;    // 'float32' | 'int8' | 'binary'
}

export function modelFingerprint(m: ModelIdentity): string {
  const canonical = `${m.provider}:${m.model}:${m.modelVersion}:${m.dim}:${m.quantization}`;
  return sha256Hex(canonical).slice(0, 16);
}
```

Each unique `ModelIdentity` gets its own vec table. Mismatched dimensions are impossible because the fingerprint diverges before the caller can insert into the wrong table.

### 6.2 Table creation with race-safe registration

The TOCTOU race in the original spec (`SELECT` then `CREATE VIRTUAL TABLE` then `INSERT`) is fixed by using `INSERT ... ON CONFLICT DO NOTHING` and re-reading:

```ts
export function ensureVecTable(db: Database, model: ModelIdentity): string {
  const id = modelFingerprint(model);
  const tableName = `vectors_${id}`;

  // Try to register the model. If it already exists, this is a no-op.
  db.prepare(`
    INSERT INTO vector_models (id, provider, model, model_version, dim, quantization, vec_table, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(id, model.provider, model.model, model.modelVersion, model.dim, model.quantization, tableName, Date.now());

  // Ensure the virtual table exists. CREATE VIRTUAL TABLE IF NOT EXISTS is safe.
  // Validate the table name is pure alphanumeric/underscore before interpolating.
  if (!/^vectors_[a-f0-9]{16}$/.test(tableName)) {
    throw new Error(`invalid vec table name: ${tableName}`);
  }
  db.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(embedding FLOAT[${model.dim}])`).run();

  return tableName;
}
```

The table name is validated against a strict regex before interpolation to prevent any SQL injection from a corrupted fingerprint.

### 6.3 Insert

```ts
export function vectorStore(
  db: Database,
  queue: WriteQueue,
  input: {
    mesh: string;
    peer: string;
    key: string;
    content: string;
    embedding: number[];
    model: ModelIdentity;
    metadata?: unknown;
  },
): Promise<void> {
  return queue.enqueue(() => {
    db.transaction(() => {
      if (input.embedding.length !== input.model.dim) {
        throw new Error(`embedding length ${input.embedding.length} does not match model dim ${input.model.dim}`);
      }
      const vecTable = ensureVecTable(db, input.model);
      const modelId = modelFingerprint(input.model);

      const buf = Buffer.from(new Float32Array(input.embedding).buffer);
      const vecResult = db.prepare(`INSERT INTO ${vecTable}(embedding) VALUES (?)`).run(buf);
      const vecRowid = Number(vecResult.lastInsertRowid);

      const lamport = tickLamport(db, input.mesh);

      db.prepare(`
        INSERT INTO vector_metadata
          (mesh_slug, peer_id, key, content, metadata, model_id, vec_rowid, lamport, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.mesh,
        input.peer,
        input.key,
        input.content,
        JSON.stringify(input.metadata ?? null),
        modelId,
        vecRowid,
        lamport,
        Date.now(),
      );
    })();
  });
}
```

### 6.4 Search

Cross-model queries are forbidden. The caller specifies the model; if that model doesn't exist in the store, the result is empty (not an error).

**Read-time integrity validation**: the `vec_table` column in `vector_models` is trusted input. If the database is corrupted or manually edited, a malicious `vec_table` value could inject arbitrary SQL into the `CREATE VIRTUAL TABLE` / `SELECT FROM` statements. The query path re-derives the expected table name from the stored identity columns and verifies it matches BEFORE using it.

```ts
export function vectorSearch(
  db: Database,
  input: { mesh: string; query: number[]; model: ModelIdentity; limit?: number },
): VectorSearchResult[] {
  const id = modelFingerprint(input.model);
  const row = db.prepare(`
    SELECT vec_table, dim, provider, model, model_version, quantization
    FROM vector_models WHERE id = ?
  `).get(id) as {
    vec_table: string;
    dim: number;
    provider: string;
    model: string;
    model_version: string;
    quantization: string;
  } | undefined;

  if (!row) return [];

  // Integrity check: re-derive the fingerprint from stored identity columns
  // and verify vec_table matches. Prevents trusting a corrupted registry row.
  const derivedFingerprint = modelFingerprint({
    provider: row.provider,
    model: row.model,
    modelVersion: row.model_version,
    dim: row.dim,
    quantization: row.quantization,
  });
  const expectedTableName = `vectors_${derivedFingerprint}`;
  if (row.vec_table !== expectedTableName) {
    throw new Error(
      `vector_models integrity failure: id ${id} has vec_table="${row.vec_table}" ` +
      `but derived ${expectedTableName}. Database may be corrupted — run claudemesh doctor.`
    );
  }

  // Defense in depth: regex-validate the format
  if (!/^vectors_[a-f0-9]{16}$/.test(row.vec_table)) {
    throw new Error(`invalid vec table name from registry: ${row.vec_table}`);
  }

  if (row.dim !== input.query.length) {
    throw new Error(`dimension mismatch: expected ${row.dim}, got ${input.query.length}`);
  }

  const buf = Buffer.from(new Float32Array(input.query).buffer);
  return db.prepare(`
    SELECT vm.key, vm.content, vm.peer_id, vm.metadata, t.distance
    FROM ${row.vec_table} t
    JOIN vector_metadata vm ON vm.vec_rowid = t.rowid
    WHERE t.embedding MATCH ?
      AND vm.mesh_slug = ?
      AND vm.tombstone = 0
      AND vm.model_id = ?
    ORDER BY t.distance
    LIMIT ?
  `).all(buf, input.mesh, id, input.limit ?? 10) as VectorSearchResult[];
}
```

`ensureVecTable` runs the same integrity check before `CREATE VIRTUAL TABLE IF NOT EXISTS` — if the stored `vec_table` doesn't match the derived name, the function throws instead of creating a table with the wrong name.

### 6.5 Model migration protocol

Changing embedding models is an explicit, expensive operation via `claudemesh advanced re-embed`:

1. Begin: mark old model as `deprecated` in `vector_models`
2. For each row in `vector_metadata` under old model (with progress output):
   - Re-embed `content` with new model (requires network to the embedding provider or a local model)
   - Insert into new vec table under new model fingerprint
   - Tombstone the old row
3. After completion with zero reads of old model for 30 days, GC the old vec table via `DROP TABLE vectors_<old_id>`

During the migration, reads against the old model still work (the vec table is not dropped until the grace period ends). New inserts go to the new model.

---

## 7. Memory recall semantics

### 7.1 API

```ts
type RecallInput = {
  mesh: string;
  key: string;
  scope?:
    | { kind: 'self' }                    // default
    | { kind: 'peer'; peer_id: string }
    | { kind: 'all' };
};

type RecallResult =
  | { kind: 'single'; peer_id: string; value: string; lamport: number; updated_at: number }
  | { kind: 'multi'; results: Array<{ peer_id: string; value: string; lamport: number; updated_at: number }> }
  | { kind: 'not_found' };
```

### 7.2 Resolution

| `scope` | Behavior |
|---|---|
| `{ kind: 'self' }` (default) | Returns the current peer's value for `key`. `not_found` if absent. |
| `{ kind: 'peer', peer_id }` | Returns that peer's value. `not_found` if absent. |
| `{ kind: 'all' }` | Returns array sorted by `(lamport DESC, peer_id bytewise ASC)`. Empty array if none. |

### 7.3 Tool surface

```ts
// mcp/tools/memory.ts
{
  name: 'recall',
  description: 'Retrieve a remembered value by key.',
  inputSchema: {
    key: z.string(),
    peer: z.enum(['self', 'all']).or(z.string()).default('self'),
  },
  handler: async ({ key, peer }) => memoryService.recall({
    mesh: currentMesh,
    key,
    scope: peer === 'self'
      ? { kind: 'self' }
      : peer === 'all'
        ? { kind: 'all' }
        : { kind: 'peer', peer_id: peer },
  }),
}
```

### 7.4 Namespaced keys (convention)

For shared team memories, the convention is to namespace the key:

```
remember('team.api_key', '...')
recall('team.api_key')
```

This avoids per-peer collision entirely. The tool documentation recommends this pattern.

---

## 8. File blob storage and garbage collection

### 8.1 Path validation

```ts
export function validatePath(p: string): void {
  if (p.length === 0) throw new Error('empty path');
  if (p.length > 1024) throw new Error('path too long');
  if (p.includes('\0')) throw new Error('null byte in path');
  if (p.startsWith('/')) throw new Error('absolute path forbidden');
  if (p.includes('\\')) throw new Error('backslash forbidden');
  if (/(^|\/)\.\.($|\/)/.test(p)) throw new Error('parent reference forbidden');
  if (/(^|\/)\.($|\/)/.test(p)) throw new Error('self reference forbidden');
  if (!/^[\w. \-/+()]+$/.test(p)) throw new Error('invalid characters');
}
```

### 8.2 Insert

```ts
export function fileShare(
  db: Database,
  queue: WriteQueue,
  blobsDir: string,
  input: { mesh: string; peer: string; path: string; content: Buffer },
): Promise<{ id: string }> {
  validatePath(input.path);
  const sha = sha256Hex(input.content);
  const size = input.content.length;

  return queue.enqueue(() => {
    // Write filesystem blob BEFORE the transaction so a rolled-back transaction
    // doesn't leave a blob without a reference. If the transaction fails,
    // we rely on GC sweep to clean up orphan files with pending_unlink = 1.
    let blobPath: string | null = null;
    let inlineContent: Buffer | null = null;

    if (size < 64 * 1024) {
      inlineContent = input.content;
    } else {
      blobPath = `blobs/${sha.slice(0, 2)}/${sha}`;
      const fullPath = path.join(blobsDir, '..', blobPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true, mode: 0o700 });
      // Use O_EXCL to avoid overwriting concurrent write
      try {
        fs.writeFileSync(fullPath, input.content, { mode: 0o600, flag: 'wx' });
      } catch (err: any) {
        if (err.code !== 'EEXIST') throw err;
        // Already exists (deduped) — verify content matches
        const existing = fs.readFileSync(fullPath);
        if (!existing.equals(input.content)) {
          throw new Error(`sha256 collision or corrupted blob: ${sha}`);
        }
      }
    }

    const id = uuidv7();
    db.transaction(() => {
      if (blobPath !== null) {
        db.prepare(`
          INSERT INTO blob_refs (sha256, ref_count, bytes, created_at, last_accessed)
          VALUES (?, 1, ?, ?, ?)
          ON CONFLICT(sha256) DO UPDATE SET
            ref_count = ref_count + 1,
            last_accessed = excluded.last_accessed
        `).run(sha, size, Date.now(), Date.now());
      }

      const lamport = tickLamport(db, input.mesh);

      db.prepare(`
        INSERT INTO files
          (id, mesh_slug, peer_id, path, sha256, size, storage_kind, inline_content, blob_path, shared_with, created_at, updated_at, lamport)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.mesh, input.peer, input.path, sha, size,
        blobPath !== null ? 'blob' : 'inline',
        inlineContent,
        blobPath,
        '[]',
        Date.now(), Date.now(), lamport,
      );
    })();
    return { id };
  });
}
```

**Why write blob before transaction**: if the filesystem write succeeds and the transaction fails, the blob is orphaned but the GC sweep finds it via `pending_unlink = 1`. If we write after the transaction commits, a crash between commit and write would leave the DB referencing a missing blob. The first failure is recoverable via GC; the second is data loss.

### 8.3 Delete with refcount + filesystem unlink

```ts
export function fileDelete(
  db: Database,
  queue: WriteQueue,
  blobsDir: string,
  input: { mesh: string; file_id: string },
): Promise<void> {
  return queue.enqueue(() => {
    let blobToUnlink: string | null = null;

    db.transaction(() => {
      const file = db.prepare('SELECT sha256, blob_path, storage_kind FROM files WHERE id = ? AND mesh_slug = ?').get(input.file_id, input.mesh) as any;
      if (!file) return;

      const lamport = tickLamport(db, input.mesh);
      db.prepare('UPDATE files SET tombstone = 1, updated_at = ?, lamport = ? WHERE id = ?').run(Date.now(), lamport, input.file_id);

      if (file.storage_kind === 'blob') {
        db.prepare('UPDATE blob_refs SET ref_count = ref_count - 1 WHERE sha256 = ?').run(file.sha256);
        const ref = db.prepare('SELECT ref_count FROM blob_refs WHERE sha256 = ?').get(file.sha256) as { ref_count: number };
        if (ref.ref_count <= 0) {
          db.prepare('UPDATE blob_refs SET pending_unlink = 1 WHERE sha256 = ?').run(file.sha256);
          blobToUnlink = file.blob_path;
        }
      }
    })();

    // Unlink happens AFTER the transaction commits. If it fails, GC sweep
    // retries via pending_unlink = 1.
    if (blobToUnlink !== null) {
      const fullPath = path.join(blobsDir, '..', blobToUnlink);
      try {
        fs.unlinkSync(fullPath);
        db.prepare('DELETE FROM blob_refs WHERE sha256 = ? AND pending_unlink = 1').run(blobToUnlink);
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          // leave pending_unlink = 1 for GC sweep to retry
        }
      }
    }
  });
}
```

### 8.4 GC sweep

Runs every 24 hours and on shutdown:

```ts
export function gcBlobs(db: Database, queue: WriteQueue, blobsDir: string): Promise<void> {
  return queue.enqueue(() => {
    // Pending unlinks from earlier failures
    const pending = db.prepare('SELECT sha256 FROM blob_refs WHERE pending_unlink = 1').all() as { sha256: string }[];
    for (const { sha256 } of pending) {
      const blobPath = path.join(blobsDir, sha256.slice(0, 2), sha256);
      try {
        fs.unlinkSync(blobPath);
        db.prepare('DELETE FROM blob_refs WHERE sha256 = ?').run(sha256);
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          db.prepare('DELETE FROM blob_refs WHERE sha256 = ?').run(sha256);
        }
      }
    }
    // Old tombstones
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    db.prepare('DELETE FROM files WHERE tombstone = 1 AND updated_at < ?').run(cutoff);
  });
}
```

---

## 9. Personal → shared publish upgrade protocol

### 9.1 Phases

The protocol is split into phases, each of which is individually committable so crashes between phases are recoverable.

```ts
export async function meshPublish(
  services: { auth: AuthService; api: ApiClient; mesh: MeshService; broker: BrokerClient; queue: WriteQueue; db: Database },
  input: { mesh_slug: string; display_name?: string },
): Promise<{ invite_url: string }> {

  // --- Phase 1: authentication ---
  const token = await services.auth.ensureAuthenticated();

  // --- Phase 2: server registration ---
  // API is idempotent on (user, slug); calling twice returns the same server_id.
  const response = await services.api.post('/api/my/meshes', {
    name: input.display_name ?? (await services.mesh.getLocal(input.mesh_slug)).name,
    slug: input.mesh_slug,
    kind: 'shared_owner',
  });
  // response: { server_id, broker_url, broker_epoch, slug }

  // --- Phase 3: local transition ---
  await services.queue.enqueue(() => {
    services.db.transaction(() => {
      services.db.prepare(`
        UPDATE mesh
        SET kind = 'shared_owner',
            broker_url = ?,
            server_id = ?,
            broker_epoch = ?,
            updated_at = ?
        WHERE slug = ? AND kind = 'personal'
      `).run(response.broker_url, response.server_id, response.broker_epoch, Date.now(), input.mesh_slug);

      // Enqueue a mesh.publish marker op (first sync op).
      services.db.prepare(`
        INSERT INTO outbox (mesh_slug, op_type, payload, client_op_id, created_at)
        VALUES (?, 'mesh.publish', ?, ?, ?)
      `).run(
        input.mesh_slug,
        JSON.stringify({ snapshot_version: 1, schema_version: 1 }),
        uuidv7(),
        Date.now(),
      );
    })();
  });

  // --- Phase 4: backfill ---
  // For small meshes (< 10k rows), enqueue all rows as backfill ops in chunks.
  // For large meshes, use snapshot + cursor protocol (§9.3).
  await backfillOutbox(services, input.mesh_slug);

  // --- Phase 5: sync wait ---
  // Wait for the outbox to drain (with timeout). Publish is considered "done"
  // when the sync daemon has acknowledged the mesh.publish marker.
  await waitForPublishAck(services, input.mesh_slug, { timeoutMs: 30_000 });

  // --- Phase 6: first invite ---
  const invite = await services.api.post(`/api/my/meshes/${input.mesh_slug}/invites`, {
    expires_in: '7d',
  });

  return { invite_url: invite.url };
}
```

### 9.2 Backfill with chunking

To satisfy the `< 100ms per transaction` rule, backfill happens in small chunks:

```ts
async function backfillOutbox(services: Services, meshSlug: string): Promise<void> {
  const CHUNK_SIZE = 200;

  for (const table of ['memory', 'state_kv', 'vector_metadata', 'files', 'tasks']) {
    let cursor = 0;
    while (true) {
      const done = await services.queue.enqueue(() => {
        const rows = services.db.prepare(`
          SELECT rowid, * FROM ${table}
          WHERE mesh_slug = ? AND tombstone = 0 AND rowid > ?
          ORDER BY rowid LIMIT ?
        `).all(meshSlug, cursor, CHUNK_SIZE) as any[];

        if (rows.length === 0) return true;

        services.db.transaction(() => {
          for (const row of rows) {
            services.db.prepare(`
              INSERT INTO outbox (mesh_slug, op_type, payload, client_op_id, created_at)
              VALUES (?, ?, ?, ?, ?)
            `).run(
              meshSlug,
              `${table}.backfill`,
              JSON.stringify(row),
              uuidv7(),
              Date.now(),
            );
          }
        })();

        cursor = rows[rows.length - 1].rowid;
        return false;
      });

      if (done) break;
    }
  }
}
```

Each chunk is a separate transaction (typically 200 rows × ~5 inserts = 1000 statements, well under 100ms). Between chunks, other writes can interleave via the queue.

### 9.3 Large mesh snapshot protocol

For meshes with >10k rows, use a server-side snapshot:

```
POST /api/my/meshes/:slug/snapshot/begin         → { snapshot_id }
POST /api/my/meshes/:slug/snapshot/:id/chunk     → { next_cursor }
POST /api/my/meshes/:slug/snapshot/:id/commit    → { broker_epoch, broker_seq_start }
```

The CLI uploads rows in chunks keyed by `snapshot_id`. If the upload is interrupted, the next attempt reads the last cursor and resumes. The server commits atomically; partial uploads never become visible.

### 9.4 Failure modes

| Phase | Failure | Recovery |
|---|---|---|
| 1 (auth) | User denies in browser | Abort publish, local mesh unchanged |
| 2 (register) | API 409 (slug collision) | CLI suggests a suffix, retries with new slug |
| 3 (local transition) | Crash | Restart detects `kind = shared_owner` with empty outbox → resumes phase 4 |
| 4 (backfill) | Crash mid-chunk | Chunk transactions are atomic; resume from last committed rowid |
| 5 (wait) | Timeout | Publish is logically complete; user sees "Published, sync catching up" |
| 6 (invite) | API error | Mesh is published; user runs `claudemesh invite` explicitly |

All phases are resumable because each phase's state is durable before the next phase begins.

---

## 10. Task claim semantics and audit events

### 10.1 Local claim

```ts
export function taskClaim(
  db: Database,
  queue: WriteQueue,
  input: { mesh: string; task_id: string; peer: string },
): Promise<void> {
  return queue.enqueue(() => {
    db.transaction(() => {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND mesh_slug = ?').get(input.task_id, input.mesh) as any;
      if (!task || task.tombstone) throw new Error('task not found');
      if (task.status === 'completed') throw new Error('task already completed');
      if (task.status === 'cancelled') throw new Error('task cancelled');
      if (task.status === 'claimed' && task.claimed_by !== input.peer) {
        throw new Error(`task already claimed by ${task.claimed_by}`);
      }

      const lamport = tickLamport(db, input.mesh);
      const now = Date.now();

      db.prepare(`
        UPDATE tasks
        SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?, lamport = ?
        WHERE id = ?
      `).run(input.peer, now, now, lamport, input.task_id);

      db.prepare(`
        INSERT INTO task_claim_events
          (mesh_slug, task_id, peer_id, event_type, lamport, event_time, applied_at)
        VALUES (?, ?, ?, 'claimed', ?, ?, ?)
      `).run(input.mesh, input.task_id, input.peer, lamport, now, now);

      db.prepare(`
        INSERT INTO outbox (mesh_slug, op_type, payload, client_op_id, created_at)
        VALUES (?, 'task.claim', ?, ?, ?)
      `).run(
        input.mesh,
        JSON.stringify({ task_id: input.task_id, peer_id: input.peer, lamport, event_time: now }),
        uuidv7(),
        now,
      );
    })();
  });
}
```

### 10.2 Inbound claim reconciliation — all branches covered

```ts
export function applyInboxClaim(
  db: Database,
  op: {
    mesh_slug: string;
    task_id: string;
    peer_id: string;
    lamport: number;
    event_time: number;
  },
): void {
  db.transaction(() => {
    const local = db.prepare('SELECT * FROM tasks WHERE id = ?').get(op.task_id) as any;
    if (!local || local.tombstone) return;

    // Advance the lamport clock per the invariant
    const newLamport = tickLamport(db, op.mesh_slug, op.lamport);

    // Branch on local status
    if (local.status === 'completed' || local.status === 'cancelled') {
      // Terminal states — audit the late claim as rejected, do not mutate the task.
      // Event type is 'rejected_terminal' (not 'superseded') because the incoming
      // claim wasn't beaten by another concurrent claim — it arrived after the
      // task was already done.
      db.prepare(`
        INSERT INTO task_claim_events
          (mesh_slug, task_id, peer_id, event_type, lamport, event_time, applied_at)
        VALUES (?, ?, ?, 'rejected_terminal', ?, ?, ?)
      `).run(op.mesh_slug, op.task_id, op.peer_id, newLamport, op.event_time, Date.now());
      return;
    }

    if (local.status === 'open') {
      // No conflict, apply the claim
      db.prepare(`
        UPDATE tasks
        SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?, lamport = ?
        WHERE id = ?
      `).run(op.peer_id, op.event_time, Date.now(), newLamport, op.task_id);

      db.prepare(`
        INSERT INTO task_claim_events
          (mesh_slug, task_id, peer_id, event_type, lamport, event_time, applied_at)
        VALUES (?, ?, ?, 'claimed', ?, ?, ?)
      `).run(op.mesh_slug, op.task_id, op.peer_id, newLamport, op.event_time, Date.now());
      return;
    }

    // Claimed locally by someone — possibly a conflict
    if (local.claimed_by === op.peer_id) {
      // Same peer re-claiming (idempotent) — bump lamport only if higher
      if (op.lamport > local.lamport) {
        db.prepare('UPDATE tasks SET lamport = ? WHERE id = ?').run(newLamport, op.task_id);
      }
      return;
    }

    // Different peer trying to claim
    const localWinsTuple = aWins(
      { lamport: local.lamport, peer_id: local.claimed_by },
      { lamport: op.lamport, peer_id: op.peer_id },
    );

    if (localWinsTuple) {
      // Our claim wins — log the incoming as superseded
      db.prepare(`
        INSERT INTO task_claim_events
          (mesh_slug, task_id, peer_id, event_type, lamport, event_time, applied_at, conflict_peer_id, conflict_lamport)
        VALUES (?, ?, ?, 'superseded', ?, ?, ?, ?, ?)
      `).run(op.mesh_slug, op.task_id, op.peer_id, newLamport, op.event_time, Date.now(), local.claimed_by, local.lamport);
    } else {
      // Incoming wins — supersede our claim
      db.prepare(`
        UPDATE tasks
        SET claimed_by = ?, claimed_at = ?, updated_at = ?, lamport = ?
        WHERE id = ?
      `).run(op.peer_id, op.event_time, Date.now(), newLamport, op.task_id);

      db.prepare(`
        INSERT INTO task_claim_events
          (mesh_slug, task_id, peer_id, event_type, lamport, event_time, applied_at, conflict_peer_id, conflict_lamport)
        VALUES (?, ?, ?, 'superseded', ?, ?, ?, ?, ?)
      `).run(op.mesh_slug, op.task_id, local.claimed_by, newLamport, op.event_time, Date.now(), op.peer_id, op.lamport);

      // Push notification to the local peer whose claim was superseded
      if (local.claimed_by === currentPeerId(op.mesh_slug)) {
        pushNotification({
          type: 'task_claim_superseded',
          task_id: op.task_id,
          by_peer: op.peer_id,
        });
      }
    }
  })();
}
```

Note the four branches: completed/cancelled (terminal, log only), open (apply), same-peer reclaim (idempotent), different-peer conflict (resolve via tuple comparison). The original spec missed the terminal-state branch.

### 10.3 MCP notification

When a local claim is superseded, subsequent tool calls by the affected agent include a `warnings` field:

```json
{
  "ok": true,
  "data": { /* tool result */ },
  "warnings": [
    {
      "type": "task_claim_superseded",
      "task_id": "abc123",
      "by_peer": "bob",
      "at_lamport": 42
    }
  ]
}
```

Claude Code renders the warning in the TUI so agents don't silently redo work.

---

## 11. Single-writer concurrency model

### 11.1 The rule

All writes go through one queue. Reads can use separate connections. No "database is locked" errors because only one writer holds the write lock at any time.

### 11.2 Queue implementation with async awareness

The original implementation didn't `await` the op result, meaning a Promise could slip through and the queue would mark "done" before the operation completed. Fixed version:

```ts
// services/store/write-queue.ts

type WriteOp<T> = () => T | Promise<T>;

interface QueueItem<T> {
  op: WriteOp<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
  signal?: AbortSignal;
}

export class WriteQueue {
  private queue: QueueItem<any>[] = [];
  private running = false;
  // State machine: 'open' → 'stopping' → 'stopped'
  // All transitions are guarded by the single JS event loop (no actual mutex
  // needed because Node/Bun are single-threaded for user code), but we use
  // this state field as the source of truth and check it atomically in each
  // method relative to when control returns to user code.
  private state: 'open' | 'stopping' | 'stopped' = 'open';

  constructor(private db: Database) {}

  async enqueue<T>(op: WriteOp<T>, signal?: AbortSignal): Promise<T> {
    // Read-and-act must happen in a single synchronous block — no awaits
    // between the check and the push. JS single-threading guarantees this:
    // no other code can run between these two statements.
    if (this.state !== 'open') {
      throw new Error(`write queue is ${this.state}`);
    }
    if (signal?.aborted) throw new Error('aborted');
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ op, resolve, reject, signal });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        if (item.signal?.aborted) {
          item.reject(new Error('aborted'));
          continue;
        }
        try {
          // await handles both sync and async ops correctly: sync returns
          // resolve immediately through the microtask queue, async returns
          // wait for the Promise to settle before proceeding.
          const result = await item.op();
          item.resolve(result);
        } catch (err) {
          item.reject(err as Error);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Begin shutdown. New enqueues are rejected immediately. Existing items
   * drain to completion. Returns when all queued items have been processed.
   *
   * Race-free: setting state='stopping' is atomic relative to enqueue()'s
   * state check because JS is single-threaded. No enqueue can sneak an item
   * past the check after stop() sets state='stopping'.
   */
  async stop(): Promise<void> {
    if (this.state !== 'open') return;
    this.state = 'stopping';
    // Wait for the drain to finish processing all queued items
    while (this.running || this.queue.length > 0) {
      await new Promise(r => setTimeout(r, 10));
    }
    this.state = 'stopped';
  }

  /**
   * Cancel all pending items immediately. Used on SIGKILL-style shutdown.
   */
  abort(): void {
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    const pending = this.queue.splice(0);
    for (const item of pending) {
      item.reject(new Error('aborted'));
    }
  }
}
```

**Race-freedom rationale**: The JS event loop guarantees that `enqueue()`'s state check (`if (this.state !== 'open')`) and the subsequent `this.queue.push()` execute atomically — no other code can run between them. When `stop()` sets `this.state = 'stopping'`, any subsequent `enqueue()` call sees the updated state synchronously and rejects. There is no TOCTOU window because JS does not preempt synchronous code.

The one subtlety: if `enqueue()` is called from an `async` function and has already passed its state check before `stop()` is called, the item is in the queue and will be drained. That's correct behavior — the caller's `await enqueue(...)` will resolve normally. If `stop()` wants to drop in-flight items, it uses `abort()` instead.

**Critical fix**: `await item.op()` instead of `const result = item.op()`. If `op` returns a Promise, the queue now waits for it to settle before starting the next item. Ops that return synchronous values (via `better-sqlite3`) resolve immediately through the Promise machinery.

**Event loop impact**: the `while` loop yields between items only if the op returns a Promise. Synchronous ops block the event loop briefly (typically <5ms per op). For large batches this is acceptable because backfill is split into chunks (§9.2).

### 11.3 PRAGMA settings

```ts
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 30000000');
db.pragma('cache_size = -8000');  // 8MB page cache
```

**Durability tradeoff**: `synchronous = NORMAL` means the last committed transaction can be lost on power failure (not crash — SQLite WAL protects against process crash). This is acceptable for claudemesh because the broker replay can recover any lost ops from the server side. For users who want higher durability, `synchronous = FULL` is available via `CLAUDEMESH_STORE_SYNC=full` env var at the cost of ~2x write latency.

### 11.4 Transaction length

Every write transaction MUST complete in < 100ms. Long operations (backfill, GC sweep, re-embedding) are split into many small transactions (§9.2).

---

## 12. Sync protocol

### 12.1 Overview

```
┌──────────┐       ┌──────────┐       ┌────────────┐
│  Tool    │ write │  SQLite  │ read  │    Sync    │
│  Handler ├──────►│  (source ├──────►│   Daemon   │
└──────────┘       │ of truth)│       └──────┬─────┘
                   └────▲─────┘              │
                        │                    │ outbox →
                        │ apply              ▼ broker ws
                   ┌────┴─────┐       ┌────────────┐
                   │  inbox   │◄──────┤   Broker   │
                   └──────────┘  ← ws └────────────┘
```

### 12.2 Outbox drain with abort semantics and head-of-line protection

The original drain blocked the whole batch on a single flaky op. Fixed version aborts the batch on network-level errors and retries only op-specific errors:

```ts
// services/broker/sync-daemon.ts

async function drainOutbox(services: Services, meshSlug: string): Promise<DrainResult> {
  const MAX_BATCH = 10;
  const MAX_ATTEMPTS_PER_OP = 10;

  // Read pending ops outside the write queue (read-only)
  const pending = services.db.prepare(`
    SELECT id, op_type, payload, client_op_id, attempts
    FROM outbox
    WHERE mesh_slug = ? AND synced_at IS NULL
    ORDER BY id
    LIMIT ?
  `).all(meshSlug, MAX_BATCH) as OutboxRow[];

  if (pending.length === 0) return { sent: 0, exhausted: false };

  let sent = 0;
  for (const op of pending) {
    // Re-read attempts to avoid stale in-memory value
    const current = services.db.prepare('SELECT attempts FROM outbox WHERE id = ?').get(op.id) as { attempts: number };
    if (current.attempts >= MAX_ATTEMPTS_PER_OP) {
      // Mark mesh as sync_paused and surface to user
      await services.queue.enqueue(() => {
        services.db.prepare('UPDATE mesh SET sync_paused = 1 WHERE slug = ?').run(meshSlug);
      });
      return { sent, exhausted: true };
    }

    try {
      const ack = await services.broker.send({
        mesh_slug: meshSlug,
        client_op_id: op.client_op_id,
        op_type: op.op_type,
        payload: JSON.parse(op.payload),
      });

      await services.queue.enqueue(() => {
        services.db.prepare(`
          UPDATE outbox
          SET synced_at = ?, server_ack_id = ?, broker_epoch = ?, broker_seq = ?
          WHERE id = ?
        `).run(Date.now(), ack.server_ack_id, ack.broker_epoch, ack.broker_seq, op.id);
      });
      sent++;
    } catch (err: any) {
      // Increment attempts in DB
      await services.queue.enqueue(() => {
        services.db.prepare(`
          UPDATE outbox
          SET attempts = attempts + 1, last_error = ?, last_attempt_at = ?
          WHERE id = ?
        `).run(String(err?.message ?? err), Date.now(), op.id);
      });

      // Classify the error
      if (isNetworkError(err)) {
        // Network error: abort the batch, let the daemon loop retry after backoff
        return { sent, exhausted: false, networkError: true };
      }
      // Op-specific error: continue with next op in batch
      continue;
    }
  }

  return { sent, exhausted: false };
}

function isNetworkError(err: any): boolean {
  if (!err) return false;
  const code = err.code ?? err.cause?.code;
  return code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ECONNRESET' ||
         code === 'ETIMEDOUT' || code === 'EAI_AGAIN' || code === 'WS_CLOSED';
}
```

### 12.3 Inbox apply

```ts
async function applyInbox(services: Services, meshSlug: string): Promise<ApplyResult> {
  const pending = services.db.prepare(`
    SELECT id, broker_epoch, broker_seq, op_type, payload
    FROM inbox
    WHERE mesh_slug = ? AND applied_at IS NULL
    ORDER BY broker_epoch, broker_seq
    LIMIT 10
  `).all(meshSlug) as InboxRow[];

  if (pending.length === 0) return { applied: 0 };

  let applied = 0;
  for (const inc of pending) {
    try {
      await services.queue.enqueue(() => {
        services.db.transaction(() => {
          applyOp(services.db, meshSlug, inc);
          services.db.prepare('UPDATE inbox SET applied_at = ? WHERE id = ?').run(Date.now(), inc.id);
        })();
      });
      applied++;
    } catch (err) {
      services.logger.error('inbox apply failed', { id: inc.id, err });
      // Stop on first apply failure; retry on next daemon tick
      break;
    }
  }
  return { applied };
}

function applyOp(db: Database, meshSlug: string, inc: InboxRow): void {
  const payload = JSON.parse(inc.payload);
  switch (inc.op_type) {
    case 'memory.set': return upsertMemory(db, { ...payload, mesh_slug: meshSlug });
    case 'memory.tombstone': return tombstoneMemory(db, { ...payload, mesh_slug: meshSlug });
    case 'state.set': return upsertStateKv(db, { ...payload, mesh_slug: meshSlug });
    case 'task.claim': return applyInboxClaim(db, { ...payload, mesh_slug: meshSlug });
    case 'vector.store': return applyInboxVectorStore(db, { ...payload, mesh_slug: meshSlug });
    case 'file.share': return applyInboxFileShare(db, { ...payload, mesh_slug: meshSlug });
    // ... etc
    default:
      throw new Error(`unknown op_type: ${inc.op_type}`);
  }
}
```

### 12.4 Daemon loop — idle path applies inbox

**Critical fix**: the idle path now applies inbox, not just drains outbox. Remote messages no longer starve.

```ts
export class SyncDaemon {
  private state: 'active' | 'idle' | 'reconnecting' | 'stopped' = 'idle';
  private idleSleepMs = 5_000;
  private activeSleepMs = 500;
  private reconnectBackoff = 1_000;
  private stopPromise: Promise<void> | null = null;
  private stopResolve: (() => void) | null = null;

  constructor(private services: Services) {}

  async start(): Promise<void> {
    this.stopPromise = new Promise(resolve => { this.stopResolve = resolve; });

    while ((this.state as string) !== 'stopped') {
      try {
        if (this.state === 'reconnecting') {
          try {
            await this.services.broker.connect();
            this.state = 'active';
            this.reconnectBackoff = 1_000;
          } catch {
            await sleep(this.reconnectBackoff);
            this.reconnectBackoff = Math.min(this.reconnectBackoff * 2, 30_000);
            continue;
          }
        }

        // Apply inbound ops FIRST, regardless of state (prevents starvation)
        for (const meshSlug of await this.getActiveMeshes()) {
          await applyInbox(this.services, meshSlug);
        }

        // Then drain outbound
        let anyNetworkError = false;
        for (const meshSlug of await this.getActiveMeshes()) {
          const result = await drainOutbox(this.services, meshSlug);
          if (result.networkError) {
            anyNetworkError = true;
            break;
          }
        }

        if (anyNetworkError) {
          this.state = 'reconnecting';
          continue;
        }

        // State transition: active → idle if nothing happened for 30s
        const now = Date.now();
        const lastActivity = this.services.broker.lastActivityAt ?? 0;
        if (this.state === 'active' && now - lastActivity > 30_000) {
          this.state = 'idle';
        }

        await sleep(this.state === 'active' ? this.activeSleepMs : this.idleSleepMs);
      } catch (err) {
        this.services.logger.error('sync daemon loop error', { err });
        await sleep(1_000);
      }
    }

    this.stopResolve!();
  }

  /** Trigger immediate drain on local change. */
  onLocalChange(): void {
    this.state = 'active';
  }

  /** Trigger immediate apply on incoming broker message. */
  onBrokerMessage(): void {
    this.state = 'active';
  }

  /** Graceful shutdown. */
  async stop(): Promise<void> {
    this.state = 'stopped';
    if (this.stopPromise) await this.stopPromise;
    await this.services.queue.stop();
  }
}
```

**State transitions**:
- `reconnecting` → `active` on successful connect
- `active` → `idle` after 30s of broker silence AND empty outbox
- `idle` → `active` on local change or broker message
- Any → `stopped` on `stop()` call

**Critical properties**:
- Inbox is applied on every tick, regardless of state
- Outbox is drained on every tick (idle has a longer sleep)
- Network errors transition to `reconnecting` with backoff
- Stop is awaitable and drains in-flight ops

---

## 13. Conflict resolution per tool family

| Tool | Strategy | Tiebreaker |
|---|---|---|
| `memory` | LWW per `(mesh, peer, key)` | `(lamport, peer_id)` bytewise |
| `state_kv` | LWW per `(mesh, key)` | `(lamport, updated_by)` bytewise |
| `vectors` | Append-only per `(mesh, peer, key, model)` | Tombstone on delete, no conflict |
| `files` | LWW per `(mesh, peer, path)` | `(lamport, peer_id)` bytewise; content dedup by sha256 |
| `tasks` | First claim wins | `(lamport, peer_id)` bytewise; supersession events logged |
| `peers` | Last broker update wins | Cache only, no local writes |

---

## 14. Offline behavior

| Operation | Offline result |
|---|---|
| `remember` | Succeeds, enqueues outbox op |
| `recall` | Succeeds from local |
| `vector_store` | Succeeds, enqueues outbox op |
| `vector_search` | Succeeds from local vectors |
| `set_state` | Succeeds, enqueues outbox op |
| `get_state` | Succeeds from local |
| `share_file` | Succeeds, content to local blob store, metadata enqueues |
| `read_peer_file` | Returns `{ status: 'stale', content: last_known }` or `{ status: 'offline' }` if never synced |
| `list_peers` | Returns cached list with `stale: true` flag after 5 min |
| `send_message` | Returns `{ status: 'queued' }`, goes to outbox |
| `claim_task` | Tentative claim, reverts on reconnect if another peer won |
| `mesh_clock` | Returns `{ lamport, sync_state: 'offline', last_sync_at }` |
| `mesh_info` | Returns local metadata |

---

## 15. Error recovery

### 15.1 Corrupt database

On startup:
```ts
const result = db.pragma('integrity_check', { simple: true });
if (result !== 'ok') {
  // Surface to user with `claudemesh doctor --repair` offer
  // Repair: .dump → new db → re-import
  // If repair fails: backup to data.db.corrupt-<timestamp> + init fresh
}
```

### 15.2 Stuck outbox

Per-op retry limit is 10 (checked against the current DB value, not stale in-memory). When exhausted:
1. Set `mesh.sync_paused = 1`
2. Surface warning overlay in UI
3. `claudemesh doctor` shows the failing ops and offers `--retry` or `--drop`

### 15.3 Diverged inbox

If inbox has a gap in `(broker_epoch, broker_seq)`:
1. Request re-sync from the last known seq
2. If broker returns a new epoch, accept it (broker restarted)
3. If gap persists, mark mesh as "needs full resync" and re-download from snapshot

### 15.4 Broker epoch change

Detected when the broker ack includes a new `broker_epoch`. The CLI:
1. Updates `mesh.broker_epoch` in the DB
2. Continues with new epoch for all subsequent ops
3. Inbox dedupe still works because the unique constraint is `(mesh, epoch, seq)`

### 15.5 Migration failure

Migrations are transactional and atomic. If a migration fails mid-run:
- `_migrations` table is updated per migration's commit
- Restart retries from the last successful migration
- If a migration keeps failing, `claudemesh doctor --rollback-migration <version>` offers an escape

---

## 16. Migration runner

```ts
// services/store/migrations.ts

interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001-initial',
    up: (db) => { db.exec(readSqlFile('001-initial.sql')); },
  },
  {
    version: 2,
    name: '002-add-broker-epoch',
    up: (db) => { db.exec(readSqlFile('002-add-broker-epoch.sql')); },
  },
  // ...
];

export function runMigrations(db: Database, queue: WriteQueue): Promise<void> {
  return queue.enqueue(() => {
    db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const applied = db.prepare('SELECT version FROM _migrations').all() as { version: number }[];
    const appliedVersions = new Set(applied.map(r => r.version));

    for (const m of MIGRATIONS) {
      if (appliedVersions.has(m.version)) continue;
      db.transaction(() => {
        m.up(db);
        db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(m.version, Date.now());
      })();
    }
  });
}
```

---

## 17. Bundle size accounting (honest)

Per review: the 800 KB JS bundle target was optimistic. Honest targets:

### 17.1 Per-platform distribution

| Platform | Native addon size | JS bundle (gz) | Total install (decompressed) |
|---|---|---|---|
| macOS arm64 | ~2.8 MB | ~1.0 MB | ~8-10 MB |
| macOS x64 | ~2.9 MB | ~1.0 MB | ~8-10 MB |
| Linux x64 | ~3.2 MB | ~1.0 MB | ~9-11 MB |
| Linux arm64 | ~3.1 MB | ~1.0 MB | ~9-11 MB |
| Windows x64 | ~3.5 MB | ~1.0 MB | ~10-12 MB |

**JS bundle target: ~1 MB gzipped** (not 800 KB). Realistic given Ink + React + Zod + citty + MCP SDK + all UI code.

**Cold start target: 200-400 ms** (not 100 ms). `better-sqlite3` native addon load + SQLite init + connection pragmas takes 150-250 ms on modern hardware. Script evaluation adds another 50-150 ms.

### 17.2 Cold start phases

| Phase | Target | Notes |
|---|---|---|
| Node startup + script load | <50 ms | Bun or Node + ESM loader |
| better-sqlite3 native load | ~100-150 ms | One-time per process |
| sqlite-vec extension load | ~20-50 ms | One-time per connection |
| SQLite connection + PRAGMA | ~30-80 ms | Includes WAL checkpoint check |
| Migration check (cached) | <10 ms | Only runs if version mismatch |
| First meaningful output | **200-400 ms total** | Measured on Apple M2 Pro, 2026 |

### 17.3 Optimization path

If cold start exceeds 400 ms in practice:
- Defer non-critical service initialization (telemetry, update check)
- Use `bun` runtime as alternate distribution (Bun's native SQLite skips addon load)
- Lazy-load MCP tool registrations

None of these are required for v1.0.0.

---

## 18. Shutdown and drain protocol

### 18.1 Signal handling

```ts
// services/lifecycle/service-manager.ts

export class ServiceManager {
  private services: {
    queue: WriteQueue;
    daemon: SyncDaemon;
    broker: BrokerClient;
  };

  async shutdown(): Promise<void> {
    // Order matters:
    // 1. Stop accepting new work
    await this.services.daemon.stop();
    // 2. Drain any queued writes
    await this.services.queue.stop();
    // 3. Close broker connection
    await this.services.broker.disconnect();
    // 4. GC sweep if time permits (best effort)
    try {
      await Promise.race([
        gcBlobs(this.services.db, this.services.queue, BLOBS_DIR),
        sleep(2_000),
      ]);
    } catch {}
    // 5. Checkpoint WAL
    this.services.db.pragma('wal_checkpoint(TRUNCATE)');
    // 6. Close DB
    this.services.db.close();
  }
}

// Entrypoint wiring:
process.on('SIGINT', async () => {
  await serviceManager.shutdown();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await serviceManager.shutdown();
  process.exit(0);
});
```

### 18.2 Timeout

Shutdown has a 10-second hard timeout. If services don't stop cleanly within that window, `process.exit(1)` is called and the user sees a warning on next launch:

```
~ Previous session didn't shut down cleanly. Running integrity check…
```

The integrity check verifies the database is uncorrupted. If WAL replay succeeds, the warning is cleared.

---

## 19. Testing strategy

### 19.1 Unit tests

Every module in `services/store/` has a colocated `*.test.ts` with 100% coverage. Uses `better-sqlite3` with `:memory:` database.

Required unit tests:
- `tickLamport` concurrency: 100 simultaneous calls, assert monotonic output with no gaps or duplicates
- `upsertMemory` conflict resolution: interleave writes with different lamports, assert winner is correct per tuple comparison
- `applyInboxClaim` all 4 branches: completed, cancelled, open, same-peer reclaim, different-peer conflict
- `WriteQueue` async op handling: enqueue async function, assert `await enqueue(...)` resolves after the Promise settles
- `ensureVecTable` race: two simulated processes race to create the same fingerprint, assert only one vec table is created
- Path validation: 50+ positive and negative cases

### 19.2 Integration tests

`tests/integration/store/` runs against a real staging broker + real file system. Covers:
- Full sync protocol end-to-end
- Conflict resolution between two simulated peers with clock skew
- Publish upgrade transaction with backfill
- Offline → reconnect → converge with 1000 pending ops
- Task claim race with explicit reconciliation
- Broker epoch change mid-session

### 19.3 Fuzz tests

`tests/fuzz/store/` generates random op sequences and verifies invariants:
- Lamport is monotonic within a peer
- Conflict resolution is deterministic (same input → same output across runs)
- Outbox + inbox round-trip produces identical state on both peers
- Blob refcount never goes negative
- No orphaned blobs after GC sweep

Fuzz budget: 100,000 random operations per CI run.

### 19.4 Benchmarks

`tests/bench/store/` tracks regression:
- Memory insert latency p50/p99
- Vector search latency
- Transaction throughput under single-writer contention
- Cold start
- Bundle size (fail if >20% regression)

---

## 20. Operational concerns

### 20.1 Backups

`claudemesh doctor --backup` produces a clean snapshot via SQLite's `BACKUP` API. Users can also manually copy `data.db` + `data.db-wal` + `data.db-shm` if the process is stopped.

### 20.2 Export

`claudemesh advanced export --format jsonl` dumps all mesh data to JSONL for debugging or manual migration.

### 20.3 Import

`claudemesh advanced import <file.jsonl>` is NOT implemented in v1.0.0. Importing rows with arbitrary lamports would break invariant §4.1. Deferred to v1.1 with a proper re-stamping pass.

### 20.4 Metrics

Local metrics log to `~/.claudemesh/logs/metrics.jsonl`:
- Operation counts and latencies per tool
- Sync lag (local lamport vs last applied inbox lamport)
- Error rates by category
- Cold start time per launch

Read by `claudemesh doctor` for diagnosis. Never transmitted externally (even if telemetry is opted in).

---

## 21. Open questions deferred to v1.1+

1. **Hybrid logical clocks** — if field experience shows Lamport is insufficient for certain workloads
2. **Selective sync** — allow users to exclude certain meshes or tables from sync
3. **Row-level encryption** — even the broker can't read content
4. **CRDT structures** — if append-only patterns dominate, move memory/state to Automerge-style
5. **Multi-machine personal mesh sync** — server-side encrypted storage of personal meshes
6. **SQLite encryption at rest** — SQLCipher adds ~4 MB; consider as `claudemesh-cli-sqlcipher` alternate distribution
7. **Time-series queries on memory** — "what did I remember 3 days ago" requires additional indexing
8. **Incremental vector re-embedding** — current flow is one big expensive operation
9. **Import support** — with safe re-stamping

---

**End of spec.**
