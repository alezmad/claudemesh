# claudemesh v2 — Pass 1 Parity Test Plan

**Status:** backlog reference
**Created:** 2026-04-11
**Purpose:** Concrete test-by-test plan that verifies v2 behaves identically to v1 for every feature in the `2026-04-11-v1-feature-inventory.md` regression list. Green parity suite = v2 Pass 1 ready to ship. Red parity suite = keep working.
**Companion to:** `2026-04-11-v1-feature-inventory.md` (this document's §12 is the input to every test below)

---

## 1. Why this exists

v2 Pass 1 is a refactor: new folder structure, facade pattern, CLI user flows. The broker is unchanged, the backend services are unchanged, every v1 **tool** (the 79 MCP tools + 85 broker WS message types) must keep working. The only safe way to prove "keep working" is to run v1 and v2 side by side and assert they produce identical behavior.

**v2 deliberately drops some v1 CLI commands** (not tools — CLI subcommands exposed to end users). Because v2 has no users yet and no migration constraints, the v2 CLI picks the best command surface without backwards compatibility. Commands dropped from v2:

| v1 command | Dropped in v2 because | Replacement |
|---|---|---|
| `claudemesh launch [args]` | Redundant with bare `claudemesh`. The subcommand word adds nothing. | `claudemesh` (bare, with flags) |
| `claudemesh disconnect telegram` | Bridge teardown is done inside Telegram (`/revoke`) or by leaving the mesh; CLI wrapper is cosmetic. | In-Telegram revoke; or leave the mesh |

**Preserved with UX upgrade**: `claudemesh connect telegram` stays in v2 but is rewritten as an interactive wizard — mesh picker, QR code, `t.me` deep link, waits for bridge confirmation. See Pass 1 spec §5.7. v1's silent auto-pick of `config.meshes[0]` is a multi-mesh footgun and is replaced.

The 79 MCP tools and 85 WS message types are **all preserved**. Only the thin wrapper CLI subcommands that translated them are dropped. This is a conscious v2 decision to simplify the CLI surface, not a regression.

v1 has thin test coverage (2 CLI test files for ~12 k LOC, ~10 broker tests mostly covering crypto primitives). That's not enough to catch regressions during a refactor. We need a **parity suite** — a test layer that doesn't trust v2 to describe its own correctness, but compares it to v1 directly.

The parity suite is the acceptance criteria. v2 Pass 1 ships when it's green.

---

## 2. The seven test layers

| # | Layer | Purpose | Compared against |
|---|---|---|---|
| 1 | **Parity tests** | Behavioral equivalence on the `inventory §12` regression list | v1 CLI subprocess |
| 2 | **WS contract tests** | Wire-format compatibility — v2 must speak the broker's v1 protocol | captured v1 envelopes |
| 3 | **MCP tool handler tests** | Every one of the 79 tools dispatches identically | v1 handler output |
| 4 | **End-to-end smoke tests** | Full user journeys against a real broker | self-consistent e2e flow |
| 5 | **JSON output golden tests** | `--json` output shape is stable for script consumers | v1 `--json` captures |
| 6 | **Facade unit tests** | Boundary invariants — no token leaks, Zod validation works | facade contract spec |
| 7 | **Port-forwarded v1 tests** | Existing crypto + broker tests still pass | unchanged |

Tests run in parallel where possible. Layers 1 and 2 are the most load-bearing — they're the proof that v2 doesn't break existing users.

---

## 3. Layer 1 — Parity tests (inventory §12 driven)

One test file per regression check in the inventory's "must preserve" list. Every file spawns both v1 and v2 CLIs against the same mock broker, captures their behavior, and asserts match on the dimensions that matter (exit code, stdout JSON fields, broker-side DB state, WS messages sent).

File layout:

```
apps/cli-v2/tests/parity/
├── first-run/
├── session-lifecycle/
├── messaging/
├── crypto/
├── tools/        (this one is covered by layer 3)
├── backends/
├── scheduled/
├── telegram/
├── dashboard-sync/
├── webhooks/
└── doctor/
```

### 3.1 First-run parity (inventory §12.1)

| Test file | Asserts |
|---|---|
| `first-run/install.test.ts` | `claudemesh install` writes identical entries to `~/.claude.json` + `~/.claude/settings.json` |
| `first-run/install-no-hooks.test.ts` | `claudemesh install --no-hooks` registers only the MCP server, not the status hooks |
| `first-run/uninstall.test.ts` | `claudemesh uninstall` removes everything `install` added, leaving other config entries untouched |
| `first-run/join-v1-invite.test.ts` | `claudemesh join <v1-invite-url>` enrolls using legacy invite format |
| `first-run/join-v2-invite.test.ts` | `claudemesh join <v2-invite-url>` enrolls using short-code + signed payload |
| `first-run/bare-first-run-welcome.test.ts` | `claudemesh` on a fresh machine (no config) shows the welcome wizard |
| `first-run/bare-returning-user-launches.test.ts` | `claudemesh` on a machine with config launches a session directly (no wizard) |
| `first-run/bare-with-flags-launches.test.ts` | `claudemesh --resume abc`, `claudemesh --mesh foo -y`, `claudemesh --name Alexis` all dispatch to the launch handler |
| `first-run/launch-word-unknown-command.test.ts` | `claudemesh launch` returns exit code 3 (invalid args) with a clear "Unknown command" error. The word `launch` is deliberately not a subcommand in v2. |

### 3.2 Session lifecycle parity (inventory §12.2)

| Test file | Asserts |
|---|---|
| `session-lifecycle/status-hook-start.test.ts` | Running `claudemesh hook` with a Claude Code `session_start` payload posts to `/hook/set-status` with `status: working`, source `hook` |
| `session-lifecycle/status-hook-stop.test.ts` | `session_stop` payload → `/hook/set-status` with `status: idle`, source `hook` |
| `session-lifecycle/status-priority.test.ts` | When a `hook` source status is fresh, a subsequent `manual` status is rejected (priority gating) |
| `session-lifecycle/status-ttl-sweep.test.ts` | After `WORKING_TTL_MS`, a stale `working` status decays to `idle` via the sweeper |
| `session-lifecycle/list-peers-freshness.test.ts` | `claudemesh peers` marks peers with stale hook source as degraded |
| `session-lifecycle/multi-mesh-status.test.ts` | Status updates in mesh A don't affect peer status in mesh B |

### 3.3 Messaging parity (inventory §12.3)

| Test file | Asserts |
|---|---|
| `messaging/send-priority-now.test.ts` | `send --priority now` delivers immediately, bypassing busy-gate |
| `messaging/send-priority-next.test.ts` | `send --priority next` waits for the recipient to be idle before delivery |
| `messaging/send-priority-low.test.ts` | `send --priority low` is pull-only (recipient must `check_messages` or `inbox`) |
| `messaging/send-to-group.test.ts` | `send @frontend <msg>` fans out to all group members, not individual peers |
| `messaging/send-broadcast.test.ts` | `send "*" <msg>` broadcasts to all connected peers in the mesh |
| `messaging/offline-queue-drain.test.ts` | Messages sent to an offline peer persist in `mesh.message_queue` and drain when the peer reconnects |
| `messaging/duplicate-delivery-prevention.test.ts` | Sending the same `messageId` twice does not double-deliver |
| `messaging/message-status-lookup.test.ts` | `message_status` returns correct delivery state: queued / delivered / acked |
| `messaging/inbox-drain.test.ts` | `claudemesh inbox` drains and prints pending messages; second run shows empty |
| `messaging/inbox-wait.test.ts` | `claudemesh inbox --wait 5` blocks for broker delivery up to 5s, returns early on arrival |

### 3.4 Cryptographic integrity parity (inventory §12.4)

| Test file | Asserts |
|---|---|
| `crypto/keypair-perms.test.ts` | Generated keypairs at `~/.claudemesh/keys/<mesh>.key` are mode `0600`, parent dir `0700` |
| `crypto/keypair-roundtrip.test.ts` | Keypair generation + persistence + reload produces the same public key |
| `crypto/hello-sig-verification.test.ts` | Valid Ed25519 hello signatures pass; altered timestamps are rejected as replay |
| `crypto/envelope-roundtrip.test.ts` | `send_message` ciphertext decrypts back to original on the recipient side |
| `crypto/file-encrypt.test.ts` | `share_file` with `to: <peer>` produces AES-GCM ciphertext + wrapped symmetric key in `mesh.file_key` |
| `crypto/file-decrypt.test.ts` | Recipient downloads + decrypts, content matches original |
| `crypto/grant-access-rewrap.test.ts` | `grant_file_access` adds a new `file_key` row for the additional recipient, re-wrapping the same symmetric key |
| `crypto/invite-v2-signature.test.ts` | v2 invite payloads pass Ed25519 signature verification; tampered payloads fail |

### 3.5 Broker backends parity (inventory §12.6)

| Test file | Asserts |
|---|---|
| `backends/postgres-mesh-execute.test.ts` | `mesh_execute "CREATE TABLE bugs..."` creates the table in the per-mesh schema |
| `backends/postgres-mesh-query.test.ts` | `mesh_query "SELECT * FROM bugs"` returns rows |
| `backends/postgres-mesh-schema.test.ts` | `mesh_schema` lists the newly-created table + columns |
| `backends/postgres-cross-mesh-isolation.test.ts` | Query in mesh A cannot see tables created in mesh B (schema-level isolation) |
| `backends/neo4j-graph-execute.test.ts` | `graph_execute "CREATE (n:Bug {id: 1})"` persists a node in the per-mesh Neo4j database |
| `backends/neo4j-graph-query.test.ts` | `graph_query "MATCH (n:Bug) RETURN n"` returns the created node |
| `backends/qdrant-vector-store.test.ts` | `vector_store collection=docs content=...` upserts into `mesh_<id>_docs` collection |
| `backends/qdrant-vector-search.test.ts` | `vector_search collection=docs query=...` returns nearest neighbors with metadata |
| `backends/qdrant-list-collections.test.ts` | `list_collections` enumerates the mesh's collections |
| `backends/minio-share-small-file.test.ts` | `share_file` with < 64 KB uploads and returns a fileId |
| `backends/minio-share-large-file.test.ts` | `share_file` with 10 MB uploads in chunks and returns a fileId |
| `backends/minio-get-file.test.ts` | `get_file` returns the content or presigned URL for download |
| `backends/minio-delete-file.test.ts` | `delete_file` removes the file from the bucket |
| `backends/docker-mcp-deploy.test.ts` | `mesh_mcp_deploy` with a catalog alias spawns a Docker container with the expected env + memory + network_allow |
| `backends/docker-mcp-logs.test.ts` | `mesh_mcp_logs` returns recent stdout/stderr from a running deployment |
| `backends/docker-mcp-undeploy.test.ts` | `mesh_mcp_undeploy` SIGTERMs the container cleanly |

### 3.6 Scheduled messages + URL watch parity (inventory §12.7)

| Test file | Asserts |
|---|---|
| `scheduled/one-shot-deliver-at.test.ts` | `schedule_reminder deliver_at=<ts+5s>` fires at the target timestamp |
| `scheduled/one-shot-in-seconds.test.ts` | `schedule_reminder in_seconds=5` fires 5 seconds after submission |
| `scheduled/cron-recurring.test.ts` | `schedule_reminder cron="*/1 * * * *"` fires every minute |
| `scheduled/persist-across-restart.test.ts` | Pending reminders survive a broker restart (re-registered from `mesh.scheduled_message` table) |
| `scheduled/list-cancel.test.ts` | `list_scheduled` shows pending; `cancel_scheduled <id>` prevents delivery |
| `scheduled/url-watch-hash-mode.test.ts` | `mesh_watch mode=hash` detects body change via SHA-256 comparison |
| `scheduled/url-watch-json-mode.test.ts` | `mesh_watch mode=json extract=data.status` detects value change at the jsonpath |
| `scheduled/url-watch-status-mode.test.ts` | `mesh_watch mode=status` detects HTTP status code change |
| `scheduled/url-watch-notify-on-match.test.ts` | `notify_on="match:up"` fires only when value equals `"up"` |
| `scheduled/url-watch-persist.test.ts` | Active watches persist across broker restart |

### 3.7 Telegram bridge parity (inventory §12.8)

The Telegram bridge is a broker-side feature that continues to work in v2 Pass 1 because Pass 1 doesn't touch the broker. However, the v2 CLI does NOT expose `claudemesh connect telegram` / `claudemesh disconnect telegram` commands — those were v1-only CLI surface that we drop because (a) there are no users to migrate and (b) Telegram connection is better expressed via broker APIs that the user flows expose.

Instead, Telegram bridge parity is verified via e2e tests in §6 that connect directly to the broker's `POST /tg/token` endpoint, simulate inbound Telegram webhook payloads, and verify outbound routing via `send_message(to: "tg:<username>")`.

| Test file | Layer | Asserts |
|---|---|---|
| `telegram/connect-wizard-mesh-picker.test.ts` | parity | `claudemesh connect telegram` with >1 joined mesh shows the Ink mesh picker (v1 silently picked mesh[0] — v2 is explicit) |
| `telegram/connect-wizard-single-mesh.test.ts` | parity | With exactly one joined mesh, the wizard skips the picker and proceeds directly to token request |
| `telegram/connect-wizard-zero-mesh.test.ts` | parity | With zero joined meshes, exits with error code 5 and "run `claudemesh join` first" |
| `telegram/connect-wizard-happy-path.test.ts` | parity | Mock broker returns `{token, deepLink}`; wizard renders QR + link; simulated `telegram_bridge_connected` push triggers success message |
| `telegram/connect-wizard-poll-fallback.test.ts` | parity | When the broker does not emit a push event, the wizard falls back to polling `GET /mesh/:id/members` every 2s until a `tg:*` entry appears |
| `telegram/connect-wizard-rate-limited.test.ts` | parity | Broker 429 response is caught and rendered as "too many Telegram tokens in the last hour" instead of raw HTTP |
| `telegram/connect-wizard-link-flag.test.ts` | parity | `--link` flag prints only the deep link, no QR, no wait (scriptable) |
| `telegram/connect-wizard-status-flag.test.ts` | parity | `--status` flag checks existing bridge without generating a new token |
| `telegram/connect-wizard-ctrl-c.test.ts` | parity | Ctrl-C during the wait phase prints the "link stays valid" hint and exits 0 |
| (e2e) `tests/e2e/telegram/broker-token-register.test.ts` | e2e | `POST /tg/token` registers a bot token, writes to `mesh.telegram_bridge` |
| (e2e) `tests/e2e/telegram/broker-inbound-routing.test.ts` | e2e | Simulated inbound Telegram update is routed as a mesh `send_message` with `subtype: telegram` |
| (parity) `telegram/send-message-to-tg-peer.test.ts` | parity | `send_message(to: "tg:<username>", ...)` via the v2 CLI calls the broker with the same WS envelope as v1 would |
| (parity) `telegram/list-peers-shows-tg-bridge.test.ts` | parity | When a Telegram bridge is registered on the broker, `claudemesh peers` includes `tg:<username>` entries with `type: bridge` |

### 3.8 Dashboard sync parity (inventory §12.9)

| Test file | Asserts |
|---|---|
| `dashboard-sync/browser-flow.test.ts` | `claudemesh sync` opens browser, receives JWT via `callback-listener`, fetches mesh list |
| `dashboard-sync/cli-sync-endpoint.test.ts` | `POST /cli-sync` with valid JWT returns the user's dashboard meshes; invalid JWT is rejected |
| `dashboard-sync/force-resync.test.ts` | `claudemesh sync --force` re-links even if already linked |

### 3.9 Webhooks parity (inventory §12.10)

| Test file | Asserts |
|---|---|
| `webhooks/create-returns-url.test.ts` | `create_webhook name=github` returns a POST URL |
| `webhooks/external-post-becomes-mesh-message.test.ts` | External `POST /hook/:meshId/:webhookId` with a JSON payload emits a mesh message to all peers |
| `webhooks/hmac-signature-validation.test.ts` | HMAC-signed requests pass, unsigned requests are rejected |
| `webhooks/list-delete.test.ts` | `list_webhooks` + `delete_webhook` round-trip works |

### 3.10 Doctor checks parity (inventory §12.11)

| Test file | Asserts |
|---|---|
| `doctor/check-node-version.test.ts` | `doctor` reports Node ≥ 20 (or warns if < 20 in a mocked env) |
| `doctor/check-claude-on-path.test.ts` | `doctor` detects `claude` binary on PATH |
| `doctor/check-mcp-registered.test.ts` | `doctor` detects MCP server entry in `~/.claude.json` |
| `doctor/check-hooks-registered.test.ts` | `doctor` detects status hooks in `~/.claude/settings.json` |
| `doctor/check-config-perms.test.ts` | `doctor` validates `~/.claudemesh/config.json` is mode `0600` |
| `doctor/check-keypairs-valid.test.ts` | `doctor` validates each mesh keypair can sign + verify |

**Parity layer total: ~70 test files.** Each file runs both v1 and v2 in the same environment and diffs the outputs.

---

## 4. Layer 2 — WS contract tests

One contract test per broker WS message type (85 total from inventory §3). Each test captures what v1's WS client would send for a given input and asserts v2 sends the byte-identical envelope (modulo legitimate non-determinism like nonces and timestamps, which are normalized before comparison).

File layout:

```
apps/cli-v2/tests/contract/ws/
├── lifecycle/                 (3 tests: hello, hello_ack, get_clock)
├── messaging/                 (4 tests)
├── profile/                   (5 tests)
├── groups/                    (2 tests)
├── state/                     (3 tests)
├── memory/                    (3 tests)
├── files/                     (5 tests)
├── vectors/                   (4 tests)
├── graph/                     (2 tests)
├── sql/                       (3 tests)
├── streams/                   (5 tests)
├── contexts/                  (3 tests)
├── tasks/                     (4 tests)
├── scheduling/                (3 tests)
├── metadata/                  (3 tests)
├── clock/                     (4 tests)
├── skills/                    (5 tests)
├── mcp-registry/              (11 tests)
├── vault/                     (4 tests)
├── url-watch/                 (3 tests)
├── webhooks/                  (3 tests)
└── audit/                     (2 tests)
```

### 4.1 Contract test pattern

```ts
// tests/contract/ws/state/set-state.test.ts
import { describe, it, expect } from 'bun:test';
import { normalize, captureV1Envelope, captureV2Envelope } from '@/tests/helpers/wire-capture';

describe('WS contract: set_state', () => {
  it('v2 envelope matches v1 for string value', async () => {
    const input = { meshId: 'test-mesh', key: 'sprint', value: '2026-W15' };
    const v1 = await captureV1Envelope('set_state', input);
    const v2 = await captureV2Envelope('set_state', input);
    expect(normalize(v2)).toEqual(normalize(v1));
  });

  it('v2 envelope matches v1 for JSON value', async () => {
    const input = { meshId: 'test-mesh', key: 'deploy_freeze', value: { until: '2026-04-15' } };
    const v1 = await captureV1Envelope('set_state', input);
    const v2 = await captureV2Envelope('set_state', input);
    expect(normalize(v2)).toEqual(normalize(v1));
  });

  it('v2 envelope matches v1 for null value (deletion)', async () => {
    const input = { meshId: 'test-mesh', key: 'tmp', value: null };
    const v1 = await captureV1Envelope('set_state', input);
    const v2 = await captureV2Envelope('set_state', input);
    expect(normalize(v2)).toEqual(normalize(v1));
  });
});
```

### 4.2 The `normalize()` helper

Strips fields that are legitimately non-deterministic between v1 and v2:

- `nonce` — random per envelope
- `timestamp` — wall clock
- `messageId` — random UUID
- `_reqId` — random correlation ID
- `ciphertext` — depends on nonce + random keypair; instead of comparing ciphertext directly, both envelopes are decrypted and the plaintext is compared

Everything else (message type, meshId, priority, sender pubkey, recipient, flags) must match byte-for-byte.

### 4.3 Full contract test manifest (85 tests)

Every WS message type from inventory §3 gets a file:

| Family | WS messages | Test files |
|---|---|---|
| Lifecycle | `hello`, `hello_ack`, `get_clock` | 3 |
| Messaging | `send`, `peer_dir_request`, `peer_dir_response`, `peer_file_request`, `peer_file_response` | 5 |
| Profile | `set_status`, `set_summary`, `set_visible`, `set_profile`, `set_stats` | 5 |
| Groups | `join_group`, `leave_group` | 2 |
| State | `set_state`, `get_state`, `list_state` | 3 |
| Memory | `remember`, `recall`, `forget` | 3 |
| Files | `get_file`, `list_files`, `file_status`, `grant_file_access`, `delete_file` | 5 |
| Vectors | `vector_store`, `vector_search`, `vector_delete`, `list_collections` | 4 |
| Graph | `graph_query`, `graph_execute` | 2 |
| SQL | `mesh_query`, `mesh_execute`, `mesh_schema` | 3 |
| Streams | `create_stream`, `publish`, `subscribe`, `unsubscribe`, `list_streams` | 5 |
| Contexts | `share_context`, `get_context`, `list_contexts` | 3 |
| Tasks | `create_task`, `claim_task`, `complete_task`, `list_tasks` | 4 |
| Scheduling | `schedule`, `list_scheduled`, `cancel_scheduled` | 3 |
| Metadata | `mesh_info`, `list_peers`, `message_status` | 3 |
| Clock | `set_clock`, `pause_clock`, `resume_clock`, `get_clock` | 4 |
| Skills | `share_skill`, `get_skill`, `list_skills`, `remove_skill`, `skill_deploy` | 5 |
| MCP registry | `mcp_register`, `mcp_unregister`, `mcp_list`, `mcp_call`, `mcp_call_response`, `mcp_deploy`, `mcp_undeploy`, `mcp_update`, `mcp_logs`, `mcp_scope`, `mcp_schema`, `mcp_catalog` | 12 |
| Vault | `vault_set`, `vault_get`, `vault_list`, `vault_delete` | 4 |
| URL watch | `watch`, `unwatch`, `watch_list` | 3 |
| Webhooks | `create_webhook`, `list_webhooks`, `delete_webhook` | 3 |
| Audit | `audit_query`, `audit_verify` | 2 |

**Contract layer total: ~85 test files.**

This layer is the load-bearing proof that v2's WS client speaks the broker's v1 protocol unchanged. If any of these tests fail, v1 users running v2 against production brokers will experience silent misbehavior.

---

## 5. Layer 3 — MCP tool handler tests

One test file per MCP tool from inventory §2 (79 tools). Each file:

1. Invokes the tool through v2's MCP server with a fixture input
2. Captures the WS message v2 sends to the broker
3. Captures the same request through v1's MCP server
4. Asserts both produce identical WS envelopes and identical return values

File layout mirrors v2's `src/mcp/tools/`:

```
apps/cli-v2/tests/mcp-tools/
├── memory/
│   ├── remember.test.ts
│   ├── recall.test.ts
│   └── forget.test.ts
├── state/
│   ├── set-state.test.ts
│   ├── get-state.test.ts
│   └── list-state.test.ts
├── messaging/
│   ├── send-message.test.ts
│   ├── list-peers.test.ts
│   ├── check-messages.test.ts
│   └── message-status.test.ts
├── profile/
│   ├── set-profile.test.ts
│   ├── set-status.test.ts
│   ├── set-summary.test.ts
│   └── set-visible.test.ts
├── groups/
│   ├── join-group.test.ts
│   └── leave-group.test.ts
├── files/
│   ├── share-file.test.ts
│   ├── get-file.test.ts
│   ├── list-files.test.ts
│   ├── file-status.test.ts
│   ├── delete-file.test.ts
│   ├── grant-file-access.test.ts
│   ├── read-peer-file.test.ts
│   └── list-peer-files.test.ts
├── vectors/
│   ├── vector-store.test.ts
│   ├── vector-search.test.ts
│   ├── vector-delete.test.ts
│   └── list-collections.test.ts
├── graph/
│   ├── graph-query.test.ts
│   └── graph-execute.test.ts
├── sql/
│   ├── mesh-query.test.ts
│   ├── mesh-execute.test.ts
│   └── mesh-schema.test.ts
├── streams/
│   ├── create-stream.test.ts
│   ├── publish.test.ts
│   ├── subscribe.test.ts
│   └── list-streams.test.ts
├── contexts/
│   ├── share-context.test.ts
│   ├── get-context.test.ts
│   └── list-contexts.test.ts
├── tasks/
│   ├── create-task.test.ts
│   ├── claim-task.test.ts
│   ├── complete-task.test.ts
│   └── list-tasks.test.ts
├── scheduling/
│   ├── schedule-reminder.test.ts
│   ├── list-scheduled.test.ts
│   └── cancel-scheduled.test.ts
├── metadata/
│   ├── mesh-info.test.ts
│   ├── mesh-stats.test.ts
│   ├── mesh-clock.test.ts
│   └── ping-mesh.test.ts
├── clock-write/
│   ├── mesh-set-clock.test.ts
│   ├── mesh-pause-clock.test.ts
│   └── mesh-resume-clock.test.ts
├── skills/
│   ├── share-skill.test.ts
│   ├── get-skill.test.ts
│   ├── list-skills.test.ts
│   ├── remove-skill.test.ts
│   └── mesh-skill-deploy.test.ts
├── mcp-registry-tier1/
│   ├── mesh-mcp-register.test.ts
│   ├── mesh-mcp-list.test.ts
│   ├── mesh-tool-call.test.ts
│   └── mesh-mcp-remove.test.ts
├── mcp-registry-tier2/
│   ├── mesh-mcp-deploy.test.ts
│   ├── mesh-mcp-undeploy.test.ts
│   ├── mesh-mcp-update.test.ts
│   ├── mesh-mcp-logs.test.ts
│   ├── mesh-mcp-scope.test.ts
│   ├── mesh-mcp-schema.test.ts
│   └── mesh-mcp-catalog.test.ts
├── vault/
│   ├── vault-set.test.ts
│   ├── vault-list.test.ts
│   └── vault-delete.test.ts
├── url-watch/
│   ├── mesh-watch.test.ts
│   ├── mesh-unwatch.test.ts
│   └── mesh-watches.test.ts
└── webhooks/
    ├── create-webhook.test.ts
    ├── list-webhooks.test.ts
    └── delete-webhook.test.ts
```

**MCP layer total: 79 test files.**

### 5.1 MCP handler test pattern

```ts
// tests/mcp-tools/memory/remember.test.ts
import { describe, it, expect } from 'bun:test';
import { v1McpServer, v2McpServer, mockBroker } from '@/tests/helpers';

describe('MCP tool: remember (parity)', () => {
  it('v1 and v2 produce identical WS envelopes', async () => {
    const input = {
      content: 'Payments API rate-limits at 100 req/s after March incident',
      tags: ['payments', 'rate-limit'],
    };

    const v1Sent = await v1McpServer.invokeAndCapture('remember', input);
    const v2Sent = await v2McpServer.invokeAndCapture('remember', input);

    expect(v2Sent).toEqual(v1Sent);
  });

  it('v1 and v2 return identical tool results', async () => {
    const input = { content: 'test memory', tags: [] };
    const v1Result = await v1McpServer.invoke('remember', input);
    const v2Result = await v2McpServer.invoke('remember', input);
    expect(v2Result).toEqual(v1Result);
  });

  it('v2 rejects invalid input via Zod with same error shape as v1', async () => {
    const invalidInput = { content: '', tags: 'not-an-array' };
    await expect(v2McpServer.invoke('remember', invalidInput)).rejects.toThrow();
  });
});
```

---

## 6. Layer 4 — End-to-end smoke tests

Full journey tests against a real broker in a Docker sandbox. Each test spins up:

1. A fresh Postgres + Neo4j + Qdrant + MinIO + broker stack (via `testcontainers`)
2. One or more v2 CLI instances as subprocesses
3. Optionally a Claude Code mock to simulate MCP client interactions

These are slower than layers 1–3 but catch integration bugs that unit-level parity tests miss.

File layout:

```
apps/cli-v2/tests/e2e/
├── first-run/
│   ├── install-and-join.test.ts
│   ├── fresh-mesh-create.test.ts
│   └── launch-with-mesh.test.ts
├── messaging/
│   ├── two-peer-send-receive.test.ts
│   ├── broadcast-to-group.test.ts
│   └── offline-queue-drain.test.ts
├── files/
│   ├── upload-download-small.test.ts
│   ├── upload-download-large.test.ts
│   └── e2e-encrypted-share.test.ts
├── state-and-memory/
│   ├── state-across-peers.test.ts
│   ├── memory-full-text-search.test.ts
│   └── context-share-and-query.test.ts
├── tasks/
│   ├── create-claim-complete.test.ts
│   └── list-by-status.test.ts
├── backends/
│   ├── shared-sql-roundtrip.test.ts
│   ├── neo4j-graph-roundtrip.test.ts
│   ├── qdrant-vector-roundtrip.test.ts
│   └── minio-file-roundtrip.test.ts
├── mcp-registry/
│   ├── deploy-catalog-entry.test.ts
│   ├── call-deployed-tool.test.ts
│   └── undeploy-cleanup.test.ts
├── telegram/
│   ├── connect-and-route.test.ts
│   └── disconnect-cleanup.test.ts
├── dashboard-sync/
│   └── browser-flow.test.ts
├── scheduled/
│   ├── cron-reminder-fires.test.ts
│   ├── url-watch-detects-change.test.ts
│   └── persist-across-restart.test.ts
├── webhooks/
│   └── inbound-post-becomes-message.test.ts
└── journey/
    ├── full-user-journey.test.ts         (install → join → send → file → logout)
    ├── connector-journey.test.ts         (deploy mcp → call tool → undeploy)
    └── skill-sharing-journey.test.ts     (share_skill → teammate loads → invoke)
```

**E2E layer total: ~28 test files.**

### 6.1 E2E test harness

Each e2e file uses a shared harness:

```ts
import { startFreshBroker, stopBroker, spawnCli } from '@/tests/helpers/e2e';

describe('e2e: two-peer send-receive', () => {
  let broker: BrokerHandle;
  let alice: CliHandle;
  let bob: CliHandle;

  beforeAll(async () => {
    broker = await startFreshBroker();
    alice = await spawnCli({ broker, displayName: 'Alice' });
    bob = await spawnCli({ broker, displayName: 'Bob' });
    await alice.join(broker.seedInvite);
    await bob.join(broker.seedInvite);
  });

  afterAll(async () => {
    await alice.shutdown();
    await bob.shutdown();
    await stopBroker(broker);
  });

  it('alice sends to bob; bob receives via inbox', async () => {
    await alice.send({ to: 'Bob', message: 'hello' });
    const inbox = await bob.inbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].plaintext).toBe('hello');
  });
});
```

### 6.2 Testcontainers vs local broker

Two modes, switchable via env var:

- `E2E_BROKER=docker` — spins up a fresh broker + all backends via `testcontainers`. Slow (~30s per test) but hermetic.
- `E2E_BROKER=local` — connects to a running local broker (`ic.claudemesh.com` or `localhost:8787`). Fast but requires manual setup.

CI uses `docker` mode. Dev iteration uses `local` mode.

---

## 7. Layer 5 — JSON output golden tests

`--json` output is the stable contract for script consumers. These tests lock the shape and fields.

File layout:

```
apps/cli-v2/tests/golden/
├── list-json.test.ts
├── peers-json.test.ts
├── info-json.test.ts
├── inbox-json.test.ts
├── state-get-json.test.ts
├── state-list-json.test.ts
├── remember-json.test.ts
├── recall-json.test.ts
├── remind-json.test.ts
├── profile-json.test.ts
├── mcp-info-json.test.ts
└── mcp-stats-json.test.ts
```

### 7.1 Golden test pattern

```ts
// tests/golden/list-json.test.ts
import { describe, it, expect } from 'bun:test';
import { runV2Cli } from '@/tests/helpers';
import { listJsonShape } from '@/tests/fixtures/golden/list.json';

describe('golden: claudemesh list --json', () => {
  it('output shape matches locked schema', async () => {
    const output = JSON.parse(await runV2Cli(['list', '--json']));
    expect(output).toMatchObject(listJsonShape);
  });

  it('includes schema_version field', async () => {
    const output = JSON.parse(await runV2Cli(['list', '--json']));
    expect(output.schema_version).toMatch(/^\d+\.\d+$/);
  });

  it('mesh entries have all v1 fields', async () => {
    const output = JSON.parse(await runV2Cli(['list', '--json']));
    for (const mesh of output.meshes) {
      expect(mesh).toHaveProperty('slug');
      expect(mesh).toHaveProperty('name');
      expect(mesh).toHaveProperty('kind');
      expect(mesh).toHaveProperty('brokerUrl');
      expect(mesh).toHaveProperty('memberCount');
    }
  });
});
```

Golden fixtures live in `tests/fixtures/golden/*.json` and are captured from v1 CLI runs the first time the test is written, then locked.

**Golden layer total: ~12 test files.**

---

## 8. Layer 6 — Facade unit tests

Per-service colocated tests that verify the facade contract:

- Every facade function validates input with Zod
- Every output type passes the boundary scanner (no `token`, `api_key`, `password`, path-like patterns)
- Error mapping via `toDomainError` preserves cause + logs unmapped errors
- Never exposes class instances, DB connections, or raw HTTP responses

File layout (colocated with services):

```
apps/cli-v2/src/services/
├── auth/
│   └── facade.test.ts
├── mesh/
│   └── facade.test.ts
├── invite/
│   └── facade.test.ts
├── broker/
│   └── facade.test.ts
├── api/
│   └── facade.test.ts
├── crypto/
│   └── facade.test.ts
├── store/
│   └── facade.test.ts
├── config/
│   └── facade.test.ts
├── state/
│   └── facade.test.ts
├── device/
│   └── facade.test.ts
├── clipboard/
│   └── facade.test.ts
├── spawn/
│   └── facade.test.ts
├── telemetry/
│   └── facade.test.ts
├── health/
│   └── facade.test.ts
├── update/
│   └── facade.test.ts
├── i18n/
│   └── facade.test.ts
└── lifecycle/
    └── facade.test.ts
```

Plus one global test at `tests/unit/facade-boundary-scan.test.ts` that walks every facade and asserts no output type contains forbidden keys (AST-based via ts-morph, per facade-pattern spec §10.2).

**Facade layer total: ~17 facade-specific test files + 1 global scanner.**

### 8.1 Facade test pattern

```ts
// services/auth/facade.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as facade from './facade';
import { getAuthService } from './index';

vi.mock('./index');

describe('auth facade contract', () => {
  it('loginWithDeviceCode rejects leaked token in output', async () => {
    vi.mocked(getAuthService).mockReturnValue({
      startDeviceCodeFlow: vi.fn().mockResolvedValue({
        user: { id: 'u1', display_name: 'Alejandro', email: 'a@b.c' },
        token: 'cm_session_SECRET',
        raw_response: { headers: {} },
      }),
    } as any);

    const result = await facade.loginWithDeviceCode();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('cm_session_');
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('raw_response');
  });

  it('loginWithToken validates input with Zod', async () => {
    await expect(facade.loginWithToken({ token: 'malformed' })).rejects.toMatchObject({
      code: 'AUTH_INVALID_TOKEN',
    });
  });

  it('whoAmI never throws', async () => {
    vi.mocked(getAuthService).mockReturnValue({
      getCurrentState: vi.fn().mockRejectedValue(new Error('boom')),
    } as any);
    await expect(facade.whoAmI()).resolves.toBeDefined();
  });

  it('toDomainError logs unmapped errors', async () => {
    const logSpy = vi.fn();
    vi.mocked(getAuthService).mockReturnValue({
      logout: vi.fn().mockRejectedValue(new TypeError('null pointer')),
      logger: { error: logSpy },
    } as any);

    await facade.logout();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('unmapped error'),
      expect.any(Object),
    );
  });
});
```

---

## 9. Layer 7 — Port-forwarded v1 tests

v1's existing tests cover crypto primitives and broker correctness. They all apply to v2 as-is because:

- v2 uses the same crypto primitives (Ed25519, NaCl crypto_box, AES-GCM)
- v2 talks to the same broker, so broker tests run unchanged
- v2 parses the same invite formats

### 9.1 Tests to port forward

| v1 test | Forward-port path | Notes |
|---|---|---|
| `apps/cli/src/__tests__/crypto-roundtrip.test.ts` | `apps/cli-v2/tests/unit/crypto-roundtrip.test.ts` | Direct copy; uses shared crypto primitives |
| `apps/cli/src/__tests__/invite-parse.test.ts` | `apps/cli-v2/tests/unit/invite-parse.test.ts` | Direct copy; v2 parses same v1 + v2 invite formats |
| `apps/broker/tests/broker.test.ts` | N/A — stays in broker | Broker unchanged |
| `apps/broker/tests/invite-signature.test.ts` | N/A — stays in broker | Broker unchanged |
| `apps/broker/tests/invite-v2.test.ts` | N/A — stays in broker | Broker unchanged |
| `apps/broker/tests/hello-signature.test.ts` | N/A — stays in broker | Broker unchanged |
| `apps/broker/tests/rate-limit.test.ts` | N/A — stays in broker | Broker unchanged |
| `apps/broker/tests/encoding.test.ts` | N/A — stays in broker | Broker unchanged |
| `apps/broker/tests/dup-delivery.test.ts` | N/A — stays in broker | Broker unchanged |
| `apps/broker/tests/metrics.test.ts` | N/A — stays in broker | Broker unchanged |
| `apps/broker/tests/logging.test.ts` | N/A — stays in broker | Broker unchanged |
| `apps/broker/tests/integration/health.test.ts` | N/A — stays in broker | Broker unchanged |

**Port-forward layer: 2 CLI tests copied, ~10 broker tests remain in place.**

---

## 10. Test helper infrastructure

Shared helpers under `apps/cli-v2/tests/helpers/`:

### 10.1 `v1-runner.ts`

Spawns the v1 CLI as a subprocess and captures its output:

```ts
export async function runV1Cli(args: string[], opts?: RunOpts): Promise<CliResult>;
export async function v1Send(args: SendArgs): Promise<string>;  // returns messageId
export async function v1Join(inviteUrl: string): Promise<void>;
export async function v1Install(): Promise<void>;
// ... one helper per v1 command
```

Uses the installed `claudemesh` binary from `apps/cli/` (v1). Tests assume v1 is available at `../../cli/dist/index.js` or via `npx claudemesh@0.10.5`.

### 10.2 `v2-runner.ts`

Same interface, but spawns v2:

```ts
export async function runV2Cli(args: string[], opts?: RunOpts): Promise<CliResult>;
// ... matching v1 helper surface
```

Uses `apps/cli-v2/dist/entrypoints/cli.js`.

### 10.3 `wire-capture.ts`

Intercepts WS messages by routing both v1 and v2 CLIs through a test proxy that records envelopes:

```ts
export async function captureV1Envelope(op: string, input: any): Promise<WsEnvelope>;
export async function captureV2Envelope(op: string, input: any): Promise<WsEnvelope>;
export function normalize(env: WsEnvelope): WsEnvelope;
```

The proxy runs on a local port, the CLI's broker URL is set to `ws://localhost:<port>/ws`, and the proxy logs every message before forwarding to a real test broker.

### 10.4 `mock-broker.ts`

In-memory broker for unit tests. Implements enough of the WS protocol to test CLI-side behavior without a real database stack.

Handles:
- Hello + authentication (skipped signature check in test mode)
- Echo back `ack` for every client message
- In-memory state for state_kv, memory, tasks
- Configurable response fixtures for WS ops

### 10.5 `real-broker.ts` (for e2e)

Spins up a real broker + Postgres + Neo4j + Qdrant + MinIO stack via `testcontainers`:

```ts
export async function startFreshBroker(opts?: BrokerOpts): Promise<BrokerHandle>;
export async function stopBroker(handle: BrokerHandle): Promise<void>;
```

The stack is pre-configured with a seed mesh + fixture users + a known invite URL. Tests use these as starting state.

### 10.6 `temp-home.ts`

Creates an isolated `~/.claudemesh/` for each test:

```ts
export async function tempHome(fn: (homeDir: string) => Promise<void>): Promise<void>;
```

Cleans up on completion. Prevents tests from interfering with the developer's real claudemesh config.

### 10.7 `ink-render.ts`

Snapshots Ink screens for UI tests (per `cli-v2-ux-design.md` §12.1):

```ts
export async function renderScreen(Component: any, props?: any): Promise<string>;
export async function waitForText(frame: () => string, text: string, timeoutMs?: number): Promise<void>;
```

### 10.8 `sqlite-fixture.ts`

(Pass 1 only needs this if we add any local caching — most of Pass 1 won't touch SQLite since the local-first work is Pass 2.)

---

## 11. Shared fixtures

Under `apps/cli-v2/tests/fixtures/`:

```
fixtures/
├── auth/
│   ├── valid-session-token.json       # sample cm_session_... token
│   ├── valid-pat.json                 # sample cm_pat_... token
│   ├── expired-token.json
│   └── malformed-token.json
├── meshes/
│   ├── sample-personal-mesh.json
│   ├── sample-shared-mesh.json
│   └── sample-guest-mesh.json
├── invites/
│   ├── v1-invite-url.txt
│   ├── v2-invite-url.txt
│   ├── expired-invite-url.txt
│   └── malformed-invite-url.txt
├── wire/
│   ├── v1-envelopes/                  # captured v1 WS envelopes, one JSON file per op
│   │   ├── send.json
│   │   ├── set_state.json
│   │   ├── remember.json
│   │   └── ... (85 files)
│   └── broker-responses/              # captured v1 broker responses
│       ├── hello_ack.json
│       ├── peers_list.json
│       └── ...
├── golden/
│   ├── list-json.json                 # expected JSON output shape
│   ├── peers-json.json
│   ├── info-json.json
│   └── ... (12 files)
├── telegram/
│   ├── sample-bot-token.json
│   ├── sample-inbound-update.json     # Telegram webhook payload
│   └── expected-routed-message.json
└── mcp-tool-inputs/
    ├── memory-remember.json           # one fixture input per tool
    ├── memory-recall.json
    └── ... (79 files, one per tool)
```

Total fixture count: ~180 files. Most are small JSON snippets captured once from v1 runs and locked.

---

## 12. Execution order + dependencies

Tests run in parallel where possible, but some layers depend on others:

```
┌─────────────────────────────────────┐
│ Layer 7: port-forwarded v1 tests   │  ← no dependencies, runs first
│ Layer 6: facade unit tests          │  ← depends on v2 services existing
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│ Layer 2: WS contract tests          │  ← depends on wire fixtures captured
│ Layer 3: MCP tool handler tests     │  ← depends on v1 + v2 MCP servers
│ Layer 5: JSON golden tests          │  ← depends on v1 + v2 CLI built
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│ Layer 1: parity tests               │  ← depends on mock-broker + helpers
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│ Layer 4: e2e smoke tests            │  ← depends on real broker + testcontainers
└─────────────────────────────────────┘
```

Layers 1, 2, 3, 5, 6, 7 run on every PR. Layer 4 runs on `main` merges + release candidates (slower).

---

## 13. CI integration

### 13.1 PR-level pipeline

```yaml
jobs:
  lint-and-typecheck:
    - biome check
    - eslint (boundaries + 3 custom rules)
    - tsc --noEmit
    - dependency-cruiser

  unit-tests:
    - bun test tests/unit/                    # facade layer
    - bun test src/services/**/*.test.ts      # colocated facade tests
    - bun test tests/golden/                   # JSON shape

  parity-tests:
    - bun test tests/parity/
    needs: [v1-cli-available, v2-cli-built]

  contract-tests:
    - bun test tests/contract/
    needs: [wire-fixtures-available]

  mcp-tool-tests:
    - bun test tests/mcp-tools/

  port-forward-tests:
    - bun test tests/unit/crypto-roundtrip.test.ts
    - bun test tests/unit/invite-parse.test.ts
```

### 13.2 Release-candidate pipeline

Adds layer 4:

```yaml
jobs:
  e2e-docker:
    - E2E_BROKER=docker bun test tests/e2e/
    timeout-minutes: 60
```

### 13.3 Coverage gates

- Unit tests: ≥ 80% branch coverage on `src/services/**/*.ts` (excluding `services/broker/*`)
- Parity tests: 100% of inventory §12 checks mapped to at least one passing test
- Contract tests: 100% of 85 WS message types have at least one passing test
- MCP tool tests: 100% of 79 tools have at least one passing test
- E2E tests: all 28 journey tests passing on `main`

If any gate fails, the PR cannot merge.

---

## 14. Success criteria (the ship checklist)

v2 Pass 1 ships when ALL of these are green:

- [ ] **Layer 1 parity**: 70 test files, every inventory §12 regression check has at least one passing parity test
- [ ] **Layer 2 contract**: 85 test files, every broker WS message type has a contract test passing against captured v1 envelopes
- [ ] **Layer 3 MCP tools**: 79 test files, every MCP tool handler produces identical WS output between v1 and v2
- [ ] **Layer 4 e2e**: 28 journey tests pass against a real broker in Docker
- [ ] **Layer 5 golden**: 12 JSON output tests pass, `schema_version` field present and stable
- [ ] **Layer 6 facade**: 17 service facade test files pass + 1 global boundary scanner (AST-based, no false positives)
- [ ] **Layer 7 port-forward**: 2 forwarded v1 CLI tests pass + broker test suite unchanged and green
- [ ] **Coverage gates**: all thresholds met
- [ ] **Zero new regressions**: any previously-passing test that starts failing must be fixed before merge (no skipping, no `.todo`)

**Total test files in v2 Pass 1: ~295** (70 + 85 + 79 + 28 + 12 + 18 + 2).

That's a lot. Most are template-driven — one helper + one fixture + one pattern = many tests. The scaffolding pass creates the files with `NotImplementedError` stubs, and the implementation pass fills them in.

**No time estimate.** It's done when the checklist is green.

---

## 15. Scaffolding implications

When v2 is re-scaffolded, the test infrastructure ships alongside the source:

- `tests/helpers/` with `v1-runner`, `v2-runner`, `wire-capture`, `mock-broker`, `real-broker`, `temp-home`, `ink-render` as stubs with `NotImplementedError`
- `tests/fixtures/` with directory structure and placeholder JSON files
- Every test file in layers 1–6 scaffolded with its describe blocks, imports, and fixture references — but the body is `throw new NotImplementedError('<test name>')`
- A CI job that counts test files vs expected counts and fails if any are missing
- A script `tests/helpers/capture-v1-fixtures.ts` that runs v1 once against a test broker to generate the wire fixtures

The scaffold pass adds ~300 test files. The implementation pass replaces the `NotImplementedError` bodies with real assertions, one file at a time, driven by the priority order above.

The implementation pass is organized by test layer, not by feature:

1. Scaffold everything (layers 1–6) with stubs
2. Implement layer 7 (port-forwarded tests) — fastest wins, establishes test harness
3. Implement layer 6 (facade units) — validates each service as it's written
4. Implement layer 5 (golden JSON) — locks output shapes early
5. Implement layer 2 (WS contract) — proves wire compatibility
6. Implement layer 3 (MCP tool handlers) — proves tool dispatch
7. Implement layer 1 (parity) — full behavioral equivalence
8. Implement layer 4 (e2e) — end-to-end sanity

When layer 1 is fully green, v2 Pass 1 is shippable.

---

## 16. What this plan does NOT cover

Explicitly out of scope for Pass 1 testing:

- **Broker-side tests** — broker is unchanged in Pass 1; broker's own test suite runs unchanged
- **Performance regression tests** — v2 shouldn't be slower than v1, but quantifying that is Pass 2 work with bench tests
- **Security audit** — the spec-level security improvements (role-per-mesh Postgres, egress proxies, SSRF policies) are Pass 2
- **Accessibility audit** — the testable a11y matrix is Pass 2 (requires the VoiceOver shim which is Pass 2)
- **Load tests** — 10k concurrent peers, sustained message throughput — deferred
- **Chaos tests** — broker restart mid-operation, network partition recovery — deferred to local-first Pass 2
- **Cross-platform tests on Windows** — v2 Pass 1 targets macOS + Linux; Windows support is best-effort, tested on release candidates only

Pass 2 adds those layers when the corresponding features ship.

---

**End of plan.**
