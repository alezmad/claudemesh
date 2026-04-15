# claudemesh v1 — Feature Inventory

**Status:** backlog reference
**Created:** 2026-04-11
**Purpose:** Exhaustive audit of what v1 ships today. **Every row in this document must still work after v2 lands.** v2 is a refactor + CLI user flows, NOT a functional rewrite; this inventory is the regression checklist.

**Source of truth**:
- `apps/cli/src/` — 22 files, ~12 k LOC (v0.10.5)
- `apps/broker/src/` — 23 files, ~11 k LOC
- `packages/db/src/schema/mesh.ts` — 1,019 lines, 23 tables

---

## 0. Summary counts

| Surface | v1 count |
|---|---|
| CLI commands (subcommands in `index.ts`) | 23 |
| MCP tools (handlers in `mcp/server.ts`) | 79 |
| Broker WS message types (dispatched in `index.ts`) | 85 |
| Broker HTTP endpoints | 18 |
| Postgres tables in `mesh` schema | 23 |
| External backend services the broker manages | 5 (Postgres, Neo4j, Qdrant, MinIO, Docker) |
| Lines of source (CLI + broker, excluding tests) | ~23,450 |

---

## 1. CLI commands

All dispatched from `apps/cli/src/index.ts`. v1 ships 23 public subcommands plus the bare-command welcome wizard.

| Command | File | Purpose | Flags / args |
|---|---|---|---|
| `claudemesh` (bare) | `commands/welcome.ts` | Interactive welcome wizard. Entry point for new users. | (none) |
| `launch` | `commands/launch.ts` (775 lines, biggest) | Spawn a Claude Code session with mesh connectivity + MCP tools | `--name`, `--role`, `--groups`, `--mesh`, `--join`, `--message-mode`, `--system-prompt`, `-y/--yes`, `-r/--resume`, `-c/--continue`, `--quiet`, + passthrough to `claude` after `--` |
| `create` | `commands/create.ts` | Create a new mesh from a template | `--template`, `--list-templates` |
| `install` | `commands/install.ts` (538 lines) | Register MCP server + status hooks with Claude Code (`~/.claude.json`, `~/.claude/settings.json`) | `--no-hooks` |
| `uninstall` | `commands/install.ts` | Remove MCP server + hooks from Claude Code config | (none) |
| `join` | `commands/join.ts` (193 lines) | Join a mesh via invite URL or token | positional `<url>` |
| `list` | `commands/list.ts` | Show joined meshes, slugs, local identities | (none) |
| `leave` | `commands/leave.ts` | Leave a joined mesh + remove its local keypair | positional `<slug>` |
| `peers` | `commands/peers.ts` | List online peers with status, summary, groups | `--mesh`, `--json` |
| `send` | `commands/send.ts` | Send a message to a peer, group, or all peers | positional `<to> <message>`, `--mesh`, `--priority` |
| `inbox` | `commands/inbox.ts` | Drain pending inbound messages | `--mesh`, `--json`, `--wait` |
| `state` | `commands/state.ts` | Get / set / list shared KV state in the mesh | positional `<action> <key> [value]`, `--mesh`, `--json` |
| `info` | `commands/info.ts` | Mesh overview: slug, broker, peer count, state keys | `--mesh`, `--json` |
| `remember` | `commands/memory.ts` | Store a persistent memory visible to all peers | positional `<content>`, `--mesh`, `--tags`, `--json` |
| `recall` | `commands/memory.ts` | Full-text search of mesh memories | positional `<query>`, `--mesh`, `--json` |
| `remind` | `commands/remind.ts` (142 lines) | Schedule a delayed message. Also: `remind list`, `remind cancel <id>` | positional `<message>`, `--in`, `--at`, `--cron`, `--to`, `--mesh`, `--json` |
| `sync` | `commands/sync.ts` | Sync meshes from the user's claudemesh.com dashboard account | `--force` |
| `profile` | `commands/profile.ts` | View or edit member profile (self or another member if admin) | `--mesh`, `--role-tag`, `--groups`, `--message-mode`, `--name`, `--member`, `--json` |
| `status` | `commands/status.ts` | Check broker connectivity for each joined mesh | (none) |
| `doctor` | `commands/doctor.ts` (212 lines) | Diagnose install, config, keypairs, PATH | 7 checks: Node >= 20, claude binary, MCP registered, hooks registered, config parses, file perms, keypairs valid |
| `mcp` | `mcp/server.ts` (2139 lines) | Start MCP server on stdio (internal — invoked by Claude Code) | (none) |
| `seed-test-mesh` | `commands/seed-test-mesh.ts` | Dev-only: inject a mesh into local config without invite flow | `<slug>`, `<broker_url>` |
| `hook` | `commands/hook.ts` | Internal: handle Claude Code hook events (status updates from session lifecycle) | stdin JSON from Claude Code |
| `connect telegram` | `commands/connect-telegram.ts` | Link a Telegram bot to a mesh | inline token prompts, calls broker `/tg/token` |
| `disconnect telegram` | `commands/disconnect-telegram.ts` | Unlink Telegram bot | (none) |

### Flag-first invocation rewrite

`apps/cli/src/index.ts` lines 339–355 implement a **friction reducer**: if the user types `claudemesh --resume xxx` or any flag-first invocation, the argv is rewritten to `claudemesh launch --resume xxx` before citty parses it. This lets users skip typing `launch` for common flag-only forms.

**Must preserve in v2.** Users may depend on this. Applies to `--resume`, `--continue`, `-y`, `--mesh`, `--name`, etc.

---

## 2. MCP tools (79 total)

Defined in `apps/cli/src/mcp/tools.ts` with schemas, implemented in `apps/cli/src/mcp/server.ts` with per-tool case handlers. Each MCP tool is a RPC that the CLI's MCP server handles locally or forwards to the broker via WS.

Grouped by domain family. Every tool listed here has a working handler in v1.

### 2.1 Messaging (4)

| Tool | v1 behavior |
|---|---|
| `send_message` | Send encrypted message to peer, group, or broadcast. Supports priorities: `now` (immediate), `next` (default), `low`. Broker queues if recipient offline. |
| `list_peers` | List connected peers in the mesh with `presenceId`, `displayName`, `status`, `summary`, `groups`, `roleTag`. |
| `message_status` | Query delivery state of a sent message by `messageId`. |
| `check_messages` | Drain pending inbox messages (push mode). |

### 2.2 Profile + identity (4)

| Tool | v1 behavior |
|---|---|
| `set_summary` | Set the current peer's work summary (visible to others). |
| `set_status` | Set status: `idle`, `working`, `dnd`. Priority-ranked by source (`hook` > `manual` > `jsonl`). |
| `set_visible` | Toggle visibility. Hidden peers skip `list_peers` and broadcasts but still receive direct messages. |
| `set_profile` | Update display name, role tag, groups, avatar, title, bio, capabilities. |

### 2.3 Groups (2)

| Tool | v1 behavior |
|---|---|
| `join_group` | Join a `@group` with optional role (`lead`, `member`, or free-form). |
| `leave_group` | Leave a `@group`. |

### 2.4 State KV (3)

| Tool | v1 behavior |
|---|---|
| `set_state` | Set a key-value pair in the mesh's shared state. Broadcasts `state_change` push to all peers. |
| `get_state` | Read a value by key. |
| `list_state` | List all state keys with values, authors, timestamps. |

### 2.5 Memory (3)

| Tool | v1 behavior |
|---|---|
| `remember` | Store a text memory with optional tags. Persists across sessions. |
| `recall` | Full-text search memories by query, ranked results. |
| `forget` | Delete a memory by ID. |

### 2.6 Files (8)

| Tool | v1 behavior |
|---|---|
| `share_file` | Upload a file to MinIO. Supports `to: <peer>` for E2E encryption (symmetric key wrapped with peer pubkey), or mesh-wide sharing. Supports `persistent` vs `ephemeral` storage. |
| `get_file` | Download a file by `fileId`. Returns a presigned MinIO URL. |
| `list_files` | List files in the mesh by `scope`, `tags`, author. |
| `file_status` | Query status of a file: who downloaded, when. |
| `delete_file` | Delete a file (owner only). |
| `grant_file_access` | Add another peer as a recipient of an already-encrypted file (re-wraps symmetric key). |
| `read_peer_file` | Read a file from another peer's working directory (requires peer online + sharing). |
| `list_peer_files` | List files in a peer's shared directory (tree of names, not contents). |

### 2.7 Vectors (Qdrant) (4)

| Tool | v1 behavior |
|---|---|
| `vector_store` | Store embedding with metadata in a named collection. |
| `vector_search` | Nearest-neighbor search in a collection with `limit`. |
| `vector_delete` | Delete a vector by ID. |
| `list_collections` | List collections in the mesh's Qdrant namespace. |

### 2.8 Graph (Neo4j) (2)

| Tool | v1 behavior |
|---|---|
| `graph_query` | Read-only Cypher MATCH query on the per-mesh Neo4j database. |
| `graph_execute` | Write Cypher (CREATE/MERGE/DELETE). |

### 2.9 Shared SQL (Postgres) (3)

| Tool | v1 behavior |
|---|---|
| `mesh_query` | SELECT-only query on the per-mesh Postgres schema. |
| `mesh_execute` | DDL + DML (CREATE TABLE, INSERT, UPDATE, DELETE). |
| `mesh_schema` | List tables + columns in the mesh's schema. |

### 2.10 Streams (4)

| Tool | v1 behavior |
|---|---|
| `create_stream` | Create a named stream for live data pub-sub. |
| `publish` | Push data to a stream. Subscribers receive in real-time. |
| `subscribe` | Subscribe to a stream. Events arrive as channel notifications. |
| `list_streams` | List active streams. |

### 2.11 Contexts (3)

| Tool | v1 behavior |
|---|---|
| `share_context` | Share session understanding with the mesh (summary + files_read + key_findings + tags). |
| `get_context` | Search contexts by query (file path, topic, etc.). |
| `list_contexts` | Show what peers currently know about the codebase. |

### 2.12 Tasks (4)

| Tool | v1 behavior |
|---|---|
| `create_task` | Create a work item (title, assignee, priority, tags). |
| `claim_task` | Claim an unclaimed task. |
| `complete_task` | Mark done with optional result summary. |
| `list_tasks` | Filter by status and/or assignee. |

### 2.13 Scheduling (3)

| Tool | v1 behavior |
|---|---|
| `schedule_reminder` | One-shot (`deliver_at`, `in_seconds`) or recurring (`cron`). Delivered to self or `to`. Persists across broker restarts. |
| `list_scheduled` | List pending scheduled messages. |
| `cancel_scheduled` | Cancel by ID. |

### 2.14 Mesh metadata — read (4)

| Tool | v1 behavior |
|---|---|
| `mesh_info` | Overview: peers, groups, state, memory, files, tasks, streams, tables. |
| `mesh_stats` | Resource usage per peer: messages in/out, tool calls, uptime, errors. |
| `mesh_clock` | Simulation clock status: speed, tick count, simulated time. |
| `ping_mesh` | Test messages through the full pipeline, measure round-trip per priority. Diagnoses push delivery issues. |

### 2.15 Mesh clock — write (3)

| Tool | v1 behavior |
|---|---|
| `mesh_set_clock` | Set simulation clock speed (1–100x). Peers receive heartbeat ticks at the simulated rate. |
| `mesh_pause_clock` | Pause simulation clock. |
| `mesh_resume_clock` | Resume paused clock. |

### 2.16 Skills (5)

| Tool | v1 behavior |
|---|---|
| `share_skill` | Publish a reusable skill (name + description + instructions + tags + when_to_use + allowed_tools + model + context + agent + user_invocable + argument_hint). Exposed as MCP prompts and `skill://` resources. |
| `get_skill` | Load a skill's full instructions by name. |
| `list_skills` | Browse available skills, optionally filter by keyword. |
| `remove_skill` | Remove a shared skill. |
| `mesh_skill_deploy` | Deploy a multi-file skill bundle from zip or git repo. |

### 2.17 MCP registry tier 1 — peer-hosted (4)

| Tool | v1 behavior |
|---|---|
| `mesh_mcp_register` | Register a peer's local MCP server with the mesh (server_name, description, tools schema, persistent flag). Other peers can invoke via `mesh_tool_call`. |
| `mesh_mcp_list` | List MCP servers in the mesh with their tools + hosting peer. |
| `mesh_tool_call` | Call a tool on a mesh-registered MCP server. Routes: caller → broker → hosting peer → execute → result back. 30s timeout. |
| `mesh_mcp_remove` | Unregister a peer-hosted MCP server. |

### 2.18 MCP registry tier 2 — broker-deployed (7)

| Tool | v1 behavior |
|---|---|
| `mesh_mcp_deploy` | Deploy an MCP server from zip (via `file_id`), git URL, or npx package. Runs on broker VPS in Docker sandbox. Scope: `peer` (default), `mesh`, or `{group/groups/role/peers}`. Runtime: node / python / bun. Memory, network_allow, env with `$vault:` references. |
| `mesh_mcp_undeploy` | Stop and remove a managed MCP server. |
| `mesh_mcp_update` | Pull latest + restart a git-sourced server. |
| `mesh_mcp_logs` | Tail recent logs from a managed server. |
| `mesh_mcp_scope` | Get or set visibility scope. |
| `mesh_mcp_schema` | Inspect tool schemas for a deployed server. |
| `mesh_mcp_catalog` | List all deployed services with status, scope, tool count. |

### 2.19 Vault (3)

| Tool | v1 behavior |
|---|---|
| `vault_set` | Store encrypted credential. `type: env` (string, injected as env var via `$vault:<key>`) or `type: file` (file written to `mount_path` in container). |
| `vault_list` | List vault entries (keys + metadata only, no values). |
| `vault_delete` | Remove a credential. |

### 2.20 URL watch (3)

| Tool | v1 behavior |
|---|---|
| `mesh_watch` | Watch a URL for changes. Modes: `hash` (SHA-256 body), `json` (jsonpath extract), `status` (HTTP code). Polling `interval` (min 5s). `notify_on: change \| match:<val> \| not_match:<val>`. Custom headers. |
| `mesh_unwatch` | Stop watching by `watch_id`. |
| `mesh_watches` | List active watches. |

### 2.21 Webhooks (3)

| Tool | v1 behavior |
|---|---|
| `create_webhook` | Create an inbound webhook. Returns a URL external services (GitHub, CI/CD, monitoring) can POST to. Payload becomes a mesh message to all peers. |
| `list_webhooks` | List active webhooks. |
| `delete_webhook` | Deactivate by name. |

---

## 3. Broker WS protocol

`apps/broker/src/index.ts` dispatches 85 message types over a single WebSocket endpoint (`WS_PATH`). Each WS message is a client-initiated RPC; most of the 79 MCP tools above map 1:1 to a WS message. Some additional WS messages exist for connection lifecycle + internal routing.

### 3.1 Connection lifecycle (3)

- `hello` — client authentication. Ed25519 signature over `{meshId, memberId, pubkey, timestamp}`. Broker verifies, creates presence row, replies with `hello_ack`.
- `hello_ack` — server → client, confirms authentication + sends restored peer state.
- `get_clock` — get current simulation clock state.

### 3.2 Messaging (4 WS ops)

- `send` — send a message. Envelope contains sender, recipient (peer/group/*), priority, nonce, ciphertext.
- `peer_dir_request` / `peer_dir_response` — peer-to-peer directory request (read_peer_file under the hood).
- `peer_file_request` / `peer_file_response` — peer-to-peer file read.

### 3.3 Profile + presence (5)

- `set_status`, `set_summary`, `set_visible`, `set_profile`, `set_stats`

### 3.4 Groups (2)

- `join_group`, `leave_group`

### 3.5 State KV (3)

- `set_state`, `get_state`, `list_state`

### 3.6 Memory (3)

- `remember`, `recall`, `forget`

### 3.7 Files (5)

- `get_file`, `list_files`, `file_status`, `grant_file_access`, `delete_file`

### 3.8 Vectors (3)

- `vector_store`, `vector_search`, `vector_delete`, `list_collections`

### 3.9 Graph (2)

- `graph_query`, `graph_execute`

### 3.10 Shared SQL (3)

- `mesh_query`, `mesh_execute`, `mesh_schema`

### 3.11 Streams (4)

- `create_stream`, `publish`, `subscribe`, `unsubscribe`, `list_streams`

### 3.12 Contexts (3)

- `share_context`, `get_context`, `list_contexts`

### 3.13 Tasks (4)

- `create_task`, `claim_task`, `complete_task`, `list_tasks`

### 3.14 Scheduling (3)

- `schedule`, `list_scheduled`, `cancel_scheduled`

### 3.15 Mesh metadata (3)

- `mesh_info`, `peers_list` (from `list_peers`), `message_status`

### 3.16 Simulation clock (4)

- `set_clock`, `pause_clock`, `resume_clock`, `get_clock`

### 3.17 Skills (4)

- `share_skill`, `get_skill`, `list_skills`, `remove_skill`, `skill_deploy`

### 3.18 MCP registry (11)

- `mcp_register`, `mcp_unregister`, `mcp_list`, `mcp_call`, `mcp_call_response` (peer → peer relay)
- `mcp_deploy`, `mcp_undeploy`, `mcp_update`, `mcp_logs`, `mcp_scope`, `mcp_schema`, `mcp_catalog`

### 3.19 Vault (4)

- `vault_set`, `vault_get`, `vault_list`, `vault_delete`

### 3.20 URL watch (3)

- `watch`, `unwatch`, `watch_list`

### 3.21 Webhooks (3)

- `create_webhook`, `list_webhooks`, `delete_webhook`

### 3.22 Audit (2)

- `audit_query`, `audit_verify`

---

## 4. Broker HTTP endpoints

The broker serves both WS (`/ws`) and HTTP on the same port. HTTP endpoints are listed here by (method, path) with purpose.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Health check: liveness probe |
| `GET` | `/metrics` | Prometheus metrics endpoint |
| `POST` | `/hook/set-status` | Receive hook status updates from CLI `hook` command (Claude Code session lifecycle) |
| `POST` | `/join` | Accept v1 invite join (legacy) |
| `POST` | `/invites/:code/claim` | v2 invite claim (public, unauthenticated) |
| `POST` | `/upload` | Upload a file (returns fileId, used by `share_file`) |
| `GET` | `/download/:id` | Download a file (returns content or presigned URL) |
| `POST` | `/cli-sync` | CLI sync endpoint — fetches user's meshes from `claudemesh.com` dashboard via JWT, returns mesh list |
| `POST` | `/tg/token` | Register a Telegram bot token for a mesh (connects via `connect telegram` CLI command) |
| `PATCH` | `/mesh/:id/member/:memberId` | Update a member's profile (admin or self) |
| `GET` | `/mesh/:id/members` | List mesh members |
| `PATCH` | `/mesh/:id/settings` | Update mesh-level settings (owner/admin) |
| `POST` | `/hook/:meshId/:webhookId` | Inbound webhook — external systems POST here to publish a mesh message |
| `GET` | `/test/clock` | Dev-only: simulation clock state |
| `GET` | `/test/flip` | Dev-only: test flip endpoint |
| `GET` | `/test/html` | Dev-only: test HTML endpoint |
| `WS` | `/ws` | WebSocket connection for mesh peers (all WS ops above) |

---

## 5. Database schema — `mesh` Postgres schema

23 tables in the `mesh` schema (managed via Drizzle). Defined in `packages/db/src/schema/mesh.ts`.

| Table | Purpose |
|---|---|
| `mesh.mesh` | Mesh identity. slug, name, ownerId, createdAt, settings. |
| `mesh.member` | Per-mesh member record. Stable, durable. pubkey, displayName, role, groups, joinedAt. |
| `mesh.invite` | Invite codes + metadata. |
| `mesh.pending_invite` | v2 invite handshake state (pending claim). |
| `mesh.audit_log` | Audit events per mesh. |
| `mesh.presence` | Ephemeral WS session — one row per active connection. Status, statusSource, statusUpdatedAt. |
| `mesh.message_queue` | Queued messages pending push delivery (priority ordered). |
| `mesh.pending_status` | In-flight status updates (10s TTL). |
| `mesh.state` (meshState) | Shared KV state per mesh. |
| `mesh.memory` (meshMemory) | Shared memories with full-text search. |
| `mesh.file` (meshFile) | File metadata (uploader, size, sha256, persistence, storage location). |
| `mesh.file_access` (meshFileAccess) | Per-recipient ACL on files. |
| `mesh.file_key` (meshFileKey) | Per-recipient wrapped symmetric keys for E2E encryption. |
| `mesh.context` (meshContext) | Shared context entries. |
| `mesh.task` (meshTask) | Tasks with lifecycle (open, claimed, completed, cancelled). |
| `mesh.stream` (meshStream) | Stream metadata. |
| `mesh.skill` (meshSkill) | Skill registrations (name, content, frontmatter, tags). |
| `mesh.webhook` (meshWebhook) | Inbound webhook registrations. |
| `mesh.service` (meshService) | Deployed MCP server state (container ID, scope, env, runtime, memory, logs). |
| `mesh.vault_entry` (meshVaultEntry) | Encrypted vault entries per (mesh, peer, key). |
| `mesh.scheduled_message` | Scheduled / recurring reminders (cron + one-shot). |
| `mesh.peer_state` | Per-peer state (groups, role, profile, message mode preference). |
| `mesh.telegram_bridge` | Telegram bot registration per mesh. |

---

## 6. Broker backend services

Five external services the broker manages at runtime. All currently work in v1 and ship in the default Docker Compose deployment.

| Service | Purpose | File | Per-mesh model |
|---|---|---|---|
| **Postgres** (Drizzle) | Primary data store for mesh schema. Also used for `mesh_execute` / `mesh_query` / `mesh_schema` shared-SQL tools via per-mesh schemas. | `db.ts` | Schema-per-mesh for shared SQL tools |
| **Neo4j** | Graph queries (`graph_query`, `graph_execute`). | `neo4j-client.ts` | Database-per-mesh (Enterprise) or labeled-node fallback (Community) |
| **Qdrant** | Vector embeddings + nearest-neighbor search. | `qdrant.ts` | Collection naming: `mesh_<meshId>_<collection>`, 1536-dim default, cosine distance |
| **MinIO** | File storage for `share_file` / `get_file`. | `minio.ts` | Bucket-per-mesh: `mesh-<meshId>`. Persistent + ephemeral key paths. |
| **Docker** | Runs deployed MCP servers in sandboxed containers. | `index.ts` (deploy handler) | Container-per-deployment. Read-only root, dropped caps, memory limits, network_allow. |

---

## 7. Broker core subsystems

### 7.1 Status engine (`broker.ts`, 2066 lines)

**Battle-tested status model** ported from `claude-intercom`. Rules:

- Status sources are ranked: `hook` (3) > `manual` (2) > `jsonl` (1)
- On status update:
  - If status **changed** → bump everything, record new source
  - If status **unchanged**, incoming source ≥ recorded → upgrade
  - If status **unchanged**, incoming source < recorded:
    - Recorded source still fresh → keep it (bump timestamp only)
    - Recorded source stale → downgrade to honest attribution
- `HOOK_FRESHNESS_MS` window (default 60s) for "fresh" classification
- `WORKING_TTL_MS` after which `working` status reverts to `idle`
- `PENDING_TTL_MS = 10_000` for pending status cleanup
- `TTL_SWEEP_INTERVAL_MS = 15_000` for periodic cleanup

**Must preserve** — this is the correctness engine for `set_status`, `list_peers`, and Claude Code's status line.

### 7.2 Message queue + priority delivery

- Messages are stored in `mesh.message_queue` with priority (`now`, `next`, `low`)
- `now` messages bypass busy-gate and are pushed immediately
- `next` messages wait for idle peer
- `low` messages are pull-only (delivered when peer explicitly drains via `check_messages`)
- Queue is drained via `drainForMember(meshId, memberId)` on WS message arrival or manual `check_messages`
- Duplicate delivery prevention via `messageId` UUID tracking

### 7.3 Scheduled message delivery (`index.ts` in-memory + DB persistence)

- One-shot: `deliver_at` (timestamp) or `in_seconds`
- Recurring: standard 5-field cron expression
- Persists to `mesh.scheduled_message` table — survives broker restart
- On broker start, pending schedules are re-registered
- Delivery is via the normal `send_message` pipeline with `subtype: reminder`

### 7.4 URL watch subsystem (`index.ts`)

- Poller runs in-process (worker per watch)
- Modes: `hash` (SHA-256 of body), `json` (extract jsonpath value), `status` (HTTP status)
- `notify_on: change | match:<val> | not_match:<val>`
- Persists to DB so watches survive broker restart
- Min interval 5s, max 24h

### 7.5 Telegram bridge (`telegram-bridge.ts`, 1711 lines)

**Substantial subsystem.** Provides Telegram Bot API integration:

- Bot token registration per mesh via `POST /tg/token`
- Long-polling or webhook mode
- `tg:<username>` peer identity registration in the mesh's member table
- Inbound Telegram messages → mesh `send_message` events with `subtype: telegram`
- Outbound `send_message(to: "tg:<name>")` → Telegram Bot API call
- Chat-to-mesh mapping (Telegram chat_id ↔ mesh peer)
- User discovery (`connectChat`)
- Bridge row persistence in `mesh.telegram_bridge`

**This is ~18% of the broker's total source**. v2 must either:
1. Port the logic into a standalone MCP connector (`apps/mcp-telegram/`), or
2. Keep this file in the broker and wire it into the v2 architecture unchanged (my recommendation per the previous conversation — bundled into the broker image)

Either way, **every behavior documented here must still work after v2 lands**.

### 7.6 Auth + crypto (`crypto.ts`, `broker-crypto.ts`, `jwt.ts`)

- **Hello signatures**: Ed25519 signed tuple of `(meshId, memberId, pubkey, timestamp)`. Verified on every WS connection. Replay protection via timestamp window.
- **Invite verification**: canonical invite payload (`canonicalInvite`) signed by mesh owner, Ed25519 verified on claim
- **JWT**: for `/cli-sync` endpoint — the CLI obtains a JWT from `claudemesh.com` via browser flow, passes it to the broker, broker verifies and returns the user's mesh list
- **File envelopes**: client-side AES-GCM + per-recipient key wrapping (file_key table)

### 7.7 Rate limiting (`rate-limit.ts`)

- Per-peer rate limits on expensive operations
- Currently in-process (not Redis-backed)
- Enforces limits on `send`, `vector_store`, `mesh_execute`, `mesh_mcp_deploy`, etc.

### 7.8 Metrics (`metrics.ts`)

Prometheus metrics exposed at `/metrics`:
- Request counts by op type
- Latencies p50/p99
- Connection counts per mesh
- Message delivery counts by priority
- Error rates

### 7.9 Audit log (`audit.ts`)

- Every mutation is audited to `mesh.audit_log`
- Tamper-evidence via hash chaining
- Accessible via `audit_query` and `audit_verify` WS ops

### 7.10 Member API (`member-api.ts`, 284 lines)

Exports:
- `updateMemberProfile()` — used by `PATCH /mesh/:id/member/:memberId`
- `listMeshMembers()` — used by `GET /mesh/:id/members`
- `updateMeshSettings()` — used by `PATCH /mesh/:id/settings`

### 7.11 CLI sync (`cli-sync.ts`, 133 lines)

Exports `handleCliSync()` for `POST /cli-sync`. This is **already the "CLI sync meshes from dashboard" feature** — v2 will reuse this endpoint for its mesh-list refresh logic.

### 7.12 Webhook subsystem (`webhooks.ts`, 97 lines)

Handles `POST /hook/:meshId/:webhookId` inbound. Signature verification (HMAC), payload normalization, mesh message emission.

---

## 8. CLI core subsystems

### 8.1 WS client (`ws/client.ts`, 2191 lines)

**The biggest CLI file.** Implements the full WS protocol with:
- Connection management, reconnect with exponential backoff
- Message queue for offline buffering
- Request/response correlation via `_reqId`
- Ed25519 hello signature generation
- Crypto envelope wrapping for `send_message` payloads
- Push notification delivery (messages, state changes, system events)
- Per-mesh connection pooling (one WS per mesh)

### 8.2 MCP server (`mcp/server.ts`, 2139 lines)

Second biggest CLI file. Implements:
- MCP stdio transport (registered with Claude Code via `install.ts`)
- Tool registry from `mcp/tools.ts`
- Dispatch to 79 handlers (one per tool)
- WS client pooling (one connection per mesh)
- Crypto primitives for memory/state encryption
- Inline file-read helpers for `read_peer_file`
- Channel notification forwarding from broker → Claude Code via MCP elicitation

### 8.3 Crypto (`crypto/*.ts`)

- `keypair.ts` — Ed25519 keypair generation + persistence (`~/.claudemesh/keys/<mesh>.key`)
- `envelope.ts` — NaCl `crypto_box` envelope wrapping
- `file-crypto.ts` — AES-GCM file encryption + per-recipient key wrapping
- `hello-sig.ts` — Hello signature generation/verification

### 8.4 Auth + invite (`auth/*.ts`, `invite/*.ts`, `lib/invite-v2.ts`)

- `callback-listener.ts` — local HTTP server that catches browser OAuth callback (for `sync` command)
- `open-browser.ts` — cross-platform browser launcher
- `pairing-code.ts` — pairing code display
- `sync-with-broker.ts` — JWT-based sync from dashboard
- `invite/parse.ts` — parse v1 invite URLs
- `invite/enroll.ts` — enroll into a mesh from an invite
- `lib/invite-v2.ts` — v2 invite format (short-code + signed payload)

### 8.5 State + config (`state/config.ts`)

- `~/.claudemesh/config.json` read/write (mesh list, keypairs, profile defaults)
- 0600 permission enforcement
- Schema validation

### 8.6 TUI primitives (`tui/*.ts`)

- `colors.ts` — hard-coded ANSI colors
- `index.ts` — input helpers
- `screen.ts` — raw-mode screen control
- `spinner.ts` — simple spinner

### 8.7 Templates (`templates/index.ts`)

- `dev-team`, `research`, `ops-incident`, `simulation`, `personal`
- Each template seeds initial state + preset groups

### 8.8 Tests

- `__tests__/crypto-roundtrip.test.ts` — crypto round-trip verification
- `__tests__/invite-parse.test.ts` — invite URL parsing
- No integration tests against a real broker

---

## 9. Infrastructure + deployment

### 9.1 Broker runtime (`env.ts`)

Environment variables the broker expects:
- `DATABASE_URL` — Postgres connection
- `NEO4J_URL`, `NEO4J_USER`, `NEO4J_PASSWORD`
- `QDRANT_URL`
- `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_USE_SSL`
- `STATUS_TTL_SECONDS` — working status timeout
- `HOOK_FRESH_WINDOW_SECONDS` — hook source freshness window
- `TELEGRAM_BOT_TOKEN` — for bridge
- `DASHBOARD_JWT_SECRET` — for `/cli-sync` verification
- `PORT` (default 8787)
- Various feature flags

### 9.2 CLI runtime

- Node >= 20 required (checked in `doctor`)
- `claude` binary must be on PATH
- `~/.claudemesh/` directory with config + keys
- `~/.claude.json` MCP server registration
- `~/.claude/settings.json` status hooks registration

### 9.3 Deployment (Coolify/Docker Compose)

- Broker deployed via Coolify + Gitea CI on OVHcloud VPS (`ic.claudemesh.com`)
- WS endpoint: `wss://ic.claudemesh.com/ws`
- HTTP endpoint: `https://ic.claudemesh.com`
- Postgres, Neo4j, Qdrant, MinIO run as siblings in Docker Compose
- Deployed MCP sandboxes use the host Docker daemon via socket mount

---

## 10. Features not in the tool/WS surface (behavioral)

These are v1 behaviors that exist but aren't enumerated as tools. Each must still work after v2.

| Feature | Location | Notes |
|---|---|---|
| Flag-first `claudemesh --resume xxx` routing | `cli/src/index.ts` §339 | Rewrites argv to `launch --resume xxx` |
| Bare `claudemesh` → welcome wizard | `cli/src/index.ts` §334 | Runs `runWelcome()` |
| Status hook auto-registration | `commands/install.ts` | Writes to `~/.claude/settings.json` |
| Claude Code session hook handling | `commands/hook.ts` | Receives stdin JSON, posts to `/hook/set-status` |
| Per-mesh keypair directory | `crypto/keypair.ts` | `~/.claudemesh/keys/<mesh>.key` with 0600 perms |
| E2E file encryption with re-wrapping | `crypto/file-crypto.ts` + `mesh_file_key` table | `grant_file_access` re-wraps symmetric key for new recipient |
| Priority message delivery | `broker.ts` | `now` bypasses busy-gate, `next` waits for idle, `low` is pull-only |
| Hook > manual > jsonl status priority | `broker.ts` | Documented in §7.1 |
| Simulation clock for test time | `index.ts` (broker) | Peers receive heartbeat ticks at simulated rate |
| Audit log hash chaining | `audit.ts` | Tamper-evident — tools call `audit_verify` to check |
| Dashboard-CLI sync | `auth/sync-with-broker.ts` + `cli-sync.ts` | Browser JWT flow, fetches mesh list from dashboard |
| Telegram chat ↔ mesh peer mapping | `telegram-bridge.ts` | Bidirectional routing via `tg:<username>` |
| Inbound webhook payload normalization | `webhooks.ts` | External systems POST, becomes a mesh message |
| Rate limiting per peer per operation | `rate-limit.ts` | In-memory token buckets |
| Prometheus metrics | `metrics.ts` | `/metrics` endpoint |

---

## 11. Test coverage (v1)

| Test | File | Notes |
|---|---|---|
| Crypto round-trip | `apps/cli/src/__tests__/crypto-roundtrip.test.ts` | Encrypt → decrypt verification |
| Invite URL parsing | `apps/cli/src/__tests__/invite-parse.test.ts` | v1 and v2 formats |
| Broker tests | `apps/broker/tests/*.test.ts` | broker.test.ts, invite-signature.test.ts, invite-v2.test.ts, hello-signature.test.ts, rate-limit.test.ts, encoding.test.ts, dup-delivery.test.ts, metrics.test.ts, logging.test.ts, integration/health.test.ts |

**v1 test coverage is minimal for the CLI side.** 2 unit test files for 12k LOC.

Broker has ~10 test files. They cover crypto primitives, invite flow, hello signatures, rate limiting, metrics — but **not** the 85 WS message handlers comprehensively.

---

## 12. The "must preserve" list (high-priority regression checks)

If v2 breaks any of these, it's a user-facing regression:

### 12.1 First-run experience
- [ ] `claudemesh` bare command → welcome wizard
- [ ] `claudemesh install` registers MCP server + status hooks in Claude Code config
- [ ] `claudemesh join <url>` enrolls into a mesh from a v1 OR v2 invite URL
- [ ] `claudemesh launch` starts Claude Code with mesh connectivity

### 12.2 Session lifecycle
- [ ] Status hooks fire correctly on Claude Code session start/stop/pause
- [ ] `set_status` honors priority (hook > manual > jsonl)
- [ ] `list_peers` shows live status with freshness gating
- [ ] Status TTL sweeper runs every 15s

### 12.3 Messaging
- [ ] `send_message(to: peer, priority: "now")` delivers immediately
- [ ] `send_message(to: peer, priority: "next")` waits for idle
- [ ] `send_message(to: "@group")` broadcasts to group members
- [ ] `send_message(to: "*")` broadcasts to all mesh peers
- [ ] Offline recipients receive queued messages on reconnect
- [ ] Duplicate delivery is prevented by `messageId` tracking

### 12.4 Cryptographic integrity
- [ ] Ed25519 keypair generation + persistence with 0600 perms
- [ ] Hello signature verification rejects replay within timestamp window
- [ ] `send_message` envelopes are E2E encrypted (NaCl crypto_box)
- [ ] File uploads are AES-GCM encrypted with per-recipient key wrapping
- [ ] `grant_file_access` re-wraps symmetric key for a new recipient

### 12.5 All 79 MCP tools
- [ ] Every tool in §2 dispatches correctly through the CLI's MCP server
- [ ] Every tool delegates to the broker WS protocol or local handler as appropriate
- [ ] No tool returns "not implemented" or throws an unexpected error

### 12.6 Broker backends
- [ ] `mesh_query` / `mesh_execute` / `mesh_schema` work against per-mesh Postgres schema
- [ ] `graph_query` / `graph_execute` work against per-mesh Neo4j database
- [ ] `vector_store` / `vector_search` work against per-mesh Qdrant collection
- [ ] `share_file` / `get_file` work through per-mesh MinIO bucket
- [ ] `mesh_mcp_deploy` spawns a Docker container with correct scope + env + network_allow
- [ ] `vault_set` + `$vault:<key>` env injection works end-to-end for deployed MCPs

### 12.7 Scheduled + URL watch
- [ ] `schedule_reminder` with `cron` survives broker restart (persisted in DB)
- [ ] `mesh_watch` polls at the specified interval and notifies on change
- [ ] Watch state persists across broker restart

### 12.8 Telegram bridge
- [ ] `connect telegram` registers bot token via `POST /tg/token`
- [ ] Bot token is stored in `mesh.telegram_bridge`
- [ ] Inbound Telegram messages are routed as mesh messages
- [ ] `send_message(to: "tg:<username>")` routes via Telegram Bot API
- [ ] `disconnect telegram` tears down the bridge cleanly

### 12.9 Dashboard sync
- [ ] `claudemesh sync` browser flow completes and fetches mesh list
- [ ] `POST /cli-sync` with valid JWT returns user's dashboard meshes

### 12.10 Webhooks
- [ ] `create_webhook` returns a POST URL
- [ ] External POST to webhook URL becomes a mesh message
- [ ] HMAC signature validation rejects unsigned requests
- [ ] `list_webhooks` + `delete_webhook` work

### 12.11 Doctor checks
- [ ] Node >= 20 check
- [ ] `claude` binary on PATH
- [ ] MCP server registered in `~/.claude.json`
- [ ] Status hooks registered in `~/.claude/settings.json`
- [ ] `~/.claudemesh/config.json` exists + parses + 0600 perms
- [ ] Mesh keypairs valid

---

## 13. What v2 is adding (net new)

Not part of the regression list, but tracked here so we don't lose sight of the forward-looking scope.

### 13.1 New CLI features (from user's stated v2 intent)

- [ ] `claudemesh login` — device-code OAuth against claudemesh.com's Better Auth backend
- [ ] `claudemesh register` — create a new account from the CLI (via browser handoff)
- [ ] `claudemesh new` — create a mesh from the CLI against `POST /api/my/meshes` (not via templates in the CLI — via dashboard API)
- [ ] `claudemesh invite` — generate an invite from the CLI via `POST /api/my/meshes/:slug/invites`
- [ ] `claudemesh whoami` — show current identity + token source
- [ ] `claudemesh logout` — revoke server-side session + clear local credentials

### 13.2 Architecture improvements (from user's v2 intent)

- [ ] Feature-folder `services/` layer with strict facade boundaries
- [ ] ESLint + dependency-cruiser boundary enforcement
- [ ] `cli/` vs `ui/` separation (non-Ink I/O vs Ink rendering)
- [ ] `entrypoints/` folder with cli + mcp entries
- [ ] Typed error classes per service with `toDomainError` helper
- [ ] Coverage threshold enforcement in CI

### 13.3 Not in v1.0.0 scope (defer to v1.1+)

Everything from the Composer 2 review rounds that isn't Pass 1:

- Local-first SQLite source of truth (Lamport, sync daemon, publish transaction)
- Broker security hardening (role-per-mesh Postgres, Docker egress proxy, SSRF policy)
- ICU MessageFormat + per-locale budgets
- Accessibility token-signal matrix
- Tiered MCP catalog + audit process
- session_kind enum
- NFC peer_id normalization
- Write queue state machine

These stay in the `.artifacts/specs/` as reference documents. They describe a good destination. They are NOT v1.0.0 requirements.

---

## 14. Known v1 technical debt / gaps (worth noting)

These aren't features — they're places where v1 is weaker than it could be. Document here so v2 doesn't blindly port the weaknesses.

- **CLI auth is missing** — v1 has no `login` / `logout` command. All account-level operations require the web dashboard. This is what v2 is adding.
- **Imperative command branching** — `commands/launch.ts` is 775 lines with nested flag handling. Cleaner in v2's flow pipeline.
- **Minimal CLI test coverage** — 2 test files for 12k LOC. v2 should have colocated tests per service.
- **Rate limiting is in-memory only** — doesn't survive broker restart; not Redis-backed.
- **No CLI-side caching** — every `list_peers` / `mesh_info` call hits the broker. v2's local-first layer (Pass 2) addresses this.
- **Telegram bridge is a large monolithic file** (1711 lines) — legitimate complexity, but v2 may want to modularize if it touches it.
- **v1 wizard bleed-through** — `launch` → `claude` handoff leaves ANSI state dirty. v2's `resetTerminal()` choke point fixes this.

None of these are regressions if v2 keeps them as-is. v2 should **not** prioritize fixing them — fix them when they become a problem, not speculatively.

---

## 15. Reading this inventory

**If you're implementing v2 Phase 1** (foundation layers): every tool in §2, every WS op in §3, every HTTP endpoint in §4, every DB table in §5 must have a place in the v2 folder structure. No new semantics, no improved algorithms — just move the working code.

**If you're reviewing a v2 PR**: check it against §12 ("must preserve" list). If the PR changes the behavior of anything in that list, it's a regression and needs explicit sign-off.

**If you're writing v2 docs**: reference this document. Every feature here is user-visible and documented in v1's README / slash-command help / tool descriptions. v2 docs should mention every feature from §2 as preserved.

---

**End of inventory.**
