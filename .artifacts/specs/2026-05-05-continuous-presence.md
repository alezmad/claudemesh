# Continuous presence — lease model + resume token

**Status:** spec, ready for v0.3.0.
**Owner:** alezmad
**Author:** Claude (2026-05-05, follow-up to user-reported "after hours claudemesh disconnects")
**Related:** `2026-05-04-per-session-presence.md` (per-launch ephemeral keypair), `apps/broker/src/index.ts:5430-5436` (current 30s ping loop), `apps/cli/src/daemon/ws-lifecycle.ts` (current backoff reconnect).

## Problem

Today, presence is fused to a single TCP/WS connection. When the
connection breaks — half-dead NAT entries, ISP route changes, laptop
sleep, broker restart — the broker tears down the presence row, fires
`peer_left`, and waits for the daemon to dial a fresh socket and run
the full attestation hello again. Other peers see the user blink
offline → back online. Messages sent to the session during the gap are
either dropped (if it's a `now`/`next` priority DM with no recipient
match) or held in `message_queue` for `low` only.

Concrete symptom (user-reported): `claudemesh peer list` shows zero
peers despite multiple sessions being "up" — they're stuck on
half-dead TCP connections. Daemon hasn't noticed because no `close`
fired. Hours later, kernel TCP keepalive (default Linux: 7200s idle +
9 × 75s probes ≈ 2h11m) finally RSTs the socket, daemon's existing
backoff reconnects, peers reappear. Until then: zombie session.

Two coupled bugs:

1. **No application-layer staleness detection.** Broker pings every
   30s (line 5431) and updates `lastPingAt` on pong, but never
   `terminate()`s a connection that stops returning pongs. Daemon
   doesn't ping at all. Both sides trust the kernel for liveness,
   which only fires after hours.

2. **Presence == connection.** Even once the staleness IS detected
   and the daemon reconnects, peers see a full `peer_left` /
   `peer_joined` cycle for a network blip that took 1–30 seconds.
   Outbound messages during the gap that target the session by
   pubkey route to nothing.

The user's ask: peers should never see a gap during transient
disconnects. Presence should be continuous as long as the *session
intent* is alive, regardless of how many sockets carried it.

## Goal

Presence is a **lease** keyed off the session's stable identity
(`sessionPubkey`), held in broker memory + DB, with a TTL refreshed
on every keepalive. Sockets come and go beneath the lease. Other peers
see continuous online status across reconnects up to the lease TTL.

Specifically:

- A daemon (or per-session WS) can drop and re-establish the WS
  within a configurable grace window (default 90s) without any peer
  observing `peer_left` / `peer_joined`.
- Messages sent to a session while its socket is mid-flap are queued,
  delivered on the next reattach, ordered.
- Reconnect itself is sub-second on the wire when a `resume_token` is
  presented — broker recognises the session, restores the slot, no
  re-attestation round-trip.
- After the grace window expires, the broker fires `peer_left`
  exactly once; on a later reconnect it fires `peer_joined` exactly
  once. No flapping.

## Non-goals

- **Multi-broker handoff.** Out of scope. If the broker process
  restarts, leases are lost and we fall back to today's behavior
  (clean reconnect, peers see one cycle). A future spec can address
  this with a shared lease store (Redis / Postgres LISTEN).
- **Dual-socket on the daemon.** Useful gold-plating but not required
  for the user-facing problem. Single-socket with watchdog +
  resume-token covers the failure modes actually observed (NAT drops,
  ISP blips, sleep <90s).
- **Manual `claudemesh reconnect` CLI.** Not needed; the lease model
  makes it redundant. Re-evaluate if real support cases surface.

## Design

### Lease model

```
sessionPubkey  →  { transport: "online" | "offline",
                    leaseUntil: Date,
                    ws: WebSocket | null,
                    ...existing PeerConn fields }
```

Today the `connections` Map IS keyed by `presenceId`, which is a fresh
UUID per WS. We change that key to `sessionPubkey` (member-WS:
`memberPubkey`; session-WS: `sessionPubkey`). The PeerConn struct
gains:

```ts
transport: "online" | "offline";
leaseUntil: Date;          // Date.now() + LEASE_TTL_MS
evictionTimer: NodeJS.Timeout | null;
```

### State transitions

**On WS open + hello accepted (initial):**
- Insert into `connections` with `transport: "online"`,
  `leaseUntil: now + 90s`, `evictionTimer: null`.
- Broadcast `peer_joined` (today's behavior).
- Issue `resume_token` (see below) in the `hello_ack`.

**On WS open + hello carries valid `resume_token`:**
- Look up by `sessionPubkey`, verify token signature + freshness
  (TTL <= LEASE_TTL_MS). If valid AND entry exists with
  `transport: "offline"`:
  - Cancel `evictionTimer`.
  - Swap `ws` reference.
  - Set `transport: "online"`, refresh `leaseUntil`.
  - **Do NOT** broadcast `peer_joined`. The lease never expired.
  - Drain any queued DMs accumulated during offline window.
  - Reply `hello_ack` with new `resume_token`.
- If entry exists with `transport: "online"` (token replay attack or
  rapid reconnect race): close old `ws` with `1000, "session_replaced"`
  before swapping. Same as today's `oldConn.ws.close(1000, ...)`
  pattern at lines 1768/1996.
- If no entry exists or token is stale: treat as a fresh hello,
  broadcast `peer_joined`. Token expired = same as a cold start.

**On WS close (any reason):**
- Look up by `sessionPubkey`. If not found, no-op (already evicted).
- Set `transport: "offline"`, clear `ws` reference.
- Start `evictionTimer = setTimeout(evict, GRACE_MS)`.
- **Do NOT** broadcast `peer_left`. **Do NOT** delete the entry.
- **Do NOT** call `disconnectPresence(presenceId)` yet.

**On `evictionTimer` fire (lease expired without reattach):**
- Delete from `connections`.
- Broadcast `peer_left` (today's behavior at lines 5167-5189).
- `decMeshCount`.
- `disconnectPresence(presenceId)`.
- Clean up URL watches, stream subs, MCP registry — same as today's
  close handler.
- Audit `peer_left`.

**Watchdog (broker):**
- The 30s ping loop (line 5431) gains a staleness check: if any
  conn's `transport === "online"` and `lastPingAt < now - 75s`, call
  `ws.terminate()`. This converts the half-dead socket into a clean
  `close` event, which fires the lease-offline transition above.
- Same logic on the daemon side (see § Daemon changes).

### Resume token

A short opaque string the broker hands the daemon in `hello_ack`.
Format: `mesh-resume.v1.<base64url(JSON-payload)>.<base64url(sig)>`
where `JSON-payload = { sub: <sessionPubkey>, mid: <meshId>, exp:
<unix-ms>, iat: <unix-ms> }` and `sig = ed25519(brokerSigningKey,
JSON-payload)`.

- **Why a token, not just sessionPubkey?** A session needs to prove
  it's the holder of an existing lease without re-running the full
  attestation handshake (which involves member key + parent
  attestation lookup). The token is a server-issued cookie: cheap to
  verify, scoped to a single session, expires with the lease.
- **Storage:** broker keeps the signing key in env (`RESUME_TOKEN_KEY`,
  generated on first boot if missing, persisted to a config row). No
  DB column needed for the tokens themselves — they're verified by
  signature alone.
- **TTL:** equal to LEASE_TTL_MS (90s). After that the daemon must
  re-handshake with full attestation. Refreshed on every successful
  reattach.
- **Daemon storage:** in-memory only. Lost on daemon restart, which
  is correct: a daemon restart is a real reconnect and should run
  the full hello.

### Wire protocol additions

`hello` (member-WS, session-WS, fresh-launch hello — all three):
```diff
{
  type: "hello",
  memberPubkey: "...",
  sessionPubkey: "...",         // session-WS only
  attestation: "...",            // session-WS only
  signature: "...",
+ resumeToken?: "mesh-resume.v1...",   // optional; presence = reattach attempt
  ...
}
```

`hello_ack`:
```diff
{
  type: "hello_ack",
  presenceId: "...",
  ...
+ resumeToken: "mesh-resume.v1...",   // always issued; replaces prior on reattach
+ leaseTtlMs: 90000,                  // informational; daemon may use for ping cadence
}
```

No new message types. Old daemons that don't send `resumeToken` get
today's full-handshake behavior — fully backward compatible.

### Message queue during grace window

Today: DMs to a presence whose WS is closed → routed to
`message_queue` only for `priority: low`; `now`/`next` either route
to a different connected session of the same member or drop.

Change: when broker would route to a session whose
`transport === "offline"` (lease still valid), enqueue regardless of
priority. On reattach, the existing inbox-drain path
(`maybePushQueuedMessages` at line 967) flushes them in order. The
`message_queue` already has the schema for this; we're just relaxing
the priority gate when the target is in grace.

### Constants

```ts
const LEASE_TTL_MS = 90_000;          // grace window after WS close
const PING_INTERVAL_MS = 30_000;      // unchanged
const STALE_PONG_THRESHOLD_MS = 75_000; // 2.5x ping interval
const RESUME_TOKEN_TTL_MS = LEASE_TTL_MS;
```

`LEASE_TTL_MS` = 90s rationale: long enough to absorb a sleep/resume
cycle, NAT timeout, ISP route flap, mobile→wifi handover. Short
enough that a true crash (daemon killed, machine off) clears the
session within 90s — peers don't see ghost online status forever.
Configurable via env (`LEASE_TTL_MS`) for self-hosted brokers.

## Daemon changes

### Watchdog

In `ws-lifecycle.ts`, add an `idleWatchdog` parallel to the existing
backoff/reconnect machinery:

```ts
let lastActivity = Date.now();   // bumped on every incoming message + pong
const watchdog = setInterval(() => {
  if (Date.now() - lastActivity > STALE_THRESHOLD_MS) {
    log("warn", "ws_stale_terminate", { url: opts.url });
    sock.terminate();   // fires existing close handler → reconnect path
  } else if (sock.readyState === sock.OPEN) {
    sock.ping();        // matches broker's 30s cadence, gives broker a pong
  }
}, PING_INTERVAL_MS);
sock.on("message", () => { lastActivity = Date.now(); });
sock.on("pong", () => { lastActivity = Date.now(); });
```

Cleanup `clearInterval(watchdog)` in the close handler and explicit
`close()` path.

### Resume token in hello

`apps/cli/src/daemon/broker.ts:136` and equivalent in
`session-broker.ts`: persist the `resumeToken` from each successful
`hello_ack` into a private field, include it in the next
`buildHello()` call. On daemon restart the field is empty → cold
start, exactly today's behavior.

### No CLI changes

`claudemesh peer list` keeps reading the broker's `connections` Map
which now reflects continuous presence. Users see online sessions as
online during transient blips. No UX surface changes.

## Migration

- New broker is fully backward compatible with old daemons (resume
  token is optional, defaults fall through to today's path).
- New daemons against an old broker: token is sent but ignored, full
  handshake runs each reconnect — same as today.
- DB migration: none. `presence` table semantics unchanged. The
  `disconnectedAt` column is now set only on lease eviction (>90s),
  not on every WS close. This is a behavioral change but not a
  schema change.
- Add ENV var `RESUME_TOKEN_KEY` (broker generates on first boot if
  unset, persists to a singleton config row).

## Test plan

1. **Sleep test:** kill -STOP the daemon for 60s, then kill -CONT.
   Expect: peers never see `peer_left`. Daemon's WS is dead-on-arrival
   when it wakes; watchdog terminates it; reconnect with resume_token
   succeeds within 1-2s; lease was at ~30s of its 90s TTL when the
   daemon resumed.

2. **Hard offline:** kill -STOP for 120s, kill -CONT. Expect: peers
   see exactly one `peer_left` at t=90s, then exactly one
   `peer_joined` after the daemon resumes and reconnects (resume
   token is now stale; full handshake runs).

3. **NAT drop simulation:** `iptables -A OUTPUT -p tcp --dport 443
   -j DROP` for 60s on the daemon host, then remove the rule. Expect:
   broker pings stop landing, broker-side watchdog calls
   `ws.terminate()` at t=75s, lease enters grace, daemon's own
   watchdog fires within ~30s, daemon reconnects with resume_token,
   peers never see a flap.

4. **Message-during-grace:** while a target session is in grace
   (offline, lease valid), send a `priority: now` DM. Expect: queued
   in `message_queue`, delivered exactly once on reattach, no
   `peer_left` visible to sender, ack returns delivered.

5. **Replay attack:** capture a resume_token in flight, replay it
   against a different broker connection while the original session
   is still online. Expect: broker treats it as a reconnect for an
   already-online session → closes old WS with `session_replaced`,
   new WS takes over. Equivalent to today's session-replacement
   semantics; the original session detects the close and either
   reconnects (if it's still alive) or gives up.

6. **Token forgery:** send a `resumeToken` not signed by the broker.
   Expect: signature check fails, broker treats hello as a fresh
   handshake (or rejects if the rest of the hello is invalid).

## Open questions

- **Should `peer list` expose a `transport` field** so callers can
  distinguish "leased but offline" from "online"? Default no — the
  abstraction we're selling is "they're online." But debugging may
  want it; gate it behind `--all` or `--debug`.
- **What about the broker-side `mcpRegistry` cleanup?** Today we
  delete non-persistent MCP entries on WS close (line 5217). With
  leases, we should defer that to lease eviction, not WS close.
  Otherwise an MCP server registered by a session disappears every
  time its WS reconnects.

## Build order

1. **Broker lease model** — change `connections` keying, add
   `transport`/`leaseUntil`/`evictionTimer`, refactor close handler
   to start grace timer instead of immediate teardown, refactor
   eviction path. (~80 lines.)
2. **Resume token** — signing key bootstrap, token issue/verify,
   wire format, hello_ack changes. (~50 lines + 1 config row.)
3. **Daemon watchdog** — `ws-lifecycle.ts` adds `idleWatchdog` and
   stores `resumeToken` from acks. (~25 lines.)
4. **Daemon hello** — pass `resumeToken` in next `buildHello()`.
   (~10 lines across `broker.ts` + `session-broker.ts`.)
5. **Broker watchdog** — extend the 30s ping loop with
   `terminate()`-on-stale logic. (~15 lines.)
6. **Queue-during-grace** — relax priority gate in DM routing.
   (~5 lines.)
7. **Spec docs** — update `docs/protocol.md` with resume_token,
   lease semantics. (~30 lines.)
8. **Tests** — six scenarios above. Likely ~3 new test files.

Estimated total: one focused day. The broker lease model is the load-
bearing change; everything else slots in cleanly once that's done.
