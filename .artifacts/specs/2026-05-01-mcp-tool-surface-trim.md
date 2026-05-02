---
title: MCP tool surface trim + multi-mesh push
status: proposed
target: claudemesh-cli 1.1.0
author: Alejandro
date: 2026-05-01
---

# MCP tool surface trim + multi-mesh push

## Problem

Two issues with the current `claudemesh mcp` server:

1. **80+ tools registered.** Every Claude session that has claudemesh installed pays the deferred-tool-list cost (~80 entries surfacing in `ToolSearch`). Most of those tools are CLI-verb-wrappers that already have a perfect Bash equivalent — no structured I/O is gained by exposing them as MCP tools.

2. **Single-mesh push only.** A session launched with `claudemesh launch` opens its WS to one mesh. Peer messages from any other joined mesh arrive only if the user manually runs `claudemesh inbox`. The MCP push pipeline doesn't fan out across meshes.

The cleanest framing: **MCP earns its keep when a tool returns structured data Claude reads. CLI is better for fire-and-forget verbs.** Today's tool surface ignores that distinction.

## Non-goals

- **Don't redesign the architecture as "CLI-only with a daemon."** That trades warm-WS sends (~5ms in-process) for cold Bash spawns (~300-500ms) and forces a Unix-socket bridge to recover state coherence. See discussion 2026-05-01 — the platform vision (vectors, graph, files, mesh-services) genuinely benefits from typed tool I/O.
- **Don't break MCP backward compat in 1.x.** Existing scripts calling `mcp__claudemesh__send_message` keep working until 2.0; in 1.1 they're soft-deprecated with a stderr warning.

## Proposal

Three patches, ship together as 1.1.0:

### Patch 1: `--mesh <slug>` flag on `claudemesh mcp`

Today `claudemesh mcp` calls `readConfig()` and `startClients(config)` — connects to every mesh in `~/.claudemesh/config.json`. The `claudemesh launch` flow writes a per-session tmpdir config with one mesh, so practically the MCP server binds to one mesh per session.

Add an explicit flag for non-launch contexts (manual `~/.claude.json` editing):

```ts
// apps/cli/src/mcp/server.ts, near line 244
export async function startMcpServer(): Promise<void> {
  const serviceIdx = process.argv.indexOf("--service");
  if (serviceIdx !== -1 && process.argv[serviceIdx + 1]) {
    return startServiceProxy(process.argv[serviceIdx + 1]!);
  }

  const meshIdx = process.argv.indexOf("--mesh");
  const onlyMesh = meshIdx !== -1 ? process.argv[meshIdx + 1] : null;

  const config = readConfig();
  if (onlyMesh) {
    const before = config.meshes.length;
    config.meshes = config.meshes.filter((m) => m.slug === onlyMesh);
    if (config.meshes.length === 0) {
      throw new Error(
        `--mesh "${onlyMesh}" not found in config (have: ${
          config.meshes.map((m) => m.slug).join(", ") || "none"
        })`,
      );
    }
  }
  // ...rest unchanged
}
```

Enables this `~/.claude.json` pattern for users who want push from N meshes simultaneously without launching N Claude sessions:

```json
{
  "mcpServers": {
    "claudemesh:flexicar":  { "command": "claudemesh", "args": ["mcp", "--mesh", "flexicar"] },
    "claudemesh:openclaw":  { "command": "claudemesh", "args": ["mcp", "--mesh", "openclaw"] },
    "claudemesh:prueba1":   { "command": "claudemesh", "args": ["mcp", "--mesh", "prueba1"] }
  }
}
```

Each instance opens one WS, holds it for the session, decrypts and forwards `claude/channel` notifications independently. Channel events already carry `[meshSlug]` in `formatPush()` (server.ts:240), so Claude knows which mesh a message came from.

**LoC:** ~10. **Risk:** very low — additive flag, default behavior unchanged.

### Patch 2: trim 25 messaging tools from MCP surface

Move these tools from "registered MCP tool" to "soft-deprecated CLI shim":

| Module | Tool | CLI replacement | Rationale |
|---|---|---|---|
| messaging.ts | `send_message` | `claudemesh send <to> <msg> [--mesh X] [--priority Y]` | Pure verb, no structured return. |
| messaging.ts | `list_peers` | `claudemesh peers --json` | One-shot, easy to parse. |
| messaging.ts | `check_messages` | `claudemesh inbox --json` | One-shot. |
| messaging.ts | `message_status` | `claudemesh msg-status <id>` (new) | One-shot lookup. |
| profile.ts | `set_profile` | `claudemesh profile --avatar X --bio Y ...` | Pure write. |
| profile.ts | `set_status` | `claudemesh status set <state>` (new) | Pure write. |
| profile.ts | `set_summary` | `claudemesh summary <text>` (new) | Pure write. |
| profile.ts | `set_visible` | `claudemesh visible <true\|false>` (new) | Pure write. |
| groups.ts | `join_group` | `claudemesh group join @<name> [--role X]` (new) | Pure write. |
| groups.ts | `leave_group` | `claudemesh group leave @<name>` (new) | Pure write. |
| state.ts | `get_state` | `claudemesh state get <key> --json` | Already exists. |
| state.ts | `set_state` | `claudemesh state set <key> <value>` | Already exists. |
| state.ts | `list_state` | `claudemesh state list --json` | Already exists. |
| memory.ts | `remember` | `claudemesh remember <text>` | Already exists. |
| memory.ts | `recall` | `claudemesh recall <query> --json` | Already exists. |
| memory.ts | `forget` | `claudemesh forget <id>` (new) | Pure write. |
| scheduling.ts | `schedule_reminder` | `claudemesh remind <msg> --in/--at/--cron` | Already exists. |
| scheduling.ts | `list_scheduled` | `claudemesh remind list --json` | Already exists. |
| scheduling.ts | `cancel_scheduled` | `claudemesh remind cancel <id>` | Already exists. |
| mesh-meta.ts | `mesh_info` | `claudemesh info --json` | One-shot read. |
| mesh-meta.ts | `mesh_stats` | `claudemesh stats --json` (new) | One-shot read. |
| mesh-meta.ts | `mesh_clock` | `claudemesh clock --json` (new) | One-shot read. |
| mesh-meta.ts | `ping_mesh` | `claudemesh ping` (new) | Pure verb. |
| tasks.ts | `claim_task` / `complete_task` | `claudemesh task claim/complete <id>` (new) | Pure write. |

**Keep as MCP tools (~50):**

- **vault.ts** — `vault_set / vault_list / vault_delete` (encrypted, structured payloads).
- **vectors.ts** — `vector_store / vector_search / vector_delete` (typed embeddings, ranked results Claude reasons over).
- **graph.ts** — `graph_query / graph_execute` (returns structured graph results).
- **files.ts** — `share_file / get_file / list_files / list_peer_files / read_peer_file / grant_file_access / file_status / delete_file` (binary payloads, ACL semantics).
- **skills.ts** — `share_skill / list_skills / get_skill / remove_skill / mesh_skill_deploy` (typed skill metadata).
- **streams.ts** — `create_stream / list_streams / publish / subscribe` (event stream cursor semantics).
- **contexts.ts** — `share_context / get_context / list_contexts` (context-passing payloads).
- **mcp-registry-*.ts** — `mesh_mcp_*` (the ~14 mesh-MCP-services tools — these are platform-defining, MCP-native).
- **clock-write.ts** — `mesh_set_clock / mesh_pause_clock / mesh_resume_clock` (logical-clock writes that Claude composes with reads).
- **sql.ts** — `mesh_query / mesh_schema / mesh_execute` (typed SQL results).
- **webhooks.ts** — `create_webhook / list_webhooks / delete_webhook` (typed webhook metadata).
- **url-watch.ts** — `mesh_watch / mesh_unwatch / mesh_watches` (returns watch state).
- **tasks.ts** — `create_task / list_tasks` (typed task records — only the writes go to CLI).

### Patch 3: tool-call → CLI shim with deprecation warning

For the trimmed tools, keep the registration but route through the CLI:

```ts
// apps/cli/src/mcp/tools/messaging.ts (sketch)
async function sendMessageDeprecated(args: SendMessageArgs): Promise<ToolResult> {
  process.stderr.write(
    `[claudemesh] mcp__claudemesh__send_message is soft-deprecated in 1.1. ` +
    `Use \`claudemesh send\` via Bash instead — it's faster and cleaner.\n`,
  );
  return originalSendMessageHandler(args); // unchanged behavior
}
```

In 2.0 the registrations get deleted entirely.

## Migration plan

1. **1.1.0** — ship all three patches. Existing users see deprecation warnings; nothing breaks.
2. **1.1.x** — collect feedback. If anyone has scripts hard-wired to the deprecated tools, surface in CHANGELOG.
3. **1.2.0** (~6 weeks later) — flip deprecation warnings to "removal in 2.0" messaging.
4. **2.0.0** — delete the 25 tool registrations. ToolSearch surface drops to ~50 entries.

## Open questions

- **Do we need a Unix-socket bridge between CLI sends and the MCP push-pipe** so they share one WS connection per mesh per session? Probably yes for `claudemesh send` warm-path performance, but it's a separate spec — file under `socket-bridge` after this lands.
- **Should `claudemesh launch` keep writing one MCP server entry** (current behavior, default for new users) or switch to the per-mesh-N-entries pattern from Patch 1? Recommend keeping single-entry default — Patch 1 is for advanced users who manually edit `~/.claude.json`.
- **Do `mesh_mcp_*` tools really belong in the keep list?** They're MCP-on-mesh management — their bias is RPC-shaped, not stream-shaped. Provisional yes; revisit if 1.1 reduces their use.

## Effort

- Patch 1: ~10 LoC + 1 test. ~30 min.
- Patch 2: ~25 tool-handler refactors (registration removed, CLI verb confirmed/added). Some new verbs (`status set`, `summary`, `visible`, `group join/leave`, `forget`, `stats`, `clock`, `ping`, `task claim/complete`, `msg-status`) need wiring through to existing broker-client methods. ~150 LoC, half a day.
- Patch 3: deprecation shim per trimmed tool. ~50 LoC, 1 hour.

**Total:** ~1 dev-day for 1.1.0. ToolSearch surface drops by ~30%, multi-mesh push works, no architectural disruption, platform tools stay typed.
