# Per-Peer Capabilities

## Goal
Give mesh members fine-grained control over what peers can do to their
session. Today: any mesh peer can send you any message; all messages get
pushed as `<channel>` reminders. Users can't say "only @alice can send me
messages," "read-only peers," or "@bob can broadcast but not DM."

## Current state
- Mesh-level role: `admin` | `member` (only affects invite issuance)
- No per-peer filter — every peer message is delivered
- No per-peer read/write split (all peers have the same capabilities)

## Target capability model

| Capability   | Meaning                                                |
|--------------|--------------------------------------------------------|
| `read`       | Peer appears in your list_peers, can see your summary  |
| `dm`         | Peer can send you direct messages                      |
| `broadcast`  | Peer's group broadcasts reach you                      |
| `state-read` | Peer can read shared state keys                        |
| `state-write`| Peer can set shared state keys                         |
| `file-read`  | Peer can read files you've shared (already exists)     |

## CLI surface
```
claudemesh grant @alice dm broadcast   # allow direct + broadcast
claudemesh grant @bob state-read       # read-only
claudemesh revoke @alice broadcast
claudemesh grants                       # list current grants per peer
claudemesh block @spammer               # shorthand for revoke-all
```

## Broker schema
New column on `mesh_member`:
```sql
peer_grants jsonb DEFAULT '{}'::jsonb
  -- shape: { "<peer_pubkey_hex>": ["dm", "broadcast", ...] }
```

Alternative (cleaner): separate `peer_grant` table keyed on
`(member_id, target_pubkey)`.

## Enforcement point
Broker's message router (`apps/broker/src/index.ts` — send flow).
Before writing the encrypted message to the recipient's queue, check
`recipient.peer_grants[sender_pubkey]` against message kind. Drop
silently if disallowed (sender sees delivered, recipient sees nothing —
matches Signal/iMessage block semantics).

## Defaults
- Unknown peers: `read + dm` (matches current behavior — additive-safe rollout)
- Existing members: grandfathered into `read + dm + broadcast + state-read`
  via a migration
- `claudemesh profile --default-grants read dm` lets users change their own default

## UI
- `claudemesh peers` renders a `[grants: dm,broadcast]` tag per peer
- `claudemesh verify` gains a `--with-grants` flag that shows the grant set
  alongside the safety number (helps the "did I accidentally block them?" check)

## Crypto implications
Grants are server-enforced metadata. Not capability tokens. A malicious
broker could forward messages regardless — this is about UX trust (spam /
noise control), not protocol security. The spec is clear about this.

## Migration plan
1. Ship broker schema change (jsonb column, nullable, default `{}`).
2. Ship `grant/revoke/grants/block` CLI commands against an unused column.
3. Enable enforcement in broker behind a per-mesh feature flag.
4. Flip on for all meshes.

## Priority
Nice-to-have. The killer feature here is `block` — every mesh gets a bad
actor eventually. Ship `block` first even if the full grant system is deferred.
