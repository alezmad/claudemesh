# Topic-key onboarding — v0.3.0 phase 2

The schema for per-topic encryption is shipped (migration 0026). The
broker generates a 32-byte XSalsa20-Poly1305 key when a topic is
created and seals one copy for the creator via `crypto_box`. The open
question is **how new joiners get their sealed copy** without giving
the broker the plaintext.

This spec covers the three live options, picks one for v0.3.0 phase 2,
and parks the rest as future cuts. Implementation is **not in this
spec** — that follows once we ship the chosen flow.

---

## The constraint

The broker holds:

- `topic.encrypted_key_pubkey` — the ephemeral x25519 pubkey used to
  seal each member's copy. Public. The matching secret is **discarded
  immediately after creation** — only the topic creator's session
  knows the topic key briefly during sealing, then it leaves memory.
- `topic_member_key.(encrypted_key, nonce)` — per-member sealed
  ciphertext.

The broker **must not** be able to decrypt any sealed copy. So when a
new member joins a topic that already exists, the broker can't seal a
copy for them by itself.

## Option A — server-side escrow (REJECTED)

Broker holds the topic key encrypted under its own service key + per-
member sealed copies. Re-sealing for new members is a server-only
operation.

**Why rejected:** the broker can read every message in every topic
forever. Calling that "per-topic encryption" misleads users. Worse
than today's plaintext-base64 because it implies a security property
the design doesn't deliver.

## Option B — member-driven re-seal (CHOSEN for phase 2)

When a new member joins, an existing member's CLIENT decrypts their
own sealed copy of the topic key, then seals a new copy for the
joiner and POSTs it to the broker.

**Wire:**

1. New member joins via `claudemesh topic join <topic>` — broker
   inserts `topic_member` row, no `topic_member_key` row.
2. New member calls `GET /v1/topics/:name/key` → 404 with
   `key_not_sealed_for_member`.
3. Existing online members (any of them) periodically poll
   `GET /v1/topics/:name/pending-seals` (new endpoint) and see the
   new joiner.
4. Existing member's client:
   - Decrypts their own sealed copy via `crypto_box_open` with their
     x25519 secret + `topic.encrypted_key_pubkey`.
   - Generates a fresh ephemeral x25519 keypair.
   - Seals the topic key for the joiner via `crypto_box` with the
     joiner's pubkey + the new ephemeral.
   - POSTs the result to `POST /v1/topics/:name/seal`.
5. Broker stores the new `topic_member_key` row.
6. New member's `GET /v1/topics/:name/key` now returns 200.

**Trust model:** broker never sees plaintext. Assumes at least one
existing member is online when the joiner connects. Worst case the
joiner waits — UI shows "waiting for a peer to share the topic key"
until somebody seals.

**Open detail — sender pubkey identity:** each re-seal uses a fresh
ephemeral pubkey. Either:

(a) Store ALL ephemeral pubkeys ever used to seal copies of this
    topic, indexed by member, so the joiner can pick the right one
    when decrypting. Adds a new table.
(b) Embed the ephemeral pubkey in the sealed payload itself (
    `encrypted_key` becomes `<32-byte ephem_pubkey><crypto_box_easy>`).
    Decoder pulls the prefix, uses it as the sender pubkey. No schema
    change beyond what 0026 already ships.

(b) wins on simplicity. Phase 2 implementation uses it.

## Option C — leaderless protocol (DEFERRED)

MLS, TreeKEM, or similar continuous group key agreement. Right answer
for groups >50 members. Overkill for v0.3.0 — implementation cost is
4-6 weeks of focused work, and the threat model gain over Option B
only matters if we believe a member's machine can be silently
compromised long enough to leak the topic key but short enough that
they aren't kicked from the topic.

Park for v0.4.0 or v0.5.0. Revisit when we onboard a customer that
asks for FS (forward secrecy) on group chat.

---

## Phase-2 implementation checklist

Schema (0026 — done):
- [x] `topic.encrypted_key_pubkey` (legacy field, will be unused in
      Option B's "embed in payload" mode, but keeping it for
      forward-compat if we ever switch to Option C)
- [x] `topic_member_key.(encrypted_key, nonce)`
- [x] `topic_message.body_version` (1 = v0.2.0 plaintext, 2 = v0.3.0 ciphertext)

API (some done — see annotations):
- [x] `GET /v1/topics/:name/key` — fetch the calling member's sealed copy
- [ ] `GET /v1/topics/:name/pending-seals` — list members without keys
- [ ] `POST /v1/topics/:name/seal` — submit a re-sealed copy

Broker:
- [x] `createTopic` generates topic key + seals for creator
- [ ] `joinTopic` becomes a "pending" insert — no key seal
- [ ] (optional) WS notification to online topic members when a new
      joiner arrives, so re-seal latency is sub-second instead of
      polling-bound

Client (CLI + web):
- [ ] On topic open, fetch sealed key, decrypt + cache in memory
- [ ] On send, encrypt body with topic key, set `body_version: 2`
- [ ] On render, decrypt v2 messages with cached key; v1 stays
      base64 plaintext (legacy)
- [ ] Background re-seal loop — poll for pending joiners, seal,
      POST

UX:
- [ ] "waiting for a peer to share the topic key" state when GET key
      returns 404
- [ ] "you are the only online member — joiners can't read messages
      until someone else logs in" warning when sole online holder
      goes offline

The phase-2 commit ships only the schema + creator-seal + GET /key.
The pending-seals endpoint, seal POST, and client encryption land in
phase 3 once this spec gets a code review. Mention fan-out from
phase 1 already works for both v1 and v2 messages, so /v1/notifications
keeps working through the cutover.
