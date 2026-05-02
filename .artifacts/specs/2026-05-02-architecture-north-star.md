---
title: claudemesh North Star — CLI-first with claude/channel push-pipe
status: canonical
target: 2.0.0
author: Alejandro
date: 2026-05-02
supersedes: none
references:
  - 2026-05-01-mcp-tool-surface-trim.md (first cut at the trim)
  - SPEC.md
  - docs/protocol.md
---

# claudemesh North Star

## The commitment, in one sentence

> **CLI is the canonical surface for every claudemesh operation. MCP exists for one thing: to deliver `claude/channel` push notifications mid-turn. That's the killer feature, and it's the only reason an MCP server runs at all.**

Everything else — sending messages, listing peers, sharing files, deploying mesh-MCPs, running graph queries, scheduling jobs, publishing skills — is invoked from the CLI, by humans, scripts, cron, hooks, or by Claude itself via Bash.

## Why this shape

1. **Mid-turn interrupt is the differentiator.** When peer A sends to peer B, B's Claude session pauses what it's doing and reads the message immediately. That requires `claude/channel` notifications routed through an MCP transport — Claude Code only watches MCP server connections for those events. **Lose that, and claudemesh becomes another inbox-polling pattern.** Every other primitive can degrade to "delivered at next tool boundary"; this one cannot.

2. **CLI is universal.** Bash works in scripts, hooks, cron, CI, terminals, automation, and Claude itself (via Bash tool calls). A primitive that exists as both an MCP tool and a CLI verb is double-maintenance with one calling convention nobody actually wants.

3. **JSON-on-stdout is enough structure.** Claude reads `claudemesh peers --json` exactly as well as it reads a typed MCP tool return. The CLI man page is the schema. The "MCP gives structured I/O" advantage was real when we were paying for nothing else, but warm-WS via socket bridge (below) closes the cost gap.

4. **Surface shrinks where it matters.** ToolSearch deferred-tool list drops from ~80 entries to ~0 entries (push-pipe registers no tools). Massive context-budget win for every Claude session.

## Prior art (this is not novel architecture)

The "live-state daemon + thin scriptable CLI talking via Unix socket" pattern is the canonical shape for CLIs in this category. Reviewers should not treat this as bespoke design:

- **Docker** — `dockerd` daemon, CLI talks via `/var/run/docker.sock`. `DOCKER_HOST` env override. `docker context` for multi-daemon switching.
- **Tailscale** — `tailscaled` daemon, `tailscale` CLI via socket. Per-key ACL identity model. Same peer-mesh-with-keypairs shape as claudemesh.
- **Stripe `listen`** — long-running CLI daemon receives webhook push, forwards to local consumer. Same push-pipe-as-CLI-subcommand shape.
- **Obsidian CLI** — talks to a running Obsidian instance via REST. **Notable: ships a Claude skill (`~/.claude/skills/obsidian-cli/SKILL.md`) that documents every verb and flag for Claude consumption — replacing MCP tool introspection entirely.**

Claudemesh's CLI-first + push-pipe + socket-bridge architecture is exactly this pattern. We are following the well-trodden path, not inventing a new one.

## The six architectural commitments

### 1. **MCP server is a push-pipe, full stop.**

The MCP entrypoint (`claudemesh mcp [--mesh <slug>]`) does exactly three things:
- Holds a WS connection to the broker for the meshes it's bound to.
- Decrypts inbound peer messages.
- Emits them as `claude/channel` notifications to the parent Claude Code session.

It registers **zero tools**. It advertises only `experimental: { "claude/channel": {} }`. Its `tools/list` returns an empty array. There is no surface to discover, search, or call.

One push-pipe per joined mesh, registered in `~/.claude.json` via `claudemesh install` (or auto-injected by `claudemesh launch`). The `--mesh` flag (shipped 1.0.3) makes this trivial.

### 2. **CLI is the canonical surface for every primitive.**

Every resource has uniform CLI verbs:

| Resource | Verbs |
|---|---|
| peer | `claudemesh peers [--json] [--mesh X]` |
| group | `claudemesh group join/leave @<n> [--role X]` |
| message | `claudemesh send <to> <msg>`, `claudemesh inbox`, `claudemesh msg-status <id>` |
| state | `claudemesh state get/set/list [--json]` |
| memory | `claudemesh remember/recall/forget` |
| task | `claudemesh task create/claim/complete/list` |
| file | `claudemesh file put/get/list/grant/delete` |
| vector | `claudemesh vector store/search/delete` |
| graph | `claudemesh graph query/execute/watch` |
| stream | `claudemesh stream create/publish/subscribe/list` |
| context | `claudemesh context share/get/list` |
| skill | `claudemesh skill publish/list/get/remove` |
| schedule | `claudemesh schedule msg/webhook/tool/list/cancel` |
| webhook | `claudemesh webhook create/list/delete` |
| watch | `claudemesh watch create/list/unwatch` |
| mcp | `claudemesh mesh-mcp deploy/list/call/undeploy/catalog` |
| clock | `claudemesh clock get/set/pause/resume` |
| sql | `claudemesh sql query/schema/execute` |
| vault | `claudemesh vault set/get/list/delete` |
| profile | `claudemesh profile/summary/visible/status set` |

**Every verb supports `--json`** for structured consumption. **Every verb supports `--mesh <slug>`** for targeting (default: pick first or interactive picker). Verbs share one broker-call implementation — no duplication between CLI and MCP.

### 3. **Warm path via Unix socket bridge** (load-bearing for 2.0).

A push-pipe holds a live WS connection. CLI invocations should reuse that connection rather than opening their own (which costs ~300-500ms cold-start).

Mechanism:
- On startup, push-pipe creates `~/.claudemesh/sockets/<mesh-slug>.sock` (Unix domain socket, mode 0600).
- CLI verbs that need broker round-trip first try to dial that socket.
- If alive: forward request, get response back over socket (~5ms).
- If absent / stale: open ephemeral WS, do the op, close (~300ms — fine for cron/scripts where there's no parent push-pipe).

Push-pipe owns one WS, all ops through that WS, broker sees ONE session per mesh per host (no duplicate hellos). On crash, socket file is unlinked by `unlink` on exit handler; stale-socket detection by `connect()` ECONNREFUSED.

This is **mandatory for 2.0** — without it, every CLI op pays cold-start, and CLI-first becomes unusably slow for tight loops.

### 4. **JSON output is the schema, with field selection and streaming.**

Every CLI verb has a deterministic `--json` output shape, documented in `docs/cli-schemas.md`, validated by zod parsers in tests. Claude reads `claudemesh vector search "x" --json` and gets a typed-array shape it can reason over identically to a tool return.

**Three output modes, mandatory across every read-shaped verb** (modeled on `gh` and `gemini`):

- `--json` — full record, all fields
- `--json <fields>` — field-selected projection (e.g. `claudemesh peers --json name,pubkey,status`)
- `--output-format stream-json` — incremental JSONL for long-running ops (mesh-MCP calls fanning across peers, `vector search` against large indexes, `schedule list` with many entries). One object per line, Claude consumes incrementally.

Plus convenience output:
- `--jq <expr>` — native jq filter pipeline
- `--template '{{.field}}'` — Go template formatting

`schema_version: "1.0"` field on every JSON output — mandatory. Bumps when shape changes. Old code paths can pin with `--schema-version=1.0`.

### 5. **All features stay. Nothing is removed.**

This is **not a feature trim**. Every primitive in the current 80-tool surface gets a CLI verb. Vectors, graphs, mesh-MCP, files, vault, SQL — all of it. The user-facing pitch is unchanged: "claudemesh gives your Claude session a name, a network, shared memory, shared compute, shared skills, scheduled actions." The change is *how you call it*.

### 6. **The Claude skill IS the schema.** *(load-bearing for CLI-first to work)*

Stripping MCP tool introspection (`tools/list`) costs Claude its discoverability. The replacement: a packaged `claudemesh` skill at `~/.claude/skills/claudemesh/SKILL.md` written by `claudemesh install`, documenting every verb, flag, JSON shape, and gotcha. Claude reads it on demand via the Skill tool — **not on every session, not pre-loaded into deferred-tool-list**. This is exactly how `obsidian-cli` works today and it works perfectly.

The skill replaces three things at once:
- **Tool discovery** — Claude knows the verb-set after one Skill invocation. No `tools/list` needed.
- **Output schemas** — every JSON shape is documented in the skill, so Claude knows what to expect from `--json` without parsing TypeScript types at runtime.
- **Behavioral conventions** — the skill teaches "preview before delete," "confirm peer match before kick," "use `--mesh` for cross-mesh ops" — soft guardrails that complement the policy engine's hard rules.

Topic-shards for size: `claudemesh` (core), `claudemesh-platform` (vault/vectors/graph/sql/mesh-mcp), `claudemesh-schedule` (cron/webhooks/watches), `claudemesh-admin` (kick/ban/grants/install). Each shard is independently loadable.

**This is the answer to the "JSON-on-stdout is a worse schema" caveat.** It's not — when Claude has a documented skill to load, the CLI surface is *more* discoverable than 80 deferred MCP tools that bloat ToolSearch silently.

### 7. **Pluggable policy engine, not binary `--yes`.** *(answers the Bash-blast-radius caveat)*

Modeled on `gemini --policy / --admin-policy` and `codex --sandbox`. Replace the current binary `-y/--yes` with:

- **`--approval-mode plan|read-only|write|yolo`** — four levels (read-only blocks all writes, plan blocks all side effects, write prompts on dangerous verbs, yolo skips all confirmation).
- **`--policy <file>`** — YAML allow/deny rules per resource × verb × peer. Sample:

```yaml
# ~/.claudemesh/policy.yaml
default: prompt
rules:
  - resource: send
    verb: "*"
    decision: allow
  - resource: sql
    verb: execute
    decision: prompt
  - resource: file
    verb: delete
    decision: deny
  - resource: mesh-mcp
    verb: call
    peers: ["@trusted"]
    decision: allow
```

Policy decisions log to a tamper-evident audit file. Org admin can ship `--admin-policy` that overrides user config. **This is the real answer to "Bash carries unrestricted blast-radius once allowed" — claudemesh's own policy engine kicks in before the broker call, regardless of what shell permissions are.**

## What this means for `claude/channel`

When peer A's CLI runs `claudemesh send peer-B "hello"`:

1. CLI dials `~/.claudemesh/sockets/<mesh>.sock` (warm path) or opens its own WS (cold).
2. Encrypts message with peer-B's pubkey via crypto_box.
3. Broker receives `send` envelope, forwards encrypted blob to peer-B's connected push-pipe.
4. Peer-B's push-pipe decrypts and emits a `claude/channel` notification.
5. Claude Code mid-turn-injects the message as a `<channel source="claudemesh" ...>` reminder.
6. Claude responds immediately per the system prompt convention.

Step 5 is the **only step that requires MCP**. Steps 1-4 are pure CLI + broker. The architecture is "CLI for everything, MCP for the one thing it's irreplaceable for."

## Migration path from 1.1.0

| Version | Ships | Behavior |
|---|---|---|
| **1.2.0** | Unix socket bridge. CLI verbs auto-detect push-pipe and use warm path. **Field-selectable JSON (`--json a,b,c`)** + `--jq` + `--template` adopted. | All existing MCP tools still work. Nothing breaks. |
| **1.2.1** | Ships `~/.claude/skills/claudemesh/SKILL.md` written by `claudemesh install`. Includes full verb reference + output schemas + gotchas. Topic-shards (`-platform`, `-schedule`, `-admin`). | Skill auto-installs on `claudemesh install`. |
| **1.3.0** | Schedule unification (`schedule msg/webhook/tool`). All remaining missing CLI verbs (file, vector, graph, mesh-mcp, vault, sql, stream, context, skill, watch). **`--output-format stream-json`** for long-running ops. | All existing MCP tools still work. New verbs additive. |
| **1.4.0** | Resource-model rename pass — every CLI verb is `<resource> <verb>`. Old verbs become aliases. | All existing MCP tools still work. Old CLI verbs aliased forever. |
| **1.5.0** | **Pluggable policy engine** (`--approval-mode`, `--policy`, `--admin-policy`). MCP `tools/list` shrinks to configurable allowlist (default: empty). `CLAUDEMESH_MCP_FAT=1` for users who need typed tool surface. | Default 1.5 install: MCP exposes zero tools. Push-pipe-only. Policy engine gates all writes. |
| **2.0.0** | MCP server hardcoded to push-pipe-only. Strip all tool registrations + handlers. | **Old MCP tool calls return tool-not-found.** Users must update scripts to CLI verbs. Old CLI verbs (1.4 aliases) still work. |

## What stays exactly the same

- Crypto: ed25519 sign + x25519 sealing + crypto_box for DMs. No change.
- Broker protocol: WS frame format, hello flow, audit log. No change.
- Membership / mesh-scope / capability grants. No change.
- Web app, dashboard, Telegram bridge, OAuth. No change.
- The platform vision (vault, vectors, graph, files, skills, mesh-MCPs, scheduled jobs). All shipped, all stay.

## What changes for users

- `~/.claude.json` simplifies: `"claudemesh": { "command": "claudemesh", "args": ["mcp"] }` becomes one entry per joined mesh after `claudemesh install`. Multi-mesh push works out of the box.
- ToolSearch loses ~80 deferred entries. Sessions are lighter.
- Scripts that called `mcp__claudemesh__*` get a deprecation warning in 1.x, break in 2.0 — replaced by `claudemesh <verb> --json` + `jq`.
- Claude Code system prompt for the MCP server gets shorter (no tool catalog), focused only on "RESPOND IMMEDIATELY to channel events."

## Open questions parked for future specs

- **Federation** — broker-to-broker encrypted relay so peers on different brokers can talk. Not in 2.0 scope.
- **Offline-with-TTL inbox** — persist `now` priority messages on broker if recipient is offline, with explicit TTL. Reasonable for 2.x.
- **Compute attribution** — when peer X invokes a mesh-MCP that peer Y deployed, who pays for broker compute / outbound calls? Pre-empts the eventual billing question. 2.x.
- **Universal hash-chained audit** — every state mutation per mesh is hash-chained, replayable, verifiable. Today only some events are; making it universal is its own spec.
- **ACP (Agent Communication Protocol) interop with Gemini CLI.** Gemini CLI exposes `--acp` for agent-to-agent comms — the same problem domain claudemesh occupies. Research question: is ACP a documented standard claudemesh can speak (making claudemesh peers and Gemini peers cross-talk in the same mesh), or is it Google-proprietary? If standard, implementing it is a major platform expansion. File as separate research spec before 2.x.

## What this spec is NOT

- Not a redesign of the broker. The broker stays as-is.
- Not a redesign of crypto. Crypto stays as-is.
- Not a feature deprecation. Every feature stays.
- Not optional. This is the canonical 2.0 architecture; intermediate versions migrate toward it.

## Effort estimate to 2.0

Sequential, single dev (revised after caveats survey — original estimate was rosy):

- **1.2.0** (socket bridge + field-JSON): 1-2 weeks. Socket bridge is real distributed-systems work (stale-cleanup, version negotiation, NFS/Windows edge cases) — not 2-3 days.
- **1.2.1** (claudemesh skill + topic shards): 2-3 days. Mostly content writing once schemas are documented.
- **1.3.0** (schedule unification + remaining verbs + stream-json): 1 week. Each of the ~10 missing verbs is small but adds up.
- **1.4.0** (resource-model rename + alias compat): 2-3 days.
- **1.5.0** (policy engine + MCP allowlist): 4-5 days. Policy engine is its own subsystem — parser, evaluator, audit log, admin override.
- **2.0.0** (strip tool handlers + cutover): 2 days.

Total: **~5-6 weeks of focused work** spread over 3-4 months calendar. Each release is independently shippable; the policy engine specifically can land later than 1.5 if needed.

## Acceptance signals — how we know it worked

- **ToolSearch** in a freshly-installed claudemesh session shows zero `mcp__claudemesh__*` entries by default (vs ~80 today).
- **`claudemesh peers --json name,status`** projects exactly two fields, no extra noise.
- **`claudemesh send <peer> "hi"`** from a Bash call inside a Claude session round-trips in <50ms (warm path via socket bridge) on localhost-broker, <250ms on EU-from-US.
- **`Skill: claudemesh`** loaded once teaches Claude the entire mesh surface; subsequent CLI calls require no further introspection.
- **A policy file with `decision: deny` for `file delete`** blocks the call before it hits the broker, with a clear stderr explanation.
- **`claudemesh status set working` from cron** opens its own WS (no daemon), succeeds in <1s, no orphan connections on broker.
