# Session capabilities — first-class concept

**Status:** spec, queued behind v0.3.0 topic-encryption work.
**Owner:** alezmad
**Author:** Claude (Sprint B follow-up, 2026-05-04)
**Related:** `2026-04-15-per-peer-capabilities.md` (existing per-peer
caps system, member-keyed), `2026-05-04-per-session-presence.md`
(per-launch session presence — what we're now restricting).

## Problem

Per-peer capability grants (`apps/broker/src/index.ts:2178+, 2309+`)
are keyed on the sender's **stable member pubkey**. The grant model
gives the recipient fine-grained control: "alice can DM me",
"bob can read state but not broadcast", etc.

But: as of v1.30.0 (`per-session-presence`), every `claudemesh
launch` mints a per-launch ephemeral keypair with a parent attestation
binding it to the member identity. The launched session inherits **all**
the member's capabilities transitively, because cap enforcement always
falls through to the member key.

Concretely:

- Member `alice` is in mesh `flexicar`, granted `dm + state-read +
  state-write` by everyone.
- Alice launches a session with `claudemesh launch` to do an automated
  task — say, run a Claude Code agent that iterates over PRs.
- That session has full member privileges. It can DM peers, write
  shared state keys (e.g. clobber `current-pr`), grant new caps, ban
  members, etc. — none of which the user wanted to delegate.

There is no way to express "this session can DM peers but cannot
deploy services or grant caps." The parent attestation is a binary
existence proof — "this session was vouched by a member" — with no
capability subset.

Plus an adjacent footgun: `set_state` (`apps/broker/src/index.ts:2949`)
has **no cap check at all**. Anyone in the mesh can write any key. The
spec at `2026-04-15-per-peer-capabilities.md` lists `state-write` as a
planned cap but it was never wired into the broker. Shared keys like
`current-pr` are write-anyone today.

## Goal

A launched session can be issued **a capability subset** of its
parent member, signed by the parent at launch time, and the broker
enforces the **intersection** of recipient grants × session caps on
every protected operation.

## Non-goals

- Changing the existing per-peer cap model. Member-keyed grants stay
  authoritative for "who is allowed to talk to me."
- Cross-machine session caps (waiting on 2.0.0 HKDF identity).
- Per-tool granularity inside the Claude Code MCP surface — this
  spec only covers the broker-enforceable verbs (dm, broadcast,
  state-read, state-write, grant, kick, ban, profile-write,
  service-deploy).
- Delegation: a session cannot re-vouch a sub-session with its own
  cap subset. Only members can attest sessions. (Could be lifted in
  a future spec; today's launch flow doesn't need it.)

## Design

### Capability vocabulary

Existing (today, member-level):

| Capability    | Effect when GRANTED on a recipient → sender pair  |
|---------------|---------------------------------------------------|
| `read`        | Sender appears in recipient's `list_peers`        |
| `dm`          | Sender can DM recipient                           |
| `broadcast`   | Sender's broadcasts reach recipient               |
| `state-read`  | Sender can read shared state                      |
| `state-write` | (planned) Sender can write shared state          |
| `file-read`   | Sender can fetch files recipient shared           |

New (session-level — cap subset on the attestation):

These are the **verbs the session is allowed to invoke**, NOT what
peers can do TO it. A session attestation declaring `["dm", "read"]`
means the session can SEND dm/read-list operations; it cannot
broadcast, write state, grant, etc.

| Session cap       | Gates which broker operations                  |
|-------------------|------------------------------------------------|
| `dm`              | `send` with single recipient                   |
| `broadcast`       | `send` with `*`, `@group`, `#topic`            |
| `state-read`      | `get_state`, `list_state`                      |
| `state-write`     | `set_state`                                    |
| `grant`           | `grant`, `revoke`, `block`                     |
| `kick`            | `kick`, `disconnect`                           |
| `ban`             | `ban`, `unban`                                 |
| `profile-write`   | `set_profile`, `set_summary`, `set_status`     |
| `service-deploy`  | `mesh_service_register`, `_unregister`         |

The default cap set when no subset is declared: the **full member
set** (today's behavior — opt-in restriction, not breaking).

### Attestation v2

Existing v1 (`apps/cli/src/services/broker/session-hello-sig.ts`):

```
canonical = `claudemesh-session-attest|<parent>|<session>|<expires>`
```

New v2 (additive — broker accepts both):

```
canonical = `claudemesh-session-attest-v2|<parent>|<session>|<expires>|<sorted-caps-csv>`
```

Where `<sorted-caps-csv>` is the lower-cased, comma-joined,
ASCII-sorted cap list. Empty-list = full member caps (default,
back-compat).

**Wire shape additions on `session_hello`:**

```ts
{
  type: "session_hello",
  ...existing fields...,
  parentAttestation: {
    sessionPubkey,
    parentMemberPubkey,
    expiresAt,
    signature,
    // NEW:
    allowed_caps?: string[],  // omitted = full member set
    version?: 2,              // omitted = v1
  },
}
```

The broker version-detects: `version === 2` → verify v2 canonical
including `allowed_caps`. Default behavior is unchanged for clients
that don't pass it.

### Enforcement

Add `allowed_caps: string[] | null` to the in-memory `PeerConn`
shape (`apps/broker/src/index.ts:131`). Populated from
`handleSessionHello` (the v2 attestation supplies it) and from
`handleHello` (control-plane / member connection — set to `null`,
meaning "full member caps").

**Effective cap check** for a sending peer needing `cap`:

```ts
function senderHasCap(conn: PeerConn, cap: string): boolean {
  if (conn.allowed_caps === null) return true; // member-level, no subset
  return conn.allowed_caps.includes(cap);
}
```

Wire this into every broker operation in the table above. The
existing per-peer recipient-cap check at `2178+, 2309+` stays —
session caps gate the **sender side**, recipient grants gate the
**receive side**, and both must allow:

```
allowed = senderHasCap(conn, capNeeded) && recipientGrants[sender][capNeeded]
```

### `set_state` gate (bonus, ship together)

Today: no cap check. After this spec: `set_state` requires
`state-write` on the sender side. Migration: existing members
default to having `state-write` in their member caps (no recipient
grant model for state-write — it's a sender-side gate only, mesh-
wide). New attestations can omit it to forbid the session.

The recipient-side analog (per-peer state-write grants) is left for
a future spec — today the value of guarding state-write is
session-level (avoid an automated session clobbering shared keys),
not peer-level.

### CLI surface

```
claudemesh launch --caps dm,read         # tight: read-only chat agent
claudemesh launch --caps dm,broadcast    # send-only, no state writes
claudemesh launch                        # default: full member caps
```

`claudemesh launch --caps ?` prints the table above with descriptions.

`claudemesh peer list --json` includes `allowed_caps` per row when
present (`null` = full member). Lets users audit what their running
sessions can actually do.

### Migration plan (mirrors `2026-04-15-per-peer-capabilities.md` §"Migration plan")

1. **Broker schema additive** — `PeerConn.allowed_caps` in-memory
   only; no DB column. Reload-on-reconnect is fine because the
   attestation is re-sent on every WS open (it's the proof of
   identity).

2. **CLI ships v2 attestation alongside v1.** New `--caps` flag
   defaults to omitted (= v1 attestation, full caps). Older
   brokers ignore the new fields entirely.

3. **Broker accepts v2.** When `allowed_caps` arrives, store it.
   No enforcement yet — log denied operations as `cap_check_dryrun`
   metric counter, still allow them through.

4. **Dry-run release.** Ship one CLI + broker release that emits
   the metric but doesn't enforce. Watch for false positives in
   real meshes for ≥ 1 week.

5. **Flip enforcement on.** Broker rejects operations failing the
   cap check with `forbidden: missing session capability "<cap>"`.
   Default ("no caps declared = full member") keeps existing
   sessions unaffected.

6. **`set_state` gate** ships in step 5 alongside the rest. Default
   member caps include `state-write`, so flipping it on doesn't
   break existing flows. Only sessions that explicitly omit
   `state-write` from `--caps` lose write access.

### Crypto notes

- v2 attestation re-uses `crypto_sign_detached` over the new
  canonical string; same parent member secret key, same TTL caps
  (≤24 h), same `expiresAt` semantics.
- v1 signatures are NOT v2 signatures — collision is impossible
  because the canonical strings have different prefixes
  (`claudemesh-session-attest` vs `claudemesh-session-attest-v2`).
  Domain separation is intrinsic.
- Like the existing per-peer cap system: caps are server-enforced
  metadata, not capability tokens. A malicious broker can ignore
  them. This is about UX trust + footgun prevention, not protocol-
  level security.

## Open questions

1. **Should the session attestation also bind to a fingerprint of
   the launched binary / Claude version?** Would let a member say
   "this session is constrained to Claude Code v1.34.15" so a
   compromised launched-binary doesn't get reused. Probably no — too
   much friction for the threat model.

2. **What's the right default for `claudemesh launch` going forward?**
   Once enforcement ships, do we change the default `--caps` from
   "full member" to "dm + read + state-read"? Tighter but breaks
   existing automation that writes state. Probably worth a one-
   release deprecation warning ("your session will lose state-write
   in v2.0.0 unless you pass --caps state-write") and then flip in
   v2.0.0.

3. **Does `--caps` belong in `~/.claudemesh/config.json` per-mesh
   defaults too?** A user who always launches read-only agents
   wants `caps: ["dm", "read"]` as a personal default. Easy add;
   defer until users ask for it.

4. **Per-tool MCP cap surface?** Out of scope here, but: a `claudemesh
   launch --tools peer:read,memory:write` would be a finer cut than
   broker-verb caps. The broker can't enforce that — it'd live in the
   MCP wrapper / Claude Code's allowedTools. Different layer.

## Test plan

- Pure-logic tests on `senderHasCap` (member-level → always true,
  empty caps → always false, declared caps → exact match).
- Broker integration: launch a session with `--caps dm`, attempt
  `set_state` → expect `forbidden: missing session capability
  "state-write"`.
- v1 attestation still accepted, no `allowed_caps` set, all caps
  permitted (back-compat).
- v2 attestation with empty `allowed_caps` array → broker treats
  as "explicitly empty, no caps allowed" (NOT "full member"). The
  full-member default is "field omitted entirely". Test both.
- Dry-run mode: cap fail increments the counter but the operation
  proceeds. Smoke-test before flipping enforcement.

## Estimate

- Spec review + open-question resolution: 1–2 days.
- Broker change (PeerConn field, attestation v2 accept, per-verb
  enforcement, dry-run mode): 2–3 days.
- CLI change (`--caps` flag, attestation builder, peer list
  surface): 1 day.
- Tests: 1 day.
- Dry-run release window: ≥ 1 week.

Total: ~1 sprint of focused work, plus a dry-run window.
