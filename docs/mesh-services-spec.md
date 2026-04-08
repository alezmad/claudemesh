# Mesh Services: MCP Servers & Skills Platform

> Consolidated spec for deploying, managing, and executing MCP servers
> and multi-file skills within a claudemesh mesh. Covers source modes,
> execution engine, credential vaults, access control, native Claude Code
> integration, and dynamic tool discovery.

---

## Problem

Today:
- **Skills** are a single `instructions` text field in Postgres. No multi-file support.
- **MCP servers** are live-proxied through the registering peer. When that peer disconnects, the server dies. The `persistent` flag is cosmetic.
- Neither supports bundled artifacts (templates, configs, schemas, example code).
- Claude Code has no way to discover mesh tools natively — peers must use the generic `mesh_tool_call` proxy.

## Design goals

1. Three source modes — inline, zip bundle, git repo — for both skills and MCP servers
2. MCP servers run on the VPS, not on peers — true 24/7 persistence
3. Sandboxed execution with resource limits
4. Native Claude Code tool integration — deployed MCPs appear as regular MCP server entries
5. Per-peer credential vault for secrets (OAuth tokens, API keys)
6. Visibility scopes on services — peer, group, role, or mesh-wide — deployer controls who can call, not who sees secrets
7. Dynamic mid-session discovery via `notifications/tools/list_changed`
8. All existing behavior preserved — inline skills and live-proxy MCPs unchanged

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│ claudemesh launch --name Mou --mesh dev                          │
│                                                                  │
│  1. Connect to broker, authenticate                              │
│  2. Fetch service catalog (scope-filtered for this peer)          │
│  3. Write native MCP entries to ~/.claude.json:                  │
│       mesh:gmail, mesh:context7, mesh:whatsapp                   │
│  4. Spawn claude                                                 │
│  5. On exit: remove mesh:* entries                               │
└──────────┬───────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│ Claude Code session                                              │
│                                                                  │
│  MCP: claudemesh (stdio)                                         │
│  ├── send_message, list_peers, set_summary, ...  (peer comms)   │
│  ├── mesh_mcp_deploy, mesh_mcp_scope, ...        (service mgmt) │
│  ├── vault_set, vault_list, ...                  (credentials)  │
│  └── mesh_mcp_schema                             (introspection)│
│                                                                  │
│  MCP: mesh:gmail (stdio proxy)        → mcp__mesh_gmail__*      │
│  MCP: mesh:context7 (stdio proxy)     → mcp__mesh_context7__*   │
│  MCP: mesh:whatsapp (stdio proxy)     → mcp__mesh_whatsapp__*   │
│                                                                  │
│  MCP: playwriter (stdio, local)       → local MCPs as usual     │
│  MCP: figma (stdio, local)                                       │
└──────────┬───────────────────────────────────────────────────────┘
           │ Each mesh:* proxy connects via WebSocket
           ▼
┌──────────────────────────────────────────────────────────────────┐
│ Broker (VPS — wss://ic.claudemesh.com/ws)                        │
│                                                                  │
│  Existing: message routing, presence, state, memory, files, ...  │
│                                                                  │
│  New: Service Catalog                                            │
│  ├── Scope enforcement (peer/group/role/mesh visibility)         │
│  ├── Tool schema registry (from runner)                          │
│  ├── Deploy/undeploy/update commands                             │
│  └── System events: mcp_deployed, mcp_undeployed                │
│                                                                  │
│  New: Vault                                                      │
│  └── Per-peer encrypted credential storage                       │
│                                                                  │
│  Tool call routing:                                              │
│  ├── Managed service? → forward to runner                        │
│  └── Live proxy?      → forward to hosting peer (existing)       │
└──────────┬───────────────────────────────────────────────────────┘
           │ stdio (child process)
           ▼
┌──────────────────────────────────────────────────────────────────┐
│ Runner (one Docker container per mesh)                            │
│                                                                  │
│  Supervisor (Node main thread)                                   │
│  ├── stdin/stdout ↔ broker (JSON-RPC multiplexed)               │
│  ├── Routes tool calls by service name                           │
│  ├── Lifecycle: load / unload / restart                          │
│  ├── Health: MCP ping per child, restart on 3 failures          │
│  ├── Logs: 1000-line ring buffer per service                     │
│  └── Vault: decrypts credentials at spawn time                   │
│                                                                  │
│  Child processes (one per MCP server):                           │
│  ├── child_process.spawn("node", [...]) ← Node MCP servers     │
│  ├── child_process.spawn("uvx", [...])  ← Python MCP servers   │
│  ├── child_process.spawn("npx", [...])  ← npm MCP packages     │
│  │                                                               │
│  │   Each child:                                                 │
│  │   ├── Own stdio pipe (MCP protocol)                          │
│  │   ├── Own env vars (including vault-resolved secrets)        │
│  │   ├── Own /secrets/<name>/ dir (vault files)                 │
│  │   └── Killed individually on undeploy                        │
│  │                                                               │
│  Base image: node:22 + python3.12 + uv + npx                    │
│  Limits: --memory=512m --cpus=1 --network=mesh-restricted       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Source modes

### 1. Inline (existing, unchanged)

```
share_skill(name, description, instructions, tags)       ← text-only skill
mesh_mcp_register(server_name, description, tools)       ← live peer proxy
```

### 2. Zip bundle

Upload a zip, then deploy:

```
1. share_file(path="./my-server.zip", tags=["mcp-bundle"])  → fileId
2. mesh_mcp_deploy(file_id=fileId, server_name="my-server", config={...})
```

**MCP server zip structure:**
```
my-mcp-server/
├── package.json          # or pyproject.toml / requirements.txt
├── src/index.ts          # MCP server entry (stdio transport)
├── .env.example          # declares required env vars
└── README.md
```

**Skill bundle zip structure:**
```
my-skill/
├── SKILL.md              # instructions (replaces inline text)
├── skill.json            # { name, description, tags }
├── templates/            # prompt templates, examples
└── schemas/              # JSON schemas, configs
```

### 3. Git repository

```
mesh_mcp_deploy(
  git_url="https://github.com/user/my-mcp-server.git",
  branch="main",
  server_name="my-server",
  config={ env: { API_KEY: "$vault:my-api-key" } }
)
```

- Shallow clone (`--depth 1`)
- Commit SHA pinned in DB for auditability
- `mesh_mcp_update(server_name)` → git pull + rebuild + restart
- Auth via `config.git_auth` (stored encrypted, never logged)

---

## Execution engine

### Why child processes, not worker threads

MCP servers use **stdio transport** — each server owns its stdin/stdout via
`StdioServerTransport`. Two servers can't share one process. Worker threads
don't help because:
- MCP SDK `StdioServerTransport` takes over process stdin/stdout
- `npx @package/mcp-server` spawns its own process anyway
- Python MCPs need a Python runtime, not a Node thread

The runner spawns each MCP server as a **child process** with its own stdio
pipe, exactly how every MCP server is designed to work.

### Container design: one per mesh

```
┌─ Docker container (mesh: "dev") ─────────────────┐
│                                                   │
│  Supervisor (Node main thread)                    │
│  ├─ stdio ↔ broker                               │
│  ├─ routes calls by service name                  │
│  │                                                │
│  ├─ spawn("npx", ["@upstash/context7-mcp"])      │
│  │   └─ stdio pipe ↔ MCP protocol                │
│  ├─ spawn("node", ["dist/index.js"])              │
│  │   └─ stdio pipe ↔ MCP protocol                │
│  ├─ spawn("uvx", ["mcp-outline"])                 │
│  │   └─ stdio pipe ↔ MCP protocol                │
│  └─ spawn("python", ["-m", "server"])             │
│      └─ stdio pipe ↔ MCP protocol                │
│                                                   │
│  Base: node:22 + python3.12 + uv + npx            │
│  Limits: --memory=512m --cpus=1                    │
│  Network: mesh-restricted bridge (allowlist)       │
└───────────────────────────────────────────────────┘
```

**Why one container, not N:**
- One Docker process to manage, one cgroup for the whole mesh
- One network namespace — single firewall config
- Shared node_modules / pip cache across services
- VPS resources: 8 vCores / 24GB — N containers exhausts memory fast

**Why not zero containers (bare child processes on the broker):**
- Broker stays routing-only — runner crashes don't take it down
- Security boundary — runner can't access broker's DB or filesystem
- Runner can be on a different machine later (NUC, second VPS)

### Supervisor protocol

Broker ↔ runner communicate over the container's stdin/stdout as JSON lines:

```typescript
// Broker → runner
{ action: "load", name: "gmail", path: "/services/gmail", env: {...} }
{ action: "call", name: "gmail", tool: "search_emails", args: {...}, callId: "abc" }
{ action: "unload", name: "gmail" }
{ action: "health", name: "gmail" }
{ action: "list_tools", name: "gmail" }

// Runner → broker
{ callId: "abc", result: {...} }
{ callId: "abc", error: "connection refused" }
{ type: "loaded", name: "gmail", tools: [{name, description, inputSchema}] }
{ type: "unloaded", name: "gmail" }
{ type: "crashed", name: "gmail", restarts: 3, error: "OOM" }
{ type: "health", name: "gmail", ok: true, rssKb: 45000 }
```

### Runtime auto-detection

| File found | Runtime | Spawn command |
|---|---|---|
| `package.json` | node | `npm install && node <main>` |
| `package.json` with npx hint | node | `npx <package>` |
| `pyproject.toml` | python | `pip install . && python -m <module>` |
| `requirements.txt` | python | `pip install -r requirements.txt && python <entry>` |
| `Bunfile` or `bun.lockb` | bun | `bun install && bun <entry>` |

### Health & restart

- Supervisor sends MCP `ping` to each child every 30s
- No response within 5s → mark unhealthy
- 3 consecutive failures → restart (kill + re-spawn)
- Max 5 restarts → status=`crashed`, notify deployer via mesh system event
- On crash: `{ type: "push", event: "mcp_crashed", eventData: { name, error, restarts } }`

### Logs

Per-service ring buffer (1000 lines). Captures child's stderr + stdout
(excluding MCP protocol JSON). Accessible via `mesh_mcp_logs(name, lines?)`.

### Storage layout

```
/var/claudemesh/services/
├── <meshId>/
│   ├── <serviceName>/
│   │   ├── source/          # extracted zip or git clone
│   │   ├── secrets/         # vault-resolved credential files
│   │   ├── node_modules/    # or .venv/ for Python
│   │   └── .meta.json       # { pid, startedAt, sha, runtime }
```

### Network policy

Default: `--network=mesh-restricted` (Docker bridge with outbound deny-all).

Per-service allowlist in deploy config:
```json
{
  "network_allow": [
    "gmail.googleapis.com:443",
    "oauth2.googleapis.com:443",
    "100.113.153.45:*"
  ]
}
```

Implemented via iptables rules on the bridge, or per-container `--add-host`
entries combined with a proxy. For Tailscale-accessible services (NUC, etc.),
allow the Tailscale IP.

---

## Credential vault

### Design

Per-peer encrypted storage on the broker. Credentials never leave the vault
in plaintext — decrypted only inside the runner container at spawn time.

Peers don't share credentials. They share **access to the running MCP
server** via scopes. The MCP server runs with the deployer's credentials;
other peers call it without ever seeing the secrets.

### Encryption model

Same crypto as E2E file sharing (`crypto/file-crypto.ts`):

1. Peer generates random symmetric key
2. Encrypts the credential with `crypto_secretbox` (symmetric)
3. Seals the symmetric key with their own pubkey (`crypto_box`)
4. Stores sealed key + ciphertext on broker — broker sees only ciphertext
5. At spawn time: runner requests decryption from the deployer's sealed key
   (the runner holds a mesh-scoped keypair granted by the deployer at deploy time)

### Vault reference syntax

In `mesh_mcp_deploy` env config, `$vault:` prefix triggers vault resolution:

```
$vault:api-key                              → inject as env var
$vault:gmail-creds:file:/secrets/creds.json → decrypt, write to file, set env var to path
```

Examples:
```typescript
mesh_mcp_deploy({
  server_name: "gmail",
  git_url: "https://github.com/gongrzhe/server-gmail-autoauth-mcp",
  env: {
    GMAIL_CREDENTIALS_PATH: "$vault:gmail-creds:file:/secrets/credentials.json",
    GMAIL_OAUTH_PATH: "$vault:gmail-oauth:file:/secrets/gcp-oauth.keys.json",
  },
  network_allow: ["gmail.googleapis.com:443", "oauth2.googleapis.com:443"],
})
```

### MCP tools

```
vault_set(key, value, type?, mount_path?)  — encrypt + store
  value: string (env var) or local file path (reads + encrypts the file)
  type: "env" (default) or "file"
  mount_path: for files, where to write inside the service dir

vault_list()                               — list keys (no values, metadata only)
vault_delete(key)                          — remove entry
```

### DB schema

```sql
CREATE TABLE mesh.vault_entry (
  id          TEXT PRIMARY KEY,
  mesh_id     TEXT NOT NULL REFERENCES mesh.mesh(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL REFERENCES mesh.member(id),
  key         TEXT NOT NULL,

  -- E2E encrypted content
  ciphertext  BYTEA NOT NULL,
  nonce       BYTEA NOT NULL,
  sealed_key  BYTEA NOT NULL,    -- symmetric key sealed with peer's pubkey

  -- Metadata (plaintext)
  entry_type  TEXT DEFAULT 'env' CHECK (entry_type IN ('env', 'file')),
  mount_path  TEXT,
  description TEXT,

  created_at  TIMESTAMP DEFAULT now(),
  updated_at  TIMESTAMP DEFAULT now(),

  UNIQUE (mesh_id, member_id, key)
);
```

---

## Visibility scopes

### Model

Scopes control who can see and call a service. Credentials are invisible to
callers — they interact with the running service, not the secrets behind it.
The deployer controls visibility; the vault handles secrets separately.

### Scope levels

| Scope | Who sees it | Use case |
|---|---|---|
| `peer` | Only the deployer (default) | Personal tools, staging before publish |
| `{ peers: [...] }` | Named peers | Shared between specific people |
| `{ group: "eng" }` | All @eng members | Team-specific tools |
| `{ groups: ["eng", "ops"] }` | Multiple groups | Cross-team tools |
| `{ role: "lead" }` | Any peer with that role | Role-gated admin tools |
| `mesh` | Everyone in the mesh | Shared utilities |

### Examples

```
┌─────────────────────────────────────────────────┐
│ Mesh: "dev-team"                                │
│                                                 │
│  mesh scope ─── everyone                        │
│  ├── context7         (utility)                 │
│  ├── youtube-transcript                         │
│  └── mesh-db          (shared database)         │
│                                                 │
│  group scope ─── @group members only            │
│  ├── @eng                                       │
│  │   ├── github-mcp   (eng team's GitHub)       │
│  │   └── ssh-manager  (eng infra access)        │
│  ├── @sales                                     │
│  │   ├── apollo-io    (sales CRM)               │
│  │   └── gmail        (sales@ inbox)            │
│  └── @ops                                       │
│      ├── stalwart-mail (mail server admin)       │
│      └── namecheap    (DNS management)           │
│                                                 │
│  role scope ─── by role tag                     │
│  ├── lead → mesh-admin-tools (deploy, vault)    │
│  └── observer → (read-only MCPs only)           │
│                                                 │
│  peer scope ─── only specific peers             │
│  ├── Alejandro                                  │
│  │   ├── gmail-personal  (my inbox)             │
│  │   └── gworkspace      (my workspace)         │
│  └── Mou                                        │
│      └── cursor-composer (Mou's Cursor)         │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Deploy with scope

```typescript
// Mesh scope — everyone
mesh_mcp_deploy({
  server_name: "context7",
  source: { type: "git", url: "..." },
  scope: "mesh",
})

// Group scope — only @eng
mesh_mcp_deploy({
  server_name: "github-mcp",
  source: { type: "git", url: "..." },
  scope: { group: "eng" },
})

// Multi-group
mesh_mcp_deploy({
  server_name: "ssh-manager",
  scope: { groups: ["eng", "ops"] },
})

// Role scope — only leads
mesh_mcp_deploy({
  server_name: "mesh-admin",
  scope: { role: "lead" },
})

// Peer scope — just me (default)
mesh_mcp_deploy({
  server_name: "gmail-personal",
  scope: "peer",
})

// Specific peers
mesh_mcp_deploy({
  server_name: "shared-workspace",
  scope: { peers: ["Mou", "Alejandro"] },
})
```

### Enforcement

- **At catalog time:** broker filters the service catalog by scope before
  sending to peers in `hello_ack`. The peer's groups and role (from `hello`)
  are matched against each service's scope. A tool you can't access never
  appears in Claude's tool list.
- **At call time:** broker re-checks scope before routing. Double-check
  in case catalog is stale or the peer's groups changed.

### Scope resolution logic

```typescript
function peerCanAccess(service: Service, peer: PeerConn): boolean {
  const scope = service.scope;
  if (typeof scope === "string") {
    if (scope === "peer") return service.deployed_by === peer.memberId;
    if (scope === "mesh") return true;
  }
  if ("peers" in scope) {
    return scope.peers.some(p =>
      p === peer.memberId || p === peer.displayName);
  }
  if ("group" in scope) {
    return peer.groups.some(g => g.name === scope.group);
  }
  if ("groups" in scope) {
    return peer.groups.some(g => scope.groups.includes(g.name));
  }
  if ("role" in scope) {
    return peer.groups.some(g => g.role === scope.role);
  }
  return false;
}
```

### MCP tools

```
mesh_mcp_scope(server_name, scope?)
  scope set:  mesh_mcp_scope("gmail", { group: "sales" })
  scope read: mesh_mcp_scope("gmail") → { scope, deployed_by }
```

### Scope change events

When a scope changes, the broker:
1. Computes which peers gained/lost access
2. Sends `mcp_scope_changed` system event to affected peers
3. Peers who gained access get `svc__*` dynamic tools via `list_changed`
4. Peers who lost access get tools removed via `list_changed`
5. Full native access requires session restart

### DB

Single column on `mesh.service`:

```sql
scope JSONB DEFAULT '{"type": "peer"}'
-- {"type": "peer"}
-- {"type": "mesh"}
-- {"type": "peers", "allow": ["member_id_1", "member_id_2"]}
-- {"type": "group", "group": "eng"}
-- {"type": "groups", "groups": ["eng", "ops"]}
-- {"type": "role", "role": "lead"}
```

### Future: cross-mesh scope

Not for v1. Each mesh is isolated. The schema supports it later:

```json
{"type": "cross_mesh", "meshes": ["dev", "staging"]}
```

A service deployed in `dev` visible in `staging`. Requires the runner to be
accessible from both meshes (possible since it's on the VPS).

---

## Native Claude Code integration

### Goal

Deployed mesh MCPs feel indistinguishable from locally installed MCP servers.
Claude sees `mcp__mesh_gmail__search_emails` — not `mesh_tool_call("gmail", ...)`.

### At session start: native MCP entries

`claudemesh launch` queries the broker for the scope-filtered service catalog
and installs each service as a native MCP entry before spawning Claude:

```typescript
// commands/launch.ts — extended flow

// Step 3 (new): fetch service catalog from broker
const catalog = await fetchServiceCatalog(mesh);

// Step 4 (new): write mesh MCP entries to ~/.claude.json
for (const service of catalog) {
  addMcpEntry(`mesh:${service.name}`, {
    command: "claudemesh",
    args: ["mcp", "--service", service.name],
  });
}

// Step 5: spawn claude with mesh-aware env
const child = spawn("claude", claudeArgs, {
  env: {
    ...process.env,
    CLAUDEMESH_CONFIG_DIR: tmpDir,
    CLAUDEMESH_DISPLAY_NAME: displayName,
    // Mesh calls traverse: proxy → WS → broker → runner → child.
    // Default MCP timeout is too short for this chain.
    MCP_TIMEOUT: process.env.MCP_TIMEOUT ?? "30000",
    // Mesh MCPs may return large results (DB queries, file contents).
    MAX_MCP_OUTPUT_TOKENS: process.env.MAX_MCP_OUTPUT_TOKENS ?? "50000",
  },
});

// Step 6 (extended): cleanup mesh:* entries on exit
child.on("exit", () => {
  removeMcpEntries("mesh:*");
  cleanup();  // existing tmpdir cleanup
});
```

Each `claudemesh mcp --service <name>` is a thin stdio proxy:

```typescript
// Thin proxy: connects to broker, serves ONE service's tools
const client = new BrokerClient(mesh);
await client.connect();
const tools = await client.getServiceTools(serviceName);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  // Wait for broker reconnection if WS is down (up to 10s)
  if (client.status !== "open") {
    const connected = await client.waitForConnection(10_000);
    if (!connected) {
      return text("Service temporarily unavailable — broker reconnecting. Retry in a few seconds.", true);
    }
  }
  return await client.mcpCall(serviceName, req.params.name, req.params.arguments);
});
```

**Resilience notes:**
- The `BrokerClient` handles WS reconnection with exponential backoff (1s→30s)
- Claude Code does NOT auto-restart crashed MCP servers — if the proxy
  process itself dies, those tools vanish until session restart
- The proxy should catch all exceptions and return MCP errors, never crash
- `claudemesh doctor` diagnoses dead proxy processes mid-session

**Result:** Claude Code starts and sees:
```
mcp__mesh_gmail__search_emails         ← proper namespace, full schema
mcp__mesh_gmail__send_email            ← deferred by ToolSearch automatically
mcp__mesh_context7__query_docs         ← native MCP, no indirection
```

### Session management

**Safe `~/.claude.json` modification:**
- `~/.claude.json` stores MCP entries AND other Claude Code config (permissions,
  env vars, etc.). Never overwrite the whole file.
- Read-modify-write: load full JSON → add/remove only `mesh:*` keys in
  `mcpServers` → write back. Preserve all other keys.
- Use `flock` on writes to prevent concurrent session corruption.

**Stale entry cleanup:**
- Each `mesh:*` entry includes `_meshSession` metadata with PID and timestamp
- `claudemesh launch` sweeps stale entries on startup (dead PID check)
- `claudemesh doctor` reports orphaned entries

**Concurrent sessions:**
- Entries are session-scoped: `mesh:gmail:w1t0p0` (includes session ID)
- Each session manages only its own entries

### Mid-session deploys: dynamic tools

When a service is deployed after the Claude session started, native MCP entries
can't be added (Claude Code doesn't support adding new MCP servers mid-session).

**Two-tier fallback:**

1. **Claudemesh MCP fires `notifications/tools/list_changed`** (stdio, proven to work)
   - Adds `svc__<name>__<tool>` tools to its own `tools/list`
   - Claude sees them as `mcp__claudemesh__svc__gmail__search_emails`
   - Works, but namespacing is less clean than native

2. **System notification tells the peer:**
   ```
   [mesh] Service deployed: "namecheap" by Alejandro (3 tools).
   Available now via mesh_tool_call("namecheap", "domains_list", {...}).
   Restart session for native mcp__mesh_namecheap__* access.
   ```

3. **`mesh_tool_call` remains the universal fallback** — works for any
   service at any time, native or not.

### Mid-session undeploys

When a service is undeployed, the native proxy process detects the broker
event and exits gracefully. Claude Code sees the MCP server disconnect and
stops offering those tools. No `list_changed` needed — MCP server death
is already handled.

### Schema introspection

For programmatic access to tool schemas (building workflows, debugging):

```
mesh_mcp_schema(server_name)                → all tools with full inputSchema
mesh_mcp_schema(server_name, tool_name)     → one specific tool's schema
mesh_mcp_catalog()                          → all services with tool counts, scope, status
```

---

## Database changes

### New table: `mesh.service`

```sql
CREATE TABLE mesh.service (
  id              TEXT PRIMARY KEY,
  mesh_id         TEXT NOT NULL REFERENCES mesh.mesh(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('mcp', 'skill')),

  -- Source
  source_type     TEXT NOT NULL CHECK (source_type IN ('inline', 'zip', 'git')),
  source_file_id  TEXT REFERENCES mesh.file(id),
  source_git_url  TEXT,
  source_git_branch TEXT DEFAULT 'main',
  source_git_sha  TEXT,
  prev_git_sha    TEXT,                    -- for rollback

  -- Content
  description     TEXT NOT NULL,
  instructions    TEXT,                    -- skills only
  tools_schema    JSONB,                   -- MCPs: [{ name, description, inputSchema }]

  -- Bundle
  manifest        JSONB,                   -- { files: [...], entry: "src/index.ts" }

  -- Execution (MCPs only)
  runtime         TEXT CHECK (runtime IN ('node', 'python', 'bun', NULL)),
  status          TEXT DEFAULT 'stopped'
                  CHECK (status IN ('building', 'installing', 'running',
                                    'stopped', 'failed', 'crashed', 'restarting')),
  config          JSONB DEFAULT '{}',      -- resource limits, network policy
  last_health     TIMESTAMP,
  restart_count   INT DEFAULT 0,
  version         INT DEFAULT 1,

  -- Visibility scope
  scope           JSONB DEFAULT '{"type": "peer"}',

  -- Metadata
  deployed_by     TEXT REFERENCES mesh.member(id),
  deployed_by_name TEXT,
  created_at      TIMESTAMP DEFAULT now() NOT NULL,
  updated_at      TIMESTAMP DEFAULT now() NOT NULL,

  UNIQUE (mesh_id, name)
);
```

### New table: `mesh.vault_entry`

```sql
CREATE TABLE mesh.vault_entry (
  id          TEXT PRIMARY KEY,
  mesh_id     TEXT NOT NULL REFERENCES mesh.mesh(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL REFERENCES mesh.member(id),
  key         TEXT NOT NULL,
  ciphertext  BYTEA NOT NULL,
  nonce       BYTEA NOT NULL,
  sealed_key  BYTEA NOT NULL,
  entry_type  TEXT DEFAULT 'env' CHECK (entry_type IN ('env', 'file')),
  mount_path  TEXT,
  description TEXT,
  created_at  TIMESTAMP DEFAULT now(),
  updated_at  TIMESTAMP DEFAULT now(),
  UNIQUE (mesh_id, member_id, key)
);
```

### Extend `mesh.skill` (backward compat)

```sql
ALTER TABLE mesh.skill
  ADD COLUMN source_type TEXT DEFAULT 'inline'
    CHECK (source_type IN ('inline', 'zip', 'git')),
  ADD COLUMN bundle_file_id TEXT REFERENCES mesh.file(id),
  ADD COLUMN git_url TEXT,
  ADD COLUMN git_branch TEXT DEFAULT 'main',
  ADD COLUMN git_sha TEXT,
  ADD COLUMN manifest JSONB;
```

---

## Wire protocol additions

### Client → broker

```typescript
// --- Service deployment ---

interface WSMcpDeployMessage {
  type: "mcp_deploy";
  server_name: string;
  source:
    | { type: "zip"; file_id: string }
    | { type: "git"; url: string; branch?: string; auth?: string };
  config?: {
    env?: Record<string, string>;    // supports $vault: refs
    memory_mb?: number;              // default 256
    cpus?: number;                   // default 0.5
    network_allow?: string[];        // default: none
    runtime?: "node" | "python" | "bun";
  };
  scope?:
    | "peer"                                    // private (default)
    | "mesh"                                    // everyone
    | { peers: string[] }                       // named peers
    | { group: string }                         // single group
    | { groups: string[] }                      // multiple groups
    | { role: string };                         // by role tag
  _reqId?: string;
}

interface WSMcpUndeployMessage {
  type: "mcp_undeploy";
  server_name: string;
  _reqId?: string;
}

interface WSMcpUpdateMessage {
  type: "mcp_update";
  server_name: string;
  _reqId?: string;
}

interface WSMcpLogsMessage {
  type: "mcp_logs";
  server_name: string;
  lines?: number;     // default 50, max 1000
  _reqId?: string;
}

interface WSMcpScopeMessage {
  type: "mcp_scope";
  server_name: string;
  scope?:                                       // set — omit to read current
    | "peer"
    | "mesh"
    | { peers: string[] }
    | { group: string }
    | { groups: string[] }
    | { role: string };
  _reqId?: string;
}

interface WSMcpSchemaMessage {
  type: "mcp_schema";
  server_name: string;
  tool_name?: string;  // omit for all tools
  _reqId?: string;
}

interface WSMcpCatalogMessage {
  type: "mcp_catalog";
  _reqId?: string;
}

// --- Skill deployment ---

interface WSSkillDeployMessage {
  type: "skill_deploy";
  source:
    | { type: "zip"; file_id: string }
    | { type: "git"; url: string; branch?: string; auth?: string };
  _reqId?: string;
}

// --- Vault ---

interface WSVaultSetMessage {
  type: "vault_set";
  key: string;
  ciphertext: string;   // base64
  nonce: string;         // base64
  sealed_key: string;    // base64
  entry_type: "env" | "file";
  mount_path?: string;
  description?: string;
  _reqId?: string;
}

interface WSVaultListMessage {
  type: "vault_list";
  _reqId?: string;
}

interface WSVaultDeleteMessage {
  type: "vault_delete";
  key: string;
  _reqId?: string;
}
```

### Broker → client

```typescript
// --- Service responses ---

interface WSMcpDeployStatusMessage {
  type: "mcp_deploy_status";
  server_name: string;
  status: "building" | "installing" | "running" | "failed";
  tools?: Array<{ name: string; description: string; inputSchema: object }>;
  error?: string;
  _reqId?: string;
}

interface WSMcpLogsResultMessage {
  type: "mcp_logs_result";
  server_name: string;
  lines: string[];
  _reqId?: string;
}

interface WSMcpSchemaResultMessage {
  type: "mcp_schema_result";
  server_name: string;
  tools: Array<{ name: string; description: string; inputSchema: object }>;
  _reqId?: string;
}

interface WSMcpCatalogResultMessage {
  type: "mcp_catalog_result";
  services: Array<{
    name: string;
    type: "mcp" | "skill";
    description: string;
    status: string;
    tool_count: number;
    deployed_by: string;
    scope: { type: string; [key: string]: unknown };
    source_type: string;
    runtime?: string;
    created_at: string;
  }>;
  _reqId?: string;
}

interface WSMcpScopeResultMessage {
  type: "mcp_scope_result";
  server_name: string;
  scope: { type: string; [key: string]: unknown };
  deployed_by: string;
  _reqId?: string;
}

// --- Skill responses ---

interface WSSkillDeployAckMessage {
  type: "skill_deploy_ack";
  name: string;
  files: string[];
  _reqId?: string;
}

// --- Vault responses ---

interface WSVaultAckMessage {
  type: "vault_ack";
  key: string;
  action: "stored" | "deleted" | "not_found";
  _reqId?: string;
}

interface WSVaultListResultMessage {
  type: "vault_list_result";
  entries: Array<{
    key: string;
    entry_type: "env" | "file";
    mount_path?: string;
    description?: string;
    updated_at: string;
  }>;
  _reqId?: string;
}

// --- System events (broadcast to mesh) ---

// Sent as WSPushMessage with subtype: "system"
// event: "mcp_deployed"
// eventData: { name, description, tool_count, deployed_by, scope, tools: [...] }

// event: "mcp_undeployed"
// eventData: { name, by }

// event: "mcp_crashed"
// eventData: { name, error, restarts }

// event: "mcp_updated"
// eventData: { name, prev_sha, new_sha, tools: [...] }
```

### Extended `hello_ack`

```typescript
interface WSHelloAckMessage {
  // ... existing fields ...

  /** Scope-filtered service catalog for this peer. */
  services?: Array<{
    name: string;
    description: string;
    status: string;
    tools: Array<{ name: string; description: string; inputSchema: object }>;
    deployed_by: string;
  }>;
}
```

---

## MCP tool additions (CLI)

### Service management tools

```typescript
mesh_mcp_deploy(server_name, file_id?, git_url?, git_branch?, env?, runtime?,
                memory_mb?, network_allow?, scope?)
mesh_mcp_undeploy(server_name)
mesh_mcp_update(server_name)           // git-only: pull + rebuild + restart
mesh_mcp_logs(server_name, lines?)
mesh_mcp_scope(server_name, scope?)    // set or read visibility scope
mesh_mcp_schema(server_name, tool?)    // introspect tool schemas
mesh_mcp_catalog()                     // list all services with status
mesh_skill_deploy(file_id?, git_url?, git_branch?)
```

### Vault tools

```typescript
vault_set(key, value, type?, mount_path?, description?)
vault_list()
vault_delete(key)
```

### Existing tools (unchanged)

```typescript
share_skill(name, description, instructions, tags)    // inline skills
mesh_mcp_register(server_name, description, tools)     // live peer proxy
mesh_tool_call(server_name, tool_name, args)           // universal fallback
mesh_mcp_list()                                        // shows both proxy + managed
```

---

## Broker-side service manager

New file: `apps/broker/src/service-manager.ts`

### Interface

```typescript
interface ServiceManager {
  deploy(opts: {
    meshId: string;
    name: string;
    source: { type: "zip"; fileId: string }
           | { type: "git"; url: string; branch: string; auth?: string };
    config: ServiceConfig;
    vaultEntries: Array<{ key: string; ciphertext: Buffer; nonce: Buffer; sealedKey: Buffer;
                          entryType: "env" | "file"; mountPath?: string }>;
  }): Promise<{ tools: ToolDef[]; status: string }>;

  undeploy(meshId: string, name: string): Promise<void>;

  update(meshId: string, name: string): Promise<{ tools: ToolDef[]; newSha?: string }>;

  callTool(meshId: string, serverName: string, toolName: string,
           args: Record<string, unknown>): Promise<{ result?: unknown; error?: string }>;

  logs(meshId: string, name: string, lines?: number): string[];

  status(meshId: string, name: string): ServiceStatus;

  restoreAll(): Promise<void>;  // on broker boot
}
```

### Boot restore

On broker startup:
1. Query `mesh.service WHERE status IN ('running', 'crashed', 'restarting')`
2. Set all to `status='restarting'`
3. Re-spawn runner container per mesh
4. Load each service's source and spawn child process
5. Set `status='running'` only after successful MCP `initialize` response
6. Services that fail to start → `status='failed'`, system event broadcast

---

## Security model

| Concern | Mitigation |
|---|---|
| Arbitrary code execution | Docker container, one per mesh |
| Resource exhaustion | `--memory=512m --cpus=1` per container |
| Filesystem escape | No host volume mounts |
| Secret leakage | Vault E2E encrypted, decrypted only inside container |
| Network exfiltration | `--network=mesh-restricted`, per-service allowlist |
| Malicious zip (path traversal) | Validate all paths within target dir, reject `..` |
| Git auth tokens | Stored encrypted in vault, passed via `GIT_ASKPASS` |
| Denial of service | Max 20 services per mesh, max 50MB zip, max 500MB image |
| Scope bypass | Double-check: filter catalog + check on call |
| OAuth token expiry | Store refresh tokens, notify deployer on persistent failure |
| Tool name collision | `svc__` prefix for mid-session dynamic tools |
| Stale MCP entries | PID check + age sweep on launch |
| Tool call timeout | `MCP_TIMEOUT=30000` set by launch (default too short for mesh chain) |
| Large tool output | `MAX_MCP_OUTPUT_TOKENS=50000` set by launch; proxy truncates if needed |
| Proxy crash | Claude Code won't auto-restart; `claudemesh doctor` diagnoses dead proxies |
| Broker restart | Proxies reconnect via BrokerClient backoff; calls return "reconnecting" during window |

---

## CLI commands

```bash
# Deploy from zip
claudemesh deploy ./my-server.zip --name my-server

# Deploy from git
claudemesh deploy --git https://github.com/user/repo.git --name my-server

# Deploy with vault refs
claudemesh vault set gmail-creds ~/.gmail-mcp/credentials.json --type file
claudemesh deploy --git https://github.com/user/gmail-mcp.git --name gmail \
  --env 'GMAIL_CREDENTIALS_PATH=$vault:gmail-creds:file:/secrets/creds.json' \
  --network-allow 'gmail.googleapis.com:443'

# Set access
claudemesh scope gmail --mesh                     # everyone
claudemesh scope gmail --group eng                # @eng only
claudemesh scope gmail --groups 'eng,ops'         # @eng + @ops
claudemesh scope gmail --role lead                # leads only
claudemesh scope gmail --peers 'Mou,Alejandro'   # specific peers
claudemesh scope gmail --peer                     # private (deployer only)

# Manage
claudemesh logs gmail
claudemesh update gmail              # git-only: pull + rebuild
claudemesh undeploy gmail
claudemesh catalog                   # list all services

# Skills
claudemesh skill deploy ./my-skill.zip
claudemesh skill deploy --git https://github.com/user/skill.git

# Vault
claudemesh vault set api-key "sk-abc123"
claudemesh vault set oauth-creds ~/path/to/creds.json --type file
claudemesh vault list
claudemesh vault delete api-key
```

---

## Migration path

| What | Before | After |
|---|---|---|
| `share_skill()` inline | works | unchanged |
| `mesh_mcp_register()` live proxy | works | unchanged, labeled "proxy" in catalog |
| Zip MCP server | not possible | `share_file` + `mesh_mcp_deploy` |
| Git MCP server | not possible | `mesh_mcp_deploy(git_url=...)` |
| Zip skill bundle | not possible | `mesh_skill_deploy(file_id=...)` |
| Git skill | not possible | `mesh_skill_deploy(git_url=...)` |
| `mesh_tool_call` | forwards to peer | routes to runner OR forwards to peer |
| `mesh_mcp_list` | proxy only | shows proxy + managed, with status |
| Tool discovery | manual `mesh_mcp_list` | native MCP entries at launch + mid-session events |
| Credentials | plaintext env vars | E2E encrypted vault with `$vault:` refs |
| Access control | none (anyone can call) | Scopes: peer/group/role/mesh per service |

All existing behavior preserved. New capabilities are additive.

---

## Implementation order

### Phase 1: Foundation
1. DB migration — `mesh.service` table, `mesh.vault_entry` table, extend `mesh.skill`
2. Wire protocol — add all new message types to `types.ts`
3. Vault — broker-side storage + CLI tools (`vault_set`, `vault_list`, `vault_delete`)
4. Service catalog — `mcp_catalog`, `mcp_schema`, scope filtering in `hello_ack`

### Phase 2: Execution engine
5. Runner supervisor — `service-manager.ts`, child process spawn/kill/restart/health
6. Docker container — base image, build + run lifecycle
7. Deploy flow — zip extraction, git clone, runtime detection, `npm install` / `pip install`
8. Tool call routing — broker routes managed service calls to runner

### Phase 3: Native integration
9. Launch integration — `claudemesh launch` writes `mesh:*` MCP entries to `~/.claude.json`
10. Stdio proxy — `claudemesh mcp --service <name>` thin proxy command
11. Mid-session fallback — `svc__*` dynamic tools + `list_changed` on claudemesh MCP
12. Session cleanup — stale entry sweep, PID checks, `flock` on config writes

### Phase 4: Skill bundles
13. Skill deploy — zip/git extraction, `SKILL.md` + `skill.json` parsing, manifest storage
14. `get_skill` extension — returns structured file contents from bundle

### Phase 5: Polish
15. `mesh_mcp_update` — git pull + rebuild + restart flow
16. Boot restore — re-spawn services on broker restart
17. CLI commands — `claudemesh deploy`, `claudemesh vault`, `claudemesh scope`, `claudemesh catalog`
18. Docs + example bundles — sample MCP server zip, sample skill bundle

---

## Appendix: Claude Code MCP behavior (verified)

Key findings from Claude Code MCP architecture research that informed this
spec. These are behaviors of Claude Code itself, not the MCP protocol.

### Lifecycle
- MCP servers start when a session begins, stop when it ends
- **No auto-restart on crash** — next tool invocation fails. Our proxy must
  handle reconnection to the broker independently
- No health checks from Claude Code — failures discovered on tool use
- `MCP_TIMEOUT` env var controls tool call timeout

### Dynamic tools
- `notifications/tools/list_changed` is supported and triggers immediate
  re-fetch of `tools/list` — works mid-conversation over stdio
- **SSE/HTTP transport support for `list_changed` may be unreliable** — known
  bug in some versions. This is why we use stdio proxies, not HTTP transport.

### ToolSearch / deferred tools
- Enabled by default (`ENABLE_TOOL_SEARCH=true`)
- Only tool **names** are loaded at startup — full schemas fetched on demand
- Requires Sonnet 4+ or Opus 4+ (Haiku does not support tool references)
- Adding 100+ MCP tools has near-zero context cost at startup
- Configurable: `ENABLE_TOOL_SEARCH=auto:5` loads upfront if <5% of context

### Tool output limits
- Warning at 10,000 tokens, hard limit at 25,000 tokens (default)
- Configurable via `MAX_MCP_OUTPUT_TOKENS` env var
- Per-tool override: `_meta["anthropic/maxResultSizeChars"]` (up to 500K chars)

### Namespacing
- Tools namespaced as `mcp__servername__toolname`
- Two servers with same tool name → no conflict (different namespace)
- Server names normalized: spaces → underscores

### Registration
- **File-based only** — no runtime API to add MCP servers
- Scopes: `local` (~/.claude.json), `project` (.mcp.json), `user` (~/.claude.json global)
- Precedence: local > project > user
- `claude mcp add --scope user` for global, `--scope project` for team-shared
- **Cannot add new MCP server entries mid-session** — this is why `claudemesh
  launch` pre-writes entries before spawning, and mid-session deploys fall
  back to dynamic `svc__*` tools on the claudemesh MCP server

### Environment variables
- Passed via `--env KEY=VALUE` on `claude mcp add`
- `.mcp.json` supports `${VAR}` and `${VAR:-default}` expansion
- Special: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`

### Implications for this spec
- Native MCP entries MUST be written before `claude` spawns → `claudemesh launch` flow
- Stdio transport is the only reliable path for `list_changed` → thin proxy model
- ToolSearch means 100+ mesh tools have negligible context cost
- No server dependencies → each mesh proxy is independent
- No auto-restart → proxies must reconnect to broker on their own
