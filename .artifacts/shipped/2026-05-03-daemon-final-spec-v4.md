# `claudemesh daemon` — Final Spec v4

> **Round 4.** v3 was reviewed by codex (round 3) and got an overall pass on
> architecture but flagged three precision gaps: (1) broker dedupe window
> semantics — permanent or windowed? schema as drawn was permanent but the
> prose said 24h; (2) feature-bit negotiation should carry parameters, not
> just booleans (so daemon can derive its outbox TTL from broker policy
> instead of hardcoding 23h); (3) key-archive record format and retention
> behavior were unspecified. Plus minor polish: document machine-id/MAC
> source precedence per OS, explicitly defer arbitrary outbound hook sends,
> resolve RunPod identity-vs-hooks inconsistency.
>
> **The intent §0 is unchanged from v2 — read it there.** v4 only revises
> what changed from v3.

---

## 0. Intent — unchanged, see v2 §0

Pre-launch peer-mesh runtime. Servers/laptops become first-class peers.
Stable identity, persistent WS, local IPC, hooks. Not a webhook gateway, not
a generic broker. We can break anything.

**One claim retracted from v1/v2**: "exactly-once" delivery. Replaced with a
precise contract in §4 below.

---

## 1. Process model — unchanged from v3 §1 / v2 §1

Resource caps, file layout, single-binary unchanged.

---

## 2. Identity — accidental-clone detection only, plus broker dedupe

Codex round-2 fix retained: no boot-id (false-positives every reboot).
Codex round-3 polish: spell out fingerprint sources per OS so we don't ship
a brittle "machine-id || first-mac" with no precedence rules.

### 2.1 Modes

```
claudemesh daemon up                       # default: persistent member
claudemesh daemon up --ephemeral           # in-memory keypair, never written
claudemesh daemon up --ephemeral --ttl 2h  # auto-shutdown after duration
```

**CI auto-detection**: if any of these env vars are set (`CI=true`,
`GITHUB_ACTIONS`, `GITLAB_CI`, `BUILDKITE`, `CIRCLECI`, `JENKINS_URL`,
`KUBERNETES_SERVICE_HOST`), AND `--persistent` is not explicitly passed,
daemon defaults to `--ephemeral`. Rationale in §16.

`RUNPOD_POD_ID` removed from auto-CI list (was inconsistent — see §16.3).

### 2.2 Accidental-clone detection (NOT attacker-grade)

This catches **image clones, restored backups, copy-pasted homedirs** —
accidents made by humans. It does not defend against an attacker who copies
both `keypair.json` and `host_fingerprint.json`. The threat model (§16) says
this explicitly.

#### 2.2.1 Fingerprint source precedence (NEW — codex r3)

`host_fingerprint.json` stores `sha256(host_id || stable_mac)` where the
inputs are computed from the OS-specific table below, in order:

| OS | `host_id` (try in order) | `stable_mac` |
|---|---|---|
| Linux | `/etc/machine-id` → `/var/lib/dbus/machine-id` → first stable MAC | First non-loopback non-virtual interface, lex-sorted by name (`en…`/`eth…` before `wl…`); `docker0/veth*/br-*/lo` excluded |
| macOS | `IOPlatformUUID` (`ioreg -rd1 -c IOPlatformExpertDevice`) | First non-loopback non-virtual interface (`en0` typical) |
| Windows | `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` | First physical adapter (`Get-NetAdapter -Physical`), MAC sorted lex by adapter name |
| BSD | `kern.hostuuid` (`sysctl -n kern.hostuuid`) | Same MAC rule as Linux |

**Excluded interfaces** (cross-platform): loopback, point-to-point tunnels
(tailscale*, wg*, utun*, ppp*), docker (docker0, br-*, veth*), VPN
(`tap*`/`tun*`), VM bridges (vboxnet*, vmnet*), Apple awdl/llw bridges.

**Cloud-image false-positive note**: bare AMIs/Azure images regenerate
`/etc/machine-id` on first boot via cloud-init; for those, the first-boot
fingerprint is what we keep. If an operator clones a *running* VM
post-cloud-init, both `host_id` AND first-MAC will collide → the daemon
correctly flags this as an accidental clone.

If `host_id` cannot be read on the host's OS, daemon logs
`fingerprint_host_id_unavailable` and falls back to MAC-only. If MAC also
unavailable (truly headless container with no NIC), daemon logs
`fingerprint_unavailable`, persists a random UUID as `host_id`, and the
clone-detection feature is effectively disabled for this host (broker
concurrent-connection policy still works).

Behavior on mismatch (unchanged from v3): refuse / `accept-host` / `remint`.
`[clone] policy = "refuse" | "warn" | "allow"` overrides per host.

### 2.3 Concurrent-duplicate-identity broker policy — unchanged from v3 §2.3

`prefer_newest` (default), `prefer_oldest`, `allow_concurrent`. Configured
per-mesh in `mesh.cloneConcurrencyPolicy`.

### 2.4 Rename, key rotation — see §14

---

## 3. IPC surface — unchanged from v3 §3

Same frozen core, same auth model (UDS 0600 / TCP+SSE bearer / no token in
query / all endpoints auth by default / UDS-only in containers / Origin/Host
checks / no User-Agent theatre).

---

## 4. Delivery contract — at-least-once, **permanent** broker dedupe

Codex round 3 caught: v3's prose said "24h dedupe window" but the schema
(partial unique indexes with no `created_at`) gave **permanent** dedupe. We
have to pick. v4 chooses **permanent dedupe** because:

- It's the simplest correct choice. No GC job, no edge case where a
  long-asleep daemon's retry slips past the window and double-sends.
- The unique index storage cost is bounded: at 1 KB per row × 100k
  messages/day × 365 = ~36 GB/year of broker storage, which is well within
  the broker's existing message-retention budget. Older message rows
  themselves can still be GC'd by the existing message retention policy
  (currently 365d) — only the `client_message_id` column on retained rows
  has to live as long as that row does.
- It eliminates the daemon-side `max_age_hours = 23h` hack. Daemon outbox
  TTL becomes "however long you want to keep retrying"; default 7d.
- It removes a class of "where exactly is the dedupe window edge?" bugs.

If broker storage growth becomes a real concern post-v0.9.0, we can convert
to a windowed scheme via a feature-bit upgrade (§15) — but we'd own the
correct migration semantics then.

### 4.1 The contract (precise)

> **Local guarantee**: each successful `POST /v1/send` returns a stable
> `client_message_id`. The send is durably persisted to `outbox.db` before
> the response returns.
>
> **Broker guarantee**: the broker dedupes on `client_message_id`
> **permanently within the lifetime of the row**. Multiple inflight retries
> from the daemon for the same `client_message_id` produce **at most one**
> broker-accepted row, regardless of time elapsed (subject to message-row
> retention policy on the broker). This is advertised via the
> `client_message_id_dedupe` feature-bit with `{ mode: "permanent" }`
> parameter (§15).
>
> **End-to-end guarantee**: at-least-once delivery to subscribers, with
> `client_message_id` propagated in the inbound envelope so receivers can
> dedupe locally. We do **not** guarantee at-most-once end-to-end —
> receiver-side dedupe is the receiver's job. The daemon's `inbox.db`
> provides it for daemon-hosted peers.

### 4.2 Daemon-supplied `client_message_id` — unchanged from v3 §4.2

Sources: `Idempotency-Key` header → body `client_message_id` → daemon-minted
ulid. Stored in outbox UNIQUE NOT NULL, propagated to broker, propagated to
receivers.

### 4.3 Broker schema delta — clarified as permanent dedupe

```sql
ALTER TABLE mesh.topic_message
  ADD COLUMN client_message_id TEXT;
ALTER TABLE mesh.message_queue
  ADD COLUMN client_message_id TEXT;

CREATE UNIQUE INDEX topic_message_client_id_idx
  ON mesh.topic_message(mesh_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE UNIQUE INDEX message_queue_client_id_idx
  ON mesh.message_queue(mesh_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

-- No created_at column needed for dedupe; the existing message row's
-- created_at handles row-level retention. Dedupe is permanent for the row's
-- lifetime, then naturally GC'd when the row is purged.
```

Partial unique indexes — legacy traffic without `client_message_id` (from
`claudemesh launch`, dashboard chat, web posts) is unaffected.

**Migration**: additive-only. Online ALTER TABLE on Postgres takes the row
lock for the column add but not the index build (`CREATE UNIQUE INDEX
CONCURRENTLY` is safe). Deploy order: schema migration → broker code that
reads/writes `client_message_id` → daemon code that sends it → daemon
enforces feature bit.

### 4.4 Outbox schema — unchanged from v3 §4.4

`UNIQUE NOT NULL` on `client_message_id`. Default `max_age_hours` raised
back to **168h (7d)** because broker dedupe is permanent — no need to stay
inside a 24h window.

### 4.5 Inbox schema — unchanged from v3 §4.5

Content table + indexes; FTS5 deferred.

### 4.6 Crash recovery — unchanged from v3 §4.6

### 4.7 Failure modes — windowed-broker case removed

The "broker dedupe window expired" failure mode in v3 §4.7 is **deleted**
because dedupe is permanent. Remaining cases:

- **`dead` rows**: surface in `claudemesh daemon outbox --failed`. User
  manually requeues (`outbox requeue <id>`) or drops (`outbox drop <id>`).
- **Receiver-side dedupe**: only daemon-hosted receivers dedupe.
  `claudemesh launch` and dashboard chat don't dedupe today; post-v0.9.0.
- **Broker row already GC'd, daemon retries**: daemon retry hits the
  partial unique index → 23505 conflict. Broker treats as already-accepted,
  returns the original `messageId` from a soft-delete tombstone OR (if the
  row was hard-deleted by retention) returns `client_id_unknown`. Daemon
  treats `client_id_unknown` as "delivered, history may have been pruned"
  and marks `done`. Tombstone strategy is a broker implementation choice
  (advertised via `client_message_id_dedupe.tombstone_retention_days` in
  §15.1).

---

## 5. Inbound — unchanged from v3 §5

---

## 6. Hooks — scopes tightened (codex r2), explicit deferment of arbitrary sends (codex r3)

### 6.1 Hooks contract — unchanged from v2 §6 / v3 §6.1

### 6.2 Capability scopes — narrowed for v0.9.0

| Scope | Capability | Notes |
|---|---|---|
| `reply:event` | Reply to the specific event that triggered this hook | Bound to `event_id`; daemon validates target; expires on hook exit |
| `dm:send:<sender_pubkey>` | Send DM only to the specific sender | Bound to one pubkey from event; not a write to anyone |
| `topic:<name>:post` | Post to the specific topic that fired | Bound to topic from event; can't write elsewhere |

**No read scopes in v0.9.0.** Hooks read via the event payload (which the
daemon redacts appropriately), not via daemon-mediated reads.

**Explicitly deferred to post-v0.9.0** (codex r3 — say it out loud so use
cases don't pile up against an undocumented limit):

- **Arbitrary outbound `dm:send` to anyone other than the event sender** —
  no scope grant for this. "Escalate to oncall" hooks must shell out to
  `claudemesh send <oncall>` with the user's normal config; the daemon
  doesn't issue capability tokens for arbitrary recipients.
- **Cross-topic post** — a hook firing on `topic:alerts` cannot post to
  `topic:incidents`. Same reason.
- **Mesh-cross post** — hooks see one mesh at a time.
- **Reading state/inbox/peers** — covered above.

If a real use case demands cross-topic or arbitrary-recipient hooks
post-v0.9.0, we add scopes like `dm:send:*` (wildcard) or
`topic:*:post` (wildcard) and gate them behind explicit operator opt-in in
config (`[hooks.<name>] dangerous_wildcards = true`). Not in v0.9.0.

### 6.3 Sandboxing — unchanged from v3 §6.3

Best-effort `network_policy = "deny"`; cross-platform unenforceability
acknowledged; counter `cm_daemon_hook_unenforceable_total` exposed.

### 6.4 Payload size & truncation — unchanged from v3 §6.4

### 6.5 Audit log + killpg — unchanged

---

## 7. Multi-mesh — unchanged

## 8. Auto-routing — unchanged

## 9. Service installation — unchanged

## 10. Observability — unchanged

## 11. SDKs — unchanged

## 12. Security model — unchanged

---

## 13. Configuration — unchanged shape, plus parameterized features

```toml
[features]
require = [
  "client_message_id_dedupe",       # broker provides §4.1 contract
  "concurrent_connection_policy",   # broker honours mesh.cloneConcurrencyPolicy
]
optional = ["mesh_skill_share", "mcp_host"]
# Daemon refuses to start if broker doesn't advertise all `require` bits.
# Broker advertises feature parameters in the negotiation response (§15.1)
# — daemon picks up `dedupe_mode` and `tombstone_retention_days` from there
# and writes them to its runtime view, not config.
```

---

## 14. Lifecycle — key rotation crypto fixed (codex r2), archive format spec'd (codex r3)

### 14.1 Key rotation — crypto correct (codex r2)

`claudemesh daemon rotate-keypair`:

- Mints fresh ed25519 + x25519 keypairs.
- Registers new pubkeys with the broker as `member_keypair_rotated` event.
- Broker associates the new pubkey with the same member id, marks the old
  pubkey as `rotated_out` (not revoked); senders who haven't received the
  rotation event continue to encrypt to the old pubkey for a grace window.
- Daemon retains the old x25519 **private** key (only x25519 — ed25519 is
  for signing, doesn't need a grace window) in `keypair-archive.json`.
- During grace, decrypt path: try current private key first; on
  `crypto_box_open_easy` failure, walk archived keys in order. Successful
  archived-key decrypts increment `cm_daemon_decrypt_archived_total`.
- After grace expiry, archived keys are zeroed and the file is rewritten
  without them. Messages still encrypted to a fully-expired pubkey fail to
  decrypt and increment `cm_daemon_decrypt_stale_total`.

#### 14.1.1 Archive record format (NEW — codex r3)

`keypair-archive.json` (mode 0600, atomic-rename writes):

```json
{
  "schema_version": 1,
  "max_archived_keys": 8,
  "keys": [
    {
      "pubkey":            "ed25519-base64...",
      "x25519_pubkey":     "base64...",
      "x25519_privkey":    "base64...",     // sensitive; whole file is 0600
      "key_id":            "k_01HQX...",     // ulid; matches broker's record
      "created_at":        "2026-04-12T11:00:00Z",
      "rotated_out_at":    "2026-05-03T16:00:00Z",
      "expires_at":        "2026-05-10T16:00:00Z"   // rotated_out_at + grace
    }
  ]
}
```

Rules:

- **`max_archived_keys`** (default 8): cap on archive size. If a rotation
  would push the archive past the cap, the oldest entry is force-expired
  (zeroed + removed) regardless of `expires_at`. Force-expiry increments
  `cm_daemon_archive_force_expired_total{key_id}`. Operator who rotates
  faster than 8 keys per grace-window-duration is intentionally accepting
  decryption gaps for very-late inbound messages encrypted to those keys.
- **Grace period default**: 7 days. Configurable via
  `[crypto] key_grace_period_days = 7`. Hard cap 30 days (codex review:
  unbounded grace = unbounded archive on disk = bigger blast radius if
  daemon host is compromised mid-life).
- **Cleanup**: scheduled daily at midnight local time + on-demand via
  `claudemesh daemon archive-cleanup`. Walks `keys[]`, drops anything with
  `expires_at < now`. If file is empty after cleanup, file is deleted.
- **Archive write failure**: rotation is aborted. Daemon refuses to commit
  the new keypair if the archive can't be written durably. Logged as
  `key_rotation_aborted_archive_write_failed`. New keypair is in memory
  only; restart returns to old keypair. This is intentional: the archive
  write is the durability point of rotation.
- **At-rest encryption**: archive file is mode 0600 plaintext, same threat
  model as `keypair.json` (root-on-host can read both anyway). Operators
  who want disk-level encryption can put `~/.claudemesh/` on an encrypted
  volume; we don't reinvent that. Documented in the threat model (§16).
  Future option `--archive-passphrase` deferred — adds passphrase prompt to
  rotation/decrypt path, but breaks unattended daemon restart.

### 14.2 Backup includes topic state — unchanged from v3 §14.2

`keypair.json`, `keypair-archive.json` (with all archived keys),
`host_fingerprint.json`, `config.toml`, `topic_subscriptions.json`,
`topic_keys.json`, `key_epoch.json`, `schema_version`.

`local_token` NOT included; regenerated on restore.

### 14.3 Local token rotation, compromised host revocation, image-clone, uninstall, recovery — unchanged from v2 §14.3

---

## 15. Version compat — feature-bit negotiation with **parameters** (codex r3)

v3's feature bits were boolean. Codex r3: dedupe-window, max-payload, key
epochs all need parameters. v4 makes feature bits string-keyed entries that
optionally carry a value.

### 15.1 Feature bits with parameters

| Bit | Type | Parameters | Notes |
|---|---|---|---|
| `client_message_id_dedupe` | object | `{ mode: "permanent"\|"windowed", window_hours?: int, tombstone_retention_days: int }` | Daemon reads `mode` to decide whether to enforce its own outbox max-age cap. `tombstone_retention_days` (broker-controlled) tells daemon how long it can expect "already-accepted" replies after the source row is GC'd |
| `concurrent_connection_policy` | bool | — | Broker honours `mesh.cloneConcurrencyPolicy` |
| `member_keypair_rotated_event` | bool | — | Broker emits the event |
| `key_epoch` | object | `{ max_concurrent_epochs: int }` | Per-topic key epochs supported |
| `max_payload` | object | `{ inline_bytes: int, blob_bytes: int }` | Hard limits broker enforces |
| `mesh_skill_share` | bool | — | Future |
| `mcp_host` | bool | — | Future |

### 15.2 Negotiation handshake (parameterized)

On WS connect, after hello, before normal traffic:

```
→ daemon:  feature_negotiation_request
           {
             require:  ["client_message_id_dedupe",
                        "concurrent_connection_policy"],
             optional: ["mesh_skill_share","mcp_host","max_payload"]
           }

← broker:  feature_negotiation_response
           {
             supported: {
               "client_message_id_dedupe": {
                 "mode": "permanent",
                 "tombstone_retention_days": 30
               },
               "concurrent_connection_policy": true,
               "member_keypair_rotated_event": true,
               "max_payload": {
                 "inline_bytes": 65536,
                 "blob_bytes": 524288000
               }
             },
             missing_required: []
           }
```

If `missing_required` is non-empty, daemon closes the connection with code
4010 `feature_unavailable`, logs forensic event, exits non-zero. Supervisor
sees a restart-loop → operator alert.

If `client_message_id_dedupe.mode == "windowed"`, daemon reads
`window_hours` and configures its outbox `max_age_hours` to
`window_hours - 1` (margin) instead of the 168h default. Permanent mode →
daemon uses the config default, no override.

### 15.3 IPC negotiation — unchanged from v3 §15.3

`GET /v1/version` returns daemon version, IPC features, schema version, and
the **parsed** broker feature parameters (so SDKs querying the daemon can
display them).

### 15.4 Compatibility matrix — unchanged from v3 §15.4

Published at `GET /v1/compat`.

---

## 16. Threat model — unchanged from v3 §16, plus RunPod fix

### 16.1 Attacker classes — unchanged

### 16.2 Out of scope — unchanged

### 16.3 Container & CI defaults table (RunPod inconsistency fixed)

| Environment | Identity | IPC | Hooks | Rationale |
|---|---|---|---|---|
| Bare metal / VM (default) | Persistent (clone-detected) | UDS + TCP loopback | Enabled | Trusted operator-owned host |
| Docker container (`/.dockerenv`) | Persistent | UDS-only by default | Enabled | Single-tenant container, host loopback shared |
| Kubernetes (`KUBERNETES_SERVICE_HOST`) | Persistent | UDS-only | Enabled | Single pod = single tenant |
| CI (`CI=true`, `GITHUB_ACTIONS`, etc.) | Ephemeral | UDS-only | Disabled by default (`[hooks] enabled = false`) | Multi-tenant runner; arbitrary code; ephemeral identity = no cross-job leak; hooks disabled because CI workloads are arbitrary user code |
| RunPod (`RUNPOD_POD_ID`) | Persistent | UDS-only | Enabled | Long-lived single-tenant sandbox; user owns the pod for its lifetime; identical trust model to a Docker container, NOT to a CI runner |

**RunPod resolution (codex r3)**: v3 listed RunPod under both "ephemeral
identity" and "hooks enabled" which was contradictory. v4 treats RunPod as
a **single-tenant container** (Docker-like): persistent identity, UDS-only,
hooks enabled. RunPod is removed from the CI auto-detect list (§2.1).
Operators who run RunPod as multi-tenant sandbox-as-CI can opt in with
`--ephemeral` + `[hooks] enabled = false` explicitly.

Operator overrides any default with explicit flags; warning logged for
non-default-secure choices.

---

## 17. Migration — unchanged from v3 §17

Broker schema delta (additive partial unique indexes, safe online),
deployed before daemon. Daemon refuses to start if `client_message_id_dedupe`
feature bit is missing from broker's negotiation response.

---

## What changed v3 → v4 (codex round-3 actionable items)

| Codex r3 item | v4 fix | Section |
|---|---|---|
| Broker dedupe window: permanent vs windowed? | **Picked permanent**; schema clarified; outbox `max_age_hours` raised back to 168h | §4 |
| Feature bits should be parameterized | All feature bits are string-keyed with optional value object | §15.1, §15.2 |
| Key archive record format unspecified | Full schema with `key_id`, timestamps, `max_archived_keys`, force-expiry rule, write-failure semantics | §14.1.1 |
| Document fingerprint source precedence per OS | Per-OS table for `host_id` and stable MAC; cloud-image false-positive note | §2.2.1 |
| Explicit deferment of arbitrary outbound hook sends | Listed deferred capabilities + escape hatch path post-v0.9.0 | §6.2 |
| RunPod ephemeral-but-hooks-enabled inconsistency | RunPod treated as single-tenant container; removed from CI auto-detect | §2.1, §16.3 |

---

## What needs review (round 4)

Round 1 → identity, IPC auth, exactly-once lie, hook tokens, surface bloat,
missing rotation/recovery/migration/threat-model.

Round 2 → boot-id false-positive, broker must dedupe on client id, CI
shared-runner reality, feature-bit negotiation, key rotation crypto, hook
scopes, FTS schema, ~7 polish items.

Round 3 → dedupe window semantics, feature-bit parameters, key archive
record format, fingerprint source precedence, deferred hook scopes, RunPod
inconsistency.

This v4 attempts to address all of round 3. Specifically:

1. **Permanent dedupe choice (§4)** — does the storage-cost calculus hold?
   Is the tombstone path (`client_id_unknown` after row GC) actually
   workable, or does it need to be a real tombstone table?
2. **Feature parameter shape (§15.1)** — is the type system right (object
   with optional value)? Should it be a flat key-value list instead?
   Versioning of parameters within a feature?
3. **Archive record format (§14.1.1)** — anything missing? Is
   `max_archived_keys=8` a sensible default, or should it be unbounded with
   a force-expiry on storage size instead of count?
4. **Fingerprint per-OS table (§2.2.1)** — accurate? Is BSD worth listing
   if we're not actively building for FreeBSD in v0.9.0?
5. **Hook deferment list (§6.2)** — does it cover all the realistic v0.9.0
   ask? Is the "shell out to `claudemesh send`" workaround for escalation
   ergonomically acceptable?
6. **RunPod resolution (§16.3)** — agree with treating RunPod as
   single-tenant container? Or are there real multi-tenant RunPod
   deployments we should default-guard against?
7. **Anything else still wrong?** Read it as if you were going to operate
   this for a year. What falls down?

Three options after this review:
- **(a) v4 is shippable**: lock the spec, start coding the frozen core.
- **(b) v5 needed**: list the must-fix items.
- **(c) the architecture itself is wrong**: what would you do differently?

Be ruthless. We can break anything.
