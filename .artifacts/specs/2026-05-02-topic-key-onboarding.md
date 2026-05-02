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

**(b) wins on simplicity. Phase 3 implementation ships it. Both the
broker creator-seal and the CLI re-seal write the
`<32-byte sender pubkey><cipher>` blob.** `topic.encrypted_key_pubkey`
becomes informational only — the wire-format truth is the inline prefix.

## Web client gap (phase 3.5)

The CLI side of phase 3 ships in this cut. The web side does NOT —
because web member rows have `peerPubkey` registered server-side but
the corresponding ed25519 SECRET is discarded immediately after
generation (see `mutations.ts:createMyMesh`). Without the secret the
browser can't `crypto_box_open` its sealed topic key.

Three fixes, in increasing order of effort:

1. **Browser-side persistent identity (recommended)** — generate an
   ed25519 keypair in the browser on first dashboard visit, store the
   secret in IndexedDB, sync the public half to `mesh.member.peerPubkey`
   via a new `POST /v1/me/peer-pubkey` endpoint. Topic keys then seal
   to the new pubkey; web user decrypts locally. Existing #general
   topics need a re-seal cycle (the v0.3.0 phase-3 re-seal loop in
   the CLI already does this for any pending member, including web
   ones). Spec lift: ~3 hours, mostly browser code + a sync endpoint.

2. **Server-held secret** — keep the member's ed25519 secret server-
   side. Trivial to implement, but the broker can read everything,
   defeating the security claim. **Rejected.**

3. **JWT-derived keys** — derive the member's keypair from a stable
   user-secret (e.g. PBKDF2 over their session JWT). Means cross-
   device same key, but needs the JWT to include ~32 bytes of stable
   key material. Tied to v2.0.0 daemon redesign. **Deferred.**

Phase 3 ships option 1 deferred; web stays on v1 plaintext until 3.5.
The CLI re-seal loop in `topic tail` already handles re-sealing for
web members ONCE they have a real pubkey — no broker work needed
when 3.5 lands.

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

## Implementation checklist

Schema (0026 — done):
- [x] `topic.encrypted_key_pubkey` (informational; wire truth is the
      inline 32-byte prefix on each `topic_member_key.encryptedKey`)
- [x] `topic_member_key.(encrypted_key, nonce)`
- [x] `topic_message.body_version` (1 = plaintext, 2 = v2 ciphertext)

API (phase 3 — done):
- [x] `GET /v1/topics/:name/key` — fetch the calling member's sealed copy
- [x] `GET /v1/topics/:name/pending-seals` — list members without keys
- [x] `POST /v1/topics/:name/seal` — submit a re-sealed copy
- [x] `GET /v1/topics/:name/messages` returns `bodyVersion`
- [x] `GET /v1/topics/:name/stream` emits `bodyVersion`
- [x] `POST /v1/messages` accepts `bodyVersion` (1|2) + skips regex
      mention extraction on v2

Broker / web mutation (phase 3 — done):
- [x] `createTopic` generates topic key + seals for creator with
      inline-sender-pubkey blob format
- [x] `ensureGeneralTopic` (web) mirrors the same flow

Client — CLI (phase 3 — done):
- [x] `services/crypto/topic-key.ts` — fetch + decrypt + encrypt + reseal helpers
- [x] `topic tail` decrypts v2 messages on render
- [x] `topic post` encrypts v2 on send via REST POST /v1/messages
- [x] Background re-seal loop in `topic tail` (30s cadence)

Client — web (phase 3.5 — DEFERRED):
- [ ] Browser-side persistent identity (IndexedDB)
- [ ] `POST /v1/me/peer-pubkey` sync endpoint
- [ ] Web chat panel encrypt-on-send + decrypt-on-render (currently v1)

UX surfaces (phase 3 — done in CLI):
- [x] "waiting for a peer to share the topic key" warning on tail
- [ ] (web) "your encryption keys are pending — pair this browser"
      banner once 3.5 lands

Mention fan-out from phase 1 already works for both v1 and v2
messages, so `/v1/notifications` keeps working through the cutover.

The phase-3 cut ships full CLI encryption + re-seal flow. Web remains
on v1 plaintext until 3.5 lands the browser identity layer. Mixed
CLI+web meshes in the meantime should keep using v1 sends OR accept
that web members can't read v2 messages.
