# v2.0.0 Daemon Redesign — Completion Roadmap

**Date:** 2026-05-04
**Owner:** alezmad
**Status:** in-progress (1.24.0 + 1.25.0 land most of it; remainder is two follow-up arcs)

## What's done

| v2.0.0 bullet | Version | Status |
|---|---|---|
| `claudemesh-daemon` long-lived launchd / systemd unit | 1.22.0 | ✅ Done |
| MCP server shrinks to thin daemon adapter | 1.24.0 | ✅ Done — 979 → ~200 LoC of push-pipe, daemon-required, no fallback |
| `claudemesh install` auto-installs + starts daemon | 1.24.0 | ✅ Done |
| `claudemesh launch` ensures daemon | 1.24.0 | ✅ Done |
| Daemon outbound routing (Sprint 4: real targets + crypto) | 1.25.0 | ✅ Done — outbox stores `mesh`, `target_spec`, `nonce`, `ciphertext`, `priority`; resolution + `crypto_box` happens at IPC accept time; drain is a forwarder |
| CLI thin-client routing for read verbs | 1.25.0 | ✅ Partial — `peer list`, `skill list/get` route through daemon when present; same `trySendViaDaemon` fallback shape |
| Ambient mode (raw `claude` Just Works) | 1.25.0 | ✅ Documented + functional for the daemon's attached mesh |

## What remains (in dependency order)

### A. Daemon multi-mesh (the prerequisite for "ambient mode for everything")

**Why it's the critical path:** ambient mode today only works for the single mesh the daemon is attached to. Users with N meshes either run N daemons (different sock paths) or restart the daemon to switch. Neither is acceptable for the v2.0.0 promise.

**What it takes:**
- Daemon holds `Map<slug, DaemonBrokerClient>` instead of one broker.
- Outbox row's `mesh` column (1.25.0 added) is the dispatch key.
- IPC `/v1/send` requires `mesh` field (or infers from target prefix `<slug>:<target>`).
- IPC read endpoints (`/v1/peers`, `/v1/skills`, `/v1/profile`) accept `?mesh=<slug>` or return mesh-grouped results.
- SSE event payloads already include `mesh` slug; no change needed.
- Drain worker selects broker by row's `mesh` column.
- `daemon up` with no `--mesh` attaches to all joined meshes; with `--mesh X` restricts to X (legacy mode for explicit single-mesh).
- Inbox dedupe keeps using `client_message_id` UNIQUE; mesh column for filtering only.

**Estimated effort:** 1 week. ~600 LoC across `run.ts`, `drain.ts`, `ipc/server.ts`, plus tests for per-mesh dispatch.

**Risk:** medium. The single-mesh assumption is baked into a few places (peer-list response shape, skill-list response shape). Need to choose: per-mesh tagged responses (breaking) or array-of-meshes wrapped responses (additive). Recommend the latter for back-compat.

### B. HKDF-derived peer keypairs (cross-machine identity)

**Why it matters:** today each install per machine = fresh keypair = different mesh member identity. User signs in on laptop and desktop and shows up as two different members. v2.0.0 promised "same identity across machines."

**What it takes:**
- `HKDF(account_secret, info: "claudemesh/mesh/<mesh_id>/peer", salt: <user_id>)` derives a deterministic ed25519 keypair per mesh.
- `account_secret` derives from the user's authenticated session — needs broker-side endpoint to vend it on first install.
- Enrollment flow changes: instead of generating a fresh keypair, derive it. Subsequent installs find the same pubkey already in `mesh.member` and skip enrollment.
- Migration: existing members keep their old keypairs (they're stored in config). Only new joins use HKDF. Optional: opt-in re-enrollment for users who want cross-machine sync.
- Broker hello-sig protocol unchanged (still ed25519 sign).

**Estimated effort:** 2-3 weeks. Touches enrollment, broker auth, dashboard, security review.

**Risk:** high. Crypto change with security implications. Needs design review (account_secret distribution security, HKDF salt choice, key compromise recovery story).

### C. Mesh → workspace public surface rename

**Why it matters:** "mesh" is internal jargon for what users experience as "a workspace." v2.0.0 calls for the rename to align UX language.

**What it takes:**
- All CLI verbs gain `workspace` aliases (`claudemesh workspace list` ≡ `claudemesh list`).
- Help text, docs, README, marketing site updated.
- DB tables stay `mesh_*` (migration cost prohibitive; not user-visible).
- Wire protocol stays `mesh_*` (broker change too disruptive).
- Eventually deprecate the `mesh` aliases (~2 minor versions later).

**Estimated effort:** 3-4 days. Mostly rote search/replace + new aliases.

**Risk:** low. Cosmetic.

### D. Full CLI-to-thin-client conversion

**Why it matters:** today the CLI has bridge + cold-path code that duplicates ~3000 LoC of broker WS / crypto / decode logic that the daemon also has. Once daemon is multi-mesh, every verb can become "open IPC, send request, render response."

**What it takes:**
- Each verb: replace `withMesh(...)` (which opens its own broker WS) with `daemonOnly(...)` (calls IPC, errors if daemon down).
- Drop `bridge/server.ts`, `bridge/client.ts`, `bridge/socket-broker.ts` entirely.
- Drop most of `services/broker/ws-client.ts` from the CLI build (kept only for daemon's internal use).
- CLI binary shrinks ~30-40%.
- Daemon becomes the only broker WS holder per user.

**Estimated effort:** 1 week. Mostly mechanical; strict typescript catches most issues.

**Risk:** medium. Breaks workflows where CLI is used without daemon (CI environments, headless scripts). Need to keep a `--no-daemon` escape hatch or document the constraint.

## Recommended sequencing

```
1.25.0 (today): Sprint 4 outbound routing + CLI thin-client read paths + ambient mode docs
1.26.0 (next): A. Daemon multi-mesh — "ambient mode for everything"
1.27.0:        D. CLI-to-thin-client conversion — drops ~3000 LoC
1.28.0:        C. Mesh → workspace rename (aliases shipped, no removal yet)
2.0.0:         B. HKDF identity (separate security-reviewed arc)
```

A → D → C → B is the right order:
- A unblocks ambient mode for multi-mesh users (highest UX value).
- D unblocks the LoC reduction the v2.0.0 promise mentioned ("3000 LoC removed").
- C is cosmetic; do it once D has stabilized.
- B is the most security-sensitive; do it last, with proper review.

## Out of scope for the v2.0.0 endpoint

- **Topic crypto (Sprint 5+).** Topics still ship as base64 plaintext. Real per-topic encryption is a v0.3.0 operator-layer item, parallel track.
- **Broker hardening for daemon idempotency (Sprint 7).** Partial unique index on `(mesh_id, client_message_id) WHERE NOT NULL` and the `mesh.client_message_dedupe` table. Documented in `2026-05-03-daemon-spec-broker-hardening-followups.md`.
- **`launch` deprecation.** 1.25.0 docs now recommend ambient mode for default cases; `launch` stays as the override path. Full deprecation is a 2.x decision.
