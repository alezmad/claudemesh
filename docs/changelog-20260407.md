# claudemesh — Implementation Changelog

**Sprint:** 2026-04-07 evening session
**Author:** Alejandro Gutiérrez + Claude (Opus 4.6)
**CLI versions:** 0.6.8 → 0.6.9 → 0.7.0
**Broker:** deployed to `ic.claudemesh.com` (Coolify, OVHcloud VPS)

---

## Features shipped

### 1. Session path (cwd) sharing
`810f372` · CLI 0.6.9 + broker

Added `cwd` to the WS hello handshake. Broker stores it in the peer record, `list_peers` returns it. Peers on the same machine see each other's working directories for direct file referencing.

### 2. Peer metadata (type, channel, model)
`810f372` · Same commit as cwd

Extended hello with `peerType: "ai" | "human" | "connector"`, `channel` (e.g. "claude-code", "telegram"), `model` (e.g. "opus-4"). Foundation for connectors, humans, and smart routing.

### 3. System notifications (peer join/leave)
`453705a` · broker + CLI

Broker broadcasts `{ subtype: "system", event: "peer_joined" | "peer_left" }` pushes to all mesh peers on connect/disconnect. MCP server formats them as `[system] Peer "Alice" joined the mesh`. System events bypass inbox/off message modes.

### 4. Cron-based persistent reminders
`e873807` · broker + CLI + `72be651` (--cron flag)

Replaced in-memory `setTimeout` with DB-persisted scheduler. Zero-dependency 5-field cron parser. Schedules survive broker restarts via `recoverScheduledMessages()` on boot. CLI: `claudemesh remind "check deploys" --cron "0 */2 * * *"`. MCP: `schedule_reminder` with `cron` field.

### 5. Simulation clock with time multiplier
`05d9b56` · broker + CLI

Per-mesh clock state (`MeshClock` interface + `meshClocks` Map). Configurable speed x1–x100. Broadcasts heartbeat ticks as system pushes: `{ event: "tick", eventData: { tick, simTime, speed } }`. Auto-pauses when last peer disconnects. MCP tools: `mesh_set_clock`, `mesh_pause_clock`, `mesh_resume_clock`, `mesh_clock`.

### 6. Inbound webhooks
`b55cf26` · broker (new `webhooks.ts`) + CLI

`POST /hook/:meshId/:secret` → broker injects as push to all mesh peers. Webhooks stored in `meshWebhook` Drizzle table. MCP tools: `create_webhook` (returns URL+secret), `list_webhooks`, `delete_webhook`. Push format: `{ subtype: "webhook", event: "webhook_name", eventData: {...body} }`.

### 7. Slack connector
`5563f90` · `packages/connector-slack/`

Bridge process using `@slack/socket-mode` + `@slack/web-api`. Joins mesh as `peerType: "connector"`, `channel: "slack"`. Bidirectional relay with echo prevention, user ID-to-name resolution with caching, auto-reconnect with exponential backoff.

### 8. Telegram connector
`fe92853` · `packages/connector-telegram/`

Zero-dependency Telegram Bot API client using native `fetch` + long polling. Same bridge pattern as Slack. HTML formatting for Telegram output. Auto-reconnect with exponential backoff (1s–30s).

### 9. Non-Claude-Code SDK
`7e102a2` · `packages/sdk/`

Standalone TypeScript SDK (`@claudemesh/sdk`). `MeshClient extends EventEmitter` with `connect()`, `send()`, `broadcast()`, `listPeers()`, `getState()`, `setState()`. Uses `libsodium-wrappers` for ed25519-to-curve25519 crypto_box encryption (same as CLI). Auto-reconnect with exponential backoff.

### 10. Mesh skills catalog
`c8cb1e3` · broker (Drizzle schema + handlers) + CLI

Peers publish reusable skills (name, description, instructions, tags). Full CRUD: `share_skill` (upsert by name), `get_skill`, `list_skills` (ILIKE search), `remove_skill`. Stored in `meshSkill` table with unique (meshId, name). `get_skill` returns instructions prominently formatted for immediate AI use.

### 11. Shared project files
`504111c` · broker relay + CLI file serving

Peer-to-peer file relay: `read_peer_file(peer, path)` and `list_peer_files(peer, path?, pattern?)`. Broker relays without reading content. Security: 1MB max, path traversal rejection, hidden files excluded, 2-level dir listing cap (500 entries). Plus hostname-based local/remote detection (`2c9c8c7`) and filesystem shortcut hint for local peers (`a92cf6b`).

### 12. Peer stats reporting
`b3b9972` · broker + CLI

Peers auto-report stats every 60s: messagesIn/Out, toolCalls, uptime, errors. `set_stats` WS message + `mesh_stats` MCP tool. Stats visible in `list_peers` response. Tool call counter incremented on every MCP invocation.

### 13. Signed audit log (hash chain)
`86a2583` · broker (new `audit.ts` + Drizzle schema)

SHA-256 hash-chained append-only log. Each entry hashes: `prevHash|meshId|eventType|actorMemberId|payload|createdAt`. Events logged: peer_joined, peer_left, state_set, message_sent (NO ciphertext). WS endpoints: `audit_query` (paginated), `audit_verify` (chain integrity check). On startup: `ensureAuditLogTable()` + `loadLastHashes()`.

### 14. Mesh templates
`69e93d4` · CLI (`apps/cli/src/templates/`)

5 JSON templates: dev-team, research, ops-incident, simulation, personal. Each defines groups, roles, state keys, and a system prompt hint. `claudemesh create --template dev-team` loads and displays template. `claudemesh create --list-templates` shows all.

### 15. Default personal mesh guidance
`b0dc538` · CLI (`install.ts`)

`claudemesh install` detects empty meshes and shows join guidance. Local-only mesh deferred (requires broker enrollment for real connectivity).

### 16. Mesh MCP proxy
`08e289a` · broker + CLI

Dynamic tool sharing: `mesh_mcp_register` → `mesh_mcp_list` → `mesh_tool_call` → broker forwards to hosting peer → execute → result back. In-memory registry with 30s call timeout. Auto-cleanup on disconnect. MCP register/unregister broadcasts system notifications (`e09671c`).

### 17. Dashboard: peer graph + state timeline + resource panel
`59332dc` (peer graph) + `7d432b3` (timeline + resources)

**Peer graph:** Radial SVG layout, animated bezier edges with priority colors, group rings, status indicators (green/amber/red), node sizing by activity. No external deps (pure SVG + CSS animations). `ResizeObserver` for responsive sizing.

**State timeline:** Vertical timeline of audit events with timestamps, icons, type badges. Newest-first with auto-scroll. Shares same TanStack Query cache (zero extra API calls).

**Resource panel:** 2x2 card grid — live peers, envelope breakdown, audit event frequency, session online/offline split.

### 18. Peer visibility + public profiles
Broker types.ts + index.ts + CLI

`set_visible(false)` makes peer invisible in `list_peers` and skips broadcast/group routing. Direct messages by pubkey still reach hidden peers. System events: `peer_visible`, `peer_hidden`. Public profiles: `set_profile({ avatar, title, bio, capabilities })` — visible to other peers in `list_peers` and peer graph.

### 19. Hostname + local/remote detection
`2c9c8c7` · broker + CLI

`os.hostname()` added to hello handshake. `list_peers` shows `[local]` or `[remote]` tag per peer. MCP instructions include file access decision guide: local → filesystem, remote <1MB → `read_peer_file`, large/persistent → `share_file`.

### 20. File access decision guide in MCP instructions
`3641618` · CLI MCP server

Clear decision guide in system instructions: three methods (filesystem for local, relay for remote, MinIO for persistent), with size limits and when to use each.

### 21. MCP server register/unregister broadcasts
`e09671c` · broker + CLI

When a peer registers or removes an MCP server, all mesh peers receive a system notification: `[system] New MCP server available: "github" (hosted by Alice). Tools: list_repos, create_issue. Use mesh_tool_call to invoke.`

---

## Also shipped (infrastructure / docs)

| Commit | What |
|--------|------|
| `0bb9d71` | Merged `schedule_reminder` + `send_later` into single tool with optional `to` param; added `subtype: "reminder"` to push |
| `79525af` | Fixed TSC error from cron example in JSDoc comment |
| `69e93d4` | Mesh templates: 5 JSON templates + `claudemesh create` command |
| `f34b8fb` | CLI `--help` text review: 44 descriptions improved for clarity, concision, consistency |
| `58ba01f` | `CLAUDEMESH_TOOLS` in install.ts synced (41→45 tools, sorted alphabetically) |
| `db2bf3e` | `protocol.md` expanded from 6 to 73 message types |
| `72be651` | `--cron` flag wired into citty remind command |

---

## CLI versions published

| Version | Key changes |
|---------|------------|
| 0.6.8 | schedule_reminder merge, reminder subtype |
| 0.6.9 | cwd + peer metadata + system notifications + cron + templates + --help review |
| 0.7.0 | Skills catalog, MCP proxy, shared files, visibility, sim clock, webhooks, peer stats, connectors, SDK |

---

## Pending (building)

- **Peer session persistence** — agent running, DB-backed state restore on reconnect
- **Persistent MCP registrations** — agent running, survive peer disconnect with online/offline status

---

## Remaining from vision (not yet built)

| # | Feature | Notes |
|---|---------|-------|
| 6 | REST API + external WS | Webhooks done, REST and WS auth remain |
| 8 | Humans in the mesh | Web chat panel needed |
| 14 | Bridge / federation | Bridge peer feasible now, federation needs design |
| 18 | Sandboxes (E2B) | Third-party integration preferred |
| 20 | Spatial topology (x,y proximity) | Visibility done, proximity model remains |
| 21 | Semantic peer search | Multi-field matching, half day |
| 22 | Mesh telemetry + debugging | Structured logging + reporting |
