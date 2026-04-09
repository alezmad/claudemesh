# Member Profile: Persistent Identity & Dashboard Management

> Spec for moving member identity (role tag, groups, display name, message
> mode) from ephemeral CLI flags to persistent server-side state, editable
> from the dashboard with configurable self-edit permissions.

---

## Problem

Today, launching a claudemesh session requires re-declaring your identity:

```bash
claudemesh launch --name Alice --role lead --groups eng,review --message-mode push
```

Every. Single. Time. These values live on the ephemeral `presence` row
(per-WS connection) and `peerState` row (cross-session, but CLI-written
only). There's no way for:

- An admin to assign someone's role/groups from the dashboard
- A user to set their profile once and forget about it
- An invite to pre-configure a new member's identity
- The dashboard to show/manage who belongs to which groups

This creates friction for daily users and makes managed teams impossible.

---

## Design

### Move identity to `member` (persistent, server-side)

| Field | Current location | New location | Source of truth |
|---|---|---|---|
| `displayName` | presence (ephemeral) | **member** (persistent) | Server, CLI flag overrides per-session |
| `roleTag` | nowhere (CLI `--role` flag only) | **member** (persistent) | Server, CLI flag overrides per-session |
| `groups` | peerState (CLI-written) | **member** (persistent) | Server, CLI flag overrides per-session |
| `messageMode` | config.json (local file) | **member** (persistent) | Server, CLI flag overrides per-session |
| `status` | presence | presence (no change) | Ephemeral, changes per-minute |
| `summary` | presence | presence (no change) | Ephemeral, changes per-task |
| `cwd`, `pid` | presence | presence (no change) | Literal session metadata |

### Three-layer model

```
member (persistent, server-side)
  │  Source of truth for identity. Set via dashboard, CLI profile command,
  │  or invite presets. Survives everything.
  │
  ├── peerState (cross-session, server-side)
  │     Cumulative stats, visibility toggle, last-seen metadata.
  │     Still CLI-written. Not promoted — these are operational, not identity.
  │
  └── presence (ephemeral, per-connection)
        Runtime snapshot. Copies member defaults on connect.
        CLI flags override for this session only.
        Status, summary, cwd, pid — all transient.
```

---

## Schema changes

### Extend `mesh.member`

```sql
ALTER TABLE mesh.member
  ADD COLUMN role_tag TEXT,                          -- free-text label (lead, backend-dev, observer)
  ADD COLUMN default_groups JSONB DEFAULT '[]',      -- [{name: string, role?: string}]
  ADD COLUMN message_mode TEXT DEFAULT 'push',       -- push | inbox | off
  ADD COLUMN dashboard_user_id TEXT;                 -- links to Payload CMS user.id (for CLI sync)

CREATE INDEX member_dashboard_user_idx
  ON mesh.member(dashboard_user_id)
  WHERE dashboard_user_id IS NOT NULL;
```

**Note:** `member.displayName` already exists. `member.role` stays as the
permission level enum (admin/member). `role_tag` is the new free-text label.

### Rename for clarity

The existing `member.role` (admin/member enum) controls **permissions**.
The new `member.role_tag` is a **label** visible to peers. To avoid
confusion in code and UI:

```
member.role       → member.permission   -- "admin" | "member" (access control)
member.role_tag   → member.roleTag      -- "backend-dev", "lead", etc. (display label)
```

**DB migration:** rename the column for clarity:

```sql
ALTER TABLE mesh.member RENAME COLUMN role TO permission;
-- Also rename the enum type if feasible, or keep as-is (DB enum name is internal)
```

**Impact:** Update all broker code that references `member.role` to
`member.permission`. The `meshRoleEnum` values stay the same (admin/member).

### Extend `mesh.mesh` — self-edit policy

```sql
ALTER TABLE mesh.mesh
  ADD COLUMN self_editable JSONB DEFAULT '{
    "displayName": true,
    "roleTag": true,
    "groups": true,
    "messageMode": true
  }';
```

Controls what members can edit about themselves. Admins can always edit
anyone. Mesh creator configures this on the dashboard.

### Extend `mesh.invite` — presets

```sql
ALTER TABLE mesh.invite
  ADD COLUMN preset JSONB DEFAULT '{}';
```

Preset schema:

```typescript
interface InvitePreset {
  displayName?: string;    // rarely set — joiner usually picks their own
  roleTag?: string;        // "backend-dev", "observer", etc.
  groups?: Array<{ name: string; role?: string }>;
  messageMode?: "push" | "inbox" | "off";
}
```

When a member joins via this invite, preset values are applied to the
member row as defaults. The joiner can change them later (if self-editable).

---

## Permission model

### Who can edit what

| Action | Who | Condition |
|---|---|---|
| Edit your own `displayName` | You | `mesh.selfEditable.displayName` is true |
| Edit your own `roleTag` | You | `mesh.selfEditable.roleTag` is true |
| Edit your own `groups` | You | `mesh.selfEditable.groups` is true |
| Edit your own `messageMode` | You | `mesh.selfEditable.messageMode` is true |
| Edit **any member's** profile fields | Mesh admins | Always |
| Change `permission` (admin ↔ member) | Mesh admins | Always |
| Revoke a member | Mesh admins | Always |
| Change `selfEditable` policy | Mesh admins | Always |

### Default policy by tier

| Field | free | pro | team | enterprise |
|---|---|---|---|---|
| `displayName` | self | self | self | self |
| `roleTag` | self | self | admin-only | admin-only |
| `groups` | self | self | admin-only | admin-only |
| `messageMode` | self | self | self | self |

These are defaults — the mesh creator can override any of them on the
dashboard regardless of tier.

---

## Broker changes

### New HTTP endpoints

#### `PATCH /mesh/:meshId/member/:memberId`

Update a member's profile fields. Used by dashboard and CLI.

```typescript
// Request
PATCH /mesh/:meshId/member/:memberId
Authorization: Bearer <dashboard-session-token> OR X-Pubkey + X-Signature
{
  "displayName": "Alice",
  "roleTag": "lead",
  "groups": [{ "name": "eng", "role": "lead" }, { "name": "review" }],
  "messageMode": "push"
}

// Response
{
  "ok": true,
  "member": {
    "id": "member_123",
    "displayName": "Alice",
    "roleTag": "lead",
    "groups": [{ "name": "eng", "role": "lead" }, { "name": "review" }],
    "messageMode": "push",
    "permission": "admin"
  }
}
```

**Authorization logic:**

```
if (caller is dashboard admin OR caller.memberId == targetMemberId with admin permission):
  → allow all fields
elif (caller.memberId == targetMemberId):
  → check mesh.selfEditable for each field
  → reject fields that are admin-only: 403 "field X is admin-managed in this mesh"
else:
  → 403 "not authorized"
```

**Side effect:** If the target member has active WebSocket connections,
push a `profile_updated` event to all their sessions:

```json
{
  "type": "profile_updated",
  "memberId": "member_123",
  "changes": {
    "roleTag": "lead",
    "groups": [{ "name": "eng", "role": "lead" }, { "name": "review" }]
  }
}
```

The CLI handles this by updating its in-memory state for the current session.

#### `GET /mesh/:meshId/members`

List all members with their profiles. Used by dashboard and CLI.

```typescript
// Response
{
  "ok": true,
  "members": [
    {
      "id": "member_123",
      "displayName": "Alice",
      "roleTag": "lead",
      "groups": [{ "name": "eng", "role": "lead" }],
      "messageMode": "push",
      "permission": "admin",
      "dashboardUserId": "user_abc123",
      "joinedAt": "2026-04-01T10:00:00Z",
      "lastSeenAt": "2026-04-08T14:30:00Z",
      "online": true,
      "sessionCount": 2
    },
    {
      "id": "member_456",
      "displayName": "Bob",
      "roleTag": "backend-dev",
      "groups": [{ "name": "eng" }],
      "messageMode": "inbox",
      "permission": "member",
      "dashboardUserId": null,
      "joinedAt": "2026-04-03T09:00:00Z",
      "lastSeenAt": "2026-04-07T18:00:00Z",
      "online": false,
      "sessionCount": 0
    }
  ]
}
```

`online` and `sessionCount` are derived from active `presence` rows
(disconnectedAt IS NULL) for each member.

#### `PATCH /mesh/:meshId/settings`

Update mesh settings including self-edit policy. Dashboard only, admin only.

```typescript
// Request
PATCH /mesh/:meshId/settings
{
  "selfEditable": {
    "displayName": true,
    "roleTag": false,
    "groups": false,
    "messageMode": true
  }
}
```

### hello_ack changes

When a peer connects, the `hello_ack` now includes the member's persistent
profile so the CLI can apply defaults:

```json
{
  "type": "hello_ack",
  "presenceId": "pres_789",
  "memberDisplayName": "Alice",
  "memberProfile": {
    "roleTag": "lead",
    "groups": [{ "name": "eng", "role": "lead" }, { "name": "review" }],
    "messageMode": "push"
  },
  "meshPolicy": {
    "selfEditable": { "displayName": true, "roleTag": false, "groups": false, "messageMode": true }
  },
  "restored": { ... }
}
```

### Presence creation changes

When creating a `presence` row on hello, the broker now merges:

```
1. Start with member defaults (displayName, roleTag → groups, messageMode)
2. Override with CLI hello payload (if flags were provided)
3. Write to presence row
```

This means `presence.groups` is populated from `member.default_groups` if
the CLI didn't send explicit groups in the hello. No more blank sessions.

### Join flow changes

When a member joins via `/join`, the broker applies invite presets:

```typescript
// In handleJoinPost, after creating the member row:
if (invite.preset) {
  const preset = invite.preset;
  await db.update(meshMember)
    .set({
      roleTag: preset.roleTag ?? null,
      defaultGroups: preset.groups ?? [],
      messageMode: preset.messageMode ?? "push",
      // displayName already set from the join request
    })
    .where(eq(meshMember.id, newMemberId));
}
```

---

## CLI changes

### Launch flow (simplified)

```typescript
// After config loaded and mesh selected:

// 1. Connect to broker (existing flow)
// 2. Receive hello_ack with memberProfile + meshPolicy

// 3. Apply member defaults, CLI flags override
const effectiveName = flags.name ?? helloAck.memberDisplayName;
const effectiveRole = flags.role ?? helloAck.memberProfile.roleTag;
const effectiveGroups = flags.groups ?? helloAck.memberProfile.groups;
const effectiveMode = flags.messageMode ?? helloAck.memberProfile.messageMode;

// 4. No prompts. Flags or server defaults. Done.
```

### `claudemesh profile` command

New command to view/edit your member profile from the CLI:

```bash
# View current profile
claudemesh profile
#   Name:     Alice
#   Role:     lead
#   Groups:   eng (lead), review
#   Messages: push
#   Mesh:     dev-team (admin)

# Edit fields (sends PATCH to broker)
claudemesh profile --role-tag fullstack
claudemesh profile --groups eng,frontend,review
claudemesh profile --message-mode inbox
claudemesh profile --name "Alice M."

# Edit another member (admin only)
claudemesh profile --member Bob --role-tag junior-dev --groups onboarding
```

Fields that are admin-managed show a lock icon:

```bash
claudemesh profile
#   Name:     Alice
#   Role:     lead 🔒 (admin-managed)
#   Groups:   eng (lead), review 🔒 (admin-managed)
#   Messages: push
```

Attempting to edit a locked field:

```bash
claudemesh profile --role-tag senior
# Error: roleTag is admin-managed in this mesh. Ask a mesh admin to change it.
```

### First launch stores displayName

When `--name Alice` is provided on first launch (or sync), the CLI sends
it to the broker which persists it on the member row. Future launches
don't need `--name`:

```bash
# First time
claudemesh launch --name Alice
# → broker stores displayName="Alice" on member row

# Every subsequent launch
claudemesh launch
# → hello_ack returns displayName="Alice", no flag needed
```

---

## Invite presets

### Creating an invite with presets (dashboard)

```
Create invite link — dev-team

  Permission:   [member ▾]  (admin/member)

  Profile presets (applied to new members):
    Role tag:     [backend-dev    ]
    Groups:       [eng ×] [review ×]  [+ Add]
    Message mode: (●) Push  ( ) Inbox  ( ) Off

  Link settings:
    Max uses:     [10  ]
    Expires:      [7 days ▾]

  [Generate link]

  ────────────────────

  ic://join/eyJhbGciOi...
  https://claudemesh.com/join/eyJhbGciOi...

  [Copy link]
```

### Creating an invite with presets (CLI)

```bash
claudemesh invite create \
  --role-tag backend-dev \
  --groups eng,review \
  --message-mode push \
  --max-uses 10 \
  --expires 7d
```

### Invite payload extension

The signed invite payload gains a `preset` field:

```json
{
  "v": 1,
  "mesh_id": "mesh_xyz",
  "mesh_slug": "dev-team",
  "broker_url": "wss://ic.claudemesh.com/ws",
  "expires_at": 1713100000,
  "mesh_root_key": "...",
  "role": "member",
  "preset": {
    "roleTag": "backend-dev",
    "groups": [{ "name": "eng" }, { "name": "review" }],
    "messageMode": "push"
  },
  "owner_pubkey": "...",
  "signature": "..."
}
```

The `preset` is included in the canonical signed bytes (appended to
the existing canonical format) so it can't be tampered with.

---

## Dashboard views

### Mesh members page

```
dev-team — Members

  ┌───────────────────────────────────────────────────────────────┐
  │ Name          Role tag       Groups          Status  Access   │
  │─────────────────────────────────────────────────────────────── │
  │ ● Alice       lead           eng, review     idle    admin ▾  │
  │ ● Bob         backend-dev    eng             working member ▾ │
  │ ○ Carol       designer       design, ux      —       member ▾ │
  │ ○ Dave        —              —               —       member ▾ │
  └───────────────────────────────────────────────────────────────┘

  ● = online (has active session)   ○ = offline

  [Invite member]
```

Clicking a member opens an edit panel:

```
  Edit member — Bob

    Display name:  [Bob            ]
    Role tag:      [backend-dev    ]
    Groups:        [eng ×]  [+ Add]
    Message mode:  (●) Push  ( ) Inbox  ( ) Off
    Permission:    [member ▾]

    Joined: Apr 3, 2026
    Last seen: 2 hours ago
    Sessions: 0 (offline)

    [Save]                         [Revoke access]
```

### Mesh settings page

```
  dev-team — Settings

  General:
    Name:        [dev-team       ]
    Visibility:  [private ▾]

  Member self-edit permissions:
    What can members edit about themselves?

      Display name:    [✓]
      Role tag:        [ ]  ← only admins can assign
      Groups:          [ ]  ← only admins can assign
      Message mode:    [✓]

  [Save]
```

### Live presence view

```
  dev-team — Live

  ┌────────────────────────────────────────────────────────────────┐
  │ ● Alice (lead)                          idle                   │
  │   eng (lead), review                                           │
  │   Session 1: ~/Desktop/claudemesh — "Working on auth sync"     │
  │   Session 2: ~/Desktop/cuidecar — "Reviewing PR #47"           │
  │                                                                │
  │ ● Bob (backend-dev)                     working                │
  │   eng                                                          │
  │   Session 1: ~/Desktop/api — "Fixing migration bug"            │
  └────────────────────────────────────────────────────────────────┘

  Auto-refreshes every 5s via WebSocket.
```

---

## Real-time profile push

When an admin (or self) updates a member's profile via the dashboard or
CLI, all active sessions for that member receive a push:

```
Dashboard: admin changes Bob's groups
  → PATCH /mesh/:meshId/member/:memberId { groups: [{name: "ops"}] }
  → Broker updates member row
  → Broker finds all active presence rows for this memberId
  → Broker sends to each WS connection:
    { type: "profile_updated", changes: { groups: [{name: "ops"}] } }
  → Bob's CLI receives push, updates in-memory groups
  → Bob's next list_peers / join_group reflects the change
  → No restart needed
```

---

## Migration from peerState

The existing `peerState` table stores `groups`, `profile`, `visible`,
`lastDisplayName`, and `cumulativeStats`. After this change:

| peerState field | Migration |
|---|---|
| `groups` | Copy to `member.default_groups` for existing members. peerState.groups becomes a session-level overlay (for CLI `join_group`/`leave_group` within a session). |
| `lastDisplayName` | Already on `member.displayName`. Drop from peerState. |
| `profile` (avatar, title, bio) | Keep on peerState for now. These are presentation, not identity. Could move to member later. |
| `visible` | Keep on peerState. Session-scoped toggle. |
| `cumulativeStats` | Keep on peerState. Operational data, not identity. |

**The peerState table is NOT removed.** It still serves its purpose for
cross-session operational state. The member table absorbs identity fields
only.

---

## Implementation order

1. **DB migration:** Add columns to `member` (role_tag, default_groups,
   message_mode, dashboard_user_id), `mesh` (self_editable), `invite`
   (preset). Rename `member.role` → `member.permission`.
2. **Broker:** `PATCH /mesh/:meshId/member/:memberId` endpoint with
   self-edit permission checks and real-time push.
3. **Broker:** `GET /mesh/:meshId/members` endpoint with online status.
4. **Broker:** `PATCH /mesh/:meshId/settings` endpoint.
5. **Broker:** Update `handleHello` to include memberProfile + meshPolicy
   in hello_ack. Update presence creation to merge member defaults.
6. **Broker:** Update `/join` to apply invite presets to new members.
7. **CLI:** Update launch to read memberProfile from hello_ack, skip
   prompts when server has defaults, flags override.
8. **CLI:** `claudemesh profile` command.
9. **CLI:** Update invite creation to accept preset flags.
10. **Web:** Member management page (list, edit, revoke).
11. **Web:** Mesh settings page (self-edit policy).
12. **Web:** Invite creation with presets.
13. **Web:** Live presence view.

---

## What stays the same

- Ed25519 keypairs remain the mesh identity
- E2E encryption unchanged (crypto_box with peer keys)
- `presence` table stays ephemeral — status, summary, cwd, pid
- `peerState` keeps operational data — stats, visibility, session profile
- `list_peers` MCP tool still works (reads from presence, now enriched
  with member defaults)
- CLI `--role`, `--groups`, `--message-mode` flags still work as
  per-session overrides
- `join_group` / `leave_group` WS messages still work for session-scoped
  group changes (these update presence, not member)

---

## Open questions

1. **Session-scoped group changes vs member-level groups.** If member has
   `groups: [eng]` and the CLI does `join_group("review")` mid-session,
   does that add to the member row or just the presence? **Proposal: just
   presence.** Session-scoped join/leave is temporary. Use `claudemesh
   profile --groups` or dashboard for permanent changes.

2. **Profile conflicts across devices.** If Alice has two CLI devices with
   different keypairs (different member rows), they have independent
   profiles. This is correct — they're different identities in the mesh.
   But if she syncs from the same dashboard account, should her profile
   sync across devices? **Proposal: no, not in v1.** Each member row is
   independent. Dashboard shows all members linked to your account.

3. **Audit trail for profile changes.** Should profile edits go in the
   audit log? **Proposal: yes.** Event type: `member_profile_updated`,
   payload includes who changed what. Useful for managed teams.
