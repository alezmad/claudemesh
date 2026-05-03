# `claudemesh daemon` — broker-hardening followups

> **Purpose**: refinements found during the v6 → v10 codex review series
> that are real improvements but **not** v0.9.0 blockers. The
> implementation target is `2026-05-03-daemon-spec-v0.9.0.md`. This
> document lists what was deferred, why, and the trigger that promotes
> each item to "must-do."
>
> **Background**: codex reviewed the daemon spec across 9 rounds (v1
> through v10). Rounds 1–4 found load-bearing architectural issues
> (identity, IPC auth, exactly-once lie, hook tokens, rotation, etc.).
> Rounds 5–9 found progressively finer correctness issues inside one
> subsystem (broker idempotency mechanics). v6 closed the architectural
> review; v7–v10 are increasingly fine-grained idempotency-correctness
> shavings on the same layer. Pre-launch (no users) doesn't need v7–v10
> level rigor. We pulled the cheap wins into v0.9.0; the rest waits.

---

## 1. B0 dedupe fast-path before rate-limit (v10)

**What v10 said**: read `mesh.client_message_dedupe` BEFORE consulting
the rate limiter. Existing id (match or mismatch) returns immediately
without touching rate-limit budget.

**Why deferred**: v0.9.0 doesn't have meaningful rate-limit pressure on
the daemon path. The split-brain failure (broker accepted, daemon
believes failure due to rate-limit-rejection-on-retry) requires
sustained saturated rate-limit windows, which don't exist pre-launch.

**Promote when**: any single mesh sees rate-limit rejections AND has
daemon retries against committed ids. Telemetry to watch:
`cm_broker_rate_limit_rejection_total` per mesh > 0 sustained.

**Implementation cost**: small — one indexed PK lookup before the
existing limiter call. The work is mostly testing the race semantics.

---

## 2. Lua-scripted idempotent rate limiter (v10)

**What v10 said**: limiter keyed by `(mesh_id, client_message_id,
window_bucket)` so retries-within-window consume budget at most once.

**Why deferred**: depends on (1) above. Without B0 fast-path this is
incremental complexity for marginal benefit. With B0 it becomes the
right belt-and-suspenders fix for the rare race where two same-id
requests both miss B0 simultaneously.

**Promote when**: B0 ships. Same trigger.

**Implementation cost**: medium — Lua script in Redis, careful TTL
tuning, integration with existing limiter call sites.

---

## 3. In-tx `mesh.mention_index` (v8)

**What v8 said**: mention-fanout index updates should commit inside the
broker accept transaction so mention-search reads can never see a
mention pointing at an uncommitted message.

**Why deferred**: the lag between accept-commit and async
mention-indexer is small (single-digit milliseconds in expected
deployment). Stale-read window during mention search is acceptable for
v0.9.0; receivers learn of mentions via the `mention` event in their
inbox stream regardless.

**Promote when**: real users complain about "I was mentioned but the
mention search doesn't show it" with reproducible cases that don't
self-heal in seconds.

**Implementation cost**: small — add `INSERT INTO mesh.mention_index`
to the accept transaction. The async indexer becomes a backfill
fallback rather than the primary path.

---

## 4. 4011 / 4012 close-code split (v6 §15.5)

**What v6 said**: split `4010 feature_unavailable` into three codes:
`4010` (missing), `4011` (params invalid), `4012` (params below floor).

**Why deferred**: v0.9.0 ships single `4010` with structured
`close_reason` JSON containing `kind`, `feature`, `detail`. Same
diagnostic information, simpler protocol surface.

**Promote when**: ops tooling or external monitoring needs distinct
status codes (e.g. PagerDuty rules that fire on 4012-only). Probably
never; structured JSON is parseable.

**Implementation cost**: trivial — three constants and a switch on
`close_reason.kind`.

---

## 5. Per-OS fingerprint precedence elaborate table (v8 §2.2.1)

**What v8 said**: comprehensive per-OS table covering Linux machine-id
sources, macOS `IOPlatformUUID`, Windows `MachineGuid`, BSD
`kern.hostuuid`, plus interface exclusion rules.

**Why deferred**: v0.9.0 ships with the simpler "machine-id ||
first-stable-mac" rule from v6. Edge cases (cloud images,
machine-id-not-readable, etc.) are documented when first hit.

**Promote when**: operators report fingerprint false-positives we can't
explain from the v6 rule. Each report adds one row to the per-OS
table.

**Implementation cost**: incremental — each OS-specific source is a
small probe function with a fallback chain.

---

## 6. `request_fingerprint` schema-version-2 in feature negotiation (v6 §15.1)

**What v6 said**: `client_message_id_dedupe` feature parameters
versioned independently. v0.9.0 ships at version 1 with a single
`request_fingerprint: bool` flag.

**Why deferred**: we don't yet need parameterized fingerprint variants
(different canonical forms, different hash algos). Version-bump path
is documented; we'll use it when we add the second fingerprint mode.

**Promote when**: we want a fingerprint algo other than sha256/JCS
(e.g. a faster hash, or a normalized canonical form).

**Implementation cost**: small — single feature-bit version bump
following the documented pattern.

---

## 7. Force-expiry / quarantine semantics for `keypair-archive.json` (v8 §14.1.1)

**What v8 said**: `max_archived_keys` cap with force-expiry; explicit
quarantine of malformed archive (`keypair-archive.json.malformed-<ts>`);
duplicate `key_id` rejection; mode-mismatch warning behavior.

**Why deferred**: v0.9.0 ships the simpler v6 rule — drop expired
entries on cleanup pass; refuse to start on malformed archive (loud,
operator-actionable). The v8 elaboration makes archive corruption
non-blocking, which is operationally nicer but trades off audit
clarity.

**Promote when**: a real operator hits an archive corruption that
shouldn't have brought the daemon down (e.g. mid-rotation crash leaves
a partially-written archive).

**Implementation cost**: small — quarantine logic + one extra startup
check.

---

## 8. Cross-language JCS conformance for `request_fingerprint` (v6 §4.4 round-6 question)

**What v6 asked**: does JCS work cross-language for
`meta_canonical_json`? Python json.dumps, Go encoding/json, and JS
JSON.stringify all behave differently. Should we ship a vetted JCS lib
in each SDK?

**Why deferred from v0.9.0**: the daemon ships in TypeScript only for
v0.9.0 (the `claudemesh-cli` package). Single-language JCS is trivial.
SDK ports come post-v0.9.0.

**Promote when**: we ship the Python or Go SDK. Each SDK port gets a
JCS conformance test against a corpus of envelopes.

**Implementation cost**: small per-language — a conformance fixture
file and a unit test.

---

## Sprint 7 (this session) — what landed vs deferred

**Landed in code** (not yet deployed):
- `packages/db/migrations/0028_message_queue_idempotency_fields.sql` adds
  nullable `client_message_id` and `request_fingerprint` columns to
  `mesh.message_queue` (additive, online-safe).
- `apps/broker/src/broker.ts` — `queueMessage` and `drainForMember`
  thread the new columns through.
- `apps/broker/src/index.ts` — `handleSend` picks them up from the
  daemon's wire envelope; outbound push echoes them back so receiving
  daemons can dedupe.
- `apps/broker/src/types.ts` — `WSPushMessage` declares the optional
  fields.

**Deployment plan (not auto-applied)**:
1. Apply migration against prod DB (the broker's filename-tracked
   migrator picks up `0028_*.sql` on next startup).
2. Deploy the broker with the code changes via Coolify.
3. Verify a daemon-originated send shows non-null `client_message_id`
   in `mesh.message_queue` afterwards.

**Still deferred** (full broker hardening):
- `mesh.client_message_dedupe` table with `request_fingerprint BYTEA`
  and atomic accept transaction (spec §4.7).
- Feature-bit advertisement on hello_ack of
  `client_message_id_dedupe` v1, with daemon-side enforcement (spec §15).
- Partial unique index `(mesh_id, client_message_id) WHERE NOT NULL`.

These sit behind the same trigger as the followups below: do them when
real users hit operational corners that this addressing doesn't cover.

---

## How to use this document

When picking up post-v0.9.0 work on the daemon:

1. Check whether any of the "promote when" triggers above have fired.
2. If yes, consult the corresponding versioned spec (v6/v7/v8/v9/v10)
   for the full proposed change.
3. Implement the lift, update `daemon-spec-v0.9.0.md` to reflect the
   merge, and remove the item from this followups list.

The versioned specs live in `.artifacts/specs/` indefinitely as a
review-trail audit.
