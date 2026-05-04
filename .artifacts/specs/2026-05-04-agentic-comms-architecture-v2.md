---
title: claudemesh — full end-state architecture for agentic peer communication
status: draft (v2 — supersedes v1: removes time-boxed phasing, adds P2P data plane, applies Codex-2 correctness/scope-gap edits)
target: end-state (architectural milestones, not version timelines)
author: Alejandro + Claude (Codex GPT-5.2 cross-checked twice)
date: 2026-05-04
supersedes: 2026-05-04-agentic-comms-architecture.md (v1)
references:
  - 2026-05-02-architecture-north-star.md (CLI-first commitment, push-pipe)
  - 2026-05-04-per-session-presence.md (per-launch session pubkey + attestation)
  - apps/cli/CHANGELOG.md (1.30.0–1.32.1 history)
---

# claudemesh — agentic peer communication, full end-state

## What this document is

The end-state architecture for claudemesh as a transport-agnostic agentic peer-comms platform. Not a release plan, not a sprint roadmap — the **shape** the system needs to converge on. Implementation order at the end is a *suggestion*, not a contract; time estimates are deliberately omitted because the surface is too cross-cutting to phase by weeks.

v1 of this spec (same date, no `-v2` suffix) treated the broker as the sole data plane. v2 corrects that: **the broker is a coordination plane (signaling, discovery, offline queue, fan-out, registry, revocation); the data plane is hybrid P2P** with broker fallback for the cases P2P can't cover. Closer to how Tailscale, libp2p, LiveKit, and modern WebRTC stacks work in production.

## TL;DR

- **Identity** — three keypair types (member, session, service) all rooted in a member's secret key. Member is durable, session is per-launch, service is a member-scoped delegate for non-Claude integrations. Every service has its own pubkey and explicit revocation.
- **Coordination plane** — broker handles signaling, peer discovery, offline message queue, group/topic fan-out, mesh state authority, revocation gossip. Always reachable.
- **Data plane** — hybrid:
  - **P2P first** (WebRTC data channels, future: QUIC) when both peers online + NAT-traversable.
  - **Broker-relayed** when peers are NAT-blocked, when one peer is offline, or for group/topic/broadcast where fan-out at the broker is structurally cheaper than N-way sender-side fan-out.
  - **Pure broker** for service identities that can't run a P2P stack (HTTP webhook senders, OpenAI Assistants, browser SDKs without WebRTC).
- **Channels** — typed envelope (dm, group, topic, rpc, system, stream). Channel type drives crypto, routing, and transport selection. `meta` is required in v2 envelope.
- **Transports** — pluggable adapters under one interface: WS-to-broker (today), WebRTC P2P, HTTP webhook, future LiveKit/QUIC/etc. Broker negotiates which adapter a peer pair uses.
- **Crypto** — every direct message is E2E encrypted to recipient's pubkey regardless of transport. Broker never sees plaintext. P2P doesn't get any extra trust just because it's direct.
- **Delivery** — at-least-once **requires receiver ack** before broker marks `delivered_at`. The retry path before that is best-effort with idempotent dedupe at the receiver.

The CLI-first commitment from the North Star spec stays intact. Every channel type and every transport is invocable from `claudemesh <verb>`. MCP serves only `claude/channel` mid-turn push.

---

## The forcing functions (why this shape, not a smaller one)

1. **Multi-session interconnect already broke** (1.30.0 → 1.32.1) because the per-session WS subsystem shipped without push handler. Symptom of "broker is the data plane and we keep bolting on" thinking. Need to formalize roles and transport adapters before the next bolt-on.

2. **Codex review surfaced a correctness bug** in `drainForMember` — claims `delivered_at = NOW()` *before* WS push succeeds; if `ws.readyState !== OPEN` the row is marked delivered and message is lost. At-most-once with no retry. Inherited by every channel/transport added unless fixed at the foundation.

3. **The agentic-comms domain has standardized on hybrid P2P + central coordinator.** Tailscale (control plane + WireGuard P2P), LiveKit (signaling + SFU + P2P data channels), libp2p (DHT discovery + multi-transport), Iroh (gossip + QUIC P2P). Pure-broker is a 2010s pattern; pure-P2P is academic. Hybrid is the norm.

4. **claudemesh's pricing/economics demand P2P.** Every byte through the broker is your cost. Voice transcripts, file transfers, real-time tool I/O — bandwidth-heavy. P2P data plane lets the broker scale linearly with peer count, not message volume.

5. **Privacy/sovereignty matters as the agent ecosystem grows.** "Your agents talk to my agents" should default to peer-to-peer paths when possible. Broker as relay is fine; broker as forced middleman is not.

---

## Audience for this architecture

| Peer type | Identity | Online presence | Data plane preference | Notes |
|---|---|---|---|---|
| **Claude Code session** | Per-launch session pubkey, member-attested | WS to broker (control + signaling) | P2P first, broker fallback | Mid-turn push via MCP `claude/channel` |
| **Daemon, no launch** (idle Mac with daemon running) | Member pubkey | WS to broker | Broker only (no P2P partner unless launched) | Receives broadcasts + member-targeted DMs |
| **Voice agent** (LiveKit, Pipecat) | Service identity, member-signed | LiveKit room + bridge | LiveKit room data channels intra-room; bridge over broker for cross-mesh | Side-car bridges room ↔ broker |
| **OpenAI Assistant / Anthropic Skill** | Service identity, scoped token | HTTP outbound, webhook inbound | Broker only (can't run P2P) | Daemon does delegated re-encryption |
| **Browser-based peer** (web dashboard, SDK) | Member or service identity | WS to broker, WebRTC for P2P | P2P-where-possible (browsers ARE WebRTC-native) | Full feature parity once on-mesh |
| **Webhook consumer** (Stripe-style passive) | Service identity | HTTP webhook inbound only | Broker only | Topic subscriptions; no inbound channel |
| **Bridge** (Slack, WhatsApp, IRC, Matrix) | Service identity per bridge + per-end-user delegated | WS to broker | Broker only for bridge ↔ broker; native protocol for bridge ↔ external | Trust delegated to bridge operator |
| **Cron / scheduled actor** | Member pubkey or service identity | Ephemeral; HTTP send only | Broker only | No long-lived connection |
| **CLI-only user** (no Claude Code) | Member pubkey | Ephemeral on each `claudemesh send` | Broker only | Command-line agent, queues via outbox |

Every row in this table works without changing the broker's coordination plane.

---

## Layer 1: Identity

Three keypair types, one auth model.

### Member identity (durable)
- Ed25519 keypair, generated at `claudemesh join <invite>`. Held in `~/.claudemesh/config.json` per mesh.
- The auth boundary — grants, kicks, bans operate on members.
- Used for hello signature on the daemon's control-plane WS.
- Used as cryptographic root of trust for sibling sessions and service identities.

### Session identity (ephemeral, per-launch)
- Ed25519 keypair generated by each `claudemesh launch`. Held in process memory only.
- Parent-signed attestation vouches for it (TTL 12h, broker cap 24h). Rotation = new launch.
- Used for hello signature on the per-session WS, and as routing key for DMs targeted at *this specific launched session*.
- Session secret never touches disk; lives only in the daemon's `sessionBrokers` map keyed by IPC token.

### Service identity (third type, additive)

For non-Claude integrations that can't or shouldn't use a per-launch session.

```
ServiceIdentity {
  service_id            // Stable string id ("openai-assistant-foo", "livekit-room-bar")
  service_pubkey        // Ed25519 pubkey — the cryptographic identity. crypto_box targets this.
  member_id             // The mesh member that owns this service (auth boundary)
  service_type          // "openai-assistant" | "livekit-room" | "webhook" | "voice-agent" | ...
  scopes                // ["dm:read", "topic:write", "rpc:invoke", ...]
  attestation           // member-signed: { service_id, service_pubkey, scopes, expires_at, signature }
  transport_hint        // "ws" | "http-webhook" | "sse" | "livekit" — informs how the broker reaches it
  delegate_daemon_pubkey?  // Optional. Set when the daemon holds the service's secret on its behalf.
}
```

Two flavors:
- **Holds-secret service** — has its own keypair (`service_pubkey` + service-secret kept by the service itself). Runs E2E crypto end-to-end. Voice agent side-cars, browser SDK, MQTT bridges.
- **Delegated service** — daemon holds the service-secret on the service's behalf. Senders still encrypt to `service_pubkey`; daemon decrypts on receipt and forwards plaintext (or re-signs) to the service via its `transport_hint`. Used by HTTP webhook consumers, OpenAI Assistants. Trust is in the daemon owner. `delegate_daemon_pubkey` records who's holding.

All three identity types resolve to a `member_id` for authorization. They differ in liveness (member = always; session = per-launch; service = scoped) and transport hint (member/session = WS-resident; service = polymorphic).

### Identity revocation (explicit)

Existing v1 left this implicit. v2 makes it concrete:

- **CLI verb:** `claudemesh service revoke <service_id>` (also `claudemesh peer revoke <pubkey>` for member revocation).
- **Broker effect:** add row to `revocation` table with `(mesh_id, revoked_pubkey, revoked_at, revoked_by, reason?)`. Drop any active WS for that pubkey (close 4002 "revoked"). Reject future helloes.
- **Drain effect:** `drainForMember` checks revocation list at drain time; ciphertext-in-flight from the revoked sender is dropped (sender already broker-acked, but recipient never sees it).
- **Gossip:** revocation events publish on the `system` channel (highest priority). Online peers cache; offline peers see on reconnect. Required so P2P sessions also honor revoke (otherwise a revoked peer's stored attestations could keep working over direct paths).
- **Latency target:** <30s for online peers to receive and apply.
- **Expiry vs revoke distinction:** `expires_at` is graceful (predictable, scheduled rotation); revoke is emergency (leaked secret, fired employee, compromised host). Both use the same revocation table; `expires_at` enforces silently when reached, revoke is logged as an audit event.

---

## Layer 2: Coordination plane (the broker, properly scoped)

The broker is **not** the data plane. Its real responsibilities:

1. **Mesh state authority** — member roster, group memberships, topic registry, service registrations, revocation list. Source of truth for who's in a mesh and what they can do.
2. **Peer discovery** — `list_peers` returns currently-online presences. Broker is the only system that knows which peers are reachable now and over which transports.
3. **Signaling for P2P upgrades** — when peer A wants to open a P2P connection to peer B, A sends a SDP offer through the broker; B responds with an SDP answer through the broker. Once the data channel is up, broker is out of the path. Same as WebRTC signaling.
4. **Offline message queue** — when recipient is offline, broker stores the (encrypted) message until they reconnect. P2P can't do this without an "always-on peer" model, which is awkward to bootstrap.
5. **Group / topic / broadcast fan-out** — broker is the cheap fan-out point. Sender publishes once; broker delivers to N recipients. P2P fan-out (gossipsub) is possible but adds significant complexity for a feature most meshes won't need at scale.
6. **TURN-style relay for NAT-blocked pairs** — when P2P negotiation fails (symmetric NAT, restrictive corporate firewall), broker carries the data. Functionally equivalent to TURN.
7. **Revocation gossip publisher** — broker pushes revocation events to all online peers via the `system` channel; peers cache them.
8. **Audit log + persistence layer** — encrypted message metadata for compliance. Bodies are E2E-encrypted, so audit is over (sender, recipient, channel, timestamp, size), not content.

The broker is **NOT**:
- The default path for online-online direct messages (P2P should win).
- The decryptor for any direct message (E2E means broker sees ciphertext only).
- A bottleneck on bulk data (file transfer, voice, screen share — these go P2P or fail).
- The sole identity authority for active sessions (P2P sessions verify attestations locally via cached mesh state).

### Two roles per mesh on the WS layer (Codex-1 correction, kept)

Within the broker's WS surface, the daemon holds two roles per mesh, not one connection per launch:

- **Control-plane connection** — one per mesh, member-keyed. Carries: signaling + outbox drain + RPCs + broadcast/member-targeted inbound + revocation gossip subscription.
- **Session connections** — N per mesh, session-keyed. Carries: presence row keyed on session pubkey + signaling for P2P upgrades involving this session + inbound for session-targeted DMs that arrive via broker fallback.

A peer who's purely on the broker (no P2P) functions exactly as today. A peer who upgrades to P2P with another peer keeps its broker WS for the other roles.

---

## Layer 3: Data plane (hybrid P2P + broker fallback)

The data plane is what carries actual message bodies. Three modes, selected per (sender, recipient, channel) tuple:

### Mode 1: Direct P2P (preferred when possible)

Two peers run a WebRTC data channel (or QUIC stream — pluggable, see Layer 4) between their daemons. Established via signaling through the broker; once up, broker is out of the path.

**When P2P is selected:**
- Both peers are online (have an active broker WS).
- Both peers' transports advertise P2P capability (WebRTC available; not a webhook-only service identity; not a browser without `RTCPeerConnection`).
- ICE negotiation succeeds (at least one candidate pair works — direct, server-reflexive, or peer-reflexive).
- Channel type is `dm`, `rpc`, or `stream` (the 1:1 cases).

**P2P session lifecycle:**
- Established lazily on first message (warm-up cost ~200ms; dominated by ICE + DTLS handshake). Subsequent messages reuse the channel.
- Idle timeout: 5min of no traffic → tear down. Re-established on next message.
- Hard timeout: 1h max regardless of activity, then re-handshake. Limits damage of compromised session keys.
- Either side can demote to broker-relay at any time; broker is the fallback always.

**Crypto on P2P:**
- DTLS handshake provides transport encryption (forward secrecy; recipient pubkey verified via cached attestation chain).
- Application-layer crypto_box ALSO runs on top — same as broker-relayed messages — so the wire format and decryption path are identical on the receiver side. Defense in depth, no special-case code.

### Mode 2: Broker-relayed (fallback)

The current path. Sender encrypts to recipient pubkey (member or session or service), pushes to broker via WS, broker queues, recipient pulls (or broker pushes to recipient's WS).

**When broker-relay is selected:**
- One peer offline → broker queues, delivers on reconnect.
- ICE negotiation fails → broker becomes the relay.
- Channel type is `group`, `topic`, or `broadcast` → broker fan-out is structurally cheaper than P2P fan-out for any group >2.
- Service identity at either end can't run P2P → broker is the only path.

**Crypto:** unchanged from today — E2E crypto_box, broker sees ciphertext only.

### Mode 3: Direct webhook (broker as broker, not as relay)

For service identities advertising `transport_hint: "http-webhook"`. Sender encrypts to service's `service_pubkey` (or to delegate-daemon's pubkey for delegated services), broker POSTs the ciphertext to the service's registered URL with HMAC signature + retry. No long-lived connection on the service side.

This is functionally a "broker queue, custom delivery transport" — broker still mediates, but delivery is HTTP not WS.

### Selection logic (deterministic, sender-side)

```
function pickTransport(sender, recipient, channel) -> Transport:
  if channel in [group, topic, broadcast]:
    return broker.relay  # fan-out semantics

  if recipient.transport_hint == "http-webhook":
    return broker.relay  # broker calls webhook

  if recipient is offline:
    return broker.queue  # store-and-forward

  if !recipient.capabilities.p2p:
    return broker.relay  # one-end can't P2P

  if !sender.capabilities.p2p:
    return broker.relay  # we can't P2P

  if has_active_p2p_session(sender, recipient):
    return p2p.session  # warm path

  attempt_p2p_handshake(sender, recipient, timeout=2s) ->
    if ok: return p2p.session
    else:  return broker.relay  # fall through, log degraded
```

Policy lives in the daemon's send path. Broker doesn't know or care — it sees only the messages that actually go through it.

---

## Layer 4: Transport adapters (pluggable)

A transport adapter is an implementation of how *one peer pair* moves bytes. Defined by an interface; new adapters added without touching upper layers.

```typescript
interface PeerTransport {
  readonly kind: string;  // "ws-broker" | "webrtc-p2p" | "http-webhook" | ...

  readonly capabilities: {
    p2p: boolean;
    bidirectional: boolean;
    midTurnPush: boolean;
    maxMessageBytes: number;
    streamingChunks: boolean;
  };

  open(opts: TransportOpenOpts): Promise<TransportSession>;
  send(envelope: Envelope): Promise<TransportSendResult>;
  inbound(): AsyncIterable<Envelope>;
  heartbeat(): Promise<boolean>;
  close(reason?: string): Promise<void>;
}
```

### Concrete adapters at end-state

1. **`WsBrokerTransport`** — current code. WebSocket to `wss://ic.claudemesh.com/ws`. Underpins both broker-relay (Mode 2) and signaling for P2P upgrades.
2. **`WebRtcP2pTransport`** — RTCPeerConnection + RTCDataChannel. Browser, Node (`node-datachannel` or similar), CLI all supported. Chunking handled at envelope layer for `stream` channel.
3. **`HttpWebhookTransport`** — outbound HTTP POST to broker `/v1/send`; inbound HTTP POST to a registered webhook URL. Unidirectional from peer's perspective. Mid-turn push: no.
4. **`LiveKitRoomTransport`** — for voice agents. Side-car bridges a LiveKit room to claudemesh. Maps a LiveKit participant → claudemesh service identity.

Future adapters TBD as concrete needs surface — no commitments here. (v1 listed MQTT/gRPC/SSE as future named adapters; v2 drops the named list per Codex-2 should-cut feedback.)

The peer's daemon advertises transport capabilities at hello time; broker stores them in the presence row; senders consult them via `list_peers` (capability fields added to the response).

---

## Layer 5: Channels (typed envelope)

Channels define **semantics**: what the message means, what crypto to apply, what delivery guarantees, what fan-out, what backpressure.

```typescript
type ChannelType =
  | "dm"           // 1:1 direct, encrypted to recipient pubkey, at-least-once with ack
  | "group"        // post to named group, per-recipient encrypt or symmetric, at-least-once with ack
  | "topic"        // pub/sub topic, persisted history, per-topic symmetric key, at-least-once with ack
  | "rpc"          // request/response with correlation id + timeout, exactly-once via dedupe
  | "system"       // peer_joined / peer_left / topology / lifecycle / revocation (broker-originated)
  | "stream";      // long-lived ordered chunks, idempotent per (stream_id, chunk_id)

interface Envelope {
  v: 2;
  channel: ChannelType;
  /** Routing target — meaning depends on channel:
   *  dm: recipient pubkey (member, session, or service)
   *  group: group name (e.g. "@admins")
   *  topic: topic id (e.g. "#abc123")
   *  rpc: recipient pubkey
   *  system: ignored (sender-determined fan-out; broker fills in)
   *  stream: recipient pubkey (the stream_id is in meta.streamId — see below) */
  target: string;
  /** Sender identity pubkey (member, session, or service). */
  from: string;
  /** Encrypted payload. Channel + recipient determines crypto recipe:
   *  dm/rpc/stream: crypto_box to recipient pubkey
   *  group: per-recipient seal (or symmetric in v3)
   *  topic: per-topic symmetric key (v0.2.0 spec)
   *  system: broker-signed, plaintext metadata (event has no body) */
  body: { nonce: string; ciphertext: string; bodyVersion: number };
  /** Required in v2 (was optional in v1). Even minimal envelopes must carry
   *  clientMessageId for idempotent dedupe. */
  meta: {
    clientMessageId: string;            // REQUIRED — idempotency id (spec §4.2)
    requestFingerprint?: string;
    priority?: "now" | "next" | "low";  // dm: gates mid-turn push; group/topic: fan-out priority
    timeoutMs?: number;                  // rpc only
    streamId?: string;                   // REQUIRED for channel:"stream"; identifies the stream
    streamChunkId?: number;              // stream only; monotonic; receiver dedupes
    streamTerminator?: boolean;          // stream only; signals end
    rpcCorrelationId?: string;           // rpc only; back-edge for response
    rpcResponse?: boolean;               // rpc only; this is a response, not request
    replyToId?: string;                  // dm/topic threading
    mentions?: string[];                 // dm/topic; @-callouts
    expiresAt?: number;                  // any; broker drops past this; default 7d for queued
  };
  /** Sender Ed25519 signature over canonical bytes. Verified by recipient
   *  (and by broker for system-message origin). */
  signature: string;
}
```

### Stream concurrency

For `channel: "stream"`, **`meta.streamId` is required**. Two concurrent streams to the same recipient pubkey use distinct streamIds; receiver demuxes by `(from, streamId)`. Without this, multi-stream voice transcripts or file transfers from the same peer would collide.

### Crypto by channel

- `dm`, `rpc`, `stream` → crypto_box(plaintext, recipient_pubkey, sender_secretkey). Receiver verifies attestation chain to ensure recipient_pubkey is a valid identity rooted in a current member.
- `group` → for now: per-recipient crypto_box (sender encrypts N times, broker fans out). Future: hybrid Curve25519 → AES-GCM with sender key wrap, like Signal Sender Keys.
- `topic` → per-topic symmetric key (already in v0.2.0 spec). Key rotation = new topic + members re-subscribe. Keys distributed via DM at join time, encrypted to each member's pubkey.
- `system` → broker is the signer; receivers verify against the broker's published Ed25519 pubkey. Plaintext bodies allowed since these are operational events.

### Delivery semantics (Codex-2 correction applied)

**At-least-once requires receiver ack.** Today's broker sets `delivered_at = NOW()` inside the claim CTE before WS push succeeds — that's at-most-once with no retry. The end-state behavior:

1. Sender's daemon writes to outbox (durable).
2. Drain worker sends to broker; broker acks with `client_message_id` echo (this is sender → broker delivery ack, NOT end-to-end).
3. Broker queues with `claimed_at` NULL, `delivered_at` NULL.
4. On recipient hello / push opportunity: broker claims by setting `claimed_at = NOW(), claim_id = <presenceId>` (lease 30s).
5. Broker `sendToPeer` writes to WS / P2P / webhook.
6. Receiver processes envelope and emits `client_ack { clientMessageId }` back to broker.
7. Broker sets `delivered_at = NOW()` ON ACK RECEIPT.
8. If lease expires without ack → broker re-eligible to claim and re-deliver.
9. Receiver dedupes by `clientMessageId` (idempotent insert into inbox).

Until ack is wired (transitional state), the transitional label is **best-effort retry with idempotent dedupe**, not at-least-once. The outbox + claim/lease + dedupe combination upgrades to at-least-once when the ack path is in place.

`rpc` exactly-once is the same path with the addition that the response carries the `rpcCorrelationId`; sender retries the request until response received OR `timeoutMs` elapses; receiver-side dedupe ensures the handler runs at most once.

### Mid-turn push

`channel: "dm"` with `meta.priority: "now"` and recipient is a launched Claude Code session → recipient's daemon emits `claude/channel` MCP push; the session's Claude Code reads it mid-turn. Other priorities deliver via `claudemesh inbox` poll or at next tool boundary.

### Reply threading + mentions

Uniform across `dm` and `topic`: `meta.replyToId` references the original message's `clientMessageId`. `meta.mentions` is an array of pubkeys (or `@<group>`) — UI/CLI surfaces them; broker doesn't enforce.

---

## Layer 6: Mesh state — broker authority + signed gossip

The mesh state (members, groups, topics, services, revocations, policies) needs both:

- **Authority** — single source of truth. The broker DB. Mutations (add member, revoke, change policy) go through broker, signed by mesh owner / admin.
- **Replication** — every peer needs a current-enough copy to authorize incoming P2P messages locally (otherwise revoke can't be enforced when peers chat directly).

End-state: broker publishes signed mesh-state-update events on the `system` channel; peers cache and apply. Conflict resolution is trivial because broker is authority — peers merge updates by version vector. Eventually consistent in seconds, not the open-ended convergence of CRDT-only systems.

For peer revocation specifically: revocation gossip is highest priority and must propagate within 30s to all online peers. Offline peers see it on reconnect.

---

## Crypto — what doesn't change vs what does

### Doesn't change
- Per-peer Ed25519 keypairs (member + session + service).
- crypto_box (Curve25519 + XSalsa20 + Poly1305) for DMs/RPC/stream.
- Parent-attestation flow for sessions and services.

### Does change (additive)
- DTLS layer underneath WebRTC P2P (transport-level encryption for fingerprint binding).
- Per-topic symmetric keys (v0.2.0 baseline; v2 makes it a hard requirement for topics).
- Broker signing key for `system` channel events (single Ed25519 keypair the broker holds; pubkey published in mesh state).
- Service identity attestations carry `service_pubkey` + `scopes`.
- Forward-secrecy for long-lived P2P sessions: post-handshake, derive a fresh symmetric key per session epoch (1h max); rotate.

---

## Migration order (architectural milestones, NO time estimates)

The end-state above doesn't ship in one PR. The following ordering minimizes regression risk and lets each milestone be useful on its own. **No weeks/sprints attached** — work proceeds when the prior milestone is stable.

### Milestone 1 — Foundational correctness
*Required before anything else. Without this, every later milestone inherits the bugs.*

- Extract `connectWsWithBackoff` helper. Refactor `DaemonBrokerClient` and `SessionBrokerClient` to use it. Eliminates the drift bug class.
- Drop daemon's stray `sessionPubkey` field (or rename + document).
- Tighten daemon-WS inbound filter — `*` broadcasts and member-targeted DMs only; session-targeted DMs land on session WS exclusively.
- Add `presence.role` column at broker (`control-plane | session | service`); list_peers + fan-out + reconnect honor it.
- **Fix broker drain race** — schema migration adds `claimed_at`, `claim_id`, `claim_expires_at` columns. Rewrite `drainForMember` for two-phase claim/deliver. Re-claim if `claimed_at` older than lease (30s).
- Receiver-side `client_ack` for at-least-once with ack (Codex-2 correction). Without ack wiring this stays at "best-effort retry with idempotent dedupe."
- Receiver-side dedupe: idempotent insert on `clientMessageId`; finished + made required for v2 envelopes.

### Milestone 2 — Capability advertisement + transport abstraction
*Sets up the interface. No new transport yet.*

- Define `PeerTransport` interface; refactor existing WS code to be the first implementation. No behavioral change.
- Add capabilities field to hello payload + presence row + `list_peers` response.
- Define `Envelope v2` schema with `meta` required + `streamId` requirement on `stream` channel. Broker accepts both v1 and v2 (v1 auto-upgraded server-side by inferring `channel` from `targetSpec` shape). Senders start emitting v2.

### Milestone 3 — Service identity + HTTP webhook transport
*First non-WS transport. Validates abstraction. Includes revocation.*

- Service identity registration: `claudemesh service register --type webhook --pubkey <hex> --scopes ...` mints attestation, stores broker-side. Service pubkey explicit in attestation.
- Service revocation: `claudemesh service revoke <service_id>` writes broker denylist + closes any active connections + publishes `system` revocation event.
- Add `HttpWebhookTransport` (broker-side outbound: POST with HMAC + retry; daemon-side inbound: HTTP server receives webhook callbacks → handleBrokerPush).
- Add `/v1/send` HTTP POST endpoint on broker (today broker is WS-only for sends).
- Demo: cron job using only `curl` posts to mesh; webhook subscriber receives.
- (`SseTransport` deferred — Codex-2 should-cut feedback. Pull in when concrete browser need arises.)

### Milestone 4 — Typed channels: rpc, stream, system
*Channel layer becomes real.*

- `channel: "rpc"` end-to-end: correlation id routing through any transport, response timeout, `claudemesh rpc <peer> <method> <args>` CLI verb.
- `channel: "stream"` end-to-end: chunked + ordered + idempotent, multi-stream demux via `meta.streamId`, `claudemesh stream <peer> <stream-id>` CLI verb.
- `channel: "system"` formalized (broker-signed events for peer_joined, peer_left, topology, revocation, mesh-state-updates).

### Milestone 5 — P2P data plane (WebRTC adapter)
*The big architectural shift. Broker becomes coordinator, not data path.*

- Add `WebRtcP2pTransport` adapter. Uses `node-datachannel` (or libdatachannel binding) on Node; native WebRTC in browser.
- Add signaling protocol over the existing broker WS:
  - `p2p_offer` (sender → broker → recipient): SDP offer + ICE candidates.
  - `p2p_answer` (recipient → broker → sender): SDP answer + ICE candidates.
  - `p2p_candidate` (either way): trickle ICE candidates.
  - All signaling messages are broker-attested (only valid sender/recipient pairs).
- Add `pickTransport()` policy in daemon send path.
- Add P2P session manager: warm-cache, idle timeout, hard timeout, demote-to-broker on failure.
- Tag broker-relayed messages that *could have* gone P2P with a metric, so degradation rate is observable.

### Milestone 6 — Mesh state replication + revocation gossip
*Required before P2P is safe at scale.*

- Broker publishes signed `system` events for all mesh state mutations.
- Peers subscribe; cache and apply.
- Revocation propagation latency target: <30s for online peers.
- P2P sessions verify peer identity against cached state on every message (cheap, just a map lookup).

### Milestone 7 — External integrations (proof points, parallel)
*One PoC per category to validate the architecture, opportunistically.*

- LiveKit side-car (validates LiveKit room transport).
- OpenAI Assistant (validates delegated-key crypto + webhook transport).
- WhatsApp / Slack bridge (validates human-bridge service identity).
- Browser SDK (validates browser as a peer; uses WebRTC adapter natively).

### Milestone 8 — Group/topic crypto upgrade
*Group fan-out crypto efficiency.*

- Sender Keys protocol for group: sender derives group key, encrypts content once, encrypts group key per-recipient. Avoids N-way encryption per message.
- Per-topic key rotation policy (member join → optional re-key; member leave → forced re-key).

### Beyond Milestone 8
- Future transport adapters as concrete needs surface (no commitments).
- Multi-broker federation (mesh spans multiple brokers; gossip across).
- Onion routing option for adversarial environments.

---

## Non-goals (explicit)

- **Replacing Slack / Discord / Matrix as a human chat product.** claudemesh is for agent coordination; humans participate via bridges or direct DMs but UX is CLI-first.
- **Pure-P2P with no central coordinator.** The broker stays — for offline queue, group fan-out, mesh authority, revocation. "P2P-first hybrid" is the commitment, not "P2P-only."
- **Replacing the MCP `claude/channel` push-pipe.** Mid-turn interrupt stays MCP. The data-plane changes don't touch the daemon-to-Claude-Code path.
- **Real-time media (audio/video) directly in claudemesh data channels.** Bandwidth-heavy media goes through dedicated stacks (LiveKit, WebRTC SFU). claudemesh metadata + signaling glues them.

---

## Open questions

1. **Mid-turn push when sender is on P2P session.** P2P delivery to recipient's daemon → daemon emits MCP push. Same shape as broker-delivered. Confirm the MCP push respects per-session targeting (different session pubkey siblings of the same member).

2. **Browser peers and NAT traversal.** Browser ↔ browser via WebRTC works. Browser ↔ daemon (Node WebRTC binding) — needs testing under symmetric NAT. May require running a STUN server (Google's for now; eventually self-hosted). TURN fallback uses the broker WS.

3. **Backpressure on stream channel.** WebRTC data channels have built-in flow control. Broker-relayed streams need per-stream backpressure signaling to avoid OOM at the broker. Proposal: receiver advertises `stream_window_bytes` periodically; sender pauses when used.

4. **Multi-region brokers.** Today single broker. If we add a second broker (or federation), how do peers in mesh A on broker 1 talk to peers in mesh A on broker 2? Out of scope here; separate spec when forced.

---

## Acknowledgements

**Codex-1 (initial architecture review of existing code) caught:**
- "Remove daemon-WS inbound entirely" idea silently loses broadcasts + member-targeted DMs whenever zero launches exist. Corrected → retained.
- Inheritance for the dup'd lifecycle would become a god class. Composition via helper kept.
- Drain race needs `claimed_at` + delivered-on-success; "check OPEN before claim" still drops on crash. Kept.
- Token-keyed registry is correct (token = auth boundary), not a smell. Kept.

**Codex-2 (single-pass review of v1 of this spec) caught:**
- At-least-once requires receiver ack, not just "set delivered_at on success." → Layer 5 delivery semantics rewritten to require client_ack.
- Service identity needs explicit `service_pubkey` field, included in attestation. → Added to ServiceIdentity definition.
- v2 envelope `meta` should be non-optional with `clientMessageId` always present. → meta is now required.
- Service identity needed explicit revocation/disable story. → New CLI verb `claudemesh service revoke`, broker denylist, system-channel gossip propagation.
- `streamId` location ambiguous; concurrent streams to same peer would collide. → `meta.streamId` made REQUIRED for `channel: "stream"`.
- Defer `SseTransport` from Milestone 3. → Done.
- Drop named future-adapter list (MQTT/gRPC) to avoid false commitments. → Done.

The hybrid P2P data plane, transport adapter abstraction, typed channel envelope, mesh state replication, and milestone reordering are mine. Codex's reviews were targeted at correctness/scope-gap/should-cut, not redesign.

**This spec is now frozen for implementation.** No further architectural drift; deviations during implementation surface as new spec-deltas with explicit rationale, not silent edits to this document.
