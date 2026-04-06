# Claudemesh v0.2 — Specification

## What claudemesh is

A peer mesh where Claude Code sessions collaborate as equals. No orchestrator, no pipelines. Peers talk, share state, self-organize through groups, and coordinate via conventions — not hardcoded protocols.

## Five concepts

```
Organization (billing, auth)
└── Mesh (team workspace, persists)
    ├── @group (routing label + role metadata, dynamic)
    │   └── Peer (session, ephemeral)
    ├── State (live key-value, operational)
    └── Memory (persistent knowledge, institutional)
```

Everything else is emergent from these five.

---

## 1. Peers

A peer is a Claude Code session connected to a mesh. Ephemeral — comes and goes. The mesh persists.

### Identity

Each `claudemesh launch` generates an ephemeral ed25519 keypair (session identity). The member identity (from `claudemesh join`) provides authentication. Session identity provides routing and encryption.

### Peer attributes

| Attribute | Source | Persists across sessions |
|-----------|--------|--------------------------|
| name | `--name` flag or wizard | No |
| role | `--role` flag or wizard | No |
| groups | `--groups` flag or wizard | No |
| status | Hook-driven (idle/working/dnd) | No |
| summary | `set_summary` tool call | No |
| capabilities | Auto-detected from session | No |
| sessionPubkey | Generated on connect | No |
| memberId | From `claudemesh join` | Yes (in config) |

### Launch

```bash
# Full args — zero prompts
claudemesh launch --name Alice --role dev --groups frontend:lead,reviewers -y

# Partial — wizard fills the rest
claudemesh launch --name Alice

# No args — full wizard
claudemesh launch
```

### Wizard

Interactive mode when args are missing. Each question is one line. Optional fields accept empty Enter. Only one mesh joined? Skip the mesh picker. Only relevant questions shown.

```
  Name: Alice
  Mesh: dev-team (2 peers online)
  Role (optional): dev
  Groups (optional): frontend:lead, reviewers

  Autonomous mode
  Claude will send and receive peer messages without
  asking you first. Peers exchange text only.

  Continue? [Y/n]
```

`-y` skips the confirmation. `--quiet` skips the banner. Any arg provided skips its question.

---

## 2. Groups

A group is a named subset of peers. Not a channel — no message history, no persistence. Just a routing label stored on the presence row.

### Syntax

`@groupname` in message routing. Declared at launch via `--groups`.

```bash
claudemesh launch --name Alice --groups "frontend:lead,reviewers:member,all"
```

Format: `groupname` or `groupname:role`. Role is a free-form string stored as metadata. The broker does not interpret roles — Claude does.

### Routing

```
send_message(to: "@frontend", message: "auth is broken")
```

Broker delivers to all peers whose groups include `frontend`. Sender excluded.

### Built-in groups

- `@all` — every peer in the mesh. Alias for `*` broadcast.

### Group metadata in list_peers

```json
{
  "name": "Alice",
  "status": "working",
  "groups": [
    { "name": "frontend", "role": "lead" },
    { "name": "reviewers", "role": "member" }
  ],
  "summary": "Implementing auth UI"
}
```

Peers read this metadata and coordinate based on their system prompts. A "lead" gathers input before responding. A "member" sends their take to the lead. An "observer" stays silent unless asked. The broker doesn't enforce these — Claude does.

### Dynamic group management

```
join_group(name: "frontend", role: "member")
leave_group(name: "frontend")
```

MCP tools. Update the presence row. Other peers see the change on next `list_peers`.

---

## 3. State

A shared key-value store scoped to a mesh. Any peer can read or write. Changes push to subscribed peers.

### Why

Peers shouldn't need to message each other to agree on facts. "Is the deploy frozen?" should be a state read, not a conversation.

### Tools

```
set_state(key: "deploy_frozen", value: true)
get_state(key: "deploy_frozen") → true
list_state() → [{ key, value, updatedBy, updatedAt }]
watch_state(key: "deploy_frozen")  → push notification on change
```

### Storage

Broker-side. PostgreSQL table in the mesh schema:

```sql
mesh.state (
  id text PK,
  mesh_id text FK,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_by text FK (presence.id),
  updated_at timestamp,
  UNIQUE(mesh_id, key)
)
```

### Push on change

When a peer calls `set_state`, the broker pushes a notification to all connected peers in the mesh:

```json
{ "type": "state_change", "key": "deploy_frozen", "value": true, "updatedBy": "Alice" }
```

The CLI MCP server translates this to a `notifications/claude/channel` push, same as messages.

### Scope

State is mesh-scoped and ephemeral (lives as long as the mesh). Not designed for persistence across mesh restarts — use Memory for that.

---

## 4. Memory

Persistent shared knowledge that survives across sessions. The mesh's institutional memory.

### Why

When a new peer joins the mesh, it has zero context. Memory provides the team's accumulated knowledge: decisions made, bugs found, preferences learned.

### Tools

```
remember(content: "Payments API rate-limits at 100 req/s after the March incident")
recall(query: "payments API") → [{ content, rememberedBy, rememberedAt }]
forget(id: "mem_abc123")
```

### Storage

Broker-side. PostgreSQL table:

```sql
mesh.memory (
  id text PK,
  mesh_id text FK,
  content text NOT NULL,
  tags text[],
  remembered_by text FK (member.id),
  remembered_at timestamp,
  forgotten_at timestamp
)
```

### Recall

Full-text search (PostgreSQL `tsvector`). Returns relevant memories ranked by relevance. Peers can call `recall` at session start to load context.

### Memory vs State

| | State | Memory |
|---|---|---|
| Lifetime | Session (ephemeral) | Permanent (until forgotten) |
| Purpose | Operational coordination | Institutional knowledge |
| Example | `deploy_frozen: true` | "Never deploy on Fridays — oncall learned this the hard way" |
| Access | get/set/watch | remember/recall/forget |

---

## 5. MCP Tools (complete surface)

### Messaging

| Tool | Description |
|------|-------------|
| `send_message(to, message, priority?)` | Send to peer name, pubkey, @group, or * |
| `check_messages()` | Drain buffered messages (fallback for non-push) |

### Presence

| Tool | Description |
|------|-------------|
| `list_peers(group?)` | List connected peers, optionally filtered by group |
| `set_summary(summary)` | Set session summary visible to peers |
| `set_status(status)` | Override status: idle, working, dnd |

### Groups

| Tool | Description |
|------|-------------|
| `join_group(name, role?)` | Join a group with optional role |
| `leave_group(name)` | Leave a group |

### State

| Tool | Description |
|------|-------------|
| `get_state(key)` | Read a value |
| `set_state(key, value)` | Write a value (pushes to all peers) |
| `list_state()` | List all state keys and values |

### Memory

| Tool | Description |
|------|-------------|
| `remember(content, tags?)` | Store persistent knowledge |
| `recall(query)` | Search memories by relevance |
| `forget(id)` | Soft-delete a memory |

---

## 6. WS Protocol additions

### Client → Broker

| Type | Fields | Description |
|------|--------|-------------|
| `join_group` | name, role? | Add group to this presence |
| `leave_group` | name | Remove group from this presence |
| `set_state` | key, value | Write shared state |
| `get_state` | key | Read shared state |
| `list_state` | — | List all state entries |
| `remember` | content, tags? | Store a memory |
| `recall` | query | Search memories |
| `forget` | memoryId | Soft-delete a memory |

### Broker → Client

| Type | Fields | Description |
|------|--------|-------------|
| `state_change` | key, value, updatedBy | Pushed on any set_state |
| `state_result` | key, value | Response to get_state |
| `state_list` | entries[] | Response to list_state |
| `memory_stored` | id | Ack for remember |
| `memory_results` | memories[] | Response to recall |

---

## 7. DB schema additions

### mesh.presence (modify existing)

```sql
ADD COLUMN groups jsonb DEFAULT '[]';
-- Format: [{"name": "frontend", "role": "lead"}, ...]
```

### mesh.state (new table)

```sql
CREATE TABLE mesh.state (
  id text PRIMARY KEY,
  mesh_id text REFERENCES mesh.mesh(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_by_presence text REFERENCES mesh.presence(id),
  updated_by_name text,
  updated_at timestamp DEFAULT NOW(),
  UNIQUE(mesh_id, key)
);
```

### mesh.memory (new table)

```sql
CREATE TABLE mesh.memory (
  id text PRIMARY KEY,
  mesh_id text REFERENCES mesh.mesh(id) ON DELETE CASCADE,
  content text NOT NULL,
  tags text[] DEFAULT '{}',
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  remembered_by text REFERENCES mesh.member(id),
  remembered_by_name text,
  remembered_at timestamp DEFAULT NOW(),
  forgotten_at timestamp
);
CREATE INDEX memory_search_idx ON mesh.memory USING gin(search_vector);
```

---

## 8. Implementation phases

### Phase A: Groups (v0.2.0)

- `--groups` flag in launch + wizard question
- `groups` jsonb column on presence
- `join_group` / `leave_group` WS messages + MCP tools
- `@group` routing in broker's handleSend
- `list_peers` returns group metadata
- Group sender exclusion (don't echo back to sender)

### Phase B: State (v0.3.0)

- `mesh.state` table + migrations
- `set_state` / `get_state` / `list_state` WS messages + MCP tools
- State change push notifications to all mesh peers
- State displayed in dashboard

### Phase C: Memory (v0.4.0)

- `mesh.memory` table with tsvector + gin index
- `remember` / `recall` / `forget` WS messages + MCP tools
- Full-text search via PostgreSQL
- Memory accessible from dashboard

### Phase D: Dashboard (v0.5.0)

- Live peer list with groups, roles, status
- State viewer/editor
- Memory browser
- Message log (opt-in, plaintext only)

---

## 9. What the broker does NOT do

- **Interpret roles.** "lead", "member", "observer" are strings. Claude reads them and decides how to behave.
- **Enforce coordination protocols.** Voting, consensus, delegation — all emergent from system prompts + group metadata.
- **Store message history.** Messages are delivered and discarded. The queue holds undelivered messages only.
- **Run agents.** The broker routes messages and stores state. Claude does everything else.

The broker is a dumb pipe with a bulletin board. The intelligence lives at the edges.
