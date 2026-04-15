# claudemesh-cli v2 Pass 2 — Final Vision

> ⚠️ **This document describes v2 Pass 2 — the longer-term vision, NOT the immediate Pass 1 scope.**
>
> For the v2 Pass 1 implementation target, see **`2026-04-11-cli-v2-pass1.md`**.
>
> Pass 1 is narrower: refactor folder structure + add CLI user flows + preserve every v1 behavior + keep broker unchanged. No local-first storage, no Lamport algorithm, no broker security rewrites, no MCP catalog tiering.
>
> This document is retained as reference for future Pass 2 work.

**Status:** Pass 2 future reference — NOT the Pass 1 implementation target
**Created:** 2026-04-10
**Consolidated:** 2026-04-10 (post-reviews, all amendments merged into body, no appendices)
**Target version:** v1.0.0 (promoted from v0.11.x after beta)
**Supersedes / absorbs:** `2026-04-10-cli-auth-device-code-pat.md`, `2026-04-10-cli-wizard-architecture-refactor.md`

**Companion specs (authoritative on their concerns; this spec defers to them):**
- `2026-04-10-cli-v2-ux-design.md` — voice, tone, microcopy, picker rules, accessibility, delight beats
- `2026-04-10-cli-v2-local-first-storage.md` — SQLite schema, lamport algorithm, sync protocol, single-writer queue
- `2026-04-10-cli-v2-facade-pattern.md` — UI↔services boundary enforcement
- `2026-04-10-cli-v2-shared-infrastructure.md` — broker-backed services: Postgres, Neo4j, Qdrant, MinIO, MCP registry, vault, URL watch

**Related:** `2026-04-10-anthropic-vision-meshes-invites.md` (product vision)

## Reading order for new contributors

The v2 spec surface totals ~8,000 lines across 5 documents. A new developer should read in this order:

1. **This document (final-vision)** — start with §0 executive summary, §1 governing rule, §2 dream experiences, §3 architectural principles, §4 mesh state model, §6 source tree overview, §11 command surface, §16 implementation phases
2. **`cli-v2-ux-design.md`** — for every design question. Read §1–§6 fully (philosophy, rules, voice, first-run, session kinds, microcopy catalog)
3. **`cli-v2-local-first-storage.md`** — before implementing any tool that touches SQLite. §1–§7 are load-bearing (principles, runtime, file layout, Lamport algorithm, schema, vector model, memory recall)
4. **`cli-v2-facade-pattern.md`** — before writing any service or facade. §1–§9 (problem, principle, contract, import policy, examples, directory structure, ESLint config, type imports, dynamic imports, re-exports)
5. **`cli-v2-shared-infrastructure.md`** — before implementing any broker-backed tool. §1 hybrid architecture + §3 RBAC + the specific section for the feature being implemented (§4 Postgres, §5 Neo4j, §6 Qdrant, §7 MinIO, §8–§9 MCP registry, §10 vault, §11 URL watch, §12 default catalog)

**Conflict resolution** between documents: this final-vision document is authoritative for architectural questions. When two documents disagree, the companion spec wins for its own domain (UX questions → ux-design, storage questions → local-first-storage, boundary questions → facade-pattern, broker questions → shared-infrastructure).

---

## 0. Executive summary

claudemesh-cli v2 is a ground-up rewrite of `apps/cli/` that delivers a **zero-friction, local-first-for-personal, broker-backed-for-shared, Apple-grade terminal experience** for spawning Claude Code sessions into a peer mesh. It ships as a sibling `apps/cli-v2/` scaffolded against v0.10.5 as reference, atomically swapped in once complete, and published to npm as `claudemesh-cli@1.0.0`.

The rewrite is justified by four converging needs that cannot be satisfied by incremental refactoring of v1:

1. **UX debt** — 27 subcommands with imperative branching, overloaded flags, and terminal-state bleed on wizard→claude handoff
2. **Architecture debt** — business logic scattered between commands and runtime, no enforced dependency boundaries, no facade pattern isolating UI from effectful services
3. **Missing capabilities** — no CLI auth (all account actions require the web), no local-first storage (broker is in the critical path for per-peer data), no dependency-injected services layer that would make testing tractable
4. **Visual inconsistency** — no central palette, no shared layout primitives, no status row pattern, ad-hoc colors per screen

The v2 rewrite addresses all four in one coordinated pass. Features that work in v1 are preserved — v2 is a **restructuring**, not a feature cut. Everything the marketing page promises today ships in v1.0.0.

---

## 1. The governing rule

> **A first-time user runs `claudemesh`, clicks Approve in a browser once, and is inside Claude Code with a working mesh. A returning user runs `claudemesh` and the terminal becomes Claude Code. Everything else in this document is a consequence of that rule.**

Every feature, every screen, every command, every error message gets held up against this sentence. If it introduces a step that isn't strictly necessary to satisfy the rule, it doesn't ship in v1.0.

---

## 2. The dream experiences (verbatim, tested end to end)

These scenarios are the acceptance test for the governing rule. Each is locked copy reviewed by design before shipping.

### 2.1 First run, fresh machine (brand new user)

```
$ claudemesh

  claudemesh
  Peer mesh for Claude Code sessions.

  Creating your mesh…

  ✔ Signed in as Alejandro
  ✔ Your mesh "alejandro-mbp" is ready

  You're in.

  Opening Claude Code…
```

**Elapsed wall time target:** < 8 seconds including browser round-trip.
**Questions asked of the user:** 1 (Approve button in browser).
**Keystrokes in terminal:** 0.
**Decisions made silently:** mesh name (hostname), display name (account name), role (member), broker URL (default), claude args (none), template (solo).

### 2.2 Daily use, returning machine

```
$ claudemesh
[terminal becomes Claude Code, instantly]
```

**Elapsed wall time target:** < 400ms of CLI overhead before handoff.
**Frames rendered:** 0 (no wizard, no welcome, no banner).
**State consulted:** `~/.claudemesh/state.json` for last-used mesh, name, role.

### 2.3 Teammate sends an invite

Terminal 1 (Alice):
```
$ claudemesh invite bob@example.com

  ✔ Sent to bob@example.com.
  ✔ Also copied to clipboard.
```

Terminal 2 (Bob, with the link in clipboard):
```
$ claudemesh

  Detected invite in clipboard.
▸ Join "alice-team"
  Continue to "bob-mbp"
```

Bob hits Enter. Claude Code launches in `alice-team`. Total keystrokes: one `claudemesh`, one Enter.

### 2.4 Starting a new mesh for a team

```
$ claudemesh new

  Name? Platform team

  ✔ Created "platform-team".
  ✔ You're in.

  Invite teammates: claudemesh invite
```

One prompt (name). Slug auto-derived. Template = team (if flag given) or solo (default). `claudemesh invite` afterwards takes zero arguments — defaults to current mesh, 7-day expiry, unlimited uses, clipboard + optional email.

### 2.5 Broker goes down mid-session

Claude Code is running in a shared mesh. Broker drops. The status line (Claude Code's bottom bar) transitions from green `◉` to yellow `◉` (reconnecting), then gray `◎` (offline). No modal. No interruption. Messages queue locally.

When the broker returns:
```
◉ Reconnected.
```
One word, one line, auto-dismissed after 2 seconds. Peer count is visible in the persistent status line, not repeated in the notification.

### 2.6 Token expired

```
$ claudemesh peers

  Your sign-in expired. Refreshing in browser…
  ⠋

  alice      idle       working on auth spec
  bob        working    launching CI builds
```

Re-auth is invisible recovery, not a user task. The user typed `claudemesh peers` and got peers — the refresh happened silently. The status line appears only because the refresh takes longer than 200ms (see rule: no spinners under 200ms).

### 2.7 Power user, fully scripted

```bash
#!/usr/bin/env bash
# CI pipeline
export CLAUDEMESH_TOKEN="$CI_PAT"
claudemesh new "ci-run-$GITHUB_RUN_ID" --template ci --json > mesh.json
claudemesh launch --mesh "ci-run-$GITHUB_RUN_ID" -- --print "Analyze this PR" < diff.txt
```

Non-interactive. No prompts. Exits with clear status codes. `--json` produces parseable output. PAT resolved from environment variable. Clean fail-fast if required flags are missing.

### 2.8 First-run failure modes (catalog)

Every failure mode produces a specific Anthropic-voice error message. Full taxonomy in the UX spec §6.

| Scenario | Message |
|---|---|
| Browser won't open | "Open this URL to sign in: https://... (we couldn't open it automatically)" |
| Browser opens but user closes it | After 10 min: "Sign-in timed out. Run `claudemesh` to try again." |
| User denies in browser | "Sign-in canceled. Run `claudemesh` to try again." |
| No network | "Can't reach claudemesh.com. Check your connection and try again." |
| claudemesh.com is down | "The dashboard is reachable but the mesh broker isn't. Retrying in 10s…" |
| Broker up, mesh creation fails | "Your account is set up, but mesh creation failed. Run `claudemesh new` to retry." |
| Claude binary missing | "Claude Code isn't installed. Install it from https://claude.ai/code and run `claudemesh` again." |

---

## 3. Architectural principles

These are inviolable. Every PR, every screen, every refactor checks against them. Violation = revision.

### 3.1 The governing rule (restated as architectural constraint)

Design every code path to minimize distance from the governing rule. If a new feature adds a screen, a flag, or a confirmation beat on the happy path, it doesn't ship in v1.

### 3.2 Hybrid architecture: local-first for personal data, broker-backed for shared data

The v2 architecture is **hybrid**, not pure local-first:

- **Local-first (SQLite)** is source of truth for per-peer data: memory, state, personal files, task claims, profile, display name, last-used cache. These tools work fully offline. See `cli-v2-local-first-storage.md` for the complete schema and sync protocol.
- **Broker-backed** is source of truth for shared-mesh data: SQL tables (Postgres schema-per-mesh), graph (Neo4j database-per-mesh), vector search (Qdrant collection-per-mesh), large files (MinIO bucket-per-mesh), deployed MCP servers (Docker-sandboxed on broker VPS), vault credentials, URL watches. See `cli-v2-shared-infrastructure.md` for isolation models, RBAC, resource limits, and the default MCP catalog.

The rule for deciding which side owns a feature:

> **If a feature requires reading another peer's data in real time, it's broker-backed. If it only needs your own data, it's local-first.**

This is what v1 already does. v2 makes it explicit in the spec.

### 3.2.1 Aggregate tool consistency model

Some tools aggregate data from both sides: `mesh_info`, `mesh_stats`, `list_peers`, `peers` command output. These are explicitly annotated with their **staleness guarantees** and **consistency mode**:

| Tool | Local data | Broker data | Consistency model | Staleness signal |
|---|---|---|---|---|
| `mesh_info` | slug, name, kind, peer_count (cached), role | broker_url, schema_version, feature flags | Eventually consistent; local cache refreshed on broker connect | `last_synced_at` timestamp in response |
| `mesh_stats` | local tool call counts, outbox/inbox lag | broker-side peer count, storage sizes, deployed MCP count | Read-through: broker query if online, cached if offline | `fresh: true/false` flag; cache TTL 60s |
| `list_peers` | peer cache from last broker update | (none — always uses cache) | Snapshot consistent; marked stale after 5 min | `stale: true` if age > 5 min, also `last_seen_at` per peer |
| `peers` command | local peer cache | peers service query (live) | Live read: broker query with 5s timeout, fall back to cache on failure | Shows "(cached, N seconds ago)" suffix if stale |
| `mesh_clock` | local lamport counter | (none) | Honestly local; returns `sync_state: offline` if broker unreachable | `sync_state: synced/stale/offline` field |

**Key principles**:
- Aggregates NEVER silently merge local + broker data. Either the response is fully local (with staleness annotation) or a fresh broker read (with timeout + fallback).
- Every aggregate response includes a staleness signal the caller can check.
- When the broker is unreachable, aggregates degrade gracefully to local data with explicit `stale: true` flagging.
- "Source of truth" for aggregates is the local cache — updated from the broker opportunistically.

### 3.3 One-way dependency graph

Enforced by ESLint `boundaries` plugin + `dependency-cruiser` at CI. Full rules in the facade pattern spec.

```
entrypoints/   →  everything (top of the graph)
commands/      →  cli, ui, service-facade, utils, types, constants, locales
mcp/           →  service-facade, service-index, templates, utils, types, constants, locales
cli/           →  service-facade, utils, types, constants, locales     (non-Ink I/O plumbing)
ui/            →  service-facade, utils, types, constants, locales     (Ink rendering only)
services/*     →  services/*, templates, locales, utils, types, constants
templates/     →  utils, types, constants
locales/       →  types
utils/         →  types
constants/     →  (nothing)
types/         →  types only
migrations/    →  services/config, services/auth, types, utils
```

Two load-bearing constraints:

1. **`services/*` is the only layer that touches filesystem, network, crypto, or env.** Everything above it composes services. Everything below it is pure.
2. **UI and commands go through `services/<feature>/facade.ts`, never through internal service files.** Facades are narrow Zod-validated interfaces that hide implementation details. See `cli-v2-facade-pattern.md`.

### 3.4 Service composition via explicit dependency injection

Services compose at the **facade layer**, not through `index.ts`. A service that needs another service's functionality imports from `services/<other>/facade.ts`. The `index.ts` file is a thin factory barrel used only by `entrypoints/cli.ts` for DI wiring.

Service wiring happens in one place — `entrypoints/cli.ts` — and services receive their dependencies explicitly at construction time:

```ts
// entrypoints/cli.ts
const authService = createAuthService({
  tokenStore: createTokenStore({ path: config.authPath }),
  apiClient: createApiClient({ baseUrl: config.apiUrl }),
});
const meshService = createMeshService({
  authService,
  brokerClient: createBrokerClient({ wsUrl: config.brokerUrl }),
  db: sqliteDb,
});
const inviteService = createInviteService({ meshService, authService, apiClient });
```

**No service holds another as a module-level singleton.** `services/*/index.ts` exposes lazy getters (`getAuthService()`) backed by the injected instances. The top-level wiring in `entrypoints/cli.ts` is a linear script: dependencies are constructed in order, each later service receiving references to earlier ones.

**What this prevents**:
- **Module-level import cycles**: impossible because the top-level wiring imports from each service's `index.ts` once, and service factories only import types (not implementations) from other services.
- **Accidental singleton drift**: every service is explicitly constructed with its dependencies; no `require()`-style hidden singletons.

**What this does NOT automatically prevent** (requires discipline + explicit layering):
- **Runtime mutual calls**: service A calling service B's method while B also calls A's method is a design decision, not an import cycle. The DI pattern doesn't block it, but the service-tier list below does constrain which services can depend on which.
- **Hidden runtime coupling**: if a service stores a reference to another service and calls it later, that's a real dependency even if there's no import cycle. Track these explicitly in the service's `README.md`.

### 3.4.1 Service dependency tiers (enforced via dependency-cruiser)

To prevent hidden layering cycles between services, `services/*` is organized into explicit tiers. A service can only depend on services in lower-numbered tiers (or same-tier for peer services). Dependency-cruiser enforces this at CI.

| Tier | Services | Rationale |
|---|---|---|
| **1 — foundational** | `crypto`, `config`, `state`, `device`, `clipboard`, `spawn`, `i18n`, `telemetry`, `logger`, `update`, `lifecycle` | Pure services or thin wrappers over OS/filesystem; no business logic |
| **2 — infrastructure** | `api`, `store` | HTTP client and SQLite store; used by higher-tier services |
| **3 — auth** | `auth` | Depends on api (HTTP) and store (token persistence) |
| **4 — broker** | `broker` | Depends on auth (for authenticated WS), api, crypto, store |
| **5 — mesh** | `mesh` | Depends on auth, broker, store, crypto, config, device |
| **6 — mesh features** | `invite`, `health` | Depends on mesh, auth, broker, api |

**Rules**:
- A service at tier N can import from services at tiers 1..N (facades only) and same-tier peers (if explicitly documented as peer services).
- Cross-tier upward imports are forbidden: `auth` cannot import from `mesh`, even through the facade.
- Dependency-cruiser enforces this with tier-aware rules in `dependency-cruiser.config.js`.

The tier list is documented in `apps/cli-v2/src/services/README.md` and validated at CI by a rule that reads the tier assignments from that file.

### 3.5 Feature-folder, not layer-folder

Each feature lives in `services/<feature>/` with everything it needs: client, logic, schemas, types, tests, facade. Claude Code's pattern, validated at ~200k-LOC scale. Rejected alternative: split by layer (`runtime/` + `operations/`) — adds folder hops without adding boundary enforcement that feature-folders + dependency-cruiser don't already provide.

### 3.6 No silent magic, no silent defaults that matter

It's OK to auto-pick the mesh name on first run because the user can rename it with one command. It's NOT OK to silently use a default the user can't easily inspect or change. Everything the CLI decided for you is visible via `claudemesh whoami --verbose`.

### 3.7 Visual restraint as a design principle

Six semantic color roles, ten icons, two-space indent. No boxes. No borders. No ASCII art. No animations. No fake typing effects. Every frame is deliberate. Full design system in the UX spec.

### 3.8 Zero runtime or code dependencies on v1

**v2 is a clean rewrite, not a refactor.** The `apps/cli-v2/` tree has **no imports from `apps/cli/`**, no shared types, no shared tests, no shared fixtures, no helper modules reused from v1. If v2 needs a piece of logic that exists in v1, it is **ported** into v2 (rewritten in the v2 architecture) or **deferred** to v1.1+.

Consequences:

1. **No `import` or `require`** pointing at `apps/cli/` from anywhere under `apps/cli-v2/`. CI has a lint rule: `no-v1-imports` fails any PR that tries.
2. **No shared workspace helpers** — v2 has its own `tests/helpers/`, its own `.eslintrc.cjs`, its own build pipeline. Not `@claudemesh/test-utils` or similar.
3. **No shared SQLite schema, config format, or wire protocol assumptions** — v2's `services/store` uses a fresh schema; migration from v1 config is explicit (see §15) and only reads the old file format, it does not call v1 code to do it.
4. **No dependency on `apps/broker/src/telegram-bridge.ts`** — the v1 telegram bridge is broker-side hardcoded code. v2 replaces it with a deployed MCP connector (see shared-infrastructure spec §9 and §12). The v2 CLI never connects to the v1 telegram bridge endpoint.
5. **Broker surface is versioned** — v2 broker ships as a new broker image (`claudemesh/broker:1.0.0`) with a separate WS protocol endpoint. v1 and v2 brokers can run side-by-side during the transition, but v2 does not speak the v1 protocol.
6. **v1 → v2 cutover is user-side** — users migrate by running `claudemesh advanced migrate` on first v2 launch, which reads their v1 `~/.claudemesh/config.json` and translates it to v2 shape. v2 never links against v1 code to do this.

**Why this is non-negotiable**: allowing v2 to import from v1 would couple their release cycles, prevent v1 from being deleted after the coordinated swap (Phase 10), and turn the "atomic swap" into a dependency-untangling exercise. The whole point of v2 is a clean slate.

### 3.9 Pre-1.0 is for breaking; 1.0 is for keeping

v0.11.x through v0.19.x are open season for breaking changes. v1.0.0 is the commitment: after that, deprecations need a minor-version cycle and a migration path. The v2 rewrite ships as v0.11.0-alpha.1 → v0.11.0 stable → v1.0.0 once proven.

### 3.10 Every write is inside a transaction, through the queue

(Inherited from the storage spec.) No "loose" writes to SQLite. Every state-changing SQL statement runs inside a transaction enqueued on the single-writer queue. Lamport counter updates happen in the same transaction as the domain row write. This is what makes the local-first storage layer correct under concurrency.

### 3.11 Facades, not raw services

(Inherited from the facade spec.) UI components and commands never import from `services/<feature>/device-code.ts` or `services/<feature>/client.ts`. They import from `services/<feature>/facade.ts` and get a narrow, Zod-validated, Promise-returning interface. This is enforced by tooling at CI, not by convention.

---

## 4. The mesh state model

Three states, one mental model. The CLI presents the same tool surface in all three.

### 4.1 Personal mesh

- **Identity**: unique per machine, created on first run
- **Storage**: `~/.claudemesh/data.db` (SQLite)
- **Peers**: just you
- **Broker**: not connected (no one to sync to)
- **Auth**: none required
- **Tools**: all local-first MCP tools work against local storage; broker-backed tools return "not available in personal mesh"
- **Invitable**: no (must be published first)

**Value proposition**: persistent memory, vector search (local sqlite-vec fallback for personal mesh), state, and file staging for Claude across sessions, with no network dependency.

### 4.2 Shared mesh, owned

- **Identity**: registered server-side with a slug, you're the owner
- **Storage**: per-peer data in local SQLite; shared data in broker-backed services (Postgres, Neo4j, Qdrant, MinIO)
- **Peers**: you + anyone with an invite
- **Broker**: connected
- **Auth**: yes, to create (not to use afterwards)
- **Tools**: complete tool surface — local-first + broker-backed
- **Invitable**: yes, via `claudemesh invite`

### 4.3 Shared mesh, guest

- **Identity**: someone else's mesh, you joined via invite
- **Storage**: per-peer data in local SQLite; shared data accessed via broker
- **Peers**: everyone in the mesh
- **Broker**: connected
- **Auth**: optional — guests use ephemeral keypairs by default, no account required
- **Tools**: same surface as owner, with some operations gated by role (rename/archive/delete are owner-only)
- **Invitable**: depends on mesh policy

### 4.4 Transitions

- **Personal → Shared owned** (`claudemesh share` / `publish`): auth triggers if not already, creates server-side mesh record, sync daemon wakes up, generates first invite URL. Per-peer SQLite data stays local; broker-backed services are initialized fresh on the broker side.
- **No account → Guest** (`claudemesh <invite-url>`): ephemeral keypair, joins, no auth required
- **Guest → Shared owned**: not applicable; guests use `claudemesh new` to create their own
- **Shared owned → Personal**: not supported (would confuse other members). Leave with `claudemesh leave`, keep local state.

---

## 5. File system layout

All paths are XDG-compliant. On macOS defaults to `~/.claudemesh/`; on Linux respects `$XDG_DATA_HOME`, `$XDG_CONFIG_HOME`, `$XDG_CACHE_HOME`; on Windows uses `%APPDATA%\claudemesh\`.

```
~/.claudemesh/
├── config.json              # user preferences (broker URL, locale, telemetry opt-out)
├── state.json               # last-used cache (mesh, name, role, session counters)
├── auth.json                # 0600, raw token; file perms are v1 security posture
├── data.db                  # SQLite source of truth for local-first data
├── data.db-wal              # write-ahead log
├── data.db-shm              # shared memory file
├── keys/                    # 0700 dir, per-mesh keypairs, 0600 files
│   ├── personal.key
│   └── <mesh-slug>.key
├── blobs/                   # 0700 dir, content-addressed local blobs (< 64 KB files + cache)
│   └── <hh>/
│       └── <sha256>
├── cache/
│   ├── update-check.json    # last npm registry poll (24h TTL)
│   └── mesh-metadata/       # cached mesh metadata
│       └── <mesh-slug>.json
├── logs/
│   ├── cli.log              # rotated
│   ├── mcp.log              # MCP server logs
│   └── metrics.jsonl        # local telemetry log (never transmitted)
└── tmp/                     # scratch space, cleaned on exit
```

**Permissions:** `~/.claudemesh/` is `0700`. `auth.json` and `keys/*` are `0600`. Other files are `0644`. On read, the CLI warns if permissions have drifted more permissive than the baseline; on write, it enforces the baseline.

**Token storage is file-permission based, not encrypted.** Server-side tokens are argon2-hashed by Better Auth's `apiKey` plugin, but the client stores the raw token in `auth.json` protected by `0600` and parent directory `0700`. v1.0.0 does NOT use OS keychain integration (deferred to v1.1+). This is a conscious tradeoff — keychain integration adds significant platform-specific code and dependency weight for a modest security improvement on single-user machines.

---

## 6. The target source tree

```
apps/cli-v2/
├── package.json                        # name: claudemesh-cli
├── tsconfig.json
├── bunfig.toml
├── build.ts                            # Bun bundler driver
├── dependency-cruiser.config.js        # enforces folder-level dep rules
├── .eslintrc.cjs                       # enforces boundary rules (facade pattern spec §7)
├── biome.json                          # linter/formatter config
├── .gitignore
├── CHANGELOG.md
├── README.md
├── bin/
│   └── claudemesh                      # shebang entry → dist/entrypoints/cli.js
│
├── src/
│   ├── entrypoints/
│   │   ├── cli.ts                      # interactive CLI entry, wires services, fires early prefetches
│   │   └── mcp.ts                      # `claudemesh mcp` → stdio MCP server
│   │
│   ├── cli/                            # non-Ink I/O plumbing
│   │   ├── argv.ts                     # parse process.argv → normalized args
│   │   ├── print.ts                    # stdout helpers, respect NO_COLOR/FORCE_COLOR
│   │   ├── structured-io.ts            # --json, --output-format ndjson
│   │   ├── exit.ts                     # exit codes + cleanup hooks
│   │   ├── update-notice.ts            # "new version available" banner
│   │   ├── handlers/
│   │   │   ├── signal.ts               # SIGINT/SIGTERM graceful shutdown
│   │   │   └── error.ts                # top-level error → user message
│   │   └── output/                     # non-interactive renderers
│   │       ├── list.ts
│   │       ├── peers.ts
│   │       ├── whoami.ts
│   │       └── version.ts
│   │
│   ├── commands/
│   │   ├── launch.ts                   # default: bare `claudemesh`
│   │   ├── join.ts                     # `claudemesh <url>` positional also routes here
│   │   ├── new/                        # multi-step wizard
│   │   │   ├── index.ts
│   │   │   ├── NameStep.tsx
│   │   │   ├── TemplateStep.tsx
│   │   │   └── ConfirmStep.tsx
│   │   ├── invite.ts
│   │   ├── list.ts
│   │   ├── rename.ts
│   │   ├── leave.ts
│   │   ├── peers.ts
│   │   ├── login.ts                    # rarely needed; auth is lazy
│   │   ├── logout.ts
│   │   ├── whoami.ts
│   │   ├── share.ts                    # publish personal mesh as shared
│   │   ├── publish.ts                  # alias for share
│   │   ├── advanced/
│   │   │   ├── doctor/
│   │   │   │   ├── index.ts
│   │   │   │   └── DoctorScreen.tsx
│   │   │   ├── mcp/                    # advanced MCP commands
│   │   │   │   ├── catalog.ts          # list default MCP catalog
│   │   │   │   ├── deploy.ts           # deploy an MCP from catalog or source
│   │   │   │   └── index.ts
│   │   │   ├── hook.ts                 # internal: Claude Code hook handler
│   │   │   ├── seed-test-mesh.ts
│   │   │   ├── install.ts              # register MCP server with Claude Code
│   │   │   ├── uninstall.ts
│   │   │   ├── connect.ts              # external bridges (telegram, etc.)
│   │   │   ├── disconnect.ts
│   │   │   ├── migrate.ts              # explicit migration runner
│   │   │   ├── telemetry.ts            # telemetry on/off
│   │   │   └── index.ts
│   │   └── index.ts                    # command registry + help grouping
│   │
│   ├── services/
│   │   ├── auth/                       # device-code + PAT authentication
│   │   │   ├── client.ts
│   │   │   ├── device-code.ts
│   │   │   ├── pat.ts
│   │   │   ├── token-store.ts
│   │   │   ├── refresh.ts
│   │   │   ├── implementation.ts
│   │   │   ├── schemas.ts
│   │   │   ├── errors.ts
│   │   │   ├── types.ts
│   │   │   ├── index.ts
│   │   │   ├── facade.ts
│   │   │   └── auth.test.ts
│   │   │
│   │   ├── mesh/                       # mesh lifecycle (create, list, join, publish, etc.)
│   │   │   ├── client.ts
│   │   │   ├── bootstrap.ts            # first-run personal mesh
│   │   │   ├── create.ts
│   │   │   ├── publish.ts
│   │   │   ├── join.ts
│   │   │   ├── list.ts
│   │   │   ├── rename.ts
│   │   │   ├── leave.ts
│   │   │   ├── resolve-target.ts
│   │   │   ├── implementation.ts
│   │   │   ├── schemas.ts
│   │   │   ├── errors.ts
│   │   │   ├── types.ts
│   │   │   ├── index.ts
│   │   │   ├── facade.ts
│   │   │   └── mesh.test.ts
│   │   │
│   │   ├── invite/                     # invite generation, parsing, claiming
│   │   │   ├── generate.ts
│   │   │   ├── parse-url.ts
│   │   │   ├── claim.ts
│   │   │   ├── send-email.ts
│   │   │   ├── schemas.ts
│   │   │   ├── errors.ts
│   │   │   ├── implementation.ts
│   │   │   ├── index.ts
│   │   │   ├── facade.ts
│   │   │   └── invite.test.ts
│   │   │
│   │   ├── broker/                     # WebSocket client + shared-service gateway
│   │   │   ├── ws-client.ts            # raw WS with reconnect/backoff
│   │   │   ├── peer-crypto.ts          # crypto_box envelope wrapping
│   │   │   ├── sync-daemon.ts          # reads outbox, applies inbox
│   │   │   ├── shared-sql.ts           # broker WS wrapper for mesh_query/mesh_execute/mesh_schema
│   │   │   ├── shared-graph.ts         # wrapper for graph_query/graph_execute
│   │   │   ├── shared-vectors.ts       # wrapper for vector_store/vector_search (Qdrant via broker)
│   │   │   ├── shared-files.ts         # wrapper for large file ops (MinIO via broker)
│   │   │   ├── mcp-registry.ts         # wrapper for mesh_mcp_* tools
│   │   │   ├── url-watch.ts            # wrapper for mesh_watch tools
│   │   │   ├── vault.ts                # wrapper for vault_* tools
│   │   │   ├── implementation.ts
│   │   │   ├── schemas.ts
│   │   │   ├── errors.ts
│   │   │   ├── index.ts
│   │   │   ├── facade.ts
│   │   │   └── broker.test.ts
│   │   │
│   │   ├── api/                        # base HTTP client for /api/my/*
│   │   │   ├── client.ts
│   │   │   ├── my.ts
│   │   │   ├── public.ts
│   │   │   ├── errors.ts
│   │   │   ├── with-retry.ts
│   │   │   ├── index.ts
│   │   │   └── facade.ts
│   │   │
│   │   ├── crypto/
│   │   │   ├── keypair.ts
│   │   │   ├── box.ts
│   │   │   ├── random.ts
│   │   │   ├── index.ts
│   │   │   └── crypto.test.ts
│   │   │
│   │   ├── store/                      # local SQLite source of truth (local-first data)
│   │   │   ├── db.ts                   # connection + PRAGMA + migration runner
│   │   │   ├── write-queue.ts          # single-writer queue
│   │   │   ├── lamport.ts              # atomic lamport tick
│   │   │   ├── conflict.ts             # bytewise tuple comparison
│   │   │   ├── memory.ts               # memory table CRUD
│   │   │   ├── vectors.ts              # local sqlite-vec (personal mesh only)
│   │   │   ├── state.ts                # local state_kv cache
│   │   │   ├── files.ts                # local blob store + sha256 addressing
│   │   │   ├── tasks.ts
│   │   │   ├── peers.ts                # peer cache
│   │   │   ├── outbox.ts               # pending sync operations
│   │   │   ├── inbox.ts                # incoming sync operations
│   │   │   ├── migrations/
│   │   │   │   ├── 001-initial.sql
│   │   │   │   └── 002-add-broker-epoch.sql
│   │   │   ├── implementation.ts
│   │   │   ├── schemas.ts
│   │   │   ├── index.ts
│   │   │   ├── facade.ts
│   │   │   └── store.test.ts
│   │   │
│   │   ├── config/
│   │   │   ├── read.ts
│   │   │   ├── write.ts
│   │   │   ├── schemas.ts
│   │   │   ├── index.ts
│   │   │   └── facade.ts
│   │   │
│   │   ├── state/                      # last-used cache (NOT the mesh state_kv — that's store/state.ts)
│   │   │   ├── last-used.ts
│   │   │   ├── session-counter.ts      # for 100th-use milestone
│   │   │   ├── schemas.ts
│   │   │   ├── index.ts
│   │   │   └── facade.ts
│   │   │
│   │   ├── device/
│   │   │   ├── info.ts
│   │   │   ├── index.ts
│   │   │   └── facade.ts
│   │   │
│   │   ├── clipboard/
│   │   │   ├── read.ts
│   │   │   ├── detect-invite.ts
│   │   │   ├── index.ts
│   │   │   └── facade.ts
│   │   │
│   │   ├── spawn/
│   │   │   ├── claude.ts               # single choke point for exec'ing claude
│   │   │   ├── browser.ts              # single choke point for opening URLs
│   │   │   ├── index.ts
│   │   │   └── facade.ts
│   │   │
│   │   ├── telemetry/
│   │   │   ├── emit.ts
│   │   │   ├── opt-out.ts
│   │   │   ├── events.ts
│   │   │   ├── index.ts
│   │   │   └── facade.ts
│   │   │
│   │   ├── health/                     # doctor checks
│   │   │   ├── check-auth.ts
│   │   │   ├── check-broker.ts
│   │   │   ├── check-crypto.ts
│   │   │   ├── check-paths.ts
│   │   │   ├── check-install.ts
│   │   │   ├── check-version.ts
│   │   │   ├── check-store.ts
│   │   │   ├── index.ts
│   │   │   └── facade.ts
│   │   │
│   │   ├── update/
│   │   │   ├── check.ts                # npm registry poll, 24h cache
│   │   │   ├── index.ts
│   │   │   └── facade.ts
│   │   │
│   │   ├── i18n/
│   │   │   ├── resolve.ts              # locale detection
│   │   │   ├── format.ts               # ICU MessageFormat wrapper
│   │   │   ├── index.ts
│   │   │   └── facade.ts
│   │   │
│   │   └── lifecycle/
│   │       ├── service-manager.ts      # start/stop long-running services
│   │       ├── index.ts
│   │       └── facade.ts
│   │
│   ├── ui/                             # Ink-only rendering layer (design spec)
│   │   ├── styles.ts                   # six semantic color roles + ten icons
│   │   ├── store.ts                    # LaunchStore
│   │   ├── router.ts                   # flow cursor + overlay stack
│   │   ├── flows.ts                    # FLOWS = { Launch, Join, New, Invite, Auth }
│   │   ├── screen-registry.ts
│   │   ├── start.ts                    # Ink bootstrap
│   │   ├── terminal.ts                 # resetTerminal() — single UI→CLI handoff point
│   │   ├── keybindings.ts              # global keymap (Tab is no-op per UX spec)
│   │   ├── session-kind.ts             # first_run | recovery | daily_launch | interactive | non_interactive | rescue
│   │   ├── hooks/
│   │   │   ├── useKeybindings.ts
│   │   │   ├── useInterval.ts
│   │   │   ├── useAsync.ts
│   │   │   ├── useTerminalSize.ts
│   │   │   ├── useService.ts
│   │   │   └── index.ts
│   │   ├── primitives/
│   │   │   ├── CardLayout.tsx
│   │   │   ├── PickerMenu.tsx          # bold + ▸ + position cues (a11y matrix)
│   │   │   ├── StatusRows.tsx
│   │   │   ├── LoadingLine.tsx
│   │   │   ├── TextBlock.tsx
│   │   │   ├── Divider.tsx
│   │   │   ├── ErrorBlock.tsx
│   │   │   └── index.ts
│   │   ├── screens/
│   │   │   ├── WelcomeScreen.tsx       # typography-only, no brand mark
│   │   │   ├── AuthScreen.tsx
│   │   │   ├── MeshPickerScreen.tsx
│   │   │   ├── ConfirmScreen.tsx
│   │   │   ├── HandoffScreen.tsx       # unmount → resetTerminal → spawn(claude)
│   │   │   └── index.ts
│   │   └── overlays/
│   │       ├── BrokerDisconnected.tsx
│   │       ├── InviteInvalid.tsx
│   │       ├── AuthExpired.tsx
│   │       ├── UpdateAvailable.tsx
│   │       └── index.ts
│   │
│   ├── mcp/                            # MCP stdio server (exposes tools to Claude Code)
│   │   ├── server.ts
│   │   ├── router.ts                   # tool dispatch + middleware
│   │   ├── tools/                      # one file per tool family
│   │   │   ├── memory.ts               # local SQLite
│   │   │   ├── state.ts                # local SQLite
│   │   │   ├── tasks.ts                # local SQLite with tentative claim semantics
│   │   │   ├── peers.ts                # list_peers, send_message, check_messages (sync via outbox)
│   │   │   ├── profile.ts              # set_profile, set_status, set_summary, set_visible
│   │   │   ├── groups.ts               # join_group, leave_group
│   │   │   ├── scheduling.ts           # schedule_reminder, list_scheduled, cancel_scheduled
│   │   │   ├── mesh-meta.ts            # mesh_info, mesh_stats, mesh_clock (read), ping_mesh
│   │   │   ├── contexts.ts             # share_context, get_context, list_contexts (via broker Postgres)
│   │   │   ├── skills.ts               # share_skill, get_skill, list_skills, remove_skill, mesh_skill_deploy
│   │   │   ├── files.ts                # share_file, get_file, grant_file_access, read_peer_file, etc (via broker MinIO)
│   │   │   ├── vectors.ts              # vector_store, vector_search, vector_delete (via broker Qdrant)
│   │   │   ├── sql.ts                  # mesh_query, mesh_execute, mesh_schema (via broker Postgres)
│   │   │   ├── graph.ts                # graph_query, graph_execute (via broker Neo4j)
│   │   │   ├── streams.ts              # create_stream, publish, subscribe, list_streams
│   │   │   ├── mcp-registry.ts         # mesh_mcp_register, mesh_mcp_list, mesh_tool_call, mesh_mcp_remove, mesh_mcp_deploy, undeploy, update, logs, scope, schema, catalog
│   │   │   ├── vault.ts                # vault_set, vault_list, vault_delete
│   │   │   ├── url-watch.ts            # mesh_watch, mesh_unwatch, mesh_watches
│   │   │   ├── clock-write.ts          # mesh_set_clock, mesh_pause_clock, mesh_resume_clock
│   │   │   ├── webhooks.ts             # create_webhook, list_webhooks, delete_webhook
│   │   │   ├── tools.test.ts
│   │   │   └── index.ts                # tool registry
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── rate-limit.ts
│   │   │   ├── logging.ts
│   │   │   └── error-handler.ts
│   │   └── handlers/
│   │       ├── stdio.ts
│   │       └── jsonrpc.ts
│   │
│   ├── constants/
│   │   ├── paths.ts
│   │   ├── urls.ts
│   │   ├── timings.ts
│   │   ├── tokens.ts                   # cm_ prefix, regex
│   │   ├── exit-codes.ts
│   │   ├── limits.ts                   # per-mesh resource limits
│   │   └── index.ts
│   │
│   ├── types/
│   │   ├── api.ts
│   │   ├── mesh.ts
│   │   ├── peer.ts
│   │   ├── invite.ts
│   │   ├── store.ts
│   │   └── index.ts
│   │
│   ├── utils/
│   │   ├── levenshtein.ts
│   │   ├── slug.ts
│   │   ├── url.ts
│   │   ├── format.ts
│   │   ├── semver.ts
│   │   ├── assert.ts
│   │   ├── retry.ts
│   │   └── index.ts
│   │
│   ├── locales/                        # ICU MessageFormat strings
│   │   ├── en.ts
│   │   ├── es.ts
│   │   └── index.ts
│   │
│   ├── templates/                      # pluggable mesh templates
│   │   ├── solo.ts
│   │   ├── team.ts
│   │   ├── ci.ts
│   │   ├── research.ts
│   │   └── index.ts
│   │
│   └── migrations/                     # on-disk config migrations (v1 → v2)
│       ├── 0001-v1-config.ts
│       ├── 0002-v1-auth.ts
│       └── index.ts
│
└── tests/
    ├── integration/
    │   ├── auth.test.ts
    │   ├── mesh.test.ts
    │   ├── invite.test.ts
    │   ├── sync-daemon.test.ts
    │   ├── shared-infra.test.ts        # against staging broker with Postgres/Neo4j/Qdrant/MinIO
    │   └── full-flow.test.ts
    ├── e2e/
    │   ├── device-code-flow.test.ts
    │   └── mcp-deploy-catalog.test.ts
    ├── fuzz/
    │   └── store.test.ts               # 100k random ops per CI run
    ├── bench/
    │   ├── store.bench.ts
    │   └── cold-start.bench.ts
    ├── fixtures/
    │   ├── auth/
    │   ├── meshes/
    │   ├── invites/
    │   └── tokens/
    └── helpers/
        ├── mock-broker.ts
        ├── mock-api.ts
        ├── temp-home.ts
        ├── ink-render.ts
        └── sqlite-fixture.ts
```

**Total: ~200 files at scaffold time.** Every file has a single responsibility and a module-header comment pointing to the spec section it implements.

---

## 7. Local-first storage

Source of truth for per-peer data: memory, state (local cache), personal files, tasks, peer cache, outbox, inbox, lamport clocks, profile.

**This spec defers to `cli-v2-local-first-storage.md` for all storage details.** That spec includes:
- Complete SQLite schema with all constraints and indexes
- Atomic Lamport clock algorithm (race-free, with tests)
- Conflict resolution rules per tool family
- Single-writer queue with async op handling
- Sync protocol (outbox drain, inbox apply, broker epoch handling)
- Personal → shared publish upgrade protocol (6 phases, all resumable)
- Task claim semantics (all 4 branches: open, claimed, completed/cancelled, same-peer reclaim)
- File blob storage with refcount GC
- Migration runner and shutdown protocol

Key guarantees:
- Every local-first tool operation succeeds offline
- Broker outages are invisible to Claude Code's tool surface for local-first tools
- Exactly-once delivery via `client_op_id` on outbox ops + `UNIQUE(mesh_slug, broker_epoch, broker_seq)` on inbox
- Deterministic cross-peer conflict resolution via bytewise `(lamport, peer_id)` tuple comparison

---

## 8. Shared infrastructure

Broker-backed services for data that requires cross-peer queries: shared SQL (Postgres), graph (Neo4j), vector search (Qdrant), large files (MinIO), MCP registry (peer-hosted and broker-deployed), vault, URL watch.

**This spec defers to `cli-v2-shared-infrastructure.md` for all broker-backed details.** That spec includes:
- Hybrid architecture diagram and owner-per-feature map
- Per-mesh isolation models for each backend
- RBAC matrix (guest / member / admin / owner)
- Complete tool surface for the ~30 broker-backed tools
- MCP registry tier 1 (peer-hosted) and tier 2 (broker-deployed) with Docker sandbox config
- Vault encryption (AES-GCM, per-mesh KMS wrapping)
- URL watch polling (hash/json/status modes)
- Default bundled MCP catalog (19 curated official servers)
- Broker deployment requirements (Docker Compose reference)
- Security model (threat table, audit logging, rate limits)

Key guarantees:
- Cross-mesh data isolation enforced at multiple layers (broker auth + backend-native isolation)
- Deployed MCPs run in hardened Docker sandboxes (read-only root, dropped caps, seccomp, network allowlist)
- Vault credentials never appear in logs or stdout
- Every operation audit-logged with 90-day retention

---

## 9. Authentication

### 9.1 Lazy, never eager

**First run does NOT prompt for auth.** Personal mesh works fully offline with no account. Auth is triggered only by:

1. `claudemesh share` / `publish` — to create a server-side mesh record
2. `claudemesh new --shared` — if the user wants a shared mesh from the start
3. `claudemesh invite` on a personal mesh — triggers publish first
4. Any `/api/my/*` call that returns 401 — silent refresh

### 9.2 Device code flow (interactive)

1. CLI requests device code: `POST /api/auth/cli/device-code` with device info
2. CLI opens browser to `claudemesh.com/cli-auth?code=ABCD-EFGH`
3. User approves in browser (after signing in via Better Auth if needed)
4. CLI polls `GET /api/auth/cli/device-code/:device_code` every 1.5s (rate-limited to 1/sec per IP per device_code)
5. On approve, CLI receives a long-lived `cm_session_*` token
6. CLI writes `~/.claudemesh/auth.json` with `0600` perms
7. CLI syncs meshes from `/api/my/meshes`

### 9.3 Personal access tokens (scripts/CI)

`cm_pat_<32 base32>` format. Created in dashboard at `/dashboard/settings/cli-tokens` or via `claudemesh login --token <value>`. Resolution order:

1. `--token` CLI flag
2. `CLAUDEMESH_TOKEN` env var
3. `~/.claudemesh/auth.json`

### 9.4 Refresh

Tokens have a 90-day default lifetime, auto-extended on use. When a token expires or is revoked, the next API call returns 401. The CLI silently triggers a device-code re-auth in the background (for interactive contexts) or fails fast with a clear error (for PAT contexts).

### 9.5 Security

- **Server-side**: Tokens hashed at rest via Better Auth `apiKey` plugin (argon2)
- **Client-side**: Raw token in `~/.claudemesh/auth.json` protected by file permissions `0600` and parent dir `0700`. No OS keychain in v1.0.0
- `cm_` prefix enables GitHub/GitGuardian secret scanning
- Rate-limited polling on device-code endpoints
- Audit events for every auth action (`auth.cli.*` namespace)
- No in-memory token cache — every request validates against the DB

---

## 10. Wizard / flow pipeline

### 10.1 Declarative flow definition

```ts
// ui/flows.ts
export enum Screen {
  Welcome = 'welcome',
  Auth = 'auth',
  MeshPicker = 'mesh-picker',
  NewMeshName = 'new-mesh-name',
  NewMeshTemplate = 'new-mesh-template',
  Confirm = 'confirm',
  Handoff = 'handoff',
}

export enum Flow {
  Launch = 'launch',
  Join = 'join',
  New = 'new',
  Invite = 'invite',
  Auth = 'auth',
}

export const FLOWS: Record<Flow, FlowEntry[]> = {
  [Flow.Launch]: [
    { screen: Screen.Welcome,    show: s => s.isFirstRun,          isComplete: s => s.welcomed },
    { screen: Screen.MeshPicker, show: s => s.ambiguousMesh,       isComplete: s => s.meshSlug !== null },
    { screen: Screen.Confirm,    show: s => s.requiresConfirmation,isComplete: s => s.confirmed },
    { screen: Screen.Handoff,    isComplete: () => false },  // terminal
  ],
  [Flow.New]: [
    { screen: Screen.NewMeshName,     isComplete: s => s.newMeshName !== null },
    { screen: Screen.NewMeshTemplate, show: s => s.templateMatters, isComplete: s => s.template !== null },
    { screen: Screen.Confirm,         isComplete: s => s.confirmed },
    { screen: Screen.Handoff,         isComplete: () => false },
  ],
  // ...
};
```

### 10.2 Router with overlay stack

```ts
// ui/router.ts
export class Router {
  private overlays: Overlay[] = [];
  constructor(private flow: FlowEntry[]) {}

  resolve(session: Session): Screen | Overlay {
    if (this.overlays.length > 0) return this.overlays.at(-1)!;
    for (const entry of this.flow) {
      if (entry.show && !entry.show(session)) continue;
      if (entry.isComplete && entry.isComplete(session)) continue;
      return entry.screen;
    }
    return this.flow.at(-1)!.screen;
  }

  pushOverlay(o: Overlay) { this.overlays.push(o); }
  popOverlay() { this.overlays.pop(); }
}
```

Overlays are interrupts: `BrokerDisconnected`, `InviteInvalid`, `AuthExpired`, `UpdateAvailable`. Pushed from anywhere (broker service, auth middleware, version check), popped when dismissed. The flow underneath resumes cleanly.

### 10.3 `session_kind` determines output budget

Per UX spec. Six modes drive visibility decisions:

| Mode | Pre-handoff output | Frames rendered |
|---|---|---|
| `first_run` | Up to 8 lines (welcome + status rows + closing sentence) | 1 Ink frame |
| `recovery` | 1 status line | 0 frames |
| `daily_launch` | 0 lines | 0 frames |
| `interactive` | Flow pipeline, no budget | N frames |
| `non_interactive` | Structured output only | 0 frames |
| `rescue` | Full diagnostic output | 0 frames |

Detection in `entrypoints/cli.ts`:
- `first_run` → no `~/.claudemesh/state.json`
- `recovery` → previous session ended with non-zero exit + cache exists
- `daily_launch` → cache exists, no flags specifying new behavior, TTY, not `-y` with missing args
- `non_interactive` → `!process.stdout.isTTY` OR `--json` OR `CI` env
- `interactive` → explicit subcommand
- `rescue` → explicit `doctor`/`--help`/`whoami`/`--version`

### 10.4 `-y` semantics

`-y` / `--yes` means: walk the flow, for each visible-and-incomplete entry, check if required fields can be filled from flags. If yes, mark complete. If no, fail fast with a clear error naming the missing flag.

No implicit defaults. No env-var magic. One flag, one meaning.

### 10.5 Terminal teardown choke point

Exactly one place handles the wizard → claude handoff:

```ts
// ui/screens/HandoffScreen.tsx
useEffect(() => {
  (async () => {
    await inkApp.unmount();
    await inkApp.waitUntilExit();
    resetTerminal();                          // ui/terminal.ts
    await flushStdout();
    await spawnClaude(claudeArgs);            // services/spawn/claude.ts
  })();
}, []);
```

`resetTerminal()` emits the full ANSI reset sequence (SGR, cursor, alt-screen, mouse tracking, bracketed paste, raw mode). No other code in the CLI emits ANSI reset — this is the one place. See the storage spec's §18 for shutdown coordination.

---

## 11. Command surface

Main help shows 8 primary commands plus a "When something's wrong" section. Advanced commands are hidden behind `claudemesh help advanced`.

```
$ claudemesh --help

claudemesh — peer mesh for Claude Code sessions
v1.0.0

USAGE
  claudemesh                 start a session in your mesh (creates one if needed)
  claudemesh <url>           join a mesh from an invite link
  claudemesh new             create a new mesh
  claudemesh invite [email]  generate an invite (copies to clipboard)
  claudemesh list            see your meshes
  claudemesh rename <name>   rename the current mesh
  claudemesh leave [mesh]    leave a mesh
  claudemesh peers           see who's in the current mesh

When something's wrong
  claudemesh doctor          diagnose install/config/connection issues
  claudemesh whoami          show current identity

More: claudemesh help advanced
```

Advanced help exposes: `login`, `logout`, `share`/`publish`, `install`, `uninstall`, `migrate`, `telemetry`, `mcp catalog`, `mcp deploy`, plus the internal `mcp`, `hook`, `seed-test-mesh` commands.

**Connectors (Telegram, Slack, Discord, GitHub, etc.) are deployed MCPs, not dedicated commands.** A user who wants a Telegram bridge runs:

```
claudemesh advanced mcp deploy telegram --env TELEGRAM_BOT_TOKEN=$vault:tg_token --scope mesh
```

v2 does NOT ship a dedicated `connect`/`disconnect` command for bridges because that creates two ways to do the same thing (deployed MCP or dedicated bridge). The v1 `apps/broker/src/telegram-bridge.ts` hardcoded bridge is **not ported** to v2 — users who need Telegram deploy the Telegram connector MCP from the default catalog instead. See the connector story in §16.5 and shared-infrastructure §9 + §12.2.

### 11.1 Flag conventions

- `-y` / `--yes` — skip all wizard prompts, fail fast on missing required input
- `-q` / `--quiet` — suppress non-essential output
- `-v` / `--verbose` — increase log detail
- `--json` / `--output-format json` — machine-readable output with top-level `schema_version` field
- `--mesh <slug>` — override mesh selection
- `--token <value>` — override auth token
- `--help` / `-h` — per-command help

### 11.2 Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | User cancelled (Ctrl-C, declined) |
| 2 | Authentication failed |
| 3 | Invalid arguments |
| 4 | Network error — **only when the user explicitly required network** (share, login, invite --email, or a broker-backed tool call). Local-first operations never exit 4. |
| 5 | Not found (mesh, invite, peer) |
| 6 | Already exists (slug collision) |
| 7 | Permission denied (role, token scope) |
| 8 | Internal error (bug) |
| 9 | Claude Code binary missing (with stderr hint to install from claude.ai/code) |

### 11.3 Risk tiers for advanced commands

Not all advanced commands are equally dangerous. v2 assigns risk tiers:

| Tier | Commands | Behavior |
|---|---|---|
| **Safe** | `whoami`, `doctor`, `login`, `logout`, `mcp catalog` | No confirmation needed |
| **Reversible** | `telemetry`, `connect`, `disconnect`, `install`, `migrate` | No confirmation needed |
| **Destructive** | `uninstall`, `leave`, `mcp deploy` with non-`peer` scope | Typed confirmation: `claudemesh uninstall` prompts `Type "uninstall" to confirm:` |
| **Developer** | `seed-test-mesh`, `hook`, internal `mcp` | Only runs if `CLAUDEMESH_DEV=1` or called by another process |

---

## 12. MCP server tool surface

The CLI's MCP server (`claudemesh mcp` stdio entry) exposes ~80 tools organized into ~20 families. Local-first tools operate on SQLite; broker-backed tools route through the broker facade.

### 12.1 Tool families

| Family | Tools | Backend | Count |
|---|---|---|---|
| **Messaging** | send_message, list_peers, check_messages, message_status | local outbox + broker | 4 |
| **Profile** | set_profile, set_status, set_summary, set_visible | local + broker | 4 |
| **Groups** | join_group, leave_group | local + broker | 2 |
| **State (local)** | set_state, get_state, list_state | local SQLite | 3 |
| **Memory** | remember, recall, forget | local SQLite | 3 |
| **Files (local + MinIO)** | share_file, get_file, list_files, file_status, delete_file, grant_file_access, read_peer_file, list_peer_files | local blobs + broker MinIO | 8 |
| **Vectors (Qdrant)** | vector_store, vector_search, vector_delete, list_collections | broker Qdrant | 4 |
| **Shared SQL (Postgres)** | mesh_query, mesh_execute, mesh_schema | broker Postgres | 3 |
| **Graph (Neo4j)** | graph_query, graph_execute | broker Neo4j | 2 |
| **Streams** | create_stream, publish, subscribe, list_streams | broker pub-sub | 4 |
| **Contexts** | share_context, get_context, list_contexts | broker Postgres | 3 |
| **Tasks** | create_task, claim_task, complete_task, list_tasks | local SQLite + sync | 4 |
| **Scheduling** | schedule_reminder, list_scheduled, cancel_scheduled | broker scheduler | 3 |
| **Mesh meta (read)** | mesh_info, mesh_stats, mesh_clock, ping_mesh | local + broker | 4 |
| **Mesh clock write** | mesh_set_clock, mesh_pause_clock, mesh_resume_clock | broker | 3 |
| **MCP registry (peer-hosted)** | mesh_mcp_register, mesh_mcp_list, mesh_mcp_remove, mesh_tool_call | broker relay | 4 |
| **MCP registry (broker-deployed)** | mesh_mcp_deploy, mesh_mcp_undeploy, mesh_mcp_update, mesh_mcp_logs, mesh_mcp_scope, mesh_mcp_schema, mesh_mcp_catalog | broker Docker sandboxes | 7 |
| **Skills** | share_skill, get_skill, list_skills, remove_skill, mesh_skill_deploy | broker Postgres + MinIO | 5 |
| **Webhooks** | create_webhook, list_webhooks, delete_webhook | broker HTTP server | 3 |
| **Vault** | vault_set, vault_list, vault_delete | broker encrypted store | 3 |
| **URL watch** | mesh_watch, mesh_unwatch, mesh_watches | broker scheduler | 3 |

**Total: ~80 tools across 21 families.** Full details for local-first tools in the storage spec §12; full details for broker-backed tools in the shared infrastructure spec §15.

### 12.2 Middleware

Every tool call goes through a middleware chain:

1. **Auth** — validates the caller's token (for broker-backed tools)
2. **Rate limit** — per-tool per-second caps (full table in shared-infra spec §14.3)
3. **Logging** — structured logs to `~/.claudemesh/logs/mcp.log`
4. **Error handler** — catches exceptions, maps to MCP error responses with domain error codes

---

## 13. Visual design system

**This spec defers to `cli-v2-ux-design.md` for all design details.** The key locked values:

- **Six semantic color roles**: `primary`, `success`, `error`, `warning`, `muted`, `dim`. No custom hex colors. Works in any terminal theme including light/dark/monochrome.
- **Ten icons**: `✔ ✘ ⚠ ▶ ▸ • ◆ █ ◉ ◎`. All BMP Unicode, ASCII fallback for old terminals.
- **Typography-only branding**: no brand mark, no ASCII art. First-run welcome uses the product name in `primary` color, tagline in `muted`. That's it.
- **Four delight beats** per major version: `"You're in."`, `"Your mesh is live. Anyone with the invite can join."`, `"Sent."`, `"Nice to see you again."` (the 100th-session easter egg).
- **Trust surfaces** (distinct category from delight): telemetry disclosure, audit access, data deletion — neutral voice, leading `~` marker.
- **Main help line**: `claudemesh    start a session in your mesh (creates one if needed)` — works for first-run and daily-use states.
- **Error structure**: 1–3 sentences, what/why/action. Exactly one primary recovery action per error.
- **Accessibility matrix**: every state has 3 cues (icon + text + position). At least 2 legible in any a11y config. WCAG contrast targets per role.
- **ICU MessageFormat** for all pluralization and locale-sensitive strings.

---

## 14. Build & ship

### 14.1 Bundler

Bun's built-in bundler, target Node (for compatibility with users on non-Bun systems). Output per-entrypoint bundles in `dist/entrypoints/`.

```ts
// build.ts
import { build } from 'bun';

await build({
  entrypoints: ['src/entrypoints/cli.ts', 'src/entrypoints/mcp.ts'],
  outdir: 'dist/entrypoints',
  target: 'node',
  minify: true,
  sourcemap: 'external',
  format: 'esm',
});
```

### 14.2 Binary

`bin/claudemesh` is a shell shim that execs Node on `dist/entrypoints/cli.js`. `claudemesh mcp` re-execs into `dist/entrypoints/mcp.js`.

### 14.3 Honest bundle size targets

Per the storage spec's §17, the 800 KB JS target was optimistic. Realistic:

| Metric | Target |
|---|---|
| JS bundle gzipped | ~1.0 MB |
| Native addon per platform (better-sqlite3 + sqlite-vec) | ~2.8–3.5 MB |
| Total npm install (macOS arm64) | 8–10 MB |
| Total npm install (Linux x64) | 9–11 MB |
| Total npm install (Windows x64) | 10–12 MB |
| Cold start to first output | **200–400 ms** on Apple M2 Pro |

100 ms cold start was fantasy with a native SQLite addon. 200–400 ms is realistic and competitive.

### 14.4 Tests

- **Unit**: colocated `*.test.ts`, run via `bun test`
- **Fuzz**: `tests/fuzz/store.test.ts`, 100k random ops per CI run
- **Integration**: `tests/integration/*.test.ts`, against staging broker + ephemeral SQLite, `INTEGRATION=1 bun test`
- **E2E**: `tests/e2e/*.test.ts`, Playwright drives browser device-code flow, `E2E=1 bun test`
- **Benchmarks**: `tests/bench/*.bench.ts`, tracked over time, regression >20% fails CI

### 14.5 Publish

```bash
# after atomic swap (post phase 10)
cd apps/cli
bun test && bun build.ts
pnpm publish --access public --no-git-checks
```

---

## 15. Migration from v1

### 15.1 On-disk migration runner

`migrations/index.ts` exports an ordered list of migrations. On CLI start, `services/config/read.ts` detects the config version, runs pending migrations, and writes back. Failures halt startup with a clear error and preserve the old file as `config.json.backup`.

Specific migrations:

1. **`0001-v1-config.ts`** — transform v1 `config.json` shape (flat keys) to v2 shape (namespaced under `mesh`, `auth`, `ui`)
2. **`0002-v1-auth.ts`** — migrate any existing tokens from v1 locations (unlikely — v1 has no CLI auth)

### 15.2 The v1 Telegram bridge (`apps/broker/src/telegram-bridge.ts`)

**Not ported.** v2 does not include the v1 hardcoded Telegram bridge. The v2 connector story is:

- All connectors (Telegram, Slack, Discord, GitHub webhooks, Linear, Notion, etc.) ship as **deployed MCP servers** via the tier-2 shared infrastructure MCP registry (see `cli-v2-shared-infrastructure.md` §9 and §12.2)
- OAuth / token credentials live in the per-peer vault (`vault_set`) and are injected into the connector container at startup via `$vault:<key>` env var substitution
- Connector MCPs run in hardened Docker sandboxes with egress-controlled networks (see shared-infrastructure §9.4.1)
- The default MCP catalog already includes tier-2 entries for `github`, `gitlab`, `slack`, `linear`, `notion`, `stripe`, `google-drive`, `google-maps` — these are claudemesh-audited connectors ready for one-command deployment

**User migration path for Telegram users**:
1. On v2 launch, the migration runner detects an active v1 telegram bridge in the user's mesh config
2. Prints a one-time notice: `"The v1 Telegram bridge is no longer built-in. Deploy the Telegram connector MCP with:\n  claudemesh advanced mcp deploy telegram --env TELEGRAM_BOT_TOKEN=$vault:tg_token --scope mesh\nYour existing Telegram Bot token can be stored via claudemesh advanced vault set tg_token <token>"`
3. The user runs the one-liner, and Telegram resumes working with the same bot token, same chat routing, but now sandboxed + egress-controlled

**Why this is a breaking change for Telegram users**: they must re-deploy the connector manually. Acceptable because (a) the new deployment is more secure, (b) it unifies connector handling, and (c) v1.0.0 is allowed to break pre-1.0 patterns (see §3.9).

**Shipping order**: the v1.0.0 default MCP catalog ships WITHOUT a `telegram` entry initially (because there's no well-known upstream Anthropic MCP for Telegram). A claudemesh-maintained `claudemesh-mcp-telegram` package ships as a separate npm package in parallel with v1.0.0, and the catalog adds it in v1.0.1.

### 15.3 v1 → v2 cutover plan

1. v2 scaffolded as `apps/cli-v2/` (Phase 0)
2. v2 fleshed out by Opus 4.6 1M against v1 as reference (Phases 1–9)
3. v2 reaches feature parity (Phase 9)
4. Atomic swap: `rm -rf apps/cli && mv apps/cli-v2 apps/cli` (Phase 10)
5. v0.11.0-alpha.1 published
6. Feedback loop → v0.11.0 stable
7. After 30 days stable → v1.0.0

---

## 16. Implementation phases

Each phase ends with a shippable release. No "PR of doom" — every phase is a thing users can install and try.

### Phase 0 — Scaffolding (1–2 days)

- Create `apps/cli-v2/` with the full file tree
- Empty files with module-header comments pointing to relevant spec sections
- Type stubs that throw `NotImplementedError`
- `package.json`, `tsconfig.json`, `bunfig.toml`, `dependency-cruiser.config.js`, `.eslintrc.cjs`, `biome.json`
- `CHANGELOG.md` stub for v0.11.0-alpha.1
- README pointers to all 5 specs
- CI passes (type-check green)

### Phase 1 — Foundation layers (2–3 days)

- `types/`, `constants/`, `utils/`, `locales/` fully filled in
- `services/crypto/`, `services/device/`, `services/clipboard/`, `services/config/`, `services/state/`, `services/api/client.ts`, `services/update/`, `services/i18n/`, `services/lifecycle/`
- Facade files for each service
- Unit tests for each
- No user-visible change yet

### Phase 2 — Local store (4–5 days)

- `services/store/` with SQLite connection, all tables, migrations
- `services/store/write-queue.ts` with async op handling
- `services/store/lamport.ts` with atomic tick
- `services/store/memory.ts`, `state.ts`, `vectors.ts`, `files.ts`, `tasks.ts`, `peers.ts`, `outbox.ts`, `inbox.ts`
- Full unit tests with 100% coverage per storage spec §19
- Fuzz test harness

### Phase 3 — Auth (3–4 days)

- `services/auth/` full device-code + PAT implementation
- `services/api/my.ts`, `public.ts`
- Backend work (web app): Better Auth apiKey plugin, device-code endpoints, dashboard PAT UI
- CLI commands: `login`, `logout`, `whoami`
- Integration tests against staging
- **v0.11.0-alpha.1 published** — auth works, personal mesh works offline

### Phase 4 — Mesh core + broker client (4–5 days)

- `services/mesh/` with bootstrap, create, publish, join, list, rename, leave
- `services/invite/` with generate, parse-url, claim
- `services/broker/ws-client.ts`, `peer-crypto.ts`, reconnect logic
- `services/broker/shared-sql.ts`, `shared-graph.ts`, `shared-vectors.ts`, `shared-files.ts`, `mcp-registry.ts`, `url-watch.ts`, `vault.ts` — WS wrappers for broker-backed tools
- CLI commands: `new`, `invite`, `list`, `rename`, `leave`, `peers`, `share`, `publish`
- Integration tests
- **v0.11.0-alpha.2 published** — all mesh operations work

### Phase 5 — Sync daemon (3–4 days)

- `services/broker/sync-daemon.ts` with outbox drain + inbox apply
- Conflict resolution rules per storage spec §13
- Offline tests: disconnect broker mid-session, verify all local-first ops work, reconnect, verify convergence
- Broker epoch change handling
- **v0.11.0-alpha.3 published** — local-first is real

### Phase 6 — Wizard + UI (4–5 days)

- `ui/` full flow pipeline: store, router, flows, screen-registry, primitives, screens, overlays
- `ui/terminal.ts` resetTerminal() choke point
- `ui/keybindings.ts` with Tab as no-op
- `ui/session-kind.ts` with all 6 modes
- All screens typography-only, no brand mark
- HandoffScreen as the single teardown point
- Accessibility matrix implementation (token-signal + VoiceOver patterns)
- **v0.11.0-beta.1 published** — wizard UX matches the design spec

### Phase 7 — MCP server (5–6 days)

- `mcp/` full stdio server
- All 21 tool families under `mcp/tools/`:
  - Local-first tool handlers call `services/store/facade.ts`
  - Broker-backed tool handlers call `services/broker/facade.ts`
- Middleware layer (auth, rate-limit, logging, error handler)
- Handlers for stdio and JSON-RPC
- Per-tool integration tests
- **v0.11.0-beta.2 published** — Claude Code gets the full ~80-tool surface

### Phase 8 — Commands + CLI polish (3–4 days)

- `commands/` all verbs implemented as thin adapters
- `cli/` I/O plumbing (print, structured-io, exit, update-notice, handlers, output)
- `commands/advanced/mcp/catalog.ts` and `deploy.ts` for default MCP catalog
- Help text in en + es with ICU
- Typo recovery (levenshtein-based)
- Clipboard-aware launch
- Risk tiers for advanced commands
- **v0.11.0-rc.1 published** — feature complete

### Phase 9 — Migration + docs (2–3 days)

- `migrations/` runner + v1→v2 migrations
- README rewrite for `apps/cli-v2/` and the root
- CHANGELOG with full v0.11.0 entry
- `docs/quickstart.md`, `docs/architecture.md`, `docs/security.md` updated
- Broker deployment docs updated (references shared-infra spec §13)
- Migration guide for v1 users upgrading
- **v0.11.0 stable published**

### Phase 10 — Coordinated swap + v1.0.0 (1–2 days)

Rather than a destructive `rm -rf` atomic swap, use a two-step coordinated cutover that preserves git history and doesn't break open PRs:

**Day 1 — announce freeze + sibling-mode verification**:
1. Announce a merge freeze on `apps/cli/` (legacy) — close all open PRs against it or rebase them onto `apps/cli-v2/` first.
2. Run the v0.11.0 stable build from `apps/cli-v2/` in parallel with v0.10.x from `apps/cli/`. Both packages coexist during this phase — v2 ships as `claudemesh-cli@0.11.0-stable` while v1 continues as `claudemesh-cli@0.10.x` for legacy users.
3. Monitor v0.11.0 stable in the wild for at least 1 week. Revert if major issues surface.

**Day 2 — rename cutover**:
1. `git mv apps/cli apps/cli-legacy-v1` (preserves history, marks the old tree explicitly)
2. `git mv apps/cli-v2 apps/cli` (v2 becomes the canonical name)
3. Update CI workflows, `pnpm-workspace.yaml`, `turbo.json`, `CLAUDE.md`, root `README.md`, `.github/CODEOWNERS`, and any hardcoded paths in a single atomic commit.
4. Bump `apps/cli/package.json` to `1.0.0`
5. Publish to npm: `pnpm publish --access public`
6. Tag `v1.0.0` on the commit
7. Delete `apps/cli-legacy-v1/` in a follow-up commit after 30 days (by which point any outstanding PRs would have been updated or abandoned).

This approach:
- **Preserves git history**: `git log --follow` continues to work across the rename
- **Doesn't break open PRs**: they surface as rename conflicts, not delete conflicts, which git handles gracefully
- **Allows rollback**: if v1.0.0 has a catastrophic bug in the first 30 days, `apps/cli-legacy-v1/` is still in the tree and can be restored with a single `git mv`
- **No "destructive delete" moment**: the atomic commit is a rename, not a `rm -rf`

### Total timeline

**Realistic: 32–42 days** of focused work for one developer. That's 6–8 weeks at a steady pace with review cycles and feedback loops.

**Compressed with Opus 4.6 1M and aggressive parallelism**:
- Phases 0–5 (architectural skeleton + core services + auth + mesh + sync) in **5–7 days** by leveraging the 1M context window for holistic passes
- Phases 6–8 (wizard + MCP server + commands) in **4–5 days**
- Phases 9–10 (polish + ship) in **1–2 days**

**Compressed total: ~10–14 days** minimum with careful spec adherence. The earlier "8–10 days" estimate was optimistic; **12 days is a more honest floor** given the ~200 file scaffold and ~15k LOC of implementation + tests.

---

## 17. Testable acceptance criteria for v1.0.0

Every criterion has a threshold, a test environment, and can be validated by running a specific command.

### First-run

- [ ] **`claudemesh` on a fresh machine with no config, no auth, and no network** bootstraps a personal mesh offline in **under 1 second** (measured on Apple M2 Pro with fresh `~/.claudemesh/` deletion)
- [ ] **`claudemesh` on a fresh machine with network** opens the browser, completes device-code flow, creates a personal mesh, and launches Claude Code in **under 8 seconds** end to end (measured from `claudemesh` Enter to Claude Code's first prompt)
- [ ] User is never asked to type a mesh name, display name, or role on first run (grep the wizard screens for `TextInput` usage)
- [ ] User is never shown more than one wizard screen on first run (trace the flow pipeline for `Flow.Launch` with `session_kind=first_run`)

### Daily use

- [ ] **`claudemesh` on a machine with a last-used mesh** adds **less than 400ms of CLI overhead** before Claude Code takes over (measured: `time claudemesh` minus the `claude` binary's own startup time)
- [ ] Zero frames rendered for `session_kind=daily_launch` (verify by spying on Ink's `render` calls)
- [ ] Last-used mesh, name, and role are applied silently (no announcement strings)

### Sharing

- [ ] `claudemesh invite` on a shared mesh copies a working URL to the system clipboard (verify with `pbpaste` / `xclip`)
- [ ] `claudemesh invite alice@example.com` sends an email with the same URL (requires email provider wired up — verified via mock in CI, real in staging)
- [ ] `claudemesh share` converts a personal mesh to shared, triggers device-code auth if needed, and prints the first invite URL
- [ ] Invites expire 7 days by default, overridable with `--expires`

### Joining

- [ ] `claudemesh <invite-url>` joins as a guest with no auth required
- [ ] `claudemesh` with an invite URL in the clipboard offers to join
- [ ] Guest meshes appear in `claudemesh list`
- [ ] `claudemesh leave` removes a joined mesh from local state

### Auth

- [ ] `claudemesh login` on a fresh machine completes end-to-end in **under 30 seconds**
- [ ] `claudemesh login --token <PAT>` works non-interactively
- [ ] `CLAUDEMESH_TOKEN=<PAT>` works for all commands
- [ ] `claudemesh logout` revokes server-side and deletes local credentials
- [ ] `claudemesh whoami` shows identity, mesh count, and token source
- [ ] Expired token triggers silent re-auth on next command (test: force-expire the token, run any command, assert no user prompt)
- [ ] Revoked token produces a clear error and prompts re-login

### Local-first

- [ ] Every local-first tool works with broker disconnected (verified via fuzz test that toggles network mid-session)
- [ ] Memory, vectors (personal), state, files, tasks persist across CLI restarts
- [ ] Offline changes sync automatically when broker returns (verify via integration test)
- [ ] No tool operation loses data on broker outage (fuzz test assertion)
- [ ] `claudemesh doctor` reports local store integrity

### Shared infrastructure

- [ ] `mesh_execute("CREATE TABLE test (id int)")` creates a table in the per-mesh Postgres schema (integration test against staging broker)
- [ ] `mesh_query("SELECT * FROM test")` returns rows
- [ ] Cross-mesh query attempt (e.g. trying to `SELECT FROM mesh_other.test`) fails with permission denied
- [ ] `graph_execute("CREATE (n:Bug {id: 1})")` works in the per-mesh Neo4j database
- [ ] `vector_store` + `vector_search` in the same collection returns semantically similar results
- [ ] `share_file` with a >64 KB file uploads to MinIO and returns a file ID
- [ ] `mesh_mcp_deploy({ catalog: "github", env: { GITHUB_PERSONAL_ACCESS_TOKEN: "$vault:test" }, scope: "mesh" })` deploys a sandboxed GitHub MCP server
- [ ] The deployed GitHub MCP responds to `mesh_tool_call("github", "get_issue", { repo, number })`
- [ ] `vault_set("test", "secret")` stores an encrypted credential; `vault_list()` returns metadata but not the value
- [ ] `mesh_watch("https://example.com", { interval: 5 })` creates a watch; simulated content change triggers a notification

### MCP server

- [ ] Claude Code discovers all ~80 tools via stdio (verify by counting `tools/list` response entries)
- [ ] Tools respect RBAC (guest can't run `mesh_execute`, etc.)
- [ ] Rate limits enforced (101st `mesh_execute` in a minute returns rate-limit error)
- [ ] Claude Code status line shows mesh name and peer count when in a shared mesh

### Visual / UX

- [ ] All colors come from `ui/styles.ts` — CI lint rule `no-inline-colors` passes (zero violations)
- [ ] All icons come from `Icons` — CI lint rule `no-raw-glyphs` passes
- [ ] Main `--help` shows exactly 8 commands plus the "When something's wrong" section
- [ ] `help advanced` shows the rest
- [ ] Errors are 1–3 sentences, user-actionable, no stack traces (per-error assertion in test suite)
- [ ] Typo recovery suggests correct mesh slugs for levenshtein distance ≤ 2
- [ ] First-run welcome is typography-only, no brand mark, no boxes

### Build / ship

- [ ] Bundle size (gzipped JS) **under 1.2 MB** on the CI runner (CI fails on regression >20%)
- [ ] Cold start **under 400 ms** on Apple M2 Pro, **under 600 ms** on Linux x64 (GitHub Actions `ubuntu-latest`), **under 800 ms** on Windows x64 (GitHub Actions `windows-latest`) — measured by `tests/bench/cold-start.bench.ts`
- [ ] `bun test` passes with **80%+ branch coverage** on `services/*` excluding `services/broker/*` (broker is integration-tested only)
- [ ] `services/broker/*` has **70%+ branch coverage** via integration tests against staging backends
- [ ] Integration tests pass against staging broker with all four backends (Postgres, Neo4j, Qdrant, MinIO) on Linux x64
- [ ] E2E tests pass for browser device-code flow on macOS arm64, Linux x64, Windows x64
- [ ] Published to npm as `claudemesh-cli@1.0.0` with platform-specific native addons for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`
- [ ] Dependency-cruiser + ESLint boundaries + 3 custom rules (`no-index-reexport-internal`, `type-imports-count-as-edges`, `no-dynamic-service-imports`) enforce the dep graph in CI with zero violations
- [ ] `tests/unit/facade-boundaries-classification.test.ts` passes — verifies pattern precedence
- [ ] `tests/unit/facade-boundary-scan.test.ts` passes — AST-based scan of all facade output types for forbidden keys

### Security (new category)

- [ ] Token storage: `~/.claudemesh/auth.json` is `0600` on write, warns on drift, never logged
- [ ] TLS: all HTTPS connections use `checkServerIdentity` with full certificate validation; no `rejectUnauthorized: false`
- [ ] Vault access: deployed MCPs receive secrets only via env injection, scrubbed from logs, never appear in `mcp_logs` output
- [ ] Cross-mesh isolation tests pass for SQL (verified: `SELECT * FROM "mesh_other".table` is rejected), graph (verified: `MATCH (n) WHERE n.mesh_id = "other"` returns empty on Enterprise + refused on Community), vectors (verified: `scope: self` doesn't leak other peers' vectors), files (verified: MinIO bucket-per-mesh presigned URL cannot access other buckets)
- [ ] Deployed MCP sandbox tests pass: container cannot escape (read-only root confirmed), cannot reach private IPs (`169.254.169.254` metadata endpoint blocked by egress proxy), cannot access host Docker socket (confirmed via attempted mount)
- [ ] Path traversal tests pass: `share_file` with `path: "../../etc/passwd"` rejected, `vault_set` with `mount_path: "../../etc/passwd"` rejected, `files.blob_path` validated on read
- [ ] Rate limiting verified: 101st `mesh_execute` in a minute returns `rate_limited` error; limits apply per peer, not per mesh
- [ ] URL watch SSRF: `mesh_watch` against `169.254.169.254`, `10.0.0.1`, `127.0.0.1` rejected at creation; DNS rebinding attempts disable the watch

### Migration

- [ ] v0.10.5 users get auto-migrated on first v2 run
- [ ] Old config file preserved as `config.json.backup`
- [ ] `claudemesh advanced migrate` available for manual re-run
- [ ] Migration never loses joined meshes or local state
- [ ] Schema migration from v2 → v2.1 (hypothetical) preserves backward compat: v2 reading a v2.1 database works for unchanged tables, v2.1 reading a v2 database runs the migration runner on first launch

### HA / outage behavior (new category)

- [ ] Broker outage during active session: Claude Code session continues, local-first tools work, broker-backed tools return clear error `"Can't reach the mesh broker right now."`
- [ ] Broker reconnect: sync daemon resumes automatically with exponential backoff, outbox drains on reconnect
- [ ] Broker restart + epoch change: inbox dedupe works via `(mesh_slug, broker_epoch, broker_seq)`, no duplicate apply, no gap
- [ ] Postgres outage: broker returns a clear error, CLI retries with backoff, no data corruption
- [ ] Neo4j outage (shared mesh only): `graph_*` tools fail with clear message, other tools unaffected
- [ ] Qdrant outage: `vector_*` tools fail, local SQLite vectors (personal mesh) still work
- [ ] MinIO outage: file upload/download fails with clear message, local blob store unaffected

### Migration

- [ ] v0.10.5 users get auto-migrated on first v2 run
- [ ] Old config file preserved as `config.json.backup`
- [ ] `claudemesh advanced migrate` available for manual re-run
- [ ] Migration never loses joined meshes or local state

### i18n / a11y

- [ ] All user-visible strings in `locales/en.ts` and `locales/es.ts`
- [ ] `CLAUDEMESH_LOCALE=es` switches the CLI to Spanish
- [ ] `NO_COLOR=1` disables colors; all states remain legible via icon + bold
- [ ] `FORCE_COLOR=1` enables colors in non-TTY contexts
- [ ] Token-signal matrix verified for every screen (CI test)

### Security

- [ ] `~/.claudemesh/` is `0700`
- [ ] `auth.json` and `keys/*` are `0600`
- [ ] Permission drift produces a warning on read and is fixed on write
- [ ] Tokens are never logged, never printed except at creation (grep test on logs)
- [ ] `cm_` prefix enables secret scanning
- [ ] Every broker-backed tool call is audit-logged
- [ ] Rate limits enforced per tool per peer

### Telemetry

- [ ] Opt-out notice shown once on first run (Trust surface, not delight)
- [ ] `claudemesh advanced telemetry off` disables immediately
- [ ] Zero PII in telemetry events (schema validation)

### Ownership

Each criterion above has a designated owner (CLI-Dev, Web-Dev, Backend-Dev, or Orchestrator) tracked in `.artifacts/backlog/2026-04-10-v1.0.0-acceptance.md`.

---

## 18. Open questions

1. **Better Auth `apiKey` plugin version**: confirm the monorepo's Better Auth version supports `enableMetadata: true`. Verify in Phase 0. If not, upgrade or fork.
2. **Atomic swap timing**: tag v0.11.0 on the final pre-swap alpha, tag v1.0.0 on the swap commit.
3. **Email sending for `claudemesh invite <email>`**: does the web app already have a transactional email path (Resend/Postmark)? If yes, reuse. If not, Phase 4 includes wiring it.
4. **Self-hosted broker support**: first-class in v1.0.0 or defer to v1.1+? Recommendation: document the config field for v1.0.0 (`broker_url` in `config.json`), full self-hosting guide in v1.1.
5. **MCP tool surface parity with v1**: confirmed ~80 tools, all covered by the tool families in §12.
6. **Windows clipboard detection**: use `clipboardy` (small dep) or native PowerShell? Recommendation: `clipboardy`.
7. **Neo4j edition**: Enterprise (multi-database) or Community (single DB + label filtering)? Recommendation: document both, warn community users of the security implications.

---

## 19. Explicitly out of scope for v1.0.0

These are valuable features deferred to v1.1+. Listed here to prevent scope creep.

- Plugin system — users can't extend the CLI with custom commands
- Remote session resume — can't pick up a session on a different machine
- Multi-account switching — one identity per machine
- Native keychain integration — tokens stay in 0600 files
- Terminal multiplexer awareness — no special tmux/screen integration
- Voice or vim modes in the CLI
- Custom prompt templates
- Scheduled / cron-style automations outside `claudemesh advanced schedule`
- Full dashboard embedded in terminal
- Mobile companion
- Self-update mechanism — `npm i -g claudemesh-cli@latest` is the update path
- Mesh archival / soft delete
- Fine-grained token scopes
- OAuth providers other than Better Auth's built-ins
- Hybrid logical clocks (plain Lamport is sufficient)
- SQLite encryption at rest
- Time-series memory queries
- Vector re-embedding incremental mode
- Import support for arbitrary lamport-stamped data

---

## 20. Future roadmap (v1.1+)

Rough order of expected value:

1. **v1.1**: Native keychain integration (macOS Keychain, Windows Credential Manager, GNOME Keyring)
2. **v1.2**: Plugin system with manifest format and install command
3. **v1.3**: Mesh archival + soft delete
4. **v1.4**: Multi-machine personal mesh sync (opt-in, account-level encryption)
5. **v1.5**: Token scopes (`mesh:read`, `mesh:write`, `invite:create`, etc.)
6. **v1.6**: Self-hosted broker first-class support
7. **v1.7**: Peer discovery over LAN (mDNS/Bonjour) for air-gapped meshes
8. **v1.8**: Fleet management dashboard (multiple machines per user)
9. **v2.0**: Plugin marketplace, web extension points, SDK for third-party tools

Each is a separate spec written closer to implementation time.

---

## 21. The one-paragraph summary

**claudemesh-cli v2 is a complete rewrite that ships a zero-friction, hybrid local-first + broker-backed, Apple-grade terminal UX on top of a feature-folder architecture enforced by dependency rules and facade boundaries. A new user runs `claudemesh` once, clicks a browser button, and is in Claude Code with a working mesh in under 8 seconds. A returning user runs `claudemesh` and the terminal becomes Claude Code with under 400ms overhead. Per-peer data (memory, state, tasks, personal files) lives in local SQLite with exactly-once sync via lamport-stamped outbox/inbox. Shared-mesh data (SQL tables, graph, vector search, large files, deployed MCP servers) lives on broker-backed services (Postgres, Neo4j, Qdrant, MinIO, Docker sandboxes) with schema-per-mesh isolation and RBAC. Auth is lazy — triggered only by publish, invite, or explicit API calls. The wizard is a declarative flow pipeline with overlay-stack interrupts and a single teardown choke point. The visual system is six semantic color roles, ten icons, typography-only branding. The command surface is eight primary verbs plus an advanced namespace. The default MCP catalog bundles 19 curated official servers for one-command deployment. The codebase is ~200 files organized by feature with strict layer boundaries. It ships as `apps/cli-v2/` scaffolded against v0.10.5 as reference, atomically swapped in once complete, and published as `claudemesh-cli@1.0.0` after 32–42 days of realistic work (or 10–14 days aggressive with Opus 4.6 1M).**

---

**End of spec.**
