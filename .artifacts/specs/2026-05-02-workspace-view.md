# Workspace view — per-user superset over joined meshes

**Status:** spec / not started
**Target:** v0.4.0
**Author:** Alejandro
**Date:** 2026-05-02

## Why

Users routinely belong to multiple meshes — work, personal, side
projects, ECIJA + flexicar + openclaw + prueba1 in our own dogfood.
Today's CLI is mesh-scoped: every read or write either auto-picks the
default mesh or forces an interactive picker. Common questions like
*"who's online across all my meshes?"* or *"any new @-mentions
anywhere?"* require N round-trips, one per mesh.

A few verbs already aggregate implicitly (`peer list`, `inbox`,
`list`), but the surface is patchy and inconsistent.

We want the equivalent of "all my Slacks in one sidebar" — without
breaking the per-mesh trust model that v0.3.0 was built around.

## What it is NOT

- **Not a literal universal mesh.** A single global mesh everyone
  joins collapses the trust boundary, blows up broadcast fan-out
  (O(users²)), and turns into spam. See the universal-mesh discussion
  rejected in this same session.
- **Not federation.** Federation is the broker-side equivalent
  (already roadmapped under v0.3.0). Workspace is purely client-side.
- **Not identity stitching for *other* peers.** `Mou@openclaw` and
  `Mou@flexicar-2` may or may not be the same human. Don't auto-merge.
  Stitching MY identities is fine — local config knows.

## What it IS

A virtual layer that aggregates reads across the meshes the user has
joined, while keeping writes mesh-scoped. Pure projection over
existing per-mesh tables. Zero broker changes. Zero protocol changes.

```
                    ┌──────────────────────────────┐
                    │          workspace           │
                    │   (per-user view, client)    │
                    └─┬────────┬────────┬─────────┬┘
                      │        │        │         │
                ┌─────▼──┐ ┌───▼──┐ ┌───▼──┐ ┌────▼──┐
                │ mesh A │ │ B    │ │ C    │ │  ...  │
                └────────┘ └──────┘ └──────┘ └───────┘
                  (each remains its own crypto + trust domain)
```

## Surface

### New verbs (all read-only, all aggregating)

```bash
claudemesh me                # overview: meshes, online peers, unread, tasks
claudemesh me topics         # all subscribed topics, namespaced
claudemesh me notifications  # cross-mesh @-mentions feed
claudemesh me activity       # cross-mesh recent send/recv/topic-post
claudemesh me search "<q>"   # full-text across memory + topics + tasks
```

`claudemesh me` (no subcommand) prints a one-screen dashboard:

```
  workspace — agutmou (4 meshes · 23 peers visible · 2 unread @you)

  meshes
    openclaw       7 peers · 3 topics · last activity 2m
    flexicar-2     5 peers · 1 topic  · last activity 18m
    prueba1        4 peers · idle
    ECIJA          7 peers · 2 topics · 1 @you · last activity 4h

  unread @-mentions
    ECIJA · #incident-2026-05-02 · 1 from coronel-abos
    openclaw · #deploys · 1 from claudemesh-2

  pending tasks (3)
    ECIJA  ship-F4-cliente   high   claimed by you
    ...
```

### Default-aggregation rule for existing verbs

When `--mesh` is omitted on a *read-only* verb, aggregate. When
`--mesh` is omitted on a *write* verb, fall back to current behavior
(default mesh or interactive picker). Already-aggregating verbs keep
working unchanged.

| Verb | Today | After workspace |
|---|---|---|
| `peer list` | aggregates ✅ | unchanged |
| `inbox` | aggregates ✅ | unchanged |
| `list` | aggregates ✅ (lists meshes) | unchanged |
| `notification list` | mesh-scoped | aggregates by default |
| `topic list` | mesh-scoped | aggregates with namespacing |
| `task list` | mesh-scoped | aggregates by default |
| `state list` | mesh-scoped | aggregates by default |
| `memory recall` | mesh-scoped | aggregates by default |
| `info` / `stats` / `ping` | mesh-scoped | unchanged (per-mesh diagnostics) |
| `send`, `topic post`, `state set`, `remember`, ... | mesh-scoped | unchanged (writes pick a mesh) |

### Rendering rules for aggregated views

1. **Topic namespacing.** `#deploys` exists in two meshes — they're
   different rooms. Render as `openclaw/#deploys`. Inside a
   mesh-scoped command, keep the bare `#deploys` shorthand.
2. **Peer name collisions.** `Mou@openclaw` notation when the same
   display name resolves in more than one mesh. Single resolution =
   bare name.
3. **Time-grouped activity.** `me activity` sorts globally by ts
   descending; mesh tag is shown as a dim suffix.
4. **Unread roll-up.** `me notifications` is a per-row
   `[mesh][topic][snippet]` list, newest first.

## API surface (REST)

Mirror the read aggregations server-side so the dashboard + future
mobile/web UIs share the same endpoints.

```
GET /v1/me                 # workspace overview
GET /v1/me/meshes          # joined meshes + summary stats
GET /v1/me/topics          # all subscribed topics, all meshes
GET /v1/me/notifications   # cross-mesh @-mentions
GET /v1/me/activity        # unified activity feed
GET /v1/me/peers           # already implicit; formalize
GET /v1/me/search?q=...    # full-text across tables
```

Auth: needs a *user-scoped* api key (one issued per user, sees all
their meshes), which we don't have today — current keys are mesh-
scoped. Two options:

- **(a) Per-user key.** New token type `cm_u_...` issued by the
  dashboard, scopes to all meshes the issuing user belongs to. Cheaper
  to build; harder to reason about because the blast radius is
  larger if leaked.
- **(b) Multi-mesh aggregation.** Accept N mesh-scoped keys
  concurrently; CLI auto-mints them via the existing `withRestKey`
  pattern, one per joined mesh. No new key type. More round-trips on
  cold start, but rotation/revocation stays simple.

**Recommendation: (b).** Reuses today's auth model, doesn't widen the
blast radius, and the ephemeral keys we already mint per-command keep
the surface area minimal. The CLI orchestrates the fan-out client-
side.

## Storage

Pure projection at first. The cross-mesh queries are SELECT joins
over `mesh_member`, `mesh_topic`, `mesh_topic_member`,
`mesh_notification`, `mesh_topic_message`, `mesh_task`, `presence`.

If `me` queries become hot (likely once dashboards land), add a
materialized `user_workspace_view` refreshed on writes. Don't
optimize early.

## Effort

| Component | Effort |
|---|---|
| CLI verbs (`me`, `me topics`, etc.) | 1.5 days |
| Default-aggregation rule across existing verbs | 0.5 day |
| REST endpoints `/v1/me/*` | 1 day |
| Multi-mesh apikey orchestration in `withRestKey` | 0.5 day |
| Tests + docs | 0.5 day |
| **Total** | **~4 days** |

## Open questions

1. **`me` as namespace vs. flag.** Could be `claudemesh --workspace
   topics` instead of `claudemesh me topics`. The verb form is
   shorter and reads better; sticking with it.
2. **Notification ordering.** All notifications globally interleaved
   by ts, or per-mesh sections? Default to **interleaved** with mesh
   tag prefix; users can `--by-mesh` to group.
3. **Search relevance.** Cross-mesh full-text search is easy when each
   mesh has its own pg full-text index. Cross-mesh ranking is the
   harder problem (IDF varies). Punt to v0.4.1 — start with simple
   tied-rank merge.
4. **Web dashboard.** Should the web dashboard's main view become a
   workspace view by default? Yes, but that's downstream of this
   spec — once `/v1/me/*` exists, the web rewrite is the obvious
   next step.

## Out of scope (v0.4.0)

- Federation / cross-broker workspace.
- Identity stitching for non-self peers.
- Cross-mesh search ranking sophistication.
- Cross-mesh write fan-out (`me broadcast` is intentionally NOT a
  verb — too easy to misuse).
- Mobile/web parity beyond the REST endpoints.

## Why we ship this

Because "I want one Slack-like sidebar for all my claudemesh meshes"
is the highest-frequency UX gap users hit, and the answer is two
days of plumbing on top of what already exists. Federation is the
right answer for cross-organization reach; workspace is the right
answer for *one user, many meshes*. Both compose.
