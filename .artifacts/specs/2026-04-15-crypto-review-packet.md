# claudemesh crypto — external review packet

**Goal:** 2-day review of the claudemesh cryptographic surface by an
external reviewer familiar with libsodium, x25519/ed25519, authenticated
encryption, and hash-chain audit logs.

**Status:** self-audited + Codex-reviewed. Not yet reviewed by an
independent human with security expertise.

## Scope

### Files in scope

| File | LoC | What it does |
|---|---|---|
| `apps/broker/src/crypto.ts` | ~400 | Hello signature verification, canonical invite bytes (v1+v2), `sealRootKeyToRecipient` via `crypto_box_seal`, `verifyInviteV2`, `claimInviteV2Core` (gated). |
| `apps/broker/src/broker-crypto.ts` | 70 | AES-256-GCM encryption-at-rest for MCP env vars. Key from `BROKER_ENCRYPTION_KEY` or ephemeral in dev. |
| `apps/broker/src/audit.ts` | ~250 | Hash-chained audit log. Canonical JSON payload hash, per-mesh `pg_advisory_xact_lock` for concurrent writers. |
| `apps/cli/src/services/crypto/box.ts` | 60 | `crypto_box_easy` / `crypto_box_open_easy` wrappers that accept ed25519 keys and convert to curve25519 via `crypto_sign_*_to_curve25519`. |
| `apps/cli/src/services/crypto/keypair.ts` | ~50 | `generateKeypair` wrapping `crypto_sign_keypair`. |
| `apps/cli/src/commands/backup.ts` | ~180 | Config backup via Argon2id + XChaCha20-Poly1305 (`crypto_aead_xchacha20poly1305_ietf_*`) from a user passphrase. |
| `apps/cli/src/services/invite/parse-v1.ts` | ~160 | Invite payload decode + signature verification, URL parsing, short-code resolution. |

### Out of scope

- TLS config (Traefik termination)
- Postgres at-rest disk encryption
- Homebrew/winget binary signing pipeline
- Secrets storage on the user's machine (we rely on OS file mode 0600)

## Threat model

### Adversary profile

- **Network attacker** on the wire between CLI and broker. Controls
  DNS, can inject packets, can replay. TLS terminates at Traefik;
  assume TLS is trusted.
- **Malicious broker** operator. Can read any row in Postgres.
- **Mesh peer** with a valid member record. Can try to escalate
  privileges, impersonate other members, replay, DoS, exfiltrate
  other members' messages.
- **Laptop thief** who has the user's `~/.claudemesh/` directory but
  not the login password. (Keys on disk at mode 0600.)

### Must hold

- E2E: broker cannot read plaintext of direct messages.
- Signature: no member can forge messages signed as another member.
- Invite integrity: modifying an invite URL invalidates the signature.
- Backup secrecy: an attacker with the backup file but not the
  passphrase learns nothing.
- Audit integrity: tampering with an audit row breaks chain
  verification.

### Known weaknesses (deliberate)

- **root_key in v1 invite URL**: current long URL form carries the
  mesh root key in base64(JSON). Short-URL mode (`/i/<code>`) resolves
  to the same token server-side, so this does NOT reduce the exposure.
  v2 protocol moves root_key out of the URL but CLI migration is not
  yet shipped.
- **Session-key routing identity**: a peer can claim arbitrary
  `sessionPubkey` in hello (validated as 64-hex in alpha.36 but not
  proven-own). Proof-of-secret-key for session key is not enforced.
  Impact: a peer can route messages as any session pubkey it chooses
  but cannot decrypt replies without the matching secret, so the
  impact is DoS/confusion, not impersonation.
- **mesh.owner_secret_key stored plaintext** in the DB. A malicious
  broker can issue arbitrary invites. Mitigated only by DB access
  control.

## Review checklist for the reviewer

1. **libsodium usage**
   - Are nonces generated with `randombytes_buf` and never reused?
   - `crypto_box_easy` / `crypto_box_open_easy` order and parameters correct?
   - Are ed25519 keys converted to curve25519 on BOTH sides consistently?
   - Is `crypto_sign_detached` / `crypto_sign_verify_detached` used with the right message bytes?

2. **Invite protocol**
   - Canonical bytes v1 + v2 format strings stable across CLI and broker?
   - Replay protection: is a v1 URL reusable? (short URL + usedCount)
   - Is the `maxUses` counter race-safe? (atomic UPDATE with `lt`)
   - v2 root_key sealing: does `crypto_box_seal` fit the trust model?
   - Is recipient_x25519_pubkey validated on both shape and length?

3. **Audit chain**
   - Is the canonical JSON serialization reviewable and stable?
   - Does `pg_advisory_xact_lock` actually serialize writes on the same mesh under HA?
   - Can a malicious broker rewrite history by dropping the `lastHash` cache + DROPping rows + replaying with a new chain? (Yes — documented. Mitigation is append-only at the DB level.)

4. **At-rest encryption (broker-crypto.ts)**
   - AES-256-GCM with 12-byte IV + 16-byte tag — correct, but is the IV generation guaranteed random and unique per encryption?
   - Any concern about auth tag truncation or nonce collision under high volume?

5. **Backup (cli/commands/backup.ts)**
   - Argon2id params reasonable? (INTERACTIVE — should possibly be SENSITIVE.)
   - XChaCha20-Poly1305 parameter order?
   - Does the passphrase-minimum (12 chars) match the Argon2id parameters?
   - Is the salt stored alongside the ciphertext and read back correctly?

6. **Session vs member key**
   - When is which key used? Is there any path where one is trusted for the other's purpose?

7. **Hello signature**
   - Timestamp skew window (`±60s`) — does the broker reject out-of-window replays?
   - Is the canonical hello string covered by the signature exactly?

8. **Grants**
   - Can a peer bypass server-side grant enforcement by lying about their
     own sender key in hello? (Signature pins memberPubkey to a real
     signing key, but sessionPubkey isn't proven.)

## Test coverage supplied

- `apps/broker/tests/invite-signature.test.ts`
- `apps/broker/tests/invite-v2.test.ts`
- `apps/broker/tests/hello-signature.test.ts`
- `apps/broker/tests/audit-canonical.test.ts`
- `apps/broker/tests/grants-enforcement.test.ts`
- `apps/broker/tests/rate-limit.test.ts`
- `apps/broker/tests/encoding.test.ts`
- `apps/broker/tests/dup-delivery.test.ts`
- `apps/cli/tests/unit/crypto-roundtrip.test.ts`

## Deliverables expected from reviewer

1. **Findings list** — severity (crit/high/med/low), file:line, fix recommendation.
2. **Protocol-level critique** — anything in the invite or hello flow that can be exploited with a valid account.
3. **Tooling recs** — libsodium best-practice they'd follow differently.
4. **Go/no-go** for v1.0.0 GA assuming the findings are addressed.

## Budget

2 person-days. Hourly rate acceptable; fixed-fee preferred. Request
for quote from reviewers with published libsodium / PKI experience
(see recommended list below).

## Recommended reviewers

- Filippo Valsorda (independent, ex-Go crypto lead, known for age/tink reviews)
- Trail of Bits (firm-rate; their Tamarin+reviewer combo is strong)
- Latacora (firm; expensive but thorough)
- NCC Group (firm; good for libsodium-specific)
- Cure53 (firm; EU, fast turnaround)

## Review deliverable format

Markdown report with:
- Findings table (id, severity, file:line, summary, recommended fix)
- Protocol notes
- One-page exec summary for non-technical stakeholders
