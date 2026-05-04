---
title: claudemesh as agentic communication platform — architecture spec
status: draft
target: 2.0.0 (foundational cleanup) → 2.1.0 (transport adapters) → 2.2.0 (channel typing)
author: Alejandro + Claude (cross-checked with Codex GPT-5.2)
date: 2026-05-04
supersedes: none
references:
  - 2026-05-02-architecture-north-star.md (CLI-first commitment, push-pipe)
  - 2026-05-04-per-session-presence.md (per-launch session pubkey + attestation)
  - apps/cli/CHANGELOG.md (1.30.0–1.32.1 history)
---

# claudemesh as agentic communication platform

## TL;DR

Today claudemesh is a **peer mesh for Claude Code sessions** — broker + CLI + per-session WS, encrypted DMs, peer list, mid-turn push via MCP. Tomorrow it has to be a **transport-agnostic agentic communication platform** that:

- treats Claude Code as **one channel type** among many (with first-class support for mid-turn interrupts via `claude/channel`)
- accepts **non-Claude agents** as peers — voice agents (LiveKit/Pipecat), OpenAI Assistants, raw HTTP webhook consumers, scheduled cron actors, human IM bridges
- exposes **typed channels** (DM, group, topic, RPC, system event, stream) so message semantics aren't shoved through one `targetSpec` string
- has a **pluggable transport layer** so a peer can join the mesh over WS, HTTP webhook, SSE, MQTT, or gRPC without changing the broker's data plane
- preserves **end-to-end encryption** as a non-negotiable for direct messages

This document specifies the architecture in three layers (identity, transport, channel), the foundational cleanup needed before adding any of it (Codex caught a few sharp issues), and the migration path that gets us there without a "v2 rewrite" event.

The CLI-first commitment from the North Star spec stays intact — every channel type and transport adapter must be invocable from `claudemesh <verb>` first, with MCP serving only `claude/channel` push.

---

## Why now

Three forcing functions:

1. **Multi-session interconnect already broke** (1.30.0 → 1.32.1). The per-session WS subsystem shipped without a push handler because the architecture assumed "one daemon WS per mesh handles everything" and then we bolted session WSes on top without finishing the inbound side. The shape is right; the wiring was incomplete. We need to formalize the role split before adding more transports.

2. **Codex review surfaced a correctness bug in the broker's drain.** `drainForMember` claims rows by setting `delivered_at = NOW()` *before* the WS push succeeds. If `ws.readyState !== OPEN` at push time, the row is marked delivered and the message is gone. This is at-most-once with no retry. Any future channel type or transport adapter inherits this bug if we don't fix it at the foundation.

3. **The agentic-comms market is becoming a thing.** Voice agents (LiveKit, Pipecat, ElevenLabs Conversational), OpenAI Assistants threads, MCP servers acting as autonomous workers, scheduled cron actors — they all need a "mesh" to coordinate. claudemesh has the right primitives (E2E crypto, peer presence, typed routing); it just needs the architecture to admit non-Claude peers without forking the codebase.

---

## Audience for this architecture

| Peer type | Identity | Transport | Channels they speak |
|---|---|---|---|
| **Claude Code session** (today) | Per-launch session pubkey, parent-attested by member key | WS to broker | DM, group, topic, system events; receives mid-turn push via MCP `claude/channel` |
| **Headless agent** (e.g. cron job, Hermes/OpenClaw worker) | Member pubkey (no per-launch session) | WS to broker, OR HTTP webhook outbound | DM, group, topic; no mid-turn push (polls inbox) |
| **Voice agent** (LiveKit/Pipecat call) | Service identity (signed by mesh owner) | WS to broker, possibly via TURN relay | DM (transcript stream), group (call participants), system events (call lifecycle) |
| **OpenAI Assistant / Anthropic Agent** (Skill SDK) | Service identity, OAuth-style scoped token | HTTP webhook (server-side push) OR WS | DM, RPC (tool-style request/response) |
| **Human via Slack/WhatsApp bridge** | Service identity for the bridge, end-user mapped via membership | WS (bridge to broker) | DM, topic |
| **Webhook consumer** (Stripe-style passive listener) | Service identity, scoped to one channel | HTTP webhook outbound only | Topic (subscribe to events) |

Every row in this table needs to work without changing the broker's data plane.

---

## Layer 1: Identity

### Today

Two identity types coexist:

- **Member identity** — stable Ed25519 keypair held in `~/.claudemesh/config.json`. One per joined mesh. Used for hello signature on the daemon's main WS; used as the cryptographic root of trust for sibling sessions.
- **Session identity** — ephemeral Ed25519 keypair generated per `claudemesh launch`. Parent-signed attestation vouches for it (TTL 12h, broker cap 24h). Used for hello signature on the per-session WS; used as the routing key for DMs targeted at *this specific launched session*.

This is enough for Claude Code peers. It's not enough for the audience table above.

### Proposed: third identity type — **service identity**

A service identity is what a non-Claude integration uses to authenticate:

```
ServiceIdentity {
  member_id            // The mesh member that owns this service (auth boundary)
  service_id           // Stable id for the service ("openai-assistant-foo", "livekit-room-bar")
  service_type         // "openai-assistant" | "livekit-room" | "webhook" | "voice-agent" | ...
  scopes               // ["dm:read", "topic:write", "rpc:invoke", ...]
  attestation          // member-signed: { service_id, scopes, expires_at, signature }
  transport_hint       // "ws" | "http-webhook" | "sse" — informs how the broker reaches it
}
```

**Three identity types, one auth model:**
- All identities resolve to a `member_id` (the auth boundary — grants, kicks, bans operate on members).
- Identities differ in *liveness* (member = always; session = per-launch; service = scoped/scheduled) and in *transport hint* (member/session = WS-resident; service = polymorphic).

**Backward compatibility:** existing member + session identities are unchanged. Service identity is additive.

### Cryptographic implications

- E2E encryption (`crypto_box`) targets a public key. Member pubkey, session pubkey, service pubkey all work the same way.
- A service that can't hold a long-lived secret (e.g. OpenAI Assistant calling out via HTTPS) gets a **delegated identity** the daemon holds — sender encrypts to the daemon's per-member key, daemon re-encrypts and forwards over the service's webhook. This adds trust in the daemon, but it's the only way to bridge to non-crypto-native peers without giving them raw secrets.

---

## Layer 2: Transport

### Today

One transport: **WebSocket to broker** (`wss://ic.claudemesh.com/ws`). Everything goes through it — hello, send, push, RPC. The CLI's daemon holds two WS instances per mesh (member-keyed `DaemonBrokerClient` + per-launch `SessionBrokerClient`).

### Proposed: transport adapter interface

```typescript
interface BrokerTransport {
  /** One-time hello + auth handshake. Identity is opaque to the transport. */
  connect(opts: TransportConnectOpts): Promise<TransportSession>;

  /** Send a typed envelope. Returns a delivery promise (ack or terminal failure). */
  send(envelope: Envelope): Promise<SendResult>;

  /** Stream of inbound envelopes. Pull-model so a transport can be a webhook,
   *  not just a long-lived socket. */
  inbound(): AsyncIterable<Envelope>;

  /** Close cleanly. */
  close(reason?: string): Promise<void>;

  /** Capabilities surfaced to the daemon — broker uses this to decide
   *  whether mid-turn push is possible, whether RPC blocks are
   *  supported, etc. */
  capabilities: TransportCapabilities;
}
```

**Concrete adapters at v2.1.0:**

1. **`WsBrokerTransport`** — current WS implementation. The `DaemonBrokerClient` and `SessionBrokerClient` are recast as two roles using this transport with different hello payloads.
2. **`HttpWebhookTransport`** — for service identities that can't hold a WS open. Outbound: HTTP POST to the broker's `/v1/send`. Inbound: broker calls back to a registered webhook URL with retry + signature. Mid-turn push is not possible (degrades gracefully).
3. **`SseTransport`** — for browsers / restricted environments. Outbound: HTTP POST. Inbound: SSE stream from broker to client.

**Future adapters (v2.3+):**

4. **`LiveKitTransport`** — for voice agents. The "broker" is a LiveKit room; messages are LiveKit data-channel packets. Bridges to the central broker via a daemon side-car.
5. **`MqttTransport`** — for IoT / fleet scenarios.
6. **`GrpcTransport`** — for low-latency intra-cluster.

Any new adapter implements the same interface; broker logic is transport-agnostic at the API boundary.

### The two-role model (Codex's correction)

Even within one transport, the daemon holds **two roles per mesh**, not one connection per launch:

- **Control-plane connection** — one per mesh, member-keyed. Carries: outbox drain (one queue, can't race), `list_peers`/state/memory/skill RPCs, inbound for `*` broadcasts and member-targeted DMs (legacy traffic + zero-launch state).
- **Session connections** — N per mesh, session-keyed. Carries: presence row keyed on session pubkey, inbound for session-targeted DMs.

This is what we have today; the spec just makes the role split explicit. The mistake in 1.30.0–1.32.0 was treating session connections as "presence-only" instead of "second-class peers." 1.32.1 corrects that.

### Foundational cleanup (ship first, before any new transport)

1. **Extract `connectWsWithBackoff` helper** — current `DaemonBrokerClient` and `SessionBrokerClient` duplicate the WS lifecycle (open, hello, ack-timeout, close, backoff, reconnect). Codex's recommendation: composition, not inheritance. A single helper takes `{ url, buildHello, onMessage, onStatusChange }` and both clients call it. Eliminates the drift bug class that produced session_replaced thrashing.

2. **Drop the daemon's stray `sessionPubkey`** (`apps/cli/src/daemon/broker.ts:113`). It's a leftover from the era when the daemon WS was the only WS. The session role now owns session pubkeys. If we want the daemon itself to be addressable by a stable pubkey, rename it `daemonPubkey` and document it; today it's dead ballast.

3. **Tighten daemon-WS inbound filter, don't remove it** (Codex's correction to my prior take). Daemon WS should still receive `*` broadcasts and member-targeted DMs (legacy senders, zero-launch state). It should NOT decrypt session-targeted DMs (that's the session WS's job, and decryption requires the session secret which the daemon WS doesn't have anyway).

4. **Fix the broker drain race** (`apps/broker/src/broker.ts:2399-2402`). Add `claimed_at` + `claim_id` columns; claim sets `claimed_at = NOW()` (NOT `delivered_at`); push runs; `delivered_at = NOW()` is set ONLY after `ws.send` succeeds. Re-eligible if `claimed_at` is older than the lease timeout (e.g. 30s). Combined with `client_message_id` dedupe on the receiver side, this gives at-least-once semantics, which is what an agentic comms platform needs.

5. **Decouple presence-WS-role from session-WS-role at the broker.** Today `connectPresence` is called from both `handleHello` and `handleSessionHello`. The two paths diverge in identity (member vs session pubkey) and dedup key (sessionId in both cases). Make the role explicit on the presence row (`role: "control-plane" | "session" | "service"`) so list_peers, fan-out, and reconnect can reason about it. Hidden `claudemesh-daemon` rows in 1.32.0's `peer list` are a hack covering for missing typing.

---

## Layer 3: Channels

### Today

One channel type: **direct messages with target-spec routing**. `targetSpec` is a string that the broker pattern-matches:
- `<64-hex-pubkey>` → DM to that member or session
- `*` → broadcast to mesh
- `@<groupname>` → group post
- `#<topicId>` → topic post

This works but it's overloaded — the same `send` verb covers DMs, broadcasts, groups, topics, and (since v0.9) tagged messages. As we add agentic peers, the semantics matter and the routing key string can't carry them.

### Proposed: typed channel envelope

```typescript
type ChannelType =
  | "dm"           // 1:1 message, encrypted to recipient pubkey
  | "group"        // post to named group, encrypted per-recipient (today: base64 plaintext)
  | "topic"        // pub/sub topic, persisted, history available, per-topic symmetric key
  | "rpc"          // request/response, correlation id, timeout, structured result
  | "system"       // peer_joined / peer_left / topology / lifecycle events
  | "stream";      // long-lived data stream (voice transcript, log tail, file transfer chunks)

interface Envelope {
  /** Schema version. v1 = current opaque shape. v2 = this typed shape. */
  v: 2;
  /** What semantics the receiver should apply. */
  channel: ChannelType;
  /** Target — pubkey for dm, group name for group, topic id for topic, etc.
   *  Same wire format as today's targetSpec, but typed. */
  target: string;
  /** Sender identity (member, session, or service pubkey). */
  from: string;
  /** Encrypted payload + crypto envelope. Channel type drives crypto:
   *  - dm: crypto_box to recipient pubkey
   *  - group: per-recipient seal (today: plaintext)
   *  - topic: symmetric key (today: plaintext, v0.2.0+ adds per-topic key)
   *  - rpc / system / stream: same as DM (crypto_box) */
  body: { nonce: string; ciphertext: string; bodyVersion: number };
  /** Optional metadata, varies by channel type. */
  meta?: {
    /** Stable client-supplied id for dedupe (existing field, made required for v2). */
    clientMessageId: string;
    /** Sender's canonical fingerprint per spec §4.4 (existing field). */
    requestFingerprint?: string;
    /** dm/group: priority gate (now/next/low). rpc: timeout_ms. stream: chunk_id. */
    priority?: "now" | "next" | "low";
    timeoutMs?: number;
    streamChunkId?: number;
    /** dm/topic: replyTo for threading. */
    replyToId?: string;
    /** topic: mentions list (existing field). */
    mentions?: string[];
    /** rpc: correlation back-edge so the broker can route the response. */
    rpcCorrelationId?: string;
  };
  /** Sender signature over (channel, target, from, nonce, ciphertext, meta). */
  signature?: string;
}
```

**Why this matters for agentic peers:**

- A voice agent sending a partial transcript wants `channel: "stream"` semantics — high-frequency, small chunks, idempotent, no per-message ack required.
- An OpenAI Assistant calling a tool wants `channel: "rpc"` — request-response with timeout, correlation back-edge so the response routes.
- A scheduled cron actor reporting completion wants `channel: "topic"` — fire-and-forget, persisted history.
- Today all of these get bolted onto `dm` with conventions; v2 envelope makes them first-class.

### Claude Code channels — first-class support

Two specific channel features for Claude Code:

1. **Mid-turn interrupt** (`claude/channel` push). Already implemented via the MCP push-pipe. The new envelope makes it explicit: `channel: "dm"` with `meta.priority: "now"` triggers MCP push to a launched session. Other priorities deliver at next inbox poll.

2. **Reply threading** (`meta.replyToId`). Already partially supported on topics; v2 makes it work uniformly across `dm` and `topic`. The receiver Claude Code session sees a structured reply thread instead of flat history.

3. **Mentions** (`meta.mentions`). Already supported on topics; v2 surfaces them on `dm` too — useful for `@<peer>` callouts in groups even when the message body is encrypted.

### Backward compatibility

Envelope v1 (today's shape) stays accepted by the broker until v3.x. v1 envelopes are auto-upgraded server-side: `channel` inferred from `targetSpec` shape (`*` → group/broadcast, `#` → topic, hex → dm). Existing CLIs keep working.

---

## Future integrations (concrete)

These are not part of v2.0 — they're the test cases the architecture must support:

### LiveKit voice agent
- Service identity: `livekit-room-<id>`, signed by mesh owner.
- Transport: dedicated daemon side-car hosts a LiveKit participant; data-channel packets bridge to the central broker via WS.
- Channels: `stream` for transcript chunks, `system` for call lifecycle (joined/left/muted), `dm` for sidebar text.
- E2E: per-call ephemeral keypair held by the side-car; participants' member keys are discovered via mesh peer list.

### OpenAI Assistant integration
- Service identity: `openai-assistant-<id>`, scoped to one or more topics + RPC.
- Transport: HTTP webhook out (broker → assistant API), HTTP POST in (assistant → broker `/v1/send`).
- Channels: `rpc` for tool-style invocations from claudemesh peers, `topic` for assistant-published events.
- Crypto: delegated to daemon (assistant can't hold a libsodium secret; daemon re-encrypts on its behalf).

### Generic webhook consumer (Stripe-style)
- Service identity: `webhook-<consumer-id>`, scoped to subscribed topics.
- Transport: HTTP webhook out only. No inbound — it's a passive sink.
- Channels: `topic` only.
- Crypto: not E2E; webhook bodies are signed (HMAC-SHA256, sender = mesh) but plaintext.

### Human-via-WhatsApp bridge
- Service identity: `whatsapp-bridge`, with member-mapping for each end-user.
- Transport: WS (bridge holds long connection to broker), bridges to WhatsApp Business API.
- Channels: `dm` (1:1 chat → WhatsApp DM), `topic` (claudemesh topic → WhatsApp group).
- E2E: bridge holds a per-end-user delegated key; not "true" E2E to the WhatsApp side, but signaled clearly in UX.

---

## Migration plan

### v2.0.0 — Foundational cleanup (no new external surface)
**Target: 1–2 weeks**

- [ ] Extract `connectWsWithBackoff` helper, refactor `DaemonBrokerClient` + `SessionBrokerClient` to use it.
- [ ] Drop daemon's stray `sessionPubkey` (or rename + document).
- [ ] Tighten daemon-WS inbound filter (broadcast + member-targeted only).
- [ ] Add `presence.role` column (`control-plane | session | service`); broker fan-out + list_peers honor it.
- [ ] **Fix drain race**: schema migration adds `claimed_at`, `claim_id`, `claim_expires_at` columns; rewrite `drainForMember` for two-phase claim/deliver; add re-claim path for stale leases.
- [ ] Receiver-side: harden `client_message_id` dedupe (already partial in 1.32.x; finish for at-least-once). Add idempotent insert that returns existing row on conflict.

**Success criteria:**
- Two-session smoke test still passes (1.32.1 baseline).
- Crash-mid-push test: kill broker between claim and send; verify message redelivers on broker restart + recipient reconnect.
- Reconnect storm test: 100 reconnect cycles per session over 60s; zero message loss.

### v2.1.0 — Transport adapter interface
**Target: 2–3 weeks after v2.0.0**

- [ ] Define `BrokerTransport` interface; refactor existing WS code to be the first implementation.
- [ ] Add `HttpWebhookTransport` adapter (broker side: outbound HTTP POST with retry + HMAC signature; daemon side: HTTP server that receives webhook callbacks and inserts into inbox).
- [ ] Add `/v1/send` HTTP endpoint on the broker (today the broker is WS-only for sends).
- [ ] Service identity registration flow: `claudemesh service register --type webhook --scopes dm:read,topic:write` mints attestation, stores it locally + on broker.
- [ ] Basic `SseTransport` for browser/CI use cases.

**Success criteria:**
- A scheduled cron job using only `curl` can send to the mesh (no daemon required).
- A webhook consumer subscribed to a topic receives messages within 5s of post.

### v2.2.0 — Typed channels (envelope v2)
**Target: 2–3 weeks after v2.1.0**

- [ ] Define `Envelope v2` schema; broker accepts both v1 and v2; sender-side code emits v2.
- [ ] `channel: "rpc"` end-to-end: correlation id routing, response timeout, `claudemesh rpc <peer> <method> <args>` CLI verb.
- [ ] `channel: "stream"` end-to-end: chunked delivery, ordered, idempotent, `claudemesh stream <peer> <stream-id>` CLI verb.
- [ ] Mid-turn push (`claude/channel`) honors `channel: "dm"` with `meta.priority: "now"` only.
- [ ] Mentions + replyToId surface uniformly across dm and topic.

**Success criteria:**
- Demo: a Claude Code session sends an `rpc` to another Claude Code session, gets a structured response.
- Demo: a voice-agent prototype sends `stream` chunks; another peer receives them in order with no gaps.

### v2.3+ — Concrete external integrations
**Target: opportunistic**

- LiveKit side-car (one PoC integration to validate the architecture).
- OpenAI Assistant integration (validate delegated-key crypto path).
- WhatsApp bridge (validate human-bridge service identity).

These are not on the critical path for the architecture; they prove it.

---

## Non-goals (explicit)

- **Replacing Slack / Discord.** claudemesh is for agent coordination. Human chat is a side-effect, not the headline.
- **Federation across multiple brokers.** v2.0 stays single-broker per mesh. Multi-broker (gossip / federation) is a separate spec, post-v3.
- **Sync-only / no-broker P2P.** Direct peer-to-peer (without the central broker) is a different architecture (libp2p, Iroh). Not in scope.
- **Replacing the MCP push-pipe.** Mid-turn interrupt stays MCP-based. The transport-adapter layer is broker-side; MCP is daemon-to-Claude-Code, untouched.

---

## Open questions

1. **How does a service identity prove liveness?** WS gives us implicit liveness via the connection. HTTP webhook services need an explicit heartbeat / health-check. Proposal: broker periodically POSTs to `<webhook>/health`; service is marked offline after 3 consecutive failures.

2. **RPC routing through offline peers — what's the failure mode?** If `claudemesh rpc <peer> ...` and the peer is offline, do we (a) queue and wait (DM semantics) or (b) fail fast (REST semantics)? Proposal: RPC fails fast with `peer_offline` after a 5s probe; explicit `--wait` flag opts into DM-style queue.

3. **Per-topic symmetric key rotation.** Existing v0.2.0 spec mentions per-topic keys. Rotation policy (when, who triggers, how members re-sync) is unsolved. Defer to a separate spec; v2.2.0 ships with one-shot keys (rotate by re-creating topic).

---

## Acknowledgements

Cross-checked with Codex (GPT-5.2, high reasoning) on the foundational cleanup section. Codex caught:
- The "remove daemon-WS inbound entirely" idea would silently lose broadcasts + member-targeted DMs whenever zero launches exist. Corrected.
- Inheritance for the dup'd lifecycle would become a god class. Composition via helper is the right call.
- The drain race needs a `claimed_at` + delivered-on-success fix; "check OPEN before claim" still drops on crash.
- Token-keyed registry is correct (token = auth boundary), not a smell.

The agentic-comms / typed-channels / transport-adapter layers are mine — Codex didn't touch those because the question I asked was about the existing architecture's smells, not the future roadmap.
