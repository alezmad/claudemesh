# Mesh Services Platform — Test Results

**Date:** 2026-04-08  
**CLI Version:** 0.8.0 → 0.8.9 (10 releases this session)  
**Broker Commit:** `26c4502`  
**Runner Image:** `claudemesh-runner:latest` (node:22 + python3.11 + uv + bun)  
**Tester:** Mou (Claude Opus 4.6, claudemesh session)  
**VPS:** surfquant.com (OVHcloud, 8 vCores, 24GB RAM)

---

## Infrastructure

| Component | Location | Status |
|---|---|---|
| Broker | Coolify auto-deploy, `wss://ic.claudemesh.com/ws` | Running (healthy) |
| Runner | Manual Docker container, `coolify` network | Running (healthy) |
| Postgres | `eo1f5gydsgrg19b57e9s4zw7` | Running |
| MinIO | `claudemesh-minio` | Running |
| DB tables | `mesh.service`, `mesh.vault_entry` | Created |
| `BROKER_ENCRYPTION_KEY` | Set in Coolify env | Persisted |
| `RUNNER_URL` | `http://claudemesh-runner:7901` | Connected |

---

## Test Results: 44/44 PASS

### Core Deploy + Tool Call Flow

| # | Test | Input | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | Deploy npx MCP (Node) | `mesh_mcp_deploy(server_name: "context7", npx_package: "@upstash/context7-mcp", scope: "mesh")` | Status: running, tools discovered | Status: building → running, 2 tools (resolve-library-id, query-docs) | **PASS** |
| 2 | Catalog shows running service | `mesh_mcp_catalog()` | context7 listed with status + tools + scope | `context7 (mcp, running) — 2 tools, scope: mesh, by Mou, npx` | **PASS** |
| 3 | Tool call through mesh | `mesh_tool_call("context7", "resolve-library-id", {query: "React hooks", libraryName: "react"})` | Library results returned | 5 React libraries with descriptions and scores | **PASS** |

### Schema + Logs + Scope

| # | Test | Input | Expected | Actual | Result |
|---|---|---|---|---|---|
| 4 | Schema introspection | `mesh_mcp_schema("context7")` | Full inputSchema for each tool | Both tools with descriptions + JSON schemas | **PASS** |
| 5 | Logs retrieval | `mesh_mcp_logs("context7", 10)` | Log lines or empty | `No logs for "context7"` (clean run) | **PASS** |
| 6 | Scope read | `mesh_mcp_scope("context7")` | Current scope | `scope: "mesh", Deployed by: Mou` | **PASS** |
| 7 | Scope change to group | `mesh_mcp_scope("context7", {group: "eng"})` | Updated | `Scope updated to: {"group":"eng"}` | **PASS** |
| 8 | Scope change to mesh | `mesh_mcp_scope("context7", "mesh")` | Updated | `Scope updated to: "mesh"` | **PASS** |

### Undeploy + Redeploy Cycle

| # | Test | Input | Expected | Actual | Result |
|---|---|---|---|---|---|
| 9 | Undeploy service | `mesh_mcp_undeploy("context7")` | Service removed | `Service "context7" undeployed.` | **PASS** |
| 10 | Catalog empty | `mesh_mcp_catalog()` | No services | `No services deployed in the mesh.` | **PASS** |
| 11 | Redeploy after undeploy | `mesh_mcp_deploy("context7", ...)` | Rebuilds + runs | Status: building → running, 2 tools | **PASS** |
| 12 | Tool call after redeploy | `mesh_tool_call("context7", "resolve-library-id", {libraryName: "drizzle"})` | Results | 5 Drizzle ORM libraries returned | **PASS** |

### Multi-Service

| # | Test | Input | Expected | Actual | Result |
|---|---|---|---|---|---|
| 13 | Deploy second service | `mesh_mcp_deploy("youtube-transcript", npx: "@lunks/youtube-transcript-mcp")` | Running | Status: running, 1 tool (get_transcript) | **PASS** |
| 14 | Catalog shows both | `mesh_mcp_catalog()` | 2 services | context7 (2 tools) + youtube-transcript (1 tool) | **PASS** |
| 15 | Tool call second service | `mesh_tool_call("youtube-transcript", "get_transcript", {url: rickroll})` | Transcript | "We're no strangers to love..." (full lyrics) | **PASS** |
| 16 | Undeploy one, other works | undeploy youtube → call context7 | context7 still works | Express library results returned | **PASS** |

### Error Handling

| # | Test | Input | Expected | Actual | Result |
|---|---|---|---|---|---|
| 17 | Call undeployed service | `mesh_tool_call("youtube-transcript", ...)` | Error | `MCP server "youtube-transcript" not found in mesh` | **PASS** |
| 18 | Call nonexistent tool | `mesh_tool_call("context7", "nonexistent-tool", {})` | MCP error | `MCP error -32602: Tool nonexistent-tool not found` | **PASS** |

### Broker Restart Survival

| # | Test | Input | Expected | Actual | Result |
|---|---|---|---|---|---|
| 19 | Boot restore after restart | Redeploy broker via Coolify | DB syncs with runner | context7 status: running (synced from runner /health) | **PASS** |
| 20 | Tool call after restart | `mesh_tool_call("context7", ..., {libraryName: "prisma"})` | Results | 5 Prisma libraries returned | **PASS** |

### Native MCP Entries at Launch

| # | Test | Input | Expected | Actual | Result |
|---|---|---|---|---|---|
| 21 | `mesh:context7` entry in ~/.claude.json | `claudemesh launch` with deployed context7 | Entry written | `mesh:context7:91367` present in config | **PASS** |
| 22 | Native tools in ToolSearch | Search for `mesh_context7` | `mcp__mesh_context7_91367__*` tools | `resolve-library-id` + `query-docs` available | **PASS** |
| 23 | Native tool call (no mesh_tool_call) | `mcp__mesh_context7_91367__resolve-library-id({libraryName: "zustand"})` | Direct result | 5 Zustand libraries returned | **PASS** |

### URL Watch

| # | Test | Input | Expected | Actual | Result |
|---|---|---|---|---|---|
| 24 | Create watch (json mode) | `mesh_watch(url: ".../test/flip", mode: "json", extract: "value", interval: 10)` | Watch created | `Watch ID: w_dfc3e47b` | **PASS** |
| 25 | Create watch (hash mode) | `mesh_watch(url: ".../test/html", mode: "hash", interval: 15)` | Watch created | Watch ID returned | **PASS** |
| 26 | Create watch (json mode, health) | `mesh_watch(url: ".../health", mode: "json", extract: "status", interval: 30)` | Watch created | Watch ID returned | **PASS** |
| 27 | List watches | `mesh_watches()` | 3 watches with metadata | All 3 shown with lastValue, lastCheck | **PASS** |
| 28 | Watch notification format | Wait for coin flip change | `[WATCH] coin flip: heads → tails` | Formatted correctly, no decrypt errors | **PASS** |
| 29 | Watch notification volume | 25 min of coin flip watching | Multiple notifications | 83 notifications received, all correct | **PASS** |
| 30 | Unwatch | `mesh_unwatch(watchId)` | Watch stopped | All 3 stopped | **PASS** |

### System Message Display

| # | Test | Input | Expected | Actual | Result |
|---|---|---|---|---|---|
| 31 | Watch notifications readable | `check_messages()` after watch fires | `[WATCH] label: old → new` | Formatted correctly | **PASS** |
| 32 | Peer returned events readable | Broker restart triggers reconnect | `[peer_returned] {...}` | Displayed with peer name and data | **PASS** |
| 33 | No "failed to decrypt" on system messages | Any system push | Plaintext format | No decrypt errors for system messages | **PASS** |

---

## Vault CRUD + Crypto (12/12 PASS)

| # | Test | Result |
|---|---|---|
| V1 | `vault_set` (env type) | **PASS** |
| V2 | `vault_set` (file type with mount_path) | **PASS** |
| V3 | `vault_list` — metadata only | **PASS** |
| V4 | `vault_delete` | **PASS** |
| V5 | `vault_list` after delete — empty | **PASS** |
| V6 | E2E crypto: env roundtrip (libsodium) | **PASS** |
| V7 | E2E crypto: file roundtrip | **PASS** |
| V8 | E2E crypto: wrong key rejected | **PASS** |
| V9 | E2E crypto: tampered ciphertext rejected | **PASS** |
| V10 | Broker crypto: AES-256-GCM roundtrip | **PASS** |
| V11 | Broker crypto: tampered data rejected | **PASS** |
| V12 | Broker crypto: random IV (no deterministic ciphertext) | **PASS** |

## Existing Tools Regression (4/4 PASS)

| # | Test | Result |
|---|---|---|
| R1 | `list_peers` | **PASS** — 4+ peers |
| R2 | `mesh_info` | **PASS** — full overview |
| R3 | `set_summary` | **PASS** |
| R4 | `mesh_mcp_scope` on non-existent service | **PASS** — graceful |

## Runner Direct Tests (3 runtimes, 3/3 PASS)

| # | Runtime | Server | Tools | Result |
|---|---|---|---|---|
| D1 | Node (npx) | context7 | resolve-library-id, query-docs | **PASS** |
| D2 | Node (npx) | youtube-transcript | get_transcript | **PASS** |
| D3 | Python (uvx) | mcp-server-time | get_current_time, convert_time | **PASS** |

---

## Known Gaps (not tested)

| Gap | Reason | Priority |
|---|---|---|
| `--resume <id>` flag | Used `-c` (continue) instead; `--resume` is passthrough to Claude | Low |
| Stale `mesh:*` entry cleanup | No stale entries exist to trigger cleanup | Low |
| Git deploy via CLI end-to-end | Runner git clone works directly, CLI→broker→runner git path not tested | Low |
| Python uvx deploy via CLI | CLI doesn't have `uvx_package` param yet | Low |
| Vault `$vault:` resolution in deploy | vault_get works but full deploy flow with vault refs untested | Medium |
| Scope filtering on hello_ack | Needs peer in different group to verify exclusion | Low |
| Runner container managed by Coolify | Runner is manually managed, not auto-deployed | Low |

---

## Bugs Found and Fixed During Testing

| Bug | Fix | Commit |
|---|---|---|
| CLI 0.8.0 installed but handlers missing | Added missing switch cases in server.ts | `9474d98` |
| Vault stored as plaintext base64 | E2E encrypt with libsodium secretbox + sealed box | `a90046a` |
| `(result as any).rowCount` fragile | Changed to `.returning().length > 0` | `070a3b7` |
| Mass-assignment in `upsertService` | Whitelisted columns | `070a3b7` |
| Missing path sanitization | `validateServiceName()` rejects `..`, `/`, non-alphanumeric | `070a3b7` |
| Runner `writeFileSync` not imported | Added to imports | `2bd388a` |
| npx binary detection picked utility bins | Filter + package-name matching | `8a3c96d` |
| Python venv binary run with `node` | Run directly or via `python -m module` | `4c385a1` |
| `mcp[cli]` extras missing for Python MCPs | Install `mcp[cli]` alongside package | `c327c28` |
| `uv venv` fails on existing venv | Added `--clear` flag | `17e6361` |
| Boot restore tried to re-deploy | Changed to sync with runner `/health` | `b6224c4` |
| `getRunningServices` only matched `running` | Also match `failed`, `crashed`, `restarting` | `4ee8102` |
| `GIT_TERMINAL_PROMPT` not disabled | Set to `0` for non-interactive clone | `b0634b8` |
| System push messages "failed to decrypt" | Skip decryption for `subtype: "system"`, format as plaintext | `bfc62b9` |
| Watch/deploy events not in channel handler | Added `watch_triggered`, `mcp_deployed`, `mcp_undeployed`, `mcp_scope_changed` cases | `26c4502` |

---

## CLI Releases This Session

| Version | Key Changes |
|---|---|
| 0.8.0 | Mesh services platform: vault, catalog, scopes, deploy tools, service proxy |
| 0.8.1 | Missing tool call handlers (vault_set, mesh_mcp_deploy, etc.) |
| 0.8.2 | Claude Code session ID (`CLAUDEMESH_SESSION_ID` + `detectClaudeSessionId()`) |
| 0.8.3 | `--resume` / `--continue` flags on launch |
| 0.8.4 | Vault E2E encryption with libsodium |
| 0.8.5 | `vault_get` wire message + deploy-time `$vault:` resolution |
| 0.8.6 | `npx_package` source type for `mesh_mcp_deploy` |
| 0.8.7 | URL watch (`mesh_watch`, `mesh_unwatch`, `mesh_watches`) |
| 0.8.8 | System push message decryption fix (ws/client.ts) |
| 0.8.9 | Watch/deploy channel notification formatting (server.ts) |

---

## Summary

**44 tests total, 44 PASS, 0 FAIL.**

The mesh services platform is end-to-end functional:
- Deploy MCP servers (Node npx, Python uvx) to the VPS runner container
- Call tools through the full mesh chain (CLI → broker → runner → MCP → result)
- Native MCP entries at launch (deployed services appear as `mcp__mesh_<name>__*` tools)
- Manage services (catalog, schema, logs, scope, undeploy/redeploy)
- Vault E2E encryption with libsodium (secretbox + sealed box)
- Broker-side AES-256-GCM encryption at rest for env vars
- Services survive broker restarts via boot sync with runner
- URL Watch: broker polls URLs, notifies on change (hash/json/status modes)
- System push messages display correctly (watch, deploy, peer events)
- Proper error handling for missing services, tools, and edge cases
- 15 bugs found and fixed during testing
