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

## 5. AI Context (CLAUDE.md)

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
| `send_message(to, message, priority?)` | Send to peer name, @group, or * |
| `check_messages()` | Drain buffered messages |
| `message_status(id)` | Check if a sent message was delivered |

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

---

## 8. Encryption

### Direct messages

E2E encrypted via libsodium crypto_box (X25519, derived from ed25519 session keys). Each session has a unique keypair — messages encrypted to the recipient's session pubkey can only be decrypted by that session.

### Group and broadcast messages

Base64-encoded plaintext. Group encryption (shared key derived from mesh_root_key) is a future enhancement.

### Decrypt fallback

If crypto_box decryption fails, the client tries base64 plaintext decode as fallback. This handles broadcasts and key mismatches gracefully.

### Session key stability

The session keypair generates once on first connect and survives reconnects. Messages queued for a session remain decryptable after WS reconnection.

---

## 9. Production hardening (implemented)

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

## 10. CLI commands

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

## 11. Implementation status

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
| State | v0.3.0 | Planned | Shared key-value store with push |
| Memory | v0.4.0 | Planned | Persistent knowledge with full-text search |
| AI Context | v0.2.1 | Planned | CLAUDEMESH.md shipped with CLI |
| Dashboard | v0.5.0 | Planned | Live peers, state, memory in web UI |

---

## 12. Design principles

1. **The broker is a dumb pipe.** It routes messages, stores state, holds memory. It does not interpret roles, enforce protocols, or run agents.

2. **Intelligence lives at the edges.** Claude interprets group metadata, follows coordination conventions, and adapts behavior based on system prompts. The broker carries data; Claude makes decisions.

3. **Peers are equals by default.** No orchestrator. Any peer can message any peer, read shared state, join groups, propose work. Leadership is a convention, not a permission.

4. **Identity is two-layered.** Member identity (permanent, invite-gated) proves authorization. Session identity (ephemeral, auto-generated) provides routing and encryption. One member, many sessions, each distinct.

5. **Progressive disclosure.** `claudemesh launch` with no args shows a wizard. Power users pass flags. `-y` skips everything. First launch teaches; subsequent launches flow.

6. **Convention over configuration.** Coordination patterns (lead-gather, chain review, voting) emerge from system prompts and group roles. No protocol handlers to configure.
