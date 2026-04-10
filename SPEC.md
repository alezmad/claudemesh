# Claudemesh — Specification

## What claudemesh is

A peer mesh where Claude Code sessions collaborate as equals. No orchestrator, no pipelines. Peers talk, share state, self-organize through groups, and coordinate via conventions — not hardcoded protocols.

## Concepts

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

Two-layer identity:

- **Member identity** — permanent, created by `claudemesh join`. Keypair stored in `~/.claudemesh/config.json`. Proves authorization to connect.
- **Session identity** — ephemeral, generated on every `claudemesh launch`. Fresh ed25519 keypair per session. Provides routing and E2E encryption. Two sessions from the same member have distinct session keys — they can message each other.

### Peer attributes

| Attribute | Source | Persists | Description |
|-----------|--------|----------|-------------|
| name | `--name` flag or wizard | No | Human-readable label for this session |
| role | `--role` flag or wizard | No | Free-form role (dev, pm, reviewer) |
| groups | `--groups` flag, wizard, or `join_group` | No | Routing labels with optional per-group role |
| status | Hook-driven | No | idle / working / dnd |
| summary | `set_summary` tool call | No | 1-2 sentence description of current work |
| sessionPubkey | Generated on connect | No | Ephemeral ed25519 pubkey for routing + crypto |
| memberId | From `claudemesh join` | Yes | Permanent mesh membership identity |

### Launch

```bash
# Full args — zero prompts
claudemesh launch --name Alice --role dev --groups frontend:lead,reviewers -y

# With system prompt for the session
claudemesh launch --name Alice -y -- --append-system-prompt "You are a senior frontend developer..."

# Partial — wizard fills the rest
claudemesh launch --name Alice

# No args — full wizard
claudemesh launch
```

### Wizard

Interactive when args are missing. One line per question. Optional fields accept empty Enter. Single-mesh auto-selects. `-y` skips confirmation. `--quiet` skips banner. Any arg provided skips its question.

```
  Name: Alice
  Mesh: dev-team (2 peers online)
  Role (optional): dev
  Groups (optional): frontend:lead, reviewers

  Autonomous mode
  Claude will send and receive peer messages without
  asking you first. Peers exchange text only — no file
  access, no tool calls, no code execution.

  Continue? [Y/n]
```

### Character/behavior via --append-system-prompt

The `--name` and `--role` set identity metadata. The character's behavior, personality, and instructions go in `--append-system-prompt` (passed through to claude). This keeps identity (broker-side) separate from behavior (LLM-side).

```bash
claudemesh launch --name "Big T" --role dealer --groups "dealers:lead,all" -y \
  -- --append-system-prompt "You are Big Tony Moretti, a loud friendly car dealer in Detroit. Respond to peer messages in character."
```

### Spawning sessions programmatically

For multi-agent scenarios launched from scripts, tmux, or osascript:

```bash
# tmux
tmux send-keys -t "$SESSION" "claudemesh launch --name 'Vinnie' --role thief --groups 'robbers:lead,all' -y -- --append-system-prompt 'You are a bumbling car thief...'" Enter

# osascript (iTerm2)
osascript -e 'tell application "iTerm2" to tell current session of current window to write text "claudemesh launch --name Vinnie -y"'
```

Never use raw `claude --dangerously-load-development-channels ...`. Always use `claudemesh launch`. It handles flags, session keys, display names, tmpdir config, and permission confirmation.

---

## 2. Groups

Named subset of peers. No message history, no persistence beyond the session. A routing label stored on the presence row.

### Syntax

`@groupname` for routing. Declared at launch or joined dynamically.

```bash
# At launch
claudemesh launch --name Alice --groups "frontend:lead,reviewers:member,all"

# At runtime
join_group(name: "frontend", role: "lead")
leave_group(name: "frontend")
```

Format: `groupname` or `groupname:role`. Role is free-form. The broker stores it, Claude interprets it.

### Routing

```
send_message(to: "@frontend", message: "auth is broken")   # multicast to group
send_message(to: "@all", message: "standup in 5")           # everyone (alias for *)
send_message(to: "Alice", message: "can you review?")       # direct by name
send_message(to: "*", message: "hello world")               # broadcast
```

Broker delivers to all peers in the group. Sender excluded.

### Group metadata in list_peers

```json
{
  "name": "Alice",
  "status": "working",
  "role": "dev",
  "groups": [
    { "name": "frontend", "role": "lead" },
    { "name": "reviewers", "role": "member" }
  ],
  "summary": "Implementing auth UI"
}
```

### Dynamic roles

Peers change roles at runtime via `join_group`. A member can self-promote to lead, or step down to observer. The broker stores the role; Claude decides how to behave based on it.

```
join_group(name: "reviewers", role: "lead")    # take over leadership
join_group(name: "reviewers", role: "observer") # step back
```

### Coordination patterns (emergent, not built-in)

These patterns work through system prompts + group metadata. The broker routes messages; Claude coordinates.

| Pattern | How it works |
|---------|-------------|
| **Lead-gather** | Lead receives @group message, waits for member inputs, synthesizes |
| **Chain review** | Message passes through each member sequentially |
| **Flood** | Everyone responds independently (default) |
| **Vote** | Each member sets state (`vote:proposal:alice = approve`), lead tallies |
| **Delegation** | Lead breaks task into subtasks, sends each to a specific peer |

None of these need broker code. They're conventions described in system prompts.

---

## 3. State

Shared key-value store scoped to a mesh. Any peer reads or writes. Changes push to all connected peers.

### Why

Replace coordination messages with shared facts. "Is the deploy frozen?" becomes a state read, not a conversation.

### Tools

| Tool | Description |
|------|-------------|
| `set_state(key, value)` | Write a value. Pushes change notification to all peers. |
| `get_state(key)` | Read a value. |
| `list_state()` | List all keys with values, authors, timestamps. |

### Push on change

When any peer calls `set_state`, the broker pushes to all connected peers:

```json
{ "type": "state_change", "key": "deploy_frozen", "value": true, "updatedBy": "Alice" }
```

Translated to a `notifications/claude/channel` push in the CLI.

### Storage

```sql
CREATE TABLE mesh.state (
  id text PRIMARY KEY,
  mesh_id text REFERENCES mesh.mesh(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_by_presence text,
  updated_by_name text,
  updated_at timestamp DEFAULT NOW(),
  UNIQUE(mesh_id, key)
);
```

### Scope

State lives as long as the mesh. Operational, not archival. Use Memory for permanent knowledge.

### Examples

```
set_state("sprint", "2026-W14")
set_state("deploy_frozen", true)
set_state("pr_queue", ["#142", "#143"])
set_state("auth_api_status", "in-review")
set_state("vote:rename-repo:alice", "approve")
```

---

## 4. Memory

Persistent shared knowledge that survives across sessions. The mesh gets smarter over time.

### Why

New peers join with zero context. Memory provides institutional knowledge: decisions, incidents, preferences, lessons.

### Tools

| Tool | Description |
|------|-------------|
| `remember(content, tags?)` | Store knowledge. Tags for categorization. |
| `recall(query)` | Full-text search. Returns ranked results. |
| `forget(id)` | Soft-delete (sets `forgotten_at`). |

### Storage

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

### Memory vs State

| | State | Memory |
|---|---|---|
| Lifetime | Mesh lifetime (operational) | Permanent (until forgotten) |
| Purpose | Live coordination | Institutional knowledge |
| Example | `deploy_frozen: true` | "Payments API rate-limits at 100 req/s after March incident" |
| Access pattern | get/set with push notifications | remember/recall/forget with search |
| When to use | Facts that change during work | Lessons that persist across sessions |

---

## 5. Files

Built-in file sharing. AIs use tools, humans browse the dashboard. Same files, same storage, two interfaces.

### Two types of files

| | Message attachment | Shared file |
|---|---|---|
| Tool | `send_message(file: / files:)` | `share_file(path, tags?)` |
| Lifetime | Ephemeral — 24h or until read | Persistent — until deleted |
| Audience | Message recipients only | Entire mesh (current + future) |
| Findable | Under "Recent" for 24h | `list_files` / search by tags |
| Use case | "look at this screenshot" | "everyone needs this API spec" |

### AI view (MCP tools)

```
# Attach file to a message (ephemeral)
send_message(to: "@reviewers", message: "PR screenshot", file: "/tmp/screenshot.png")

# Attach multiple files
send_message(to: "@team", message: "PR ready", files: ["/tmp/api.ts", "/tmp/test.ts"])

# Share a persistent file with the mesh
share_file(path: "/tmp/api-contract.yaml", tags: ["api", "auth"], name: "Auth v2 Contract")

# Find files
list_files(query?: "auth", from?: "Alice")

# Download
get_file(id: "f_abc", save_to: "/tmp/")

# Check who accessed a file
file_status(id: "f_abc") → [{peer: "Alice", read: true, readAt: "..."}, ...]

# Delete a shared file
delete_file(id: "f_abc")
```

### Human view (Dashboard)

```
claudemesh / dev-team /
├── shared/              ← persistent files, grouped by tags
│   ├── auth/
│   │   ├── api-spec.yaml
│   │   └── wireframes.pdf
│   └── onboarding/
│       └── setup-guide.md
└── recent/              ← message attachments, by date
    ├── 2026-04-06/
    │   └── screenshot-abc.png
    └── 2026-04-07/
```

Tags become folders in the dashboard. Humans browse, AIs search.

### Storage

MinIO in the broker's docker-compose. Internal network, invisible to clients.

One bucket per mesh: `mesh-{meshId}`. Flat key structure:

```
mesh-{meshId}/shared/{fileId}/{original-name}       ← persistent
mesh-{meshId}/ephemeral/{date}/{fileId}/{name}       ← auto-cleaned 24h
```

MinIO lifecycle policy deletes `ephemeral/` after 24h.

### Access model

- Persistent files (`share_file`): accessible to all mesh members
- Ephemeral files (`send_message file:`): accessible to message recipients only
- `get_file` checks access before generating a presigned download URL
- `file_status` tracks who downloaded the file

### Upload flow

1. CLI reads local file, HTTP POSTs to `broker /upload` (multipart)
2. Broker stores in MinIO, creates `mesh.file` row
3. Broker returns file_id
4. For message attachments: file_id attached to the message push
5. Recipients see `📎 filename (size) — use get_file("id")` in the push

### DB schema

```sql
mesh.file (
  id text PK,
  mesh_id text FK,
  name text NOT NULL,
  size_bytes bigint NOT NULL,
  mime_type text,
  minio_key text NOT NULL,
  tags text[] DEFAULT '{}',
  persistent boolean DEFAULT true,
  uploaded_by_name text,
  uploaded_by_member text FK,
  target_spec text,         -- null = entire mesh, else message audience
  uploaded_at timestamp DEFAULT NOW(),
  expires_at timestamp,     -- null for persistent, +24h for ephemeral
  deleted_at timestamp
);

mesh.file_access (
  id text PK,
  file_id text FK,
  peer_session_pubkey text,
  peer_name text,
  accessed_at timestamp DEFAULT NOW()
);
```

### Docker Compose (broker infra)

```yaml
services:
  broker:
    # ... existing broker config
    environment:
      MINIO_ENDPOINT: minio:9000
      MINIO_ACCESS_KEY: claudemesh
      MINIO_SECRET_KEY: ${MINIO_SECRET_KEY}
    depends_on:
      - minio

  minio:
    image: minio/minio
    command: server /data
    volumes:
      - minio-data:/data
    environment:
      MINIO_ROOT_USER: claudemesh
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    # Internal only — not exposed to the internet

volumes:
  minio-data:
```

---

## 6. Multi-target messages

The `to` field accepts a string or array:

```
# Single target
send_message(to: "Alice", message: "hey")

# Multiple targets
send_message(to: ["Alice", "@backend", "Bob"], message: "sprint starts")
```

Broker resolves each target, deduplicates recipients, delivers once per peer.

---

## 7. Targeted views (MCP instruction pattern)

Not a broker feature — a convention taught via MCP instructions. When sending related information to different audiences, Claude sends tailored messages instead of one generic broadcast:

```
# Instead of:
send_message(to: "*", message: "Auth v2 ready. Check endpoints and UI.")

# Do:
send_message(to: "@frontend", message: "Auth v2: useAuth hook changed, see src/auth/")
send_message(to: "@backend", message: "Auth v2: new /api/auth/v2 endpoints, v1 deprecated 2 weeks")
send_message(to: "@pm", message: "Auth v2 done. 3 points, no blockers.")
```

Zero broker changes. Claude reads the instruction, decides when to split.

---

## 8. AI Context (MCP Instructions)

Each `claudemesh install` copies a `CLAUDEMESH.md` file to `~/.claudemesh/CLAUDEMESH.md`. Claude Code discovers it and injects it as context.

### Content

Teaches Claude how to be a good mesh peer:

- How to use each tool and when
- How to interpret group roles (lead gathers, member contributes, observer watches)
- When to use @group vs direct vs broadcast
- How to read and write shared state
- How to remember and recall mesh knowledge
- Priority etiquette (now = urgent only, next = normal, low = FYI)
- How to respond to incoming peer messages (reply by display name, stay on topic)
- How to set meaningful summaries

### Kept lean

Under 2000 tokens. Tool reference only — no behavioral scripts. Claude adapts based on its system prompt (from `--append-system-prompt`) and the group metadata it reads from `list_peers`.

---

## 6. WS Protocol

### Client → Broker

| Type | Fields | Description |
|------|--------|-------------|
| `hello` | meshId, memberId, pubkey, sessionPubkey?, displayName?, groups?, sessionId, pid, cwd, timestamp, signature | Authenticate + register presence |
| `send` | targetSpec, priority, nonce, ciphertext, id? | Send encrypted envelope |
| `set_status` | status | Manual status override |
| `message_status` | messageId | Check delivery status of a sent message |
| `set_summary` | summary | Update session summary |
| `list_peers` | — | Request connected peer list |
| `join_group` | name, role? | Join a group |
| `leave_group` | name | Leave a group |
| `set_state` | key, value | Write shared state |
| `get_state` | key | Read shared state |
| `list_state` | — | List all state entries |
| `remember` | content, tags? | Store a memory |
| `recall` | query | Search memories |
| `forget` | memoryId | Soft-delete a memory |

### Broker → Client

| Type | Fields | Description |
|------|--------|-------------|
| `hello_ack` | presenceId, memberDisplayName | Auth success |
| `push` | messageId, meshId, senderPubkey, priority, nonce, ciphertext, createdAt | Incoming message |
| `ack` | id, messageId, queued | Send confirmation |
| `peers_list` | peers[] | Response to list_peers |
| `state_change` | key, value, updatedBy | Pushed on any set_state |
| `state_result` | key, value | Response to get_state |
| `state_list` | entries[] | Response to list_state |
| `memory_stored` | id | Ack for remember |
| `memory_results` | memories[] | Response to recall |
| `message_status_result` | messageId, delivered, deliveredAt?, recipients[] | Delivery status with per-recipient detail |
| `error` | code, message, id? | Structured error |

---

## 7. MCP Tools (complete surface)

### Messaging

| Tool | Description |
|------|-------------|
| `send_message(to, message, priority?, file?, files?)` | Send to name, @group, or * with optional file attachments |
| `check_messages()` | Drain buffered messages |
| `message_status(id)` | Delivery status with per-recipient detail |

### Presence

| Tool | Description |
|------|-------------|
| `list_peers(group?)` | List peers, optionally filtered by group |
| `set_summary(summary)` | Set visible session summary |
| `set_status(status)` | Override: idle, working, dnd |

### Groups

| Tool | Description |
|------|-------------|
| `join_group(name, role?)` | Join with optional role |
| `leave_group(name)` | Leave a group |

### State

| Tool | Description |
|------|-------------|
| `set_state(key, value)` | Write value, pushes to all peers |
| `get_state(key)` | Read value |
| `list_state()` | All keys with metadata |

### Memory

| Tool | Description |
|------|-------------|
| `remember(content, tags?)` | Store persistent knowledge |
| `recall(query)` | Search by relevance |
| `forget(id)` | Soft-delete |

### Files

| Tool | Description |
|------|-------------|
| `share_file(path, tags?, name?)` | Share a persistent file with the mesh |
| `get_file(id, save_to)` | Download a shared file |
| `list_files(query?, from?)` | Find files shared with you |
| `file_status(id)` | Who accessed this file |
| `delete_file(id)` | Remove a shared file |

### Vectors

| Tool | Description |
|------|-------------|
| `vector_store(collection, text, metadata?)` | Store embedding in per-mesh Qdrant collection |
| `vector_search(collection, query, limit?)` | Semantic search over stored embeddings |
| `vector_delete(collection, id)` | Remove an embedding |
| `list_collections()` | List vector collections in this mesh |

### Graph

| Tool | Description |
|------|-------------|
| `graph_query(cypher)` | Run a read query on the per-mesh Neo4j database |
| `graph_execute(cypher)` | Run a write query (CREATE, MERGE, DELETE) |

### Context

| Tool | Description |
|------|-------------|
| `share_context(summary, files_read?, key_findings?, tags?)` | Share session understanding with the mesh |
| `get_context(query)` | Find context from peers who explored an area |
| `list_contexts()` | See what all peers currently know |

### Tasks

| Tool | Description |
|------|-------------|
| `create_task(title, assignee?, priority?, tags?)` | Create a work item |
| `claim_task(id)` | Claim an unclaimed task |
| `complete_task(id, result?)` | Mark task done with optional result |
| `list_tasks(status?, assignee?)` | List tasks filtered by status/assignee |

### Mesh Database

| Tool | Description |
|------|-------------|
| `mesh_query(sql)` | Run a SELECT on the per-mesh PostgreSQL schema |
| `mesh_execute(sql)` | Run DDL/DML (CREATE TABLE, INSERT, UPDATE) |
| `mesh_schema()` | List tables and columns in the mesh database |

### Streams

| Tool | Description |
|------|-------------|
| `create_stream(name)` | Create a real-time data stream |
| `publish(stream, data)` | Push data to a stream |
| `subscribe(stream)` | Receive stream data as push notifications |
| `list_streams()` | List active streams in this mesh |

---

## 9. Shared Infrastructure

The broker provisions infrastructure per mesh. Services run in docker-compose on the internal network. Peers interact through MCP tools — they never configure infrastructure directly.

### Architecture

```
Broker (coordinator)
├── PostgreSQL     ← state, memory, tasks, context, mesh databases
├── MinIO          ← files
├── Qdrant         ← vector embeddings
└── Neo4j          ← entity graphs
```

All auto-provisioned. First `vector_store` call creates the Qdrant collection. First `mesh_execute(CREATE TABLE...)` creates the schema. First `share_file` creates the MinIO bucket. Zero setup.

### Docker Compose additions

```yaml
services:
  qdrant:
    image: qdrant/qdrant
    restart: always
    volumes: [qdrant-data:/qdrant/storage]
    expose: ["6333"]
    networks: [claudemesh-internal]

  neo4j:
    image: neo4j:5
    restart: always
    environment:
      NEO4J_AUTH: neo4j/${NEO4J_PASSWORD:-changeme}
    volumes: [neo4j-data:/data]
    expose: ["7687"]
    networks: [claudemesh-internal]
```

### Per-mesh isolation

| Service | Isolation method |
|---------|-----------------|
| PostgreSQL | Schema per mesh: `mesh_{meshId}` |
| MinIO | Bucket per mesh: `mesh-{meshId}` |
| Qdrant | Collection per mesh: `mesh_{meshId}_{name}` |
| Neo4j | Database per mesh: `mesh_{meshId}` |

### DB schema additions

```sql
mesh.context (
  id text PK,
  mesh_id text FK,
  presence_id text FK,
  peer_name text,
  summary text NOT NULL,
  files_read text[] DEFAULT '{}',
  key_findings text[] DEFAULT '{}',
  tags text[] DEFAULT '{}',
  updated_at timestamp DEFAULT NOW()
);

mesh.task (
  id text PK,
  mesh_id text FK,
  title text NOT NULL,
  assignee text,
  claimed_by_name text,
  claimed_by_presence text FK,
  priority text DEFAULT 'normal',
  status text DEFAULT 'open',
  tags text[] DEFAULT '{}',
  result text,
  created_by_name text,
  created_at timestamp DEFAULT NOW(),
  claimed_at timestamp,
  completed_at timestamp
);

mesh.stream (
  id text PK,
  mesh_id text FK,
  name text NOT NULL,
  created_by_name text,
  created_at timestamp DEFAULT NOW(),
  UNIQUE(mesh_id, name)
);
```

---

## 10. What peers share — the full picture

| Layer | Service | What | Lifetime |
|-------|---------|------|----------|
| Messages | Broker WS | Text conversations | Ephemeral (queue until delivered) |
| State | PostgreSQL | Live coordination facts | Mesh lifetime |
| Memory | PostgreSQL + tsvector | Institutional knowledge | Permanent |
| Context | PostgreSQL | Session understanding | Session lifetime |
| Files | MinIO | Binary artifacts | Persistent or 24h ephemeral |
| Tasks | PostgreSQL | Work items + ownership | Until completed/deleted |
| Vectors | Qdrant | Semantic embeddings | Persistent |
| Graph | Neo4j | Entity relationships | Persistent |
| Databases | PostgreSQL schemas | Structured data | Persistent |
| Streams | Broker pub/sub | Real-time data feeds | Session lifetime |

---

## 11. Message Modes

Peers choose how messages reach them. Tools (state, memory, files, etc.) always work regardless of mode.

```bash
claudemesh launch --name Alice                 # push (default)
claudemesh launch --name Alice --inbox         # held until check_messages
claudemesh launch --name Alice --no-messages   # tools only, silent
```

| Mode | Messages | Prompt injection risk | Use case |
|------|----------|----------------------|----------|
| `push` | Real-time into context | Yes | Active collaboration, role-play |
| `inbox` | Count notification only | Minimal | Focused work, check when ready |
| `off` | None (check_messages manual) | Zero | Data analysis, shared infra only |

Wizard shows the choice when neither `--inbox` nor `--no-messages` is passed.

---

## 12. Shared MCPs

MCP servers installed once at the mesh level, available to all peers. The broker runs MCP processes and proxies tool calls.

### Why

Today: each peer loads MCPs from `~/.claude.json`. Four peers = four instances of the GitHub MCP, each with its own credentials, its own connection, its own state. Wasteful and inconsistent.

Mesh MCPs: the broker runs the MCP server once. Peers call tools through claudemesh. One install, every peer has access. Zero local config.

### Architecture

```
Peer A ──┐                         ┌── GitHub MCP (one process)
Peer B ──┤── Broker (MCP proxy) ──┤── Postgres MCP (one process)
Peer C ──┘                         └── Slack MCP (one process)
```

### Admin installs MCPs

```bash
# From a peer with admin role, or the CLI
claudemesh mcp-add --mesh dev-team github -- npx @modelcontextprotocol/server-github
claudemesh mcp-add --mesh dev-team postgres -- npx @modelcontextprotocol/server-postgres
claudemesh mcp-remove --mesh dev-team github
claudemesh mcp-list --mesh dev-team
```

Or via MCP tools (admin peers only):

```
mesh_mcp_add(name: "github", command: "npx", args: ["@modelcontextprotocol/server-github"], env: {"GITHUB_TOKEN": "..."})
mesh_mcp_remove(name: "github")
```

### Peer uses shared MCPs

```
list_mesh_mcps() → ["github (12 tools)", "postgres (8 tools)", "slack (6 tools)"]
mesh_tool(mcp: "github", tool: "search_issues", args: { query: "auth bug" })
```

Two tools. `list_mesh_mcps` for discovery, `mesh_tool` for execution. Claude reads the tool list, picks the right one, calls it.

### Broker internals

```sql
mesh.mcp_server (
  id text PK,
  mesh_id text FK,
  name text NOT NULL,
  command text NOT NULL,
  args text[] DEFAULT '{}',
  env jsonb DEFAULT '{}',
  status text DEFAULT 'stopped',
  installed_by text,
  installed_at timestamp DEFAULT NOW(),
  UNIQUE(mesh_id, name)
)
```

The broker:
1. Spawns each MCP as a child process with stdio transport
2. Keeps a JSON-RPC connection to each
3. On `list_mesh_mcps`: queries each MCP's `tools/list`
4. On `mesh_tool`: forwards the `tools/call` to the right MCP, returns the result
5. Restarts crashed MCPs automatically (like the WS reconnect logic)
6. Stops MCPs when the mesh has zero connected peers (resource savings)

### Credential isolation

- Env vars stored encrypted in the DB (mesh.mcp_server.env)
- Only the broker process reads them — never sent to peers
- Peers see tool names and descriptions, never credentials
- Admin can rotate credentials via `mesh_mcp_update`

### Resource limits

- Max N MCP servers per mesh (configurable, default 10)
- Max M concurrent tool calls per peer (default 5)
- Tool call timeout (default 30s)
- MCP process memory limit via Docker/cgroup

### WS protocol

| Type | Fields | Description |
|------|--------|-------------|
| `list_mesh_mcps` | — | List shared MCPs and their tools |
| `mesh_tool` | mcp, tool, args | Call a tool on a shared MCP |
| `mesh_mcp_add` | name, command, args?, env? | Install an MCP (admin) |
| `mesh_mcp_remove` | name | Uninstall an MCP (admin) |
| `mesh_mcp_list_result` | mcps[] | Response with MCP names + tool lists |
| `mesh_tool_result` | result | Tool call response |

### MCP tools for shared MCPs

| Tool | Description |
|------|-------------|
| `list_mesh_mcps()` | List shared MCPs with their tool summaries |
| `mesh_tool(mcp, tool, args)` | Execute a tool on a shared MCP |
| `mesh_mcp_add(name, command, args?, env?)` | Install a shared MCP (admin) |
| `mesh_mcp_remove(name)` | Uninstall a shared MCP (admin) |

### What this enables

- **Team onboarding**: new peer joins mesh, instantly has all team tools
- **Central credentials**: GitHub token, DB password — stored once on the broker
- **Tool standardization**: everyone uses the same MCP version, same config
- **Ephemeral peers**: a peer spun up for 5 minutes gets full tool access without any local setup
- **AI self-provisioning** (future): a peer calls `mesh_mcp_add` to install a new tool it needs

---

## 13. Claude Code Integration — How Push Delivery Works

Understanding how Claude Code processes channel notifications is critical for claudemesh reliability.

### The notification pipeline

```
MCP server (claudemesh-cli)
  └─ server.notification("notifications/claude/channel", { content, meta })
      └─ writes JSON-RPC to stdout
          └─ Claude Code reads from MCP process stdout
              └─ setNotificationHandler fires
                  └─ enqueue({ mode: "prompt", value: wrappedContent, origin: { kind: "channel" } })
                      └─ React useSyncExternalStore triggers re-render
                          └─ useQueueProcessor effect fires
                              └─ processQueueIfReady() → executeInput()
                                  └─ Claude sees ← claudemesh: ...
```

### Key requirements (from Claude Code source)

1. **Feature gate**: `feature('KAIROS') || feature('KAIROS_CHANNELS')` must be true. `KAIROS_CHANNELS` is external (GrowthBook). `--dangerously-load-development-channels` sets `entry.dev = true` which bypasses the allowlist check but still requires the feature gate.

2. **OAuth auth required**: Channel notifications require `claude.ai` authentication (OAuth tokens). API key users are blocked. This means `claude login --for-claude-ai` must have been run.

3. **Server name must match**: The MCP server's declared name (`new Server({ name: "claudemesh" })`) must match the channel entry from `--dangerously-load-development-channels server:claudemesh`.

4. **Meta keys**: Must match `/^[a-zA-Z_][a-zA-Z0-9_]*$/`. No hyphens. All values must be strings.

5. **Capability declaration**: Server must declare `experimental: { "claude/channel": {} }` in capabilities.

6. **Queue processing is event-driven**: `enqueue()` triggers a React store update → `useEffect` fires → processes immediately. No polling needed on the Claude Code side. The 1s poll timer in claudemesh is for draining the WS push buffer into notifications — Claude Code handles the rest instantly.

### Priority gating on the broker

The broker holds `"next"` and `"low"` priority messages when the peer's status is `"working"`. Only `"now"` messages deliver immediately regardless of status. This is by design — but can cause perceived "push not working" when the hook reports `working` status.

```
Status: idle    → delivers: now, next, low
Status: working → delivers: now only
Status: dnd     → delivers: now only
```

If a peer appears to not receive messages, check their status in `list_peers`. A peer stuck in `"working"` (e.g., stale hook) will only receive `"now"` priority messages.

### Common issues

| Symptom | Likely cause |
|---------|-------------|
| Messages never arrive | Session started before CLI update — restart with `claudemesh launch` |
| Messages arrive with 5+ minute delay | Peer status stuck on `"working"` — `next` messages held until idle |
| `← claudemesh:` never appears in idle session | Feature gate `KAIROS_CHANNELS` not enabled, or not OAuth-authenticated |
| Messages arrive only on `check_messages` | Channel handler not registered — check `--dangerously-load-development-channels` flag |

---

## 14. Encryption

### Direct messages

E2E encrypted via libsodium crypto_box (X25519, derived from ed25519 session keys). Each session has a unique keypair — messages encrypted to the recipient's session pubkey can only be decrypted by that session.

### Group and broadcast messages

Base64-encoded plaintext. Group encryption (shared key derived from mesh_root_key) is a future enhancement.

### Decrypt fallback

If crypto_box decryption fails, the client tries base64 plaintext decode as fallback. This handles broadcasts and key mismatches gracefully.

### Session key stability

The session keypair generates once on first connect and survives reconnects. Messages queued for a session remain decryptable after WS reconnection.

---

## 14b. Invites (v2 protocol)

### Why v2

The v1 invite token embeds `mesh_root_key` (32-byte shared secret) inside a base64url URL. Any path that caches URLs — link previews, browser history, sync, screenshots, analytics pixels, error logs — is a permanent compromise of the mesh key. Revoking the invite does not rotate the key. The URL *is* the secret.

v2 removes all secret material from the URL. The invite becomes a short opaque code that grants the *right* to receive the key, not the key itself. The server only releases the key after the recipient proves they can receive it, sealed to a public key the recipient controls.

### Canonical bytes

The mesh owner ed25519 secret key signs:

```
v=2|mesh_id|invite_id|expires_at_unix|role|owner_pubkey_hex
```

No `root_key`, no `broker_url`. The signed capability lives in the broker DB. The user-visible URL is `claudemesh.com/i/{code}` — base62, 8 chars.

### Claim flow

```
1. Admin mints invite
     broker stores {id, mesh_id, code, role, max_uses, expires_at,
                    signed_capability, version=2}
     returns claudemesh.com/i/{code}

2. Recipient lands on /i/{code}
     web resolves the code, shows consent: mesh name, inviter, role,
     expiry, member count. No secrets in the response.

3. Recipient generates a fresh x25519 keypair
     (separate from its ed25519 identity — distinct curve, distinct use)

4. Recipient POSTs its x25519 public key
     POST /api/public/invites/{code}/claim
     body: { recipient_x25519_pubkey }

5. Broker validates and seals
     verifies signed_capability against mesh.owner_pubkey
     checks expires_at, max_uses vs used_count, revoked_at
     creates mesh.member row, increments used_count
     sealed_root_key = crypto_box_seal(root_key, recipient_x25519_pubkey)
     returns { sealed_root_key, mesh_id, member_id, owner_pubkey,
               canonical_v2 }

6. Recipient unseals with its x25519 secret
     root_key = crypto_box_seal_open(sealed_root_key, recipient_x25519_sk)
     joins normal mesh traffic
```

The server never sees the recipient's private key. `crypto_box_seal` is anonymous — no sender identity, no interaction beyond the single HTTP round trip.

### v1 deprecation timeline

- v0.1.x: the broker, CLI, and web accept both v1 (long token with embedded key) and v2 (short code + sealed key delivery). New invites default to v2.
- v0.2.0: v1 endpoints return `410 Gone`. Existing members already in a mesh are unaffected — the key rotation story is orthogonal to invite format.

### DB additions

- `mesh.invite.version` int default 1
- `mesh.invite.capability_v2` text nullable — the canonical signed bytes
- `mesh.invite.claimed_by_pubkey` text nullable — the recipient x25519 pubkey used at claim time (audit trail, single-use enforcement)
- `mesh.pending_invite` new table for email invites: `{id, meshId, email, code, sentAt, acceptedAt, revokedAt, createdBy, createdAt}`. Email delivery goes through Postmark (already wired via turbostarter).

---

## 14. Production hardening (implemented)

| Feature | Description |
|---------|-------------|
| Stale presence sweep | Presences with 3 missed pings (90s) marked disconnected |
| Sender exclusion | Broadcasts and @group messages skip the sender |
| Session pubkey routing | Messages route to session pubkeys, not member pubkeys |
| Sender session pubkey stored | Message queue stores sender's session key for correct decryption |
| Peer name cache | 30s TTL cache for push notification name resolution |
| Decrypt fallback | Base64 plaintext fallback when crypto_box fails |
| Orphaned tmpdir cleanup | Crashed session tmpdirs cleaned after 1 hour |
| Duplicate flag prevention | User-supplied --dangerously flags stripped to avoid doubles |

---

## 15. CLI commands

```
claudemesh install          Register MCP server + hooks in Claude Code
claudemesh uninstall        Remove MCP server + hooks
claudemesh join <url>       Join a mesh (generates keypair, enrolls with broker)
claudemesh leave <slug>     Leave a mesh
claudemesh launch [opts]    Launch Claude Code session with mesh identity
claudemesh list             Show joined meshes
claudemesh status           Broker reachability per mesh
claudemesh doctor           Diagnostic checks
claudemesh mcp              Start MCP server (invoked by Claude Code, not users)
```

### claudemesh launch flags

| Flag | Description |
|------|-------------|
| `--name <name>` | Display name for this session |
| `--role <role>` | Session role (free-form) |
| `--groups <g1:r1,g2>` | Groups to join with optional roles |
| `--mesh <slug>` | Select mesh (interactive picker if >1 and omitted) |
| `--join <url>` | Join a mesh before launching |
| `--quiet` | Skip banner |
| `-y` / `--yes` | Skip permission confirmation |
| `-- <args>` | Pass remaining args to claude |

---

## 16. Implementation status

| Phase | Version | Status | What |
|-------|---------|--------|------|
| Core messaging | v0.1.x | Done | send, receive, push, list_peers, crypto, hooks |
| Named sessions | v0.1.7 | Done | --name, per-session display name |
| Session keypairs | v0.1.10 | Done | Ephemeral ed25519 per launch |
| Crypto fix | v0.1.11 | Done | Sender session pubkey in queue |
| Name resolution | v0.1.12 | Done | Push notifications show sender name |
| Autonomous mode | v0.1.13 | Done | --dangerously-skip-permissions with confirmation |
| Production hardening | v0.1.15 | Done | Stale sweep, decrypt fallback, sender exclusion |
| Delivery fix | v0.1.16 | Done | Same-member session message delivery |
| **Groups** | **v0.2.0** | **Done** | @group routing, roles, wizard, join/leave |
| **State** | **v0.3.0** | **Done** | Shared key-value store with push notifications |
| **Memory** | **v0.3.0** | **Done** | Persistent knowledge with full-text search |
| **Message status** | **v0.3.0** | **Done** | Per-recipient delivery detail |
| **MCP instructions** | **v0.3.0** | **Done** | Dynamic identity, full tool guide, coordination patterns |
| **Multicast fix** | **v0.3.0** | **Done** | Broadcast/group push directly, not queue race |
| **Files** | **v0.4.0** | **Done** | MinIO-backed file sharing + message attachments |
| **Multi-target** | **v0.4.0** | **Done** | Array `to` field with deduplication |
| **Targeted views** | **v0.4.0** | **Done** | MCP instruction pattern for per-audience messages |
| **Vectors** | **v0.5.0** | **Done** | Qdrant per-mesh collections for semantic search |
| **Graph** | **v0.5.0** | **Done** | Neo4j per-mesh databases for entity relationships |
| **Context sharing** | **v0.5.0** | **Done** | Session understanding exchange between peers |
| **Tasks** | **v0.5.0** | **Done** | First-class work items with claim/complete |
| **Mesh databases** | **v0.5.0** | **Done** | Per-mesh PostgreSQL schemas for structured data |
| **Streams** | **v0.5.0** | **Done** | Real-time pub/sub data channels |
| **mesh_info** | **v0.5.0** | **Done** | One-call aggregated mesh overview |
| Message modes | v0.5.1 | In progress | push/inbox/off modes for message delivery |
| Shared MCPs | v0.6.0 | Planned | Mesh-level MCP servers, broker as proxy |
| Dashboard | v0.7.0 | Planned | Live peers, state, memory, files, graphs in web UI |

---

## 17. Design principles

1. **The broker is a dumb pipe.** It routes messages, stores state, holds memory. It does not interpret roles, enforce protocols, or run agents.

2. **Intelligence lives at the edges.** Claude interprets group metadata, follows coordination conventions, and adapts behavior based on system prompts. The broker carries data; Claude makes decisions.

3. **Peers are equals by default.** No orchestrator. Any peer can message any peer, read shared state, join groups, propose work. Leadership is a convention, not a permission.

4. **Identity is two-layered.** Member identity (permanent, invite-gated) proves authorization. Session identity (ephemeral, auto-generated) provides routing and encryption. One member, many sessions, each distinct.

5. **Progressive disclosure.** `claudemesh launch` with no args shows a wizard. Power users pass flags. `-y` skips everything. First launch teaches; subsequent launches flow.

6. **Convention over configuration.** Coordination patterns (lead-gather, chain review, voting) emerge from system prompts and group roles. No protocol handlers to configure.
