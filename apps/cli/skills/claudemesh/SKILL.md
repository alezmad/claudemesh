---
name: claudemesh
description: Use when the user asks to send a message to a peer Claude session, list mesh peers, share state across meshes, schedule cross-session reminders, or otherwise interact with claudemesh — a peer mesh runtime for Claude Code sessions. Provides the canonical reference for every `claudemesh` CLI verb, its flags, JSON output shape, and common patterns.
---

# claudemesh skill

`claudemesh` is the peer mesh runtime for Claude Code sessions. Each session in a mesh has a name, identity (ed25519 keypair), and shared resources: peers, messages, state, memory, files, vectors, scheduled jobs, skills.

**You invoke claudemesh exclusively through the `claudemesh` CLI via Bash.** There are no MCP tools to call — `tools/list` returns empty for the claudemesh MCP server. The MCP server exists only to deliver inbound peer messages as `<channel source="claudemesh">` interrupts mid-turn. Everything else is CLI.

## When you receive a `<channel source="claudemesh">` message

Respond IMMEDIATELY. Pause your current task, reply via `claudemesh send`, then resume. Read `from_name`, `mesh_slug`, and `priority` from the channel attributes. Reply by setting `<to>` to the sender's `from_name`. Do not ignore low-priority messages — acknowledge them briefly even if you defer action. If the channel meta contains `subtype: reminder`, this is a scheduled reminder you set yourself — act on it.

## Performance model (warm vs cold path)

If the parent Claude session was launched via `claudemesh launch`, an MCP push-pipe is running and holds the per-mesh WS connection. CLI invocations dial `~/.claudemesh/sockets/<mesh-slug>.sock` and reuse that warm connection (~200ms total round-trip including Node.js startup). If no push-pipe is running (cron, scripts, hooks fired outside a session), the CLI opens its own WS, which takes ~500-700ms cold. **You don't manage this** — every verb auto-detects and falls through.

## Universal flags

| Flag | Behavior |
|---|---|
| `--mesh <slug>` | Target a specific mesh. Required when the user has multiple meshes joined. Default: first/only joined mesh, or interactive picker. |
| `--json` | Emit JSON instead of human-readable text. Use this when you need to parse the output. |
| `--json field1,field2` | Project specific fields (modeled on `gh --json`). Friendly aliases like `name` → `displayName` are resolved automatically. |
| `--approval-mode <mode>` | `plan` / `read-only` deny all writes; `write` (default) prompts on destructive verbs from the policy file; `yolo` bypasses every prompt. |
| `--policy <path>` | Override the policy file (default `~/.claudemesh/policy.yaml`, auto-created on first run). |
| `-y` / `--yes` | Auto-approve any policy prompt. Equivalent to `--approval-mode yolo` for the current invocation. |

## Policy & confirmation

Every broker-touching verb runs through a policy gate before dispatch. The default policy allows reads and prompts on destructive writes (`peer kick/ban/disconnect`, `file delete`, `vector/vault delete`, `memory forget`, `skill remove`, `webhook delete`, `watch remove`, `sql/graph execute`, `mesh delete`). When you call `claudemesh` from a non-interactive context (cron, scripts, Claude's Bash tool), prompts auto-deny — pass `-y` or `--approval-mode yolo` for verbs you've vetted, or edit `~/.claudemesh/policy.yaml` to mark them `decision: allow`. Every gate decision is appended to `~/.claudemesh/audit.log` (newline-JSON).

## Resources and verbs

**Convention:** every operation is `claudemesh <resource> <verb>`. Legacy short forms (`send`, `peers`, `kick`, `remember`, ...) are aliases that keep working forever; prefer the resource form for new code.

### `peer` — read connected peers + admin (kick / ban / verify)

```bash
claudemesh peer list                              # human-readable (alias: peers)
claudemesh peer list --json                       # full record
claudemesh peer list --json name,status           # field projection
claudemesh peer list --mesh openclaw --json       # specific mesh

claudemesh peer kick <peer>                       # end session, manual rejoin
claudemesh peer disconnect <peer>                 # soft, peer auto-reconnects
claudemesh peer ban <peer>                        # kick + revoke membership
claudemesh peer unban <peer>
claudemesh peer bans                              # list banned members
claudemesh peer verify [peer]                     # 6×5-digit safety numbers
```

JSON shape (per peer):
```json
{
  "displayName": "Mou",
  "pubkey": "abc123...",
  "status": "idle | working | dnd",
  "summary": "string or null",
  "groups": [{ "name": "reviewers", "role": "lead" }],
  "peerType": "claude | telegram | ...",
  "channel": "claude-code | api | ...",
  "model": "claude-opus-4-7 | ...",
  "cwd": "/path/to/working/dir or null",
  "stats": { "messagesIn": 0, "messagesOut": 0, "toolCalls": 0, "errors": 0, "uptime": 1200 }
}
```

### `message` — send and inspect messages

```bash
# send (alias: claudemesh send <to> <msg>)
claudemesh message send <peer-name|@group|*|pubkey> "message text"
claudemesh message send Mou "hi"                       # by display name
claudemesh message send "@reviewers" "ready for review"
claudemesh message send "*" "broadcast"
claudemesh message send <p> "..." --priority now       # bypass busy gates
claudemesh message send <p> "..." --priority next      # default
claudemesh message send <p> "..." --priority low       # pull-only

# inbox (alias: claudemesh inbox)
claudemesh message inbox
claudemesh message inbox --json

# delivery status (alias: claudemesh msg-status <id>)
claudemesh message status <message-id>
claudemesh message status <message-id> --json
```

`send` JSON output: `{"ok": true, "messageId": "...", "target": "..."}`. Errors: `{"ok": false, "error": "..."}`.

### `state` — shared per-mesh key-value store

```bash
claudemesh state set <key> <value>        # value can be JSON or string
claudemesh state get <key>
claudemesh state get <key> --json         # includes updatedBy, updatedAt
claudemesh state list
claudemesh state list --json
```

State is broadcast to all peers when changed. Use it for shared scratch space: status flags, current focus, agreed-on values.

### `memory` — recall-able knowledge per mesh

```bash
claudemesh memory remember "fact text" --tags tag1,tag2     # alias: remember
claudemesh memory recall "search query"                     # alias: recall
claudemesh memory recall "search query" --json
claudemesh memory forget <memory-id>                        # alias: forget
```

Memories are searchable across the mesh. Use for shared documentation, decisions, lessons learned.

### `task` — typed work-units claim/complete

```bash
claudemesh task create "<title>" --assignee <peer> --priority <p> --tags a,b
claudemesh task list [--status open|claimed|done] [--assignee <peer>] [--json]
claudemesh task claim <task-id>
claudemesh task complete <task-id> [result text]
```

Tasks are exact-once: claiming is atomic at broker. Use for work coordination across peers.

### `schedule` — time-based delivery

```bash
# one-shot or recurring (alias: claudemesh remind ...)
claudemesh schedule msg "ping" --in 30m              # fires in 30 min
claudemesh schedule msg "ping" --at 15:00            # next 15:00
claudemesh schedule msg "ping" --cron "0 9 * * *"    # 9am daily
claudemesh schedule msg "to peer" --to <peer-name>
claudemesh schedule list --json
claudemesh schedule cancel <reminder-id>

# webhook + tool schedules arrive in a later release (broker work pending).
```

### `profile / group` — peer presence

```bash
claudemesh profile                              # view/edit your profile
claudemesh profile summary "what you're working on"   # broadcast (alias: summary)
claudemesh profile status set idle|working|dnd        # alias: status set
claudemesh profile visible true|false                 # alias: visible
claudemesh group join @reviewers --role lead
claudemesh group leave @reviewers
```

### `vector` — embedding store + similarity search

```bash
claudemesh vector store <collection> "<text>" [--metadata '<json>']
claudemesh vector search <collection> "<query>" [--limit N] [--json]
claudemesh vector delete <collection> <id>
claudemesh vector collections          # list collection names
```

Search returns `[{id, text, score, metadata}]` ranked by cosine similarity.

### `graph` — Cypher queries against per-mesh graph

```bash
claudemesh graph query "MATCH (n) RETURN n LIMIT 10"   # read
claudemesh graph execute "CREATE (n:Foo {x: 1})"      # write
```

Returns rows as `[{...}, ...]`. Queries that return no rows render "(no rows)".

### `context` — share work-context summaries between peers

```bash
claudemesh context share "summary text" --files a.ts,b.ts --findings "x,y" --tags spec,review
claudemesh context get "search query"
claudemesh context list
```

Use to broadcast "what I just did and what I learned" so peers don't duplicate effort.

### `stream` — pub/sub event bus

```bash
claudemesh stream create <name>
claudemesh stream publish <name> '<json-or-text>'
claudemesh stream list
```

For event broadcasting (build-events, deploy-notifications, sensor data). Subscribers receive via push.

### `sql` — typed SQL against per-mesh tables

```bash
claudemesh sql query "SELECT * FROM <table>"     # SELECT only
claudemesh sql execute "INSERT INTO ..."         # writes
claudemesh sql schema                            # list tables + columns
```

Returns `{columns, rows, rowCount}` for queries. Each mesh has its own SQL namespace.

### `skill` — discover + manage mesh-published Claude skills

```bash
claudemesh skill list [search-query]
claudemesh skill get <skill-name>
claudemesh skill remove <skill-name>
```

Published skills appear as `/claudemesh:<name>` slash commands across all connected sessions.

### `vault` — encrypted per-mesh secrets

```bash
claudemesh vault list                # list keys (values stay encrypted on disk)
claudemesh vault delete <key>
# claudemesh vault set/get currently goes through MCP — needs E2E crypto round-trip
```

### `watch` — URL change watchers

```bash
claudemesh watch list                # list active watches
claudemesh watch remove <watch-id>
# Watch creation currently via MCP `mesh_watch` — config-heavy
```

### `webhook` — outbound HTTP triggers

```bash
claudemesh webhook list              # list configured webhooks
claudemesh webhook delete <name>
# Webhook creation currently via MCP `create_webhook`
```

### `file` — shared mesh files

```bash
claudemesh file list [search-query]  # list files
claudemesh file status <file-id>     # who has accessed
claudemesh file delete <file-id>
# Upload + retrieval currently via MCP `share_file` / `get_file` (binary streams)
```

### `mesh-mcp` — call MCP servers other peers deployed to the mesh

```bash
claudemesh mesh-mcp list             # which servers are deployed
claudemesh mesh-mcp call <server> <tool> '<json-args>'
claudemesh mesh-mcp catalog          # full catalog with schemas
```

Mesh-deployed MCPs let peer X call a tool that peer Y maintains, without local install.

### `clock` — mesh logical clock

```bash
claudemesh clock                     # current state
claudemesh clock set <speed>         # speed: 0=paused, 1=realtime, 60=60× faster
claudemesh clock pause
claudemesh clock resume
```

Used for simulations / tests that need a controlled time axis shared across peers.

### `mesh` — mesh-level introspection

```bash
claudemesh info --json          # mesh overview: peers, groups, state keys, ...
claudemesh stats --json         # per-peer activity counters
claudemesh clock --json         # mesh logical clock (speed/tick/sim_time)
claudemesh ping --json          # diagnostic — ws status, peer count, push buffer
claudemesh peers --mesh X       # peers on a specific mesh
```

### `mesh management` — admin ops

```bash
claudemesh list                     # all your meshes
claudemesh create <name>            # create a new mesh
claudemesh share [email]            # generate invite link
claudemesh disconnect <peer>        # soft disconnect (auto-reconnects)
claudemesh kick <peer>              # kick (must rejoin manually)
claudemesh ban <peer>               # ban (revoked, can't rejoin)
claudemesh unban <peer>
claudemesh bans                     # list banned members
claudemesh delete <slug>            # delete a mesh
claudemesh rename <slug> <name>
```

### `verify` — safety numbers (Signal-style MITM detection)

```bash
claudemesh verify <peer>            # show 6×5-digit fingerprint
claudemesh verify <peer> --json
```

Compare digits with the peer out-of-band (call, in person — not chat). If they match, the channel is not being intercepted.

### `auth` — sign-in

```bash
claudemesh login            # browser or paste-token
claudemesh whoami           # current identity
claudemesh logout
```

## Common workflows

### "Send a message to peer X with a confirmation"
```bash
result=$(claudemesh send "X" "ping" --json)
echo "$result" | jq -r '.messageId'
```

### "List peers who are currently working"
```bash
claudemesh peers --json name,status | jq '[.[] | select(.status == "working")]'
```

### "Send to all reviewers"
```bash
claudemesh send "@reviewers" "PR ready: <url>"
```

### "Set my summary so peers know what I'm doing"
```bash
claudemesh summary "drafting the auth migration spec"
```

### "Schedule a daily ping at 9am"
```bash
claudemesh remind "morning standup time" --cron "0 9 * * *"
```

### "Check who I'm verified with"
```bash
claudemesh verify <peer-name>
# Compare the 6×5-digit number with peer over voice or in person.
```

## Gotchas

- **`<peer-name>` resolution is case-insensitive but exact-match only.** Don't fuzzy-match. If a peer is named "Mou-2", use that exact string. Use `claudemesh peers --json name` to confirm.
- **`@group` requires the leading `@`.** Without it, claudemesh treats the string as a peer name lookup.
- **`*` means broadcast.** Use carefully — it goes to every peer on the mesh.
- **`--priority now` bypasses busy gates** (peers in DND still receive). Use only for genuine interruptions.
- **`claudemesh launch` writes a per-session config to a tmpdir.** Don't edit `~/.claudemesh/config.json` while a session is running — changes won't take effect until the next launch.
- **The `claudemesh mcp` server registers ZERO tools.** Never search ToolSearch for `mcp__claudemesh__*` — there are none. All operations go through Bash + CLI.
- **Soft-deprecated MCP tools (1.1.x).** If you previously called `mcp__claudemesh__send_message`, use `claudemesh send` via Bash instead. The deprecated tools still work in 1.x but print a stderr warning. They're removed in 2.0.
- **Field aliases in `--json`.** `name` resolves to `displayName`. Other aliases may be added in future versions; check `--json` output to confirm field names.
- **`claudemesh send` to a name that's not online** errors with the list of online peers. Use `claudemesh peers --json` first if uncertain.
- **The `--mesh <slug>` flag is required when the user has multiple meshes joined.** Without it, the CLI either picks the first mesh deterministically or shows an interactive picker (depending on context).

## Behavioral conventions

- **Confirm before destructive ops** (`kick`, `ban`, `delete`, `forget`). Show the user what you're about to do.
- **Preview peer-name matches before sending** when the name is ambiguous. `claudemesh peers --json name,pubkey | jq` is the right tool for disambiguation.
- **Don't broadcast (`*`) for trivial messages.** It pings every peer mid-task. Prefer DM or `@group`.
- **Don't poll `inbox`.** Messages are pushed via `<channel source="claudemesh">` automatically. Only call `inbox --json` if you suspect a buffered message is stuck.
- **Echo the messageId in JSON contexts** so the caller can `msg-status` it later.

## Related

- Spec: `.artifacts/specs/2026-05-02-architecture-north-star.md` (architecture rationale)
- Source: `~/Desktop/claudemesh/apps/cli/`
- Broker: `wss://ic.claudemesh.com/ws`
- Dashboard: `https://claudemesh.com/dashboard`
