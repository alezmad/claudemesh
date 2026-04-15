# claudemesh-cli v2 Pass 2 — Shared infrastructure (broker-backed services)

> ⚠️ **This document describes v2 Pass 2 broker hardening — NOT the Pass 1 scope.**
>
> For the v2 Pass 1 implementation target, see **`2026-04-11-cli-v2-pass1.md`**.
>
> Pass 1 keeps the broker **exactly as it is today in v1**. No role-per-mesh Postgres isolation, no MCP catalog tiering, no egress-controlled Docker networks, no SSRF policy for URL watch, no RBAC matrix rewrite, no catalog audit process, no vault mount_path validation. The broker's existing behavior is preserved; v2 Pass 1 only changes the CLI side.
>
> The existing v1 broker features (Postgres schemas, Neo4j databases, Qdrant collections, MinIO buckets, Docker MCP sandboxes, vault, URL watch, Telegram bridge) keep working unchanged. The security hardenings described in this document are desirable improvements for future broker releases, not v2 Pass 1 gates.
>
> This document is retained as reference for future Pass 2 broker hardening work.

**Status:** Pass 2 future reference — NOT the Pass 1 implementation target
**Created:** 2026-04-10
**Companion to:** `2026-04-10-cli-v2-final-vision.md` and `2026-04-10-cli-v2-local-first-storage.md`
**Purpose:** Specifies the broker-backed shared services that the CLI surfaces as mesh tools: shared SQL (Postgres), graph database (Neo4j), vector search (Qdrant), object storage (MinIO), MCP registry (two tiers), URL watch, vault, and the default bundled MCP catalog. Establishes the hybrid architecture where per-peer data is local-first SQLite while shared-mesh data lives on broker-hosted backends.

All of this is **already implemented in v1** (`apps/cli/src/mcp/tools.ts`, `apps/broker/src/*`). This spec documents the v1 behavior, locks it into the v2 architecture, and defines the isolation and multi-tenancy model.

---

## Table of contents

1. The hybrid architecture
2. Shared-infrastructure inventory
3. Per-mesh isolation models
4. Shared SQL (Postgres)
5. Graph database (Neo4j)
6. Vector search (Qdrant)
7. Object storage (MinIO)
8. MCP registry — tier 1: peer-hosted
9. MCP registry — tier 2: broker-deployed
10. Vault (encrypted credentials)
11. URL watch
12. Default bundled MCP catalog
13. Broker deployment requirements
14. Security model
15. Tool surface summary
16. Migration from v1

---

## 1. The hybrid architecture

v2 is **local-first for per-peer data** and **broker-backed for shared-mesh data**. This is what v1 already does, now explicit:

```
┌─────────────────────────────────────────────────────────────────┐
│                          Claude Code                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │ stdio MCP protocol
┌───────────────────────────▼─────────────────────────────────────┐
│              claudemesh-cli (per-peer process)                  │
│                                                                 │
│   ┌─────────────────────────┐    ┌─────────────────────────┐    │
│   │  LOCAL (SQLite)         │    │  REMOTE (broker WS)     │    │
│   │  source of truth for    │    │  gateway to shared      │    │
│   │  per-peer data:         │    │  services:              │    │
│   │                         │    │                         │    │
│   │  • memory               │    │  • mesh_query (SQL)     │    │
│   │  • state_kv (local ptr) │    │  • graph_query (Cypher) │    │
│   │  • personal files       │    │  • vector_search        │    │
│   │  • task claims          │    │  • mesh_tool_call       │    │
│   │  • outbox / inbox       │    │  • mesh_watch           │    │
│   │  • peer cache           │    │  • vault_set            │    │
│   └─────────────────────────┘    └──────────┬──────────────┘    │
└──────────────────────────────────────────────┼──────────────────┘
                                               │ WebSocket
┌──────────────────────────────────────────────▼──────────────────┐
│                     Broker (per-mesh gateway)                   │
│                                                                 │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│   │ Postgres │  │  Neo4j   │  │  Qdrant  │  │    MinIO     │    │
│   │ per-mesh │  │ per-mesh │  │ per-mesh │  │   per-mesh   │    │
│   │ schema   │  │    DB    │  │collection│  │    bucket    │    │
│   └──────────┘  └──────────┘  └──────────┘  └──────────────┘    │
│                                                                 │
│   ┌───────────────────────────────────────────────────────┐     │
│   │ MCP runtime sandbox (Docker per deployed server)     │     │
│   └───────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

### Which side owns what

| Concern | Owner | Rationale |
|---|---|---|
| `memory` | Local SQLite | Per-peer knowledge; local-first for offline |
| Local state keys | Local SQLite | Fast reads, sync via outbox |
| Shared `state_kv` snapshot | Local SQLite | Synced from broker, readable offline |
| Personal files (`files`) | Local blobs + MinIO mirror | Content-addressed local; upload to MinIO on share |
| Tasks (claims + status) | Local SQLite + sync | Offline claim with reconciliation |
| **Shared SQL tables** | **Broker Postgres** | Cross-peer SQL requires central DB |
| **Shared graph** | **Broker Neo4j** | Cross-peer Cypher requires central DB |
| **Cross-peer vector search** | **Broker Qdrant** | Shared index across peers |
| **Large file object store** | **Broker MinIO** | Per-mesh bucket, ephemeral vs persistent paths |
| **Shared MCP tool calls** | **Broker (routes or hosts)** | Tool lives on peer or in broker sandbox |
| **URL watch polling** | **Broker** | Central poller, push notifications to peers |
| **Vault credentials** | **Broker** (encrypted) | Injected into deployed MCPs at runtime |

### The rule

**If a feature requires reading another peer's data, it's broker-backed.** If it only needs your own data, it's local. This is the clean boundary.

---

## 2. Shared-infrastructure inventory

Confirmed present in v1 code:

| Service | v1 file | v1 client lib |
|---|---|---|
| Postgres (shared SQL) | `apps/broker/src/broker.ts` (embedded) | `pg` (node-postgres) |
| Neo4j (graph) | `apps/broker/src/neo4j-client.ts` | `neo4j-driver` |
| Qdrant (vectors) | `apps/broker/src/qdrant.ts` | `@qdrant/js-client-rest` |
| MinIO (files) | `apps/broker/src/minio.ts` | `minio` |
| MCP runtime (Docker) | `apps/broker/src/broker.ts` (sandbox spawner) | Docker socket / `dockerode` |
| Vault (encrypted creds) | `apps/broker/src/broker.ts` | AES-GCM + KMS key |
| URL watch | `apps/broker/src/broker.ts` | Node fetch + scheduler |

v2 keeps all seven services and ports them into the new architecture without redesign. The broker continues to run them; the v2 CLI consumes them through WebSocket calls routed through `services/broker/ws-client.ts`.

---

## 3. Per-mesh isolation models

Each backend uses a different isolation strategy. This is intentional — each tool's semantics match a different model.

| Backend | Isolation strategy | Naming scheme | Multi-tenancy options |
|---|---|---|---|
| **Postgres** | Schema-per-mesh | `mesh_<meshId>` schema | Default: one schema per mesh. Optional: single-owner mode (user's own schema), or Row-Level Security for fine-grained cross-mesh sharing. |
| **Neo4j** | Database-per-mesh | `mesh_<meshId>` database | Enterprise: multi-database. Community: single default DB with label-based filtering (`mesh_id` label on every node). |
| **Qdrant** | Collection-per-mesh (per-collection) | `mesh_<meshId>_<collection>` | Single Qdrant instance, collection-level ACLs via broker. |
| **MinIO** | Bucket-per-mesh | `mesh-<meshId>` | Single MinIO cluster, IAM policies per bucket. |
| **MCP sandboxes** | Container-per-deployment | `cm-mcp-<meshId>-<serverName>` | Docker network isolation, read-only filesystem by default, network allowlist. |
| **Vault** | Row-per-peer | `vault(mesh_id, peer_id, key)` | AES-GCM with per-mesh wrapping key. |
| **URL watches** | Row-per-watch | `watches(mesh_id, peer_id, watch_id)` | Broker-level rate limiting per peer. |

### The RBAC layer

Every broker-backed operation goes through a common authorization check:

```ts
// apps/broker/src/authz.ts
export async function checkAccess(
  user: User,
  meshId: string,
  resource: Resource,
  action: Action,
): Promise<AuthzResult> {
  // 1. Is the user a member of the mesh?
  const membership = await getMembership(user.id, meshId);
  if (!membership) return { allowed: false, reason: 'not_a_member' };

  // 2. Does the user's role include this action?
  const role = membership.role; // 'owner' | 'admin' | 'member' | 'guest'
  if (!roleAllows(role, resource, action)) {
    return { allowed: false, reason: 'insufficient_role' };
  }

  // 3. Does the resource's scope include the user?
  if (resource.scope === 'peer' && resource.owner_id !== user.id) {
    return { allowed: false, reason: 'not_resource_owner' };
  }

  return { allowed: true };
}
```

Role capabilities (complete matrix):

| Action | guest | member | admin | owner |
|---|---|---|---|---|
| **SQL** | | | | |
| `mesh_query` (read) | ✓ (read-only) | ✓ | ✓ | ✓ |
| `mesh_execute` (write/DDL) | — | ✓ | ✓ | ✓ |
| `mesh_schema` | ✓ | ✓ | ✓ | ✓ |
| **Graph** | | | | |
| `graph_query` | ✓ (read-only) | ✓ | ✓ | ✓ |
| `graph_execute` | — | ✓ | ✓ | ✓ |
| **Vectors** | | | | |
| `vector_search scope=self` | ✓ | ✓ | ✓ | ✓ |
| `vector_search scope=all` | — | ✓ | ✓ | ✓ |
| `vector_search scope={peer}` | — | own peer only | ✓ | ✓ |
| `vector_store` | ✓ (own namespace) | ✓ | ✓ | ✓ |
| `vector_delete` | own only | own only | any | any |
| **Files** | | | | |
| `share_file` | ✓ | ✓ | ✓ | ✓ |
| `get_file` (download) | own + shared-with-self | own + shared-with-self + mesh-wide | any | any |
| `grant_file_access` (re-share) | — | own files only | any file | any file |
| `revoke_file_access` | — | own files only | any file | any file |
| `delete_file` | own only | own only | any | any |
| **MCP registry tier 1 (peer-hosted)** | | | | |
| `mesh_mcp_register` | — | ✓ | ✓ | ✓ |
| `mesh_mcp_list` | ✓ | ✓ | ✓ | ✓ |
| `mesh_mcp_remove` | — | own only | any | any |
| `mesh_tool_call` | ✓ (subject to scope) | ✓ | ✓ | ✓ |
| **MCP registry tier 2 (broker-deployed)** | | | | |
| `mesh_mcp_deploy scope=peer` | — | ✓ (own peer only) | ✓ | ✓ |
| `mesh_mcp_deploy scope=mesh` | — | — | ✓ | ✓ |
| `mesh_mcp_deploy scope=group` | — | — | ✓ | ✓ |
| `mesh_mcp_scope widen` (peer→mesh/group) | — | — | ✓ | ✓ |
| `mesh_mcp_scope narrow` | — | own deployments only | any | any |
| `mesh_mcp_undeploy` | — | own only | any | any |
| `mesh_mcp_logs` | — | own deployments only | any | any |
| `mesh_mcp_update` | — | own only | any | any |
| `mesh_mcp_catalog` | ✓ | ✓ | ✓ | ✓ |
| **Vault** | | | | |
| `vault_set` (own) | — | ✓ | ✓ | ✓ |
| `vault_list` (own metadata) | — | ✓ | ✓ | ✓ |
| `vault_delete` (own) | — | ✓ | ✓ | ✓ |
| `vault_read` (by deployed MCP) | — | — | — | — (broker-only, injected at container start) |
| **URL watch** | | | | |
| `mesh_watch` create | ✓ | ✓ | ✓ | ✓ |
| `mesh_unwatch` (own) | ✓ | ✓ | ✓ | ✓ |
| `mesh_unwatch` (any) | — | — | ✓ | ✓ |
| `mesh_watches` list | own only | own only | all | all |
| **Mesh lifecycle** | | | | |
| `mesh_rename` | — | — | ✓ | ✓ |
| `mesh_delete` | — | — | — | ✓ |
| `set_role` on another peer | — | — | ✓ (member↔guest) | ✓ (any transition) |
| **Catalog control** | | | | |
| `catalog enable tier=extended` | — | — | ✓ | ✓ |

**Key principles**:

1. **Guests are read-mostly** but can create vectors in their own namespace and watch URLs. They cannot write to shared SQL/graph, cannot deploy MCPs, cannot re-share files.
2. **Members can do everything in their own scope** (own files, own vectors, own vault, own tier-1 MCP registrations, own tier-2 peer-scoped deployments). They cannot widen scope to `mesh` or manage other peers' resources.
3. **Admins can manage mesh-wide resources** — scope changes, deployments affecting other members, role transitions for guests/members. They cannot delete the mesh or change the owner's role.
4. **Owners have full control** including mesh deletion and role reassignment. There is exactly one owner per mesh at any time; ownership transfer is a two-step process (invite new owner → current owner steps down).
5. **Vault read is broker-only** — no tool exposes the raw secret value. Deployed MCPs receive secrets via container env var injection at startup, scoped to the deployer's vault.
6. **MCP scope escalation path** (peer → mesh) requires admin role at the moment of escalation. A member cannot deploy as peer and then escalate themselves; an admin must approve the scope change.

Roles are assigned at invite time or via `claudemesh advanced set-role` (admin+ required).

---

## 4. Shared SQL (Postgres)

### 4.1 Overview

Each mesh has its own Postgres schema in the broker's cluster. Peers can run DDL (CREATE TABLE) and DML (INSERT/UPDATE/DELETE/SELECT) inside that schema. Cross-mesh access is impossible because the schema is the isolation boundary.

### 4.2 Tools

```
mesh_query(sql)       → SELECT-only, returns rows
mesh_execute(sql)     → DDL + DML, returns affected rows
mesh_schema()         → Lists tables and columns in this mesh's schema
```

Inputs are raw SQL strings. The broker parses them (via `pg-parser` or similar) to:
1. Reject queries that touch `pg_catalog`, `information_schema` beyond the mesh's scope, or other schemas
2. **Cross-schema qualified references**: the parser walks the AST and rejects any `TableRef` whose schema is not the caller's mesh schema (catches `SELECT * FROM "mesh_other".bugs`)
3. **File / system access**: `COPY ... FROM PROGRAM`, `COPY ... FROM '/path'`, `COPY ... TO PROGRAM`, `pg_read_file`, `pg_read_binary_file`, `pg_ls_dir`, `lo_import`, `lo_export`
4. **Cross-database access**: `dblink_connect`, `dblink`, any `postgres_fdw` operations
5. **Schema / extension management**: `CREATE SCHEMA`, `DROP SCHEMA`, `ALTER SCHEMA`, `CREATE EXTENSION`, `DROP EXTENSION`
6. **Role management**: `CREATE USER`, `CREATE ROLE`, `ALTER ROLE`, `DROP ROLE`, `GRANT`, `REVOKE`
7. **System catalog access** beyond a minimal allowlist (`pg_tables`, `pg_views`, `pg_indexes` scoped to the mesh's own schema)
8. **Volatile privilege functions**: `pg_backend_pid`, `pg_signal_backend`, `pg_terminate_backend`, `current_setting`/`set_config` with sensitive keys

**The parser is secondary defense**. Primary isolation is enforced by dedicated Postgres roles per mesh (see §4.3), which means even if the parser misses a pattern, role-based access control prevents cross-mesh reads at the Postgres layer.

### 4.3 Schema lifecycle — role-per-mesh isolation

**`search_path` alone is NOT a security boundary.** `SET search_path` only affects unqualified name resolution; a malicious query can still write `SELECT * FROM "mesh_other".bugs` and bypass the default. Isolation is enforced via **dedicated Postgres roles per mesh**.

```sql
-- On mesh creation
CREATE ROLE "mesh_<slug>_role" WITH LOGIN NOINHERIT;
CREATE SCHEMA "mesh_<slug>" AUTHORIZATION "mesh_<slug>_role";

-- Revoke public defaults that would allow cross-schema reads
REVOKE ALL ON SCHEMA "mesh_<slug>" FROM PUBLIC;
REVOKE ALL ON DATABASE claudemesh_shared FROM PUBLIC;
REVOKE ALL ON SCHEMA pg_catalog FROM "mesh_<slug>_role";
REVOKE ALL ON SCHEMA information_schema FROM "mesh_<slug>_role";

-- Grant only to the mesh's own role
GRANT USAGE, CREATE ON SCHEMA "mesh_<slug>" TO "mesh_<slug>_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "mesh_<slug>_role" IN SCHEMA "mesh_<slug>"
  GRANT ALL ON TABLES TO "mesh_<slug>_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "mesh_<slug>_role" IN SCHEMA "mesh_<slug>"
  GRANT ALL ON SEQUENCES TO "mesh_<slug>_role";

-- Explicitly revoke dangerous function access
REVOKE EXECUTE ON FUNCTION pg_read_file(text) FROM "mesh_<slug>_role";
REVOKE EXECUTE ON FUNCTION pg_read_binary_file(text) FROM "mesh_<slug>_role";
REVOKE EXECUTE ON FUNCTION lo_import(text) FROM "mesh_<slug>_role";
REVOKE EXECUTE ON FUNCTION lo_export(oid, text) FROM "mesh_<slug>_role";

-- On mesh deletion
DROP SCHEMA "mesh_<slug>" CASCADE;
DROP ROLE "mesh_<slug>_role";
```

The broker holds **one pool per mesh role** via PgBouncer (see §4.5) and dispatches queries to the correct pool. Even if a malicious query bypasses the parser, the Postgres role has zero privileges outside its own schema, so cross-mesh reads are denied at the database layer.

```ts
async function meshQuery(meshSlug: string, sql: string): Promise<Row[]> {
  // Pool is pre-configured with role "mesh_<slug>_role" — primary isolation
  const pool = await getPoolForMesh(meshSlug);
  const client = await pool.connect();
  try {
    // Secondary defense: unqualified names default to mesh schema
    await client.query(`SET search_path TO "mesh_${meshSlug}"`);
    const result = await client.query(sql);
    return result.rows;
  } finally {
    await client.query('RESET search_path');
    client.release();
  }
}
```

### 4.4 Connection pooling via PgBouncer (mandatory)

**Scaling problem**: 10 connections per mesh × 1000 meshes = 10,000 Postgres connections. Default `max_connections` is ~100. Direct connection-per-mesh does not scale.

**Mandatory architecture**:

```
broker → PgBouncer (transaction mode) → Postgres
         │
         └─ one logical pool per mesh role
            max 10 connections per pool
            shared underlying Postgres connections via multiplexing
```

Reference configuration in `apps/broker/pgbouncer.ini`:

```ini
[databases]
* = host=postgres port=5432

[pgbouncer]
pool_mode = transaction
max_client_conn = 10000
default_pool_size = 10
reserve_pool_size = 2
server_reset_query = DISCARD ALL
```

**`server_reset_query = DISCARD ALL` is mandatory** — it resets `search_path`, session variables, temporary tables, and prepared statements between transactions to prevent state leakage across meshes reusing the same underlying Postgres connection.

### 4.5 Tool call flow

```
Claude Code → claudemesh-cli MCP server → mesh_query(sql)
                                             ↓
                                     services/broker/facade.ts
                                             ↓ WS
                                     broker: checkAccess → switch search_path → execute → return rows
                                             ↑ WS
                                     services/broker/facade.ts → MCP response
                                             ↑
Claude Code ← rows
```

### 4.5 Multi-tenancy option: Row-Level Security

For meshes that want cross-peer row isolation (e.g. "each peer sees only their own bug reports"), RLS can be enabled:

```sql
ALTER TABLE "mesh_<slug>".bugs ENABLE ROW LEVEL SECURITY;
CREATE POLICY peer_isolation ON "mesh_<slug>".bugs
  FOR ALL
  USING (peer_id = current_setting('claudemesh.peer_id')::text);
```

The broker sets `claudemesh.peer_id` as a session variable before executing queries. Opt-in via `mesh_execute("SET claudemesh.rls_enabled = true")` — a mesh-level flag that future table creations use.

### 4.6 Single-owner mode

For personal meshes that become shared, the default schema ownership is the mesh owner (the creator). Other members have read access by default; write access is granted via role.

### 4.7 Resource limits

Per-mesh Postgres limits:
- **Max connections**: 10 (pooled through broker)
- **Max query time**: 30 seconds (`statement_timeout`)
- **Max schema size**: 1 GB (soft limit; warns at 80%, blocks writes at 100%)
- **Max tables per mesh**: 100

Limits are enforced at the broker level, not Postgres-native.

---

## 5. Graph database (Neo4j)

### 5.1 Overview

Each mesh has either:
- A dedicated Neo4j database (Enterprise edition), OR
- A shared default database with `mesh_id` label filtering (Community edition)

### 5.2 Tools

```
graph_query(cypher)    → Read-only MATCH
graph_execute(cypher)  → Write CREATE, MERGE, DELETE
```

### 5.3 Enterprise mode

```cypher
// On mesh creation
CREATE DATABASE mesh_<slug> IF NOT EXISTS;

// On mesh deletion
DROP DATABASE mesh_<slug> IF EXISTS;
```

The broker opens a session against the mesh-specific database:

```ts
const session = neo4jDriver.session({ database: meshDbName(meshSlug) });
```

### 5.4 Community mode — `graph_*` tools refused

Neo4j Community edition does not support multi-database isolation. Label-based filtering (Cypher AST rewriting to inject `mesh_id` labels) has known bypass patterns via APOC procedures, `CALL { ... }` subqueries, and future syntax that the rewriter can't anticipate. This is NOT a production-grade security boundary.

**In Community mode, the broker refuses `graph_query` and `graph_execute` tools entirely**, returning a clear error:

```
  Graph tools (graph_query, graph_execute) require Neo4j Enterprise edition.
  This broker is running Neo4j Community, which does not support multi-mesh isolation.
  Contact your administrator to upgrade.
```

The broker detects the edition at startup via Neo4j's `CALL dbms.components()` RPC and sets a feature flag. Community mode is valid for **personal meshes and development** (where the user owns all data and isolation isn't a concern), but the `graph_*` tools are disabled whenever a mesh has >1 peer OR is `shared_owner`/`shared_guest`.

**Enterprise is required for any shared mesh with graph features.** The reference Docker Compose (§13) documents this explicitly and defaults to Community (safer default — fail closed, not open).

### 5.5 Resource limits

- **Max query time**: 30 seconds
- **Max nodes per mesh**: 100,000 (soft limit)
- **Max relationships per mesh**: 500,000

---

## 6. Vector search (Qdrant)

### 6.1 Overview

Each mesh has one or more named collections in Qdrant, prefixed with the mesh ID. Collections are created on first insert.

### 6.2 Tools

```
vector_store(collection, text, metadata?)   → embed + upsert
vector_search(collection, query, limit?)    → embed query + nearest neighbors
vector_delete(collection, id)               → delete by ID
list_collections()                          → list this mesh's collections
```

### 6.3 Collection naming and creation

From v1's `qdrant.ts`:

```ts
export function meshCollectionName(meshId: string, collection: string): string {
  return `mesh_${meshId}_${collection}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

export async function ensureCollection(name: string, vectorSize = 1536): Promise<void> {
  try {
    await qdrant.getCollection(name);
  } catch {
    await qdrant.createCollection(name, {
      vectors: { size: vectorSize, distance: "Cosine" },
    });
  }
}
```

Default vector size is 1536 (OpenAI `text-embedding-3-small` or `ada-002`). v2 extends this with explicit model fingerprinting (see below) so peers using different embedding models don't corrupt each other's index.

### 6.4 Embedding provider

The broker runs an embedding service as part of the `vector_store` flow:

1. Peer calls `vector_store(collection, text)`
2. Broker receives the text + the peer's embedding-model preference (stored per-mesh in the mesh config)
3. Broker calls the embedding provider (OpenAI, Voyage, local sentence-transformers, etc.)
4. Broker upserts the vector into Qdrant with metadata `{ peer_id, text, model_id, timestamp }`
5. Returns the vector ID to the peer

Embedding model is per-mesh, not per-peer, to ensure search results are comparable across peers. Set via `claudemesh advanced set-embedding-model <provider>:<model>` (mesh admin only).

### 6.5 Cross-peer search with explicit scope

```
vector_search(collection, query, { scope: "self" | "all" | { peer: <id> }, limit: 10 })
```

**Scope is mandatory** — the caller must specify whether they want their own vectors, all peers' vectors, or a specific peer's vectors. There is no default "search everything" mode because that silently leaks vectors from other peers.

- `scope: "self"` — Qdrant filter `peer_id == self.peer_id`. Private search across the caller's own vectors.
- `scope: "all"` — Qdrant filter `peer_id IN mesh.members`. Cross-peer search with `peer_id` in results.
- `scope: { peer: "alice" }` — Qdrant filter `peer_id == "alice"`. Read another peer's specific vectors (requires the caller's role to allow it).

The scope filter is applied **server-side** in Qdrant via the collection's metadata filter, not client-side after the response. A malicious caller cannot bypass scope by editing the filter client-side.

Results always include `peer_id` metadata so the caller knows who contributed each result, even under `scope: "self"` (for audit).

### 6.6 Resource limits

- **Max collections per mesh**: 20
- **Max vectors per collection**: 100,000
- **Max vector dimension**: 4096

---

## 7. Object storage (MinIO)

### 7.1 Overview

Each mesh has a dedicated MinIO bucket. Files uploaded via `share_file` land there. Small files (< 64 KB) still go through the local SQLite blob store; large files go to MinIO.

### 7.2 Bucket naming and creation

From v1's `minio.ts`:

```ts
export function meshBucketName(meshId: string): string {
  return `mesh-${meshId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

export async function ensureBucket(name: string): Promise<void> {
  const exists = await minioClient.bucketExists(name);
  if (!exists) await minioClient.makeBucket(name);
}
```

### 7.3 Key paths

Two categories:
- **Persistent**: `shared/{fileId}/{originalName}` — survives until explicit delete
- **Ephemeral**: `ephemeral/{YYYY-MM-DD}/{fileId}/{originalName}` — auto-deleted after 7 days

The CLI's `share_file` tool takes a `persistence` flag (default: `persistent`). Ephemeral files are for temporary artifacts (screenshots, test output, pasted snippets) that don't need long-term storage.

### 7.4 E2E encryption with per-mesh long-term keys

Files shared to a specific peer (`share_file(to: "jordan")`) are end-to-end encrypted using each peer's **per-mesh long-term keypair** (not the ephemeral session key — session keys rotate, and a re-wrap operation after rotation would be expensive).

Every peer maintains two keys per mesh:
- **Session keypair** — rotates per session, used for transient messages (crypto_box)
- **Long-term keypair** — stable per `(mesh, peer)` pair, used for file encryption and vault envelopes

The long-term key is generated at first mesh join and persisted at `~/.claudemesh/keys/<mesh-slug>.key` (0600). It's registered with the broker in the mesh member list so senders can look it up.

Flow:
1. Sender generates a random symmetric key (32 bytes, AES-256-GCM)
2. Sender encrypts the file content with the symmetric key
3. Sender looks up the recipient's **long-term public key** from the mesh member list
4. Sender wraps the symmetric key with the recipient's long-term public key (crypto_box or sealed-box)
5. Wrapped key + file ciphertext uploaded to MinIO
6. Recipient downloads, unwraps the key with their long-term private key, decrypts the content

The broker cannot read the content. `grant_file_access` adds another recipient by re-wrapping the symmetric key with the new recipient's long-term public key.

### 7.5 Download URLs (chunked for large files)

The broker returns presigned URLs from MinIO. Two modes:

- **Small files (< 10 MB)**: single presigned URL, 10-minute expiry, one request
- **Large files (>= 10 MB)**: multipart download with per-chunk presigned URLs, each chunk up to 10 MB, 60-minute expiry total. The broker returns a list of URLs `{ chunks: [{ url, range: "0-10485759" }, ...] }`. The CLI downloads chunks in sequence (or in parallel for faster total throughput) and concatenates them.

For encrypted files, the URL delivers the ciphertext; the recipient decrypts locally after downloading all chunks.

**Resume on interruption**: if a chunk download fails, the CLI re-requests a new presigned URL for just that chunk. The broker regenerates the URL with a fresh expiry. Total download attempts capped at 3 per chunk.

### 7.6 Resource limits

- **Max file size**: 100 MB
- **Max total storage per mesh**: 10 GB (soft limit)
- **Ephemeral file retention**: 7 days
- **Persistent file retention**: until explicit delete

---

## 8. MCP registry — tier 1: peer-hosted

### 8.1 Overview

A peer can register their **local** MCP server (e.g. their personal Postgres connector, their internal API wrapper) with the mesh. Other peers discover it and call it via `mesh_tool_call`. The call is routed through the broker to the hosting peer, executed locally by the hosting peer's CLI, and the result is returned.

**Credentials never leave the hosting peer's machine.** The hosting peer's MCP server sees the real secrets; the broker only forwards requests and responses.

### 8.2 Tools

```
mesh_mcp_register(server_name, description, tools)  → announce
mesh_mcp_list()                                       → discover
mesh_tool_call(server_name, tool_name, args)          → invoke
mesh_mcp_remove(server_name)                          → unregister
```

### 8.3 Registration

```ts
mesh_mcp_register({
  server_name: "postgres-prod",
  description: "Production postgres connector",
  tools: [
    { name: "query", description: "Run SELECT", inputSchema: {...} },
    { name: "tables", description: "List tables", inputSchema: {...} },
  ],
  persistent: true,
});
```

`persistent: true` means other peers see the registration even when the hosting peer is offline. The hosting peer's status is shown as "offline" in `mesh_mcp_list` but the entry itself persists.

### 8.4 Tool call routing

```
Peer A (caller)                    Broker                     Peer B (host)
    │                                 │                            │
    ├─ mesh_tool_call ───────────────►│                            │
    │     server_name: "postgres"     │                            │
    │     tool_name: "query"          │                            │
    │     args: { sql: "..." }        │                            │
    │                                 ├─ mcp_invoke ──────────────►│
    │                                 │     routed via WS          │
    │                                 │                            ├─ execute locally
    │                                 │◄── mcp_result ─────────────┤
    │◄── mesh_tool_call_result ───────┤                            │
    │     { result: [...] }           │                            │
```

Timeout: 30 seconds. If the hosting peer doesn't respond in time, the caller gets a `{ status: 'timeout' }` error.

### 8.5 Rate limiting

Per-caller-per-host: 100 requests/minute. Per-mesh total: 1000 requests/minute. Enforced at the broker.

### 8.6 Use cases

- **Database access**: Peer B has credentials for the prod DB; Peer A queries it without ever seeing the credentials
- **Internal APIs**: Peer B's company-internal API is firewall-bound; Peer A calls it through B's machine as a proxy
- **GPU-accelerated tools**: Peer B has a local GPU; Peer A runs inference on B's machine

---

## 9. MCP registry — tier 2: broker-deployed

### 9.1 Overview

Distinct from tier 1, the broker can **host** MCP servers directly in sandboxed containers. A peer uploads (or references) an MCP server package, and the broker runs it as a long-lived process on the VPS. Other peers call its tools via `mesh_tool_call` (same call path as tier 1, but the "host" is the broker itself).

**This is how the marketing page's headline feature works**: `mesh_mcp_deploy("postgres-prod")` runs the actual MCP server on the broker, so the credentials are in the broker's vault (not the uploader's machine), and the server stays up even when the uploader is offline.

### 9.2 Tools

```
mesh_mcp_deploy(server_name, { file_id | git_url | npx_package }, env, runtime, scope, ...)
mesh_mcp_undeploy(server_name)
mesh_mcp_update(server_name)         → pull latest + restart
mesh_mcp_logs(server_name, lines)    → tail recent logs
mesh_mcp_scope(server_name, scope?)  → get/set visibility
mesh_mcp_schema(server_name, tool?)  → inspect tool definitions
mesh_mcp_catalog()                   → list all deployed services in the mesh
```

### 9.3 Deployment sources

Three ways to provide the MCP server code:

1. **File upload**: `mesh_mcp_deploy({ file_id: "..." })` — the `file_id` comes from `share_file` with a `.zip` or `.tar.gz` archive
2. **Git clone**: `mesh_mcp_deploy({ git_url: "https://github.com/...", git_branch: "main" })`
3. **npm package**: `mesh_mcp_deploy({ npx_package: "@upstash/context7-mcp" })`

### 9.4 Runtime sandbox

Each deployed MCP server runs in a Docker container with strict limits + writable working directory + egress-controlled network:

```ts
// apps/broker/src/mcp-runtime.ts (excerpt)
const containerConfig = {
  Image: runtimeImage(runtime), // 'node:20-alpine' | 'python:3.12-alpine' | 'oven/bun:1'
  Env: {
    ...env,
    HOME: '/workspace/home',
    XDG_CONFIG_HOME: '/workspace/home/.config',
    XDG_CACHE_HOME: '/workspace/home/.cache',
    XDG_DATA_HOME: '/workspace/home/.local/share',
  },
  HostConfig: {
    Memory: memory_mb * 1024 * 1024,
    MemorySwap: memory_mb * 1024 * 1024,
    CpuShares: 256,
    PidsLimit: 100,
    ReadonlyRootfs: true,
    Tmpfs: {
      '/tmp': 'size=100m,mode=1777',
      '/workspace/home': 'size=50m,mode=700,uid=65534,gid=65534', // writable HOME for XDG paths
    },
    Binds: [
      // Per-mesh persistent workspace (opt-in via deploy config)
      `/broker/data/mesh-${meshSlug}/mcp-${serverName}:/workspace/data:rw`,
    ],
    NetworkMode: mcpNetworkName(meshSlug, serverName), // egress-controlled network, see below
    CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges', 'seccomp=default'],
    ReadonlyPaths: ['/etc', '/usr'],
  },
  User: '65534:65534', // explicit nobody:nogroup UID/GID
  WorkingDir: '/workspace',
};
```

**Security posture**:
- Read-only root filesystem with explicit `ReadonlyPaths` for `/etc`, `/usr`
- `/tmp` writable with 100 MB limit (mode 1777 for standard behavior)
- `/workspace/home` writable tmpfs with 50 MB limit — provides `$HOME`, `$XDG_CONFIG_HOME`, `$XDG_CACHE_HOME`, `$XDG_DATA_HOME` for npm/python packages that expect writable user dirs
- `/workspace/data` optional persistent bind mount per `(mesh, server_name)` — used by `filesystem` MCP and similar
- Memory cap (default 256 MB, max 1 GB)
- **Egress network isolation** (see §9.4.1 below) — not bare `bridge` mode
- All capabilities dropped
- Default seccomp profile (plus optional stricter custom profile per catalog entry)
- Runs as explicit UID `65534` (nobody), NOT `User: 'nobody'` (which depends on the base image's `/etc/passwd`)
- `no-new-privileges` prevents setuid escalation

### 9.4.1 Network isolation for deployed MCPs

**`NetworkMode: 'bridge'` is NOT acceptable** for sandboxed MCPs. Bridge mode gives the container full egress to the internet and to other containers on the default bridge network.

Instead, the broker creates a **per-deployment Docker network** with no external access by default:

```ts
// Create a network with no egress
await docker.createNetwork({
  Name: mcpNetworkName(meshSlug, serverName),
  Driver: 'bridge',
  Internal: true,  // ← no NAT to the host/internet
  IPAM: { Config: [{ Subnet: '172.28.0.0/24' }] },
  Options: { 'com.docker.network.bridge.enable_icc': 'false' }, // no inter-container comms
});
```

When `network_allow` is non-empty, the broker attaches an **egress proxy** (a tiny sidecar container running `envoy` or `mitmproxy` in allowlist mode) to the MCP's network. The proxy accepts outbound connections only to hosts in `network_allow`, rejects everything else, and blocks private IP ranges by default:

- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC1918 private)
- `127.0.0.0/8` (loopback)
- `169.254.0.0/16` (link-local — blocks cloud metadata endpoints)
- `fc00::/7`, `fe80::/10` (IPv6 private + link-local)
- `::1/128`

Even if `network_allow` contains a hostname that resolves to a private IP, the proxy rejects the connection at the IP layer.

**Docker socket access is forbidden.** No MCP can mount `/var/run/docker.sock`. The `docker` MCP is explicitly excluded from the default catalog (§12).

### 9.5 Environment variables and vault

MCP servers often need credentials (API keys, DB passwords). These live in the **vault**, not in the deploy command:

```ts
// Step 1: store the secret
vault_set({ key: "github_token", value: "ghp_xxx..." });

// Step 2: reference it in deploy
mesh_mcp_deploy({
  server_name: "github",
  npx_package: "@modelcontextprotocol/server-github",
  env: {
    GITHUB_PERSONAL_ACCESS_TOKEN: "$vault:github_token",
  },
  scope: "mesh",
});
```

The broker resolves `$vault:<key>` at container start by decrypting the value with the per-mesh wrapping key. The raw value is injected as an environment variable and never appears in logs or command history.

### 9.6 Scope (visibility)

Each deployed MCP has a visibility scope controlling which peers can call it:

| Scope | Meaning |
|---|---|
| `"peer"` (default) | Only the deployer can call it |
| `"mesh"` | Every member of the mesh can call it |
| `{ group: "frontend" }` | Only members of `@frontend` group |
| `{ groups: ["frontend", "backend"] }` | Union of multiple groups |
| `{ role: "admin" }` | Members with the `admin` role |
| `{ peers: ["alice", "bob"] }` | Explicit peer allowlist |

Change scope later with `mesh_mcp_scope(server_name, new_scope)`.

### 9.7 Logs and observability

Every deployed MCP server's stdout and stderr are captured by the broker:

```
mesh_mcp_logs("postgres-prod", lines=50)
```

Logs are retained for 7 days in the broker's own storage. Errors beyond that are dropped.

### 9.8 Catalog

```
mesh_mcp_catalog()
```

Returns a list of every deployed MCP server in the mesh, with:
- Server name
- Status (`running`, `starting`, `stopped`, `crashed`)
- Scope
- Tool count
- Uptime
- Last log timestamp

Filtered by the caller's visibility: you only see servers whose scope includes you.

### 9.9 Cold start and lifecycle

- **First deploy**: ~10–30 seconds (Docker image pull if not cached, container start, MCP handshake)
- **Cached deploy**: ~2–5 seconds
- **Undeploy**: ~1 second (SIGTERM with 10s grace, then SIGKILL)
- **Update**: undeploy + deploy with same config
- **Auto-restart**: if the container crashes, the broker restarts it up to 5 times in 60 seconds. Beyond that, it's marked `crashed` and requires manual `mesh_mcp_update`.

### 9.10 Resource limits per mesh

- **Max deployed servers per mesh**: 20
- **Max total memory per mesh**: 4 GB
- **Max total containers on broker**: 200 (across all meshes)

---

## 10. Vault (encrypted credentials)

### 10.1 Overview

Per-peer encrypted storage for secrets used by deployed MCP servers. Secrets are encrypted at rest with AES-GCM, keys wrapped with a per-mesh KMS key.

### 10.2 Tools

```
vault_set(key, value, type?, mount_path?, description?)  → store
vault_list()                                              → list keys + metadata (no values)
vault_delete(key)                                         → remove
```

### 10.3 Types

- `type: "env"` (default) — a string, injected as an environment variable via `$vault:<key>`
- `type: "file"` — a file, written to `mount_path` inside the deployed container. Used for TLS certs, SSH keys, JSON credential files

### 10.4 Per-peer, per-mesh

Each peer has their own vault entries per mesh. Peer A's `github_token` and Peer B's `github_token` are two separate values. When a deployed MCP references `$vault:github_token`, the broker looks up the secret owned by **the user who deployed the server** (the deployer's vault, not the caller's vault — tool calls from other peers execute with the deployer's credentials).

### 10.5 `mount_path` validation for `type: file`

When a vault entry is of `type: file`, it's written to `mount_path` inside the deployed container. The broker **validates `mount_path` before accepting the vault entry**:

```ts
function validateMountPath(mountPath: string): void {
  if (!mountPath.startsWith('/run/secrets/')) {
    throw new Error('mount_path must be under /run/secrets/');
  }
  if (mountPath.includes('\0')) throw new Error('null byte in mount_path');
  if (mountPath.includes('..')) throw new Error('parent reference forbidden');
  if (!/^\/run\/secrets\/[a-zA-Z0-9._-]+$/.test(mountPath)) {
    throw new Error('invalid mount_path format');
  }
}
```

All vault files are written under `/run/secrets/` inside the container. Path traversal via `mount_path: "../../etc/passwd"` is rejected at `vault_set` time, not at container start time.

Inside the container, `/run/secrets/` is a dedicated tmpfs mount separate from the writable `$HOME` tmpfs. Files are owned by the deployment runtime user (UID 65534), mode `0400` (read-only by owner).

### 10.6 Security

- AES-256-GCM for row encryption
- Per-mesh wrapping key derived from the broker's KMS
- Secrets never logged (scrubbed from broker stdout, container stdout piped through a secret-masking filter before being written to `mcp_logs`)
- Never returned by `vault_list` (only metadata: key, type, created_at, description)
- Revocation: `vault_delete` immediately breaks any deployed server using that key (the broker sends SIGTERM to affected containers)
- RBAC: only the deployer can `vault_set` for keys referenced by their own deployments. Admins can revoke but not read other peers' vault entries.

---

## 11. URL watch

### 11.1 Overview + SSRF policy

The broker polls an HTTP URL on a schedule and notifies the requesting peer when the response changes. Useful for monitoring external status pages, build progress, PR states, etc.

**`mesh_watch` is a server-side HTTP fetch primitive and therefore an SSRF vector.** The broker enforces a destination policy on every watch URL:

**Rejected destinations** (checked at watch creation AND on every poll, after DNS resolution):
- Private IP ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` (CGNAT)
- Loopback: `127.0.0.0/8`, `::1/128`
- Link-local (cloud metadata): `169.254.0.0/16`, `fe80::/10` — blocks AWS/GCP/Azure IMDS endpoints
- IPv6 private: `fc00::/7`
- Broadcast: `255.255.255.255`
- Unspecified: `0.0.0.0`, `::`
- Broker's own hostname / internal container network

**DNS rebinding protection**: the broker resolves the URL's hostname BEFORE fetching, rejects any resolution into a blocked range, and pins the IP for subsequent polls. If a subsequent poll resolves to a different IP (rebinding attempt), the watch is disabled and the creator is notified.

**Allowed schemes**: `https://` only (no `http://`, no `file://`, no `gopher://`, no `ftp://`, no `data:`). `http://` is allowed in development mode only via `CLAUDEMESH_DEV=1` on the broker.

**Per-watch egress limit**: max 1 MB response body per poll. Responses larger than 1 MB are truncated and hashed at 1 MB.

### 11.2 Tools

```
mesh_watch({
  url: "https://status.example.com",
  mode: "hash" | "json" | "status",
  extract?: "data.status",          // for json mode
  interval: 30,                       // seconds, min 5
  notify_on?: "change" | "match:up" | "not_match:down",
  headers?: { Authorization: "..." },
  label?: "Example status"
})

mesh_unwatch(watch_id)
mesh_watches()   → list own watches
```

### 11.3 Detection modes

- **`hash`** — SHA-256 of the response body; notify on any change
- **`json`** — extract a jsonpath from the response; notify on change at that path
- **`status`** — HTTP status code only; notify on code change

### 11.4 Notification

When a change is detected, the broker pushes a message to the watching peer via the normal `send_message` channel with `subtype: watch`:

```json
{
  "subtype": "watch",
  "watch_id": "abc123",
  "label": "Example status",
  "url": "https://status.example.com",
  "old_value": "up",
  "new_value": "down",
  "at": 1712800000000
}
```

### 11.5 Resource limits and worker pool

- **Max watches per peer per mesh**: 10
- **Min interval**: 5 seconds
- **Max interval**: 86400 seconds (24h)
- **Max response body for hash/json**: 1 MB
- **Broker-side total concurrent watches**: 10,000 per broker instance

**Worker pool architecture**: 10,000 watches at 5-second intervals = 2,000 requests/second sustained. A single polling loop cannot handle this. The broker runs a **worker pool** with backpressure:

- 50 worker goroutines (or Node.js async workers)
- Shared priority queue sorted by next-poll timestamp
- Each worker pulls the next due watch, fetches, applies change detection, emits notification, re-queues
- If the pool can't keep up, poll intervals stretch (warning logged, watch marked "degraded")

For >10,000 concurrent watches, horizontal scaling is required: multiple broker instances with a shared queue (Redis-backed). This is a v1.1+ feature; v1.0.0 caps at 10,000 per broker.

---

## 12. Default bundled MCP catalog

### 12.1 Purpose

Users should be able to add common infrastructure tools (GitHub, Slack, filesystem, etc.) to their mesh with a single command, without hunting for the right package name or writing a config file. The broker ships with a curated catalog of **official Anthropic MCP reference servers** pre-approved for one-command deployment.

### 12.2 The tiered catalog

The catalog is **tiered by risk**. Tier 1 (core) ships enabled by default. Tier 2 (extended) requires explicit opt-in by a mesh admin via `claudemesh advanced catalog enable tier=extended`. Tier 3 (dangerous) is **never** available via catalog — users who want these MCPs must deploy them via `npx_package` or `git_url` with full awareness of the risks.

**Tier 1 — Core (default, low-risk)**

Version-pinned, SHA256-locked, signature-verified, quarterly audited:

| Alias | Package | Risk profile | Env vars |
|---|---|---|---|
| `git` | `@modelcontextprotocol/server-git` | local git ops, read-only by default | none |
| `memory` | `@modelcontextprotocol/server-memory` | in-container KV, no network | none |
| `sequential-thinking` | `@modelcontextprotocol/server-sequential-thinking` | no I/O, pure reasoning aid | none |
| `time` | `@modelcontextprotocol/server-time` | timezone lookup, no network | none |
| `filesystem` | `@modelcontextprotocol/server-filesystem` | scoped to `/workspace/data` per mesh | none |

**Tier 2 — Extended (opt-in, medium-risk)**

Require explicit admin enablement per mesh. Egress-controlled via `network_allow` to specific host lists per entry:

| Alias | Package | Risk | Env vars | Egress allowlist |
|---|---|---|---|---|
| `github` | `@modelcontextprotocol/server-github` | API key in vault | `GITHUB_PERSONAL_ACCESS_TOKEN` | `api.github.com`, `github.com` |
| `gitlab` | `@modelcontextprotocol/server-gitlab` | API key in vault | `GITLAB_PERSONAL_ACCESS_TOKEN` | `gitlab.com`, `*.gitlab.com` (configurable) |
| `slack` | `@modelcontextprotocol/server-slack` | bot token in vault | `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID` | `slack.com`, `*.slack.com` |
| `linear` | `linear-mcp` | API key in vault | `LINEAR_API_KEY` | `api.linear.app` |
| `notion` | `@notionhq/notion-mcp-server` | API key in vault | `NOTION_API_KEY` | `api.notion.com` |
| `google-maps` | `@modelcontextprotocol/server-google-maps` | API key in vault | `GOOGLE_MAPS_API_KEY` | `maps.googleapis.com` |
| `google-drive` | `@modelcontextprotocol/server-gdrive` | OAuth flow | OAuth tokens in vault | `googleapis.com`, `*.googleusercontent.com` |
| `stripe` | `@stripe/mcp` | live API key — highest risk of T2 | `STRIPE_SECRET_KEY` | `api.stripe.com` |
| `postgres` | `@modelcontextprotocol/server-postgres` | external DB connection | `POSTGRES_CONNECTION_STRING` | (user-specified host + egress proxy validates) |
| `sqlite` | `@modelcontextprotocol/server-sqlite` | scoped to `/workspace/data` | `SQLITE_PATH` | none |
| `fetch` | `@modelcontextprotocol/server-fetch` | arbitrary HTTP — SSRF vector | none | (user-specified, validated per-request by egress proxy) |
| `puppeteer` | `@modelcontextprotocol/server-puppeteer` | browser automation — can leak data | none | (user-specified) |
| `playwright` | `@playwright/mcp` | browser automation | none | (user-specified) |

**Tier 3 — Dangerous (never in catalog)**

| Alias | Why excluded |
|---|---|
| `docker` / any MCP requiring Docker socket access | Socket access = root on host VPS = container escape |
| Shell/exec MCPs that run arbitrary commands | No sandbox tight enough; equivalent to RCE |
| Any MCP requiring `CAP_SYS_ADMIN`, `CAP_NET_ADMIN`, or privileged mode | Escalation risk |

Users who need tier-3 functionality deploy via `npx_package` or `git_url` and take responsibility for the security review.

**Source of truth**: the catalog lives in `apps/broker/src/mcp-catalog.ts` and is pinned to specific versions with SHA256 lockfile entries.

### 12.3 Catalog audit process (documented, not one-liner)

Every catalog entry goes through a **mandatory audit checklist** before inclusion and at quarterly review:

**On inclusion**:
1. **Provenance check** — package published by a verified Anthropic partner or a well-known vendor (e.g. Stripe, Notion, Slack)
2. **Source audit** — review the package source for: filesystem access, network hosts, env var reads, spawned processes, native dependencies
3. **Version pin** — exact version + SHA256 hash in `mcp-catalog-lockfile.json`. No `latest` tags, no version ranges.
4. **Signature verification** — if the package is signed (sigstore/cosign), verify the signature. If not, document the risk.
5. **Permission review** — document the minimum set of permissions, env vars, and network hosts required. Mismatch with catalog entry = audit fail.
6. **Risk tier assignment** — Tier 1 (zero external I/O), Tier 2 (known-host egress), Tier 3 (excluded)
7. **Approval** — two reviewers (one engineering, one security) sign off

**Quarterly re-review** (every 3 months):
1. Check for upstream version updates, CVEs, or publisher changes
2. Re-run source audit against the new version if any updates are pending
3. Update `mcp-catalog-lockfile.json` with new pins if approved
4. Document changes in `CHANGELOG-catalog.md`

**Compromise response** (if an upstream package is compromised):
1. Broker revokes the catalog entry immediately (pushed via broker config reload)
2. Running deployments using that catalog entry are SIGTERMed
3. Users notified via `mesh_info` and the next `claudemesh` launch
4. Post-mortem documented at `docs/incidents/`

The audit checklist and current lockfile live in `apps/broker/src/mcp-catalog.ts` and `apps/broker/mcp-catalog-lockfile.json`. All tier-1 and tier-2 catalog entries are subject to this process. Third-party `npx_package` / `git_url` deployments bypass the catalog entirely and are the user's responsibility.

### 12.3 One-command deployment

```
mesh_mcp_deploy({
  server_name: "github",
  catalog: "github",                    // ← references the catalog alias
  env: {
    GITHUB_PERSONAL_ACCESS_TOKEN: "$vault:github_token"
  },
  scope: "mesh"
})
```

When `catalog` is set, the broker:
1. Looks up the catalog entry
2. Uses the pinned package/version, not a free-form `npx_package`
3. Validates required env vars are present (from vault)
4. Applies the catalog's default sandboxing rules
5. Deploys

### 12.4 Custom MCP deployments still work

The catalog doesn't replace `npx_package` / `git_url` / `file_id` deployments. It's a fast path for common cases. Custom deployments retain full control but require more careful configuration.

### 12.5 Catalog discovery from CLI

```
$ claudemesh mcp catalog

Available MCP servers (official Anthropic catalog):

  filesystem           read/write files in a scoped directory
  github               GitHub API: issues, PRs, commits, files
  git                  local git ops: log, diff, blame
  postgres             run SQL against a Postgres database
  slack                Slack: channels, messages, users
  fetch                HTTP fetch any URL
  memory               reference memory MCP (simple KV)
  sequential-thinking  structured step-by-step reasoning
  time                 timezone-aware time queries
  puppeteer            browser automation
  ...

Deploy with: claudemesh mcp deploy <alias>
```

An advanced CLI command (not in the main 8). The actual deployment is through the normal `mesh_mcp_deploy` tool surface; this command is a convenience wrapper.

### 12.6 Security review for catalog updates

Before a new package is added to the catalog:
1. Source code audit (the publisher, the package, recent updates)
2. Permissions review (what env vars, what network hosts, what filesystem paths)
3. Version pinning (never `latest`, always explicit)
4. Bundled in the next broker release (no runtime catalog updates)

**The catalog is an opinionated list, not a marketplace.** Users who want bleeding-edge or third-party MCPs use `npx_package` or `git_url` with the understanding that they're taking on the security review themselves.

---

## 13. Broker deployment requirements

### 13.1 Services the broker depends on

| Service | Version | Purpose | Isolation |
|---|---|---|---|
| PostgreSQL | 15+ | Broker metadata + per-mesh shared SQL schemas | schema-per-mesh |
| Neo4j | 5.15+ | Per-mesh graph databases | database-per-mesh (Enterprise) or labeled (Community) |
| Qdrant | 1.7+ | Per-mesh vector collections | collection-per-mesh |
| MinIO | latest | Per-mesh object storage buckets | bucket-per-mesh |
| Docker | 24+ | MCP runtime sandboxes | container-per-deployment |
| KMS | any cloud KMS or local | Vault key wrapping | per-mesh key |

### 13.2 Docker Compose reference

**Default ships with Neo4j Community** (safer default, no license acceptance). Meshes that need `graph_*` tools must override to Enterprise and accept the license separately.

```yaml
# apps/broker/docker-compose.yml (reference deployment — Community default)
services:
  broker:
    image: claudemesh/broker:1.0.0
    depends_on: [postgres, pgbouncer, neo4j, qdrant, minio]
    environment:
      POSTGRES_URL: postgresql://broker:${POSTGRES_PASSWORD}@pgbouncer:6432/broker
      NEO4J_URL: bolt://neo4j:7687
      NEO4J_USER: neo4j
      NEO4J_PASSWORD: ${NEO4J_PASSWORD}
      NEO4J_EDITION: community  # or 'enterprise' (see docker-compose.enterprise.yml)
      QDRANT_URL: http://qdrant:6333
      MINIO_ENDPOINT: minio:9000
      MINIO_ACCESS_KEY: ${MINIO_ACCESS_KEY}
      MINIO_SECRET_KEY: ${MINIO_SECRET_KEY}
      KMS_KEY_ID: ${KMS_KEY_ID}
      DOCKER_SOCKET: /var/run/docker.sock
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - mcp-workspaces:/broker/data   # per-mesh MCP workspaces (see §13.3)

  pgbouncer:
    image: edoburu/pgbouncer:latest
    depends_on: [postgres]
    environment:
      DB_HOST: postgres
      DB_USER: broker
      DB_PASSWORD: ${POSTGRES_PASSWORD}
      POOL_MODE: transaction
      MAX_CLIENT_CONN: 10000
      DEFAULT_POOL_SIZE: 10
    volumes:
      - ./pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini

  postgres:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    command: >
      postgres
      -c max_connections=200
      -c statement_timeout=30000
    volumes:
      - postgres-data:/var/lib/postgresql/data

  neo4j:
    # Community edition by default — graph_* tools are DISABLED for shared meshes
    # To enable graph tools for shared meshes, switch to neo4j:5.15-enterprise
    # and accept the Enterprise license (user responsibility):
    #   NEO4J_ACCEPT_LICENSE_AGREEMENT: "yes"
    image: neo4j:5.15-community
    environment:
      NEO4J_AUTH: neo4j/${NEO4J_PASSWORD}
    volumes:
      - neo4j-data:/data

  qdrant:
    image: qdrant/qdrant:v1.7.4
    volumes:
      - qdrant-data:/qdrant/storage

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    volumes:
      - minio-data:/data

volumes:
  postgres-data:
  neo4j-data:
  qdrant-data:
  minio-data:
  mcp-workspaces:
```

**Enterprise Neo4j** (for meshes needing `graph_*`) lives in `apps/broker/docker-compose.enterprise.yml` as an overlay file:

```yaml
services:
  neo4j:
    image: neo4j:5.15-enterprise
    environment:
      NEO4J_ACCEPT_LICENSE_AGREEMENT: "yes"  # USER RESPONSIBILITY — Neo4j Enterprise license terms
      NEO4J_EDITION: enterprise
```

Apply with `docker compose -f docker-compose.yml -f docker-compose.enterprise.yml up`. The user must review and accept the Neo4j Enterprise license independently — claudemesh does not bundle a license grant.

### 13.3 Per-mesh MCP workspaces (filesystem MCP mount protocol)

Deployed MCPs that need filesystem access (e.g. `filesystem`, `sqlite`) get a **per-mesh persistent workspace** mounted at `/workspace/data` inside the container:

```
Host path:       /broker/data/mesh-<slug>/mcp-<server-name>/
Container path:  /workspace/data
Permissions:     owned by UID 65534 (container's nobody), mode 0700
```

The broker creates the workspace on first deployment, validates the path (no `..`, no absolute outside `/broker/data`), and cleans it up on `mesh_mcp_undeploy`. Workspaces are **not shared** across MCP deployments — each `(mesh, server_name)` pair gets its own isolated directory.

**Quota**: 1 GB per workspace (enforced via tmpfs size or disk quota). Larger requirements need explicit admin approval.

Example: the `filesystem` MCP is deployed with:
```json
{
  "server_name": "fs",
  "catalog": "filesystem",
  "env": { "ALLOWED_DIRS": "/workspace/data" },
  "scope": "mesh"
}
```
Peers then call `mesh_tool_call("fs", "read_file", { path: "/workspace/data/notes.md" })` and the MCP returns the file content from the per-mesh workspace.

The `sqlite` MCP is similar — it stores the SQLite database file at `/workspace/data/mesh.sqlite` and uses the mount for persistence across container restarts.

### 13.3 Minimum broker VPS specs

For a small mesh (< 10 peers, < 5 deployed MCPs):

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB | 100 GB |
| Network | 100 Mbps | 1 Gbps |

For a large mesh (50+ peers, 20+ deployed MCPs):

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 8 vCPU | 16 vCPU |
| RAM | 16 GB | 32 GB |
| Disk | 200 GB | 1 TB SSD |
| Network | 1 Gbps | 10 Gbps |

### 13.4 Scaling notes

- **Postgres**: vertical scaling first, read replicas for read-heavy meshes
- **Neo4j**: Enterprise clustering for large graphs
- **Qdrant**: horizontal scaling via sharding (collections per node)
- **MinIO**: distributed mode (4+ nodes) for high availability
- **Broker process**: single-node for v1.0.0; horizontal scaling via sticky sessions in v1.1+

### 13.5 Official Docker image

`claudemesh/broker:1.0.0` — built from `apps/broker/Dockerfile`, includes:
- Broker binary (Bun-compiled)
- All CLI dependencies for the catalog MCPs (node, python, bun runtimes for sandbox containers)
- `sqlite-vec` extension for embedded use
- Default seccomp profile for container sandboxing

### 13.6 Broker availability posture (single-node for v1.0.0)

**v1.0.0 ships a single-node broker per mesh.** There is no high-availability failover, no load balancing across broker instances, no multi-region replication. The broker is a single point of failure for all shared-infrastructure operations (SQL, graph, vectors, MCP tool calls, URL watches).

**Client behavior on broker outage**:
- **Local-first tools** (memory, state, tasks, personal files, recall on local vectors) continue to work from SQLite. Users experience no interruption for per-peer data operations.
- **Broker-backed tools** (mesh_query, graph_query, vector_search, mesh_tool_call, mesh_watch) return a clear error: `"Can't reach the mesh broker right now. This operation requires the shared infrastructure. Try again in a minute."`
- **The sync daemon enters reconnecting state** with exponential backoff (1s → 2s → 5s → 10s → 30s max). Outbox operations queue locally and flush on reconnect.
- **Claude Code's status line** transitions to amber/gray `◉` / `◎` to signal broker unreachable.

**Client behavior on broker restart**:
- The broker increments its `broker_epoch` on each restart (see storage spec §5.9)
- CLIs reconnect and receive the new epoch in the first ack
- Inbox dedupe uses `(mesh_epoch, broker_seq)` so seq numbers starting from 1 after restart don't collide with prior deliveries
- Postgres connections held via PgBouncer are reset via `server_reset_query = DISCARD ALL` to clear any leaked session state

**In-flight Postgres state on broker disconnect**:
- PgBouncer-pooled connections in transaction mode: any in-flight transaction aborts on broker crash and releases the connection back to the pool
- `SET search_path` state is cleared by `DISCARD ALL` on reset, so reused connections start clean for the next mesh
- A connection validator (`SELECT 1` on checkout) catches any connections that survived in broken state

**Clean error surfaces on outage**:
| Operation | User-visible message |
|---|---|
| `claudemesh launch` to shared mesh | "Can't reach the mesh. Your Claude Code session will start, but broker-backed tools will be unavailable until we reconnect." |
| `mesh_execute` during outage | "Can't reach the mesh broker. Try again in a minute." |
| `claudemesh share` during outage | "Can't publish right now. claudemesh.com is unreachable. Try again in a minute." |
| Background sync daemon | Silent retry with status line dot transition. No modal. |

**HA is a v1.1+ feature.** v1.0.0 treats the broker as a dependency similar to any other self-hosted database — run it on reliable infrastructure, monitor it, accept that outages are possible. For mission-critical deployments, document the limitation explicitly in the operator runbook.

### 13.7 Broker observability (v1.0.0 minimum)

- **Structured logs** to stdout in JSON format, ingestible by any log collector
- **`/health`** HTTP endpoint returning `{ status, postgres_ok, neo4j_ok, qdrant_ok, minio_ok, uptime_s, version }`
- **`/metrics`** Prometheus-format endpoint with: request counts, latencies (p50/p99), error rates by category, active connections per pool, sync daemon outbox/inbox lag, deployed MCP container count
- **Audit log** (§14.2) retained for 90 days, accessible via `claudemesh advanced audit --mesh <slug>`

v1.1+ will add traces, alerts, and a dashboard template. v1.0.0 ships with enough to diagnose outages via `curl /health` and log tailing.

---

## 14. Security model

### 14.1 Threat model

| Threat | Mitigation |
|---|---|
| Cross-mesh data leak via SQL | Schema isolation + search_path enforcement + parser-level rejection of cross-schema queries |
| Cross-mesh data leak via Neo4j | Enterprise database isolation (preferred) or labeled queries (community) |
| Cross-mesh data leak via Qdrant | Collection-level naming + broker-enforced ACL |
| Cross-mesh data leak via MinIO | Bucket-per-mesh + IAM policies |
| Deployed MCP escaping sandbox | Docker with read-only root, dropped caps, seccomp, no-new-privileges |
| Vault secret leak in logs | Secrets never appear in stdout/stderr; env injection happens at container start |
| Deployed MCP making outbound network calls | Default: no network. Explicit `network_allow` required. |
| Peer calling another peer's local MCP | Tier-1 MCP calls are routed through broker with auth check |
| Malicious MCP from catalog | Catalog entries are version-pinned and audited before inclusion |
| Malicious custom MCP (`npx_package`/`git_url`) | User takes responsibility; broker enforces sandbox regardless |
| Broker compromise | Per-mesh KMS wrapping keys; root compromise still exposes ciphertext but not KMS keys without separate credentials |

### 14.2 Audit logging

Every shared-infrastructure operation is logged to the broker's audit log:

```json
{
  "timestamp": 1712800000000,
  "mesh_id": "alejandro-mbp",
  "peer_id": "alice",
  "action": "mesh_mcp_deploy",
  "resource": "server_name=github",
  "result": "success",
  "source_ip": "1.2.3.4"
}
```

Logs are retained for 90 days. Accessible via `claudemesh advanced audit --mesh <slug>` (admin-only).

### 14.3 Rate limiting

Limits are applied **per peer, per mesh** (not per mesh total, which would let one abusive peer starve the quota for everyone). An additional per-mesh aggregate cap applies at 10× the per-peer limit to cap total mesh load.

| Operation | Per peer/mesh | Per mesh aggregate |
|---|---|---|
| `mesh_execute` | 100/min | 1000/min |
| `graph_execute` | 100/min | 1000/min |
| `vector_store` | 500/min | 5000/min |
| `vector_search` | 1000/min | 10000/min |
| `mesh_mcp_deploy` | 5/hour | 50/hour |
| `mesh_tool_call` | 1000/min | 10000/min |
| `mesh_watch` (create) | 10/hour | 100/hour |
| `share_file` | 100/hour | 1000/hour |

Rate limits are enforced via token buckets in the broker, keyed by `(mesh_id, peer_id, operation)`. Excess requests return a `rate_limited` error with `retry_after_seconds` in the response.

**Per-IP rate limit** (separate from per-peer): 2000 requests/minute per source IP to protect against anonymous abuse of unauthenticated endpoints (device-code polling, invite claim).

---

## 15. Tool surface summary

All ~30 tools from the gap analysis, organized by family, with their broker-side requirements:

| Family | Tools | Backend | Isolation |
|---|---|---|---|
| **SQL** | `mesh_query`, `mesh_execute`, `mesh_schema` | Postgres | schema-per-mesh |
| **Graph** | `graph_query`, `graph_execute` | Neo4j | database-per-mesh |
| **Vectors** | `vector_store`, `vector_search`, `vector_delete`, `list_collections` | Qdrant | collection-per-mesh |
| **Files (large)** | `share_file`, `get_file`, `grant_file_access`, `read_peer_file`, `list_peer_files`, `list_files`, `file_status`, `delete_file` | MinIO | bucket-per-mesh |
| **MCP registry (peer-hosted)** | `mesh_mcp_register`, `mesh_mcp_list`, `mesh_mcp_remove`, `mesh_tool_call` | in-memory on broker | per-mesh registry |
| **MCP registry (broker-deployed)** | `mesh_mcp_deploy`, `mesh_mcp_undeploy`, `mesh_mcp_update`, `mesh_mcp_logs`, `mesh_mcp_scope`, `mesh_mcp_schema`, `mesh_mcp_catalog` | Docker | container-per-deployment |
| **Vault** | `vault_set`, `vault_list`, `vault_delete` | Postgres + AES-GCM | row-per-peer |
| **URL watch** | `mesh_watch`, `mesh_unwatch`, `mesh_watches` | broker scheduler | row-per-watch |
| **Mesh clock (write)** | `mesh_set_clock`, `mesh_pause_clock`, `mesh_resume_clock` | in-memory on broker | per-mesh |
| **Streams** | `create_stream`, `publish`, `subscribe`, `list_streams` | Redis / in-memory pub-sub | per-mesh |
| **Webhooks** | `create_webhook`, `list_webhooks`, `delete_webhook` | broker HTTP server | per-mesh |
| **Contexts** | `share_context`, `get_context`, `list_contexts` | Postgres | schema-per-mesh |
| **Skills** | `share_skill`, `get_skill`, `list_skills`, `remove_skill`, `mesh_skill_deploy` | Postgres + MinIO | schema-per-mesh |

**Tools not needing shared infrastructure** (local-first, already in the storage spec):
- Memory: remember, recall, forget
- State: set_state, get_state, list_state
- Tasks: create_task, claim_task, complete_task, list_tasks
- Messaging: send_message, list_peers, check_messages, message_status
- Profile: set_summary, set_status, set_visible, set_profile
- Groups: join_group, leave_group
- Scheduling: schedule_reminder, list_scheduled, cancel_scheduled
- Mesh meta: mesh_info, mesh_stats, mesh_clock (read), ping_mesh
- Small files (< 64 KB) fallback to local blobs

---

## 16. Migration from v1

### 16.1 What stays unchanged

- `apps/broker/src/qdrant.ts` — port verbatim
- `apps/broker/src/minio.ts` — port verbatim
- `apps/broker/src/neo4j-client.ts` — port verbatim
- Postgres schema management logic in `apps/broker/src/broker.ts` — port verbatim
- MCP runtime sandbox logic — port verbatim
- Vault encryption logic — port verbatim
- URL watch scheduler — port verbatim
- Tool definitions in `apps/cli/src/mcp/tools.ts` — ported into `apps/cli-v2/src/mcp/tools/<family>.ts` files

### 16.2 What changes

- **CLI side**: tool handlers move from `apps/cli/src/mcp/` (monolithic) to `apps/cli-v2/src/mcp/tools/<family>.ts` (one file per family)
- **Broker client**: `apps/cli-v2/src/services/broker/ws-client.ts` is a typed wrapper with schemas for each remote tool call
- **Tool dispatch**: broker-backed tools go through `services/broker/facade.ts`, local tools go through the appropriate feature facade (per the facade pattern spec)
- **Authz enforcement**: v2 explicitly calls `services/auth/facade.ts::whoAmI()` before any shared-infrastructure operation, then the broker re-validates on its side
- **Default MCP catalog**: new file `apps/broker/src/mcp-catalog.ts` with the curated list (documented in §12)

### 16.3 What's added

- Curated default MCP catalog (§12)
- Explicit RBAC model with role matrix (§3)
- Structured audit logging (§14.2)
- Explicit rate limits per operation (§14.3)
- Resource limit enforcement per mesh
- v2 broker Docker Compose reference deployment (§13.2)

### 16.4 Phase plan integration

This spec adds **~3-4 days** to the v2 phased plan:

| Phase | New work |
|---|---|
| Phase 4 (Mesh core) | +1 day — port broker client WS wrappers for SQL/graph/vector/files |
| Phase 5 (Sync daemon) | unchanged |
| Phase 7 (MCP server) | +2 days — implement `mcp/tools/sql.ts`, `graph.ts`, `vectors.ts`, `files.ts`, `mcp-registry.ts`, `watch.ts`, `vault.ts`, `mesh-clock.ts`; all delegating to broker facade |
| Phase 8 (Commands) | +0.5 day — add `claudemesh mcp catalog` and `claudemesh mcp deploy <alias>` advanced commands |
| Phase 9 (Migration) | +0.5 day — document broker deployment requirements in new docs section |

Total v2 phased plan revises from ~28-37 days to **~32-41 days** realistic, or ~11-13 days aggressive with Opus 4.6 1M.

---

## 17. Open questions

1. **Neo4j Enterprise licensing**: community edition is free but lacks multi-database. v1 silently falls back to labeled queries. Should v2.0.0 require Enterprise, or document both paths? Recommendation: document both, warn community users of the security implications.

2. **Embedding provider for Qdrant**: the broker needs to call an embedding model. Options: (a) use the user's OpenAI key from their vault, (b) run a local sentence-transformers container, (c) require the caller to pre-compute embeddings. v1 uses option (a). Recommendation: keep (a), add (b) as a config option for air-gapped deployments.

3. **Docker socket access**: the broker mounts `/var/run/docker.sock` to spawn MCP sandboxes. This is a significant privilege. Alternative: use `docker-in-docker` or a separate sandbox runner with a minimal API. Recommendation: stick with Docker socket for v1.0.0, add hardening notes in the security runbook.

4. **MinIO vs S3**: should v2 default to MinIO or support S3-compatible backends generically? Recommendation: MinIO is the reference; any S3-compatible backend works via the same `minio` client library.

5. **Per-mesh Postgres connection pooling**: 10 connections per mesh can exhaust a Postgres cluster with 1000 meshes. Should the broker use PgBouncer or a shared connection pool with search_path switching? Recommendation: shared pool with search_path switching, already implemented in v1.

6. **Vault KMS**: v1 uses a local key file. v2 should use a cloud KMS (AWS KMS, GCP KMS, Azure Key Vault) or HashiCorp Vault in production. Local key file remains as a dev fallback.

7. **Tier-2 MCP execution fairness**: if one mesh deploys 20 MCPs and consumes all the broker's container resources, other meshes suffer. Need per-mesh quotas and a fairness scheduler. Recommendation: document as v1.1 feature; for v1.0.0 use static per-mesh limits.

---

**End of spec.**
