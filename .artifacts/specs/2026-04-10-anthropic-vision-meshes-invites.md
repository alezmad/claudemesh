# Anthropic Vision: Meshes & Invitations

**Status:** in progress · partial implementation 2026-04-10
**Owner:** agutierrez
**Scope:** `apps/web`, `packages/api`, `packages/db`, `apps/broker` (future), `apps/cli` (future)

---

## Guiding principles

1. **Identity is opaque, display is free-form.** Humans pick any name; the system uses random IDs.
2. **Secrets never appear in URLs.** Links are capabilities, not credentials.
3. **Defaults are obvious; advanced options are discoverable but hidden.**
4. **Self-service wherever possible; admins don't become gatekeepers.**
5. **Every visible action is also an auditable event.**

These mirror how Anthropic builds its own org/workspace/project model.

---

## Part 1 — Meshes

### Problem
Global uniqueness on `mesh.slug` creates name collisions at scale. Two users picking "platform" or "test" fight for the slug. At 50k users this is the default state.

### Decision
**Drop the slug as an identity concept.** `mesh.id` (opaque, already random) is the canonical identifier everywhere (URLs, invites, broker lookups). `mesh.name` is a free-form display label, non-unique. `mesh.slug` is kept as a non-unique cosmetic string derived from the name at creation time, embedded in invite payloads for debugging.

### What this enables
- Two users can both name their mesh "platform-team" with zero friction
- URLs stay stable (`/meshes/{id}`) even if the user renames the mesh
- No "slug taken" error state exists in the product anymore

### Tradeoff explicitly accepted
Users lose the ability to type `claudemesh join platform-team` — but they never did, because the CLI takes signed invite tokens, not slugs. This capability was phantom.

### Implementation — DONE in this spec
- [x] Drop `UNIQUE` constraint on `mesh.slug` (migration `0017_mesh-slug-non-unique.sql`)
- [x] Remove `slug` field from `createMyMeshInputSchema`
- [x] Remove slug field from `CreateMeshForm`
- [x] Server-side `toSlug(name)` derives slug from name automatically
- [x] Schema comment documents the non-canonical role of `slug`

### Future (optional, not in v0.1.x)
- **Vanity slugs as a Pro feature:** one globally-unique handle per *account* (not per mesh), exposed as `claudemesh.com/@acme/...`. Sold as part of an org tier. This is where slug uniqueness actually pays for itself — against usernames, not against meshes.

---

## Part 2 — Invitations

### Problems with the current invite system

| # | Problem | Severity |
|---|---|---|
| 1 | `mesh_root_key` is embedded in the invite URL as base64url JSON | 🔴 **Security** |
| 2 | Invite URLs are ~400 chars of opaque base64url | 🟡 UX |
| 3 | No invite-by-email; only shareable link | 🟡 UX |
| 4 | Required form fields (role, maxUses, expiresInDays) for every invite | 🟡 UX |
| 5 | Landing page does not clearly preview role/consent | 🟡 UX |
| 6 | No audit trail for invites received-but-never-clicked | 🟢 Polish |
| 7 | `ic://` link scheme is vestigial, nothing registers the handler | 🟢 Polish |

### Severity 🔴 — the root key leak

Current canonical invite bytes:
```
v | mesh_id | mesh_slug | broker_url | expires_at | mesh_root_key | role | owner_pubkey
```

`mesh_root_key` is a 32-byte shared secret used by all channel and broadcast encryption in the mesh. Once it lives in a URL:
- Slack/Telegram/Discord link previews fetch and cache the URL → root key is in those caches
- Browser history, sync, analytics pixels, error logs → root key persists anywhere URLs persist
- A screenshot of the invite link is a compromise
- Revoking the invite does **not** rotate the key, so exposure is permanent

**Anthropic would never do this.** The fix is a protocol change: the invite grants the *right* to receive the key, it is not the key itself.

### The v2 invite protocol (spec only in this doc — NOT implemented this session)

**Design goals**
1. No secret material in any user-visible string (URL, QR, paste buffer)
2. Invite URLs are short (<30 chars): `claudemesh.com/i/abc12345`
3. Existing v1 invites continue to work during a deprecation window
4. Revocation is clean and immediate
5. One recipient = one root-key-delivery capability

**Flow**
```
Admin creates invite (v2):
  server generates short_code (base62, 8 chars, unique)
  server stores in DB: {id, mesh_id, code, role, max_uses, expires_at, signed_capability}
  signed_capability = ed25519_sign(canonical_v2_bytes, mesh.owner_secret_key)
  canonical_v2_bytes = v=2 | mesh_id | invite_id | expires_at | role | owner_pubkey
  NOTE: no root_key, no broker_url
  returns: claudemesh.com/i/{code}

Recipient clicks the link:
  web: GET /api/public/invites/code/{code}
    returns {mesh_name, inviter_name, role, expires_at, member_count}
    no secrets, no signature leaked
  web: shows consent landing: "You are joining ACME as a Member"
  recipient authenticates (sign up / log in) OR runs CLI

Recipient claims the invite:
  CLI: generates session ed25519 keypair (ephemeral)
  CLI: connects to broker ws://ic.claudemesh.com/ws
  CLI: sends { type: "claim_invite", code, recipient_pubkey }
  broker: looks up invite by code
  broker: verifies signed_capability against mesh.owner_pubkey
  broker: checks expires_at, max_uses vs used_count, revoked_at
  broker: increments used_count, creates mesh.member row
  broker: seals mesh.root_key with crypto_box_seal to recipient_pubkey
  broker: returns { sealed_root_key, mesh_id, member_id }
  CLI: unseals with its secret key → has root_key
  CLI: starts normal mesh traffic

Revocation:
  admin sets invite.revoked_at = now()
  any future claim fails at broker with invite_revoked
  root_key is NOT rotated — past members keep access
  (for "kick a member" semantics, use a separate member revocation, which DOES rotate the key)
```

**Properties**
- URL contains only `{code}` (8 chars base62)
- `signed_capability` lives server-side; leaks of the URL never expose the root key
- Screenshot of invite URL is harmless
- Link preview bots see nothing sensitive
- Broker DB is the source of truth for revocation

**Migration strategy (v1 → v2)**
- Add `invite.code`, `invite.v2_capability` columns (nullable for existing rows)
- `createMyInvite` generates BOTH v1 token (legacy) and v2 code
- Web invite UI displays the short URL by default, long URL as "Legacy format" disclosure
- Broker accepts both formats until v0.2.0
- Announce deprecation window; at v0.2.0 the long-format endpoints 410 Gone

**Status update 2026-04-10 — v2 is now being implemented in parallel**

The scope that was deferred at the top of the session is actively landing in a coordinated multi-agent push:
- Broker: new `/api/public/invites/:code/claim` endpoint, `crypto_box_seal` against recipient x25519 pubkey, signed capability verification, single-use accounting.
- DB: `mesh.invite.version` int, `mesh.invite.capability_v2` text nullable, `mesh.invite.claimed_by_pubkey` text nullable. New table `mesh.pending_invite` for email invites.
- CLI / web claim client: generates a fresh x25519 keypair (separate from the ed25519 identity), POSTs the pubkey, unseals the returned `sealed_root_key`, then verifies `canonical_v2` against `owner_pubkey`.
- Email invites (parallel track): Postmark delivery wired on top of `pending_invite`; the email body carries the same `claudemesh.com/i/{code}` short URL.

v1 invites continue to work throughout v0.1.x. v1 endpoints return `410 Gone` at v0.2.0.

Docs updated in the same session: `SPEC.md` §14b, `docs/protocol.md` (v2 invites subsection), `docs/roadmap.md` (in progress).

---

### Severity 🟡 — implemented this session

#### Short invite codes (URL shortening, backward-compatible)

Additive: invites now get both a long token AND a short opaque code. The web app prefers the short URL.

**DB:** new nullable `invite.code` column, unique. New migration `0018_invite-short-code.sql`.

**API:** `createMyInvite` generates `code` (base62, 8 chars, collision-retry). Returns `shortUrl` alongside `inviteLink` / `joinUrl`.

**Web:** new server route `/i/[code]/page.tsx` that resolves the code server-side and redirects to the canonical `/join/[token]` page. Invite generator UI shows the short URL as the primary "Copy link" target.

**Backward compat:** existing invites without a `code` keep working via their long token. No broker/CLI changes.

**This is NOT the v2 protocol.** It only fixes the URL-length problem. The root key is still embedded in the long token that the short code resolves to. The short code is a URL shortener, not a capability boundary. Document this clearly so nobody confuses the two.

---

#### Collapsed advanced fields

The invite form asks for `role`, `max uses`, `expires in days` upfront. 90% of users only ever create `{ role: member, max_uses: 1, expires_in_days: 7 }`.

Change: defaults are pre-filled; the three fields are hidden behind an "Advanced" disclosure.

---

### Severity 🟡 — deferred

#### Invite by email

- Requires an `invitation_email` table or equivalent pending-invites state
- Requires wire-up to email delivery (already have Postmark via turbostarter)
- Out of scope this session; fits naturally on top of v2 invite protocol

#### Consent landing redesign

- The `/join/[token]` page should show: mesh name, inviter, role being granted, member count, expiry, explicit "Join as Member of ACME" button
- Needs a design pass
- Deferred

---

### Severity 🟢 — deferred

- Remove `ic://` scheme — it's dead, nothing handles it, safe to delete in v0.1.x cleanup
- Received-but-not-clicked audit — falls out of email invites for free

---

## Summary table

| Change | Status | File(s) |
|---|---|---|
| Drop global slug uniqueness | ✅ done | `packages/db/src/schema/mesh.ts`, migration `0017` |
| Remove slug from create-mesh form | ✅ done | `apps/web/src/modules/mesh/create-mesh-form.tsx` |
| Server-derived slug from name | ✅ done | `packages/api/src/modules/mesh/mutations.ts` |
| Short invite codes (URL shortener) | ✅ done | `packages/db` migration `0018`, api, web `/i/[code]` |
| Collapse invite advanced fields | ✅ done | `apps/web/src/modules/mesh/invite-generator.tsx` |
| v2 invite protocol (root key out of URL) | 🚧 in progress | broker `/api/public/invites/:code/claim`, `mesh.invite.version` + `capability_v2` + `claimed_by_pubkey`, CLI/web claim client |
| Invite by email | 🚧 in progress | `mesh.pending_invite` table, Postmark delivery |
| Consent landing redesign | 📝 spec only | (future PR) |
| Remove `ic://` scheme | 📝 spec only | (cleanup PR) |

---

## Non-goals (for clarity)

- Not adding per-user mesh namespaces (`alice/platform`) — opaque IDs are enough
- Not adding vanity slugs at v0.1.x — can come as a Pro tier later
- Not changing the broker wire protocol this session
- Not rewriting the CLI join flow this session

---

## Post-implementation checklist

- [x] Web builds without type errors on changed files
- [x] Migrations run on production DB (`0017` applied; `0018` after review)
- [x] No broker protocol change (backward compat verified)
- [x] Existing long-token invites continue to resolve
- [x] New invites expose `shortUrl` in the API response
