// Decode incoming broker pushes and dedupe-insert them into the daemon
// inbox. Publishes a `message` event to the daemon's event bus on every
// new row (idempotent receives suppress the event).

import { randomUUID } from "node:crypto";

import type { SqliteDb } from "./db/sqlite.js";
import { insertIfNew } from "./db/inbox.js";
import type { EventBus } from "./events.js";
import { decryptDirect } from "~/services/crypto/facade.js";

export interface InboundContext {
  db: SqliteDb;
  bus: EventBus;
  meshSlug: string;
  /** Daemon's mesh secret key hex, used to decrypt sealed DMs. */
  recipientSecretKeyHex?: string;
  /** Daemon's session secret key hex (rotates per connect). When the
   *  sender encrypted to our session pubkey, decrypt with this instead. */
  sessionSecretKeyHex?: string;
  /** 1.34.10: recipient pubkey of the WS that received this push.
   *  Either the daemon's member pubkey (member-WS) or one of our
   *  session pubkeys (session-WS). Threaded through to the bus event
   *  so each MCP subscriber can filter to events meant for its own
   *  session — without it, every MCP on the same daemon renders every
   *  inbox row, which manifests as session A seeing its own outbound
   *  to B (because A's MCP also picks up the bus event B's WS just
   *  published). */
  recipientPubkey?: string;
  /** 1.34.10: kind of WS this push arrived on. "session" pushes only
   *  surface to the matching session's MCP; "member" pushes surface to
   *  every session on the same mesh (member-keyed broadcasts, member
   *  DMs that don't have a session). */
  recipientKind?: "session" | "member";
  /** v2 agentic-comms (M1): emit `client_ack` back to the broker after
   *  the message lands in inbox.db. Broker uses the ack to set
   *  `delivered_at` (atomic at-least-once). Without it, the broker's
   *  30s lease expires and re-delivers — correct but noisy. The WS
   *  client owns this callback because it's the one that owns the
   *  socket; inbound.ts just signals "I accepted this id." */
  ackClientMessage?: (clientMessageId: string, brokerMessageId: string | null) => void;
  /** 1.34.9: drops system events (peer_joined / peer_left /
   *  peer_returned) whose eventData.pubkey is one of our own. The broker
   *  fans peer_joined to every OTHER connection in the mesh — but our
   *  daemon's member-WS counts as "other" relative to our session-WS,
   *  so without this filter the user sees `[system] Peer "<self>"
   *  joined the mesh` every time their own session reconnects.
   *  Implementation passes a closure that walks the live broker map
   *  rather than a static set, so newly-spawned sessions are visible
   *  immediately. */
  isOwnPubkey?: (pubkey: string) => boolean;
  log?: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Spec §4.5: dedupe by `client_message_id` (broker echoes it from the
 * sender's daemon). When the broker doesn't yet propagate the field
 * (Sprint 7 prereq), fall back to the broker's `messageId` as the
 * dedupe key — at-least-once still holds; we just lose the
 * sender-attested form.
 */
export async function handleBrokerPush(msg: Record<string, unknown>, ctx: InboundContext): Promise<void> {
  // System/topology pushes (peer_join, tick, …) — emit verbatim.
  if (msg.subtype === "system" && typeof msg.event === "string") {
    const eventData = (msg.eventData as Record<string, unknown> | undefined) ?? {};
    // 1.34.9: drop self-joins. The broker excludes the JOINING
    // connection from the fan-out, but our daemon owns multiple
    // connections per mesh (member-WS + N session-WSs), and each is a
    // distinct "other" from the broker's view — so a session's own
    // peer_joined arrives at the same daemon's member-WS and used to
    // surface as `[system] Peer "<self>" joined`. The session-WS path
    // already skips system events entirely (see session-broker.ts
    // 1.34.9), and this filter handles the member-WS path.
    const eventPubkey = typeof eventData.pubkey === "string" ? eventData.pubkey : "";
    if (eventPubkey && ctx.isOwnPubkey?.(eventPubkey)) return;
    ctx.bus.publish(mapSystemEventKind(msg.event), {
      mesh: ctx.meshSlug,
      event: msg.event,
      ...eventData,
    });
    return;
  }

  if (msg.type !== "push") return;

  const brokerMessageId = stringOrNull(msg.messageId);
  const senderPubkey    = stringOrNull(msg.senderPubkey)    ?? "";
  const senderName      = stringOrNull(msg.senderName)      ?? senderPubkey.slice(0, 8);
  const senderMemberPk  = stringOrNull(msg.senderMemberPubkey);
  const topic           = stringOrNull(msg.topic);
  const replyToId       = stringOrNull(msg.replyToId);
  const ciphertext      = stringOrNull(msg.ciphertext)      ?? "";
  const nonce           = stringOrNull(msg.nonce)           ?? "";
  const createdAt       = stringOrNull(msg.createdAt);
  const priority        = stringOrNull(msg.priority) ?? "next";
  const subtype         = stringOrNull(msg.subtype);
  // Forward-compat: Sprint 7 brokers will send client_message_id alongside.
  const clientMessageId = stringOrNull(msg.client_message_id) ?? brokerMessageId ?? randomUUID();
  const body            = await decryptOrFallback({
    ciphertext, nonce, senderPubkey, ctx,
  });

  const id = randomUUID();
  const inserted = insertIfNew(ctx.db, {
    id,
    client_message_id: clientMessageId,
    broker_message_id: brokerMessageId,
    mesh: ctx.meshSlug,
    topic,
    sender_pubkey: senderPubkey,
    sender_name: senderName,
    body,
    meta: createdAt ? JSON.stringify({ created_at: createdAt }) : null,
    received_at: Date.now(),
    reply_to_id: replyToId,
    // 1.34.11: persist the recipient context so /v1/inbox can scope
    // queries to the asking session. Mirrors the same fields on the
    // bus event added in 1.34.10. Falls back to NULL when the caller
    // didn't pass them (legacy paths, tests).
    recipient_pubkey: ctx.recipientPubkey ?? null,
    recipient_kind:   ctx.recipientKind   ?? null,
  });

  // Whether the row was newly inserted or already existed (dedupe), the
  // broker still wants to know we received and processed this message —
  // ack regardless. Skipping ack on dedupe would leak: broker would
  // re-deliver after lease, and the receiver would re-dedupe forever.
  ctx.ackClientMessage?.(clientMessageId, brokerMessageId);

  if (!inserted) return; // already had this id; no event

  ctx.bus.publish("message", {
    id,
    mesh: ctx.meshSlug,
    client_message_id: clientMessageId,
    broker_message_id: brokerMessageId,
    sender_pubkey: senderPubkey,
    sender_member_pubkey: senderMemberPk,
    sender_name: senderName,
    topic,
    reply_to_id: replyToId,
    priority,
    ...(subtype ? { subtype } : {}),
    body,
    created_at: createdAt,
    // 1.34.10: per-recipient routing context. SSE subscribers (the
    // MCP servers that translate bus events into channel notifications)
    // use this to filter to events meant for their own session. Without
    // it, every MCP on the same daemon emits a channel push for every
    // inbox row, which means session A sees its own outbound to B
    // because B's session-WS published the inbox row to the shared bus.
    ...(ctx.recipientPubkey ? { recipient_pubkey: ctx.recipientPubkey } : {}),
    ...(ctx.recipientKind   ? { recipient_kind:   ctx.recipientKind   } : {}),
  });
}

async function decryptOrFallback(args: {
  ciphertext: string;
  nonce: string;
  senderPubkey: string;
  ctx: InboundContext;
}): Promise<string | null> {
  const { ciphertext, nonce, senderPubkey, ctx } = args;
  if (!ciphertext) return null;

  // Try DM decrypt first (sender used crypto_box against our session/member key).
  if (nonce && senderPubkey) {
    const envelope = { nonce, ciphertext };
    // Try session key (sender encrypted to our session pubkey, the common case).
    if (ctx.sessionSecretKeyHex) {
      const pt = await decryptDirect(envelope, senderPubkey, ctx.sessionSecretKeyHex);
      if (pt !== null) return pt;
    }
    // Fall back to member key (sender encrypted to our stable mesh pubkey).
    if (ctx.recipientSecretKeyHex) {
      const pt = await decryptDirect(envelope, senderPubkey, ctx.recipientSecretKeyHex);
      if (pt !== null) return pt;
    }
  }

  // Fallback: broadcast/topic posts are base64 plaintext (existing CLI
  // pre-encryption convention for `*` and `@topic`). Sprint 7+ adds per-
  // topic symmetric keys.
  try { return Buffer.from(ciphertext, "base64").toString("utf8"); }
  catch (e) { ctx.log?.("warn", "inbound_b64_decode_failed", { err: String(e) }); return null; }
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function mapSystemEventKind(event: string): "peer_join" | "peer_leave" | "system" {
  if (event === "peer_joined") return "peer_join";
  if (event === "peer_left")   return "peer_leave";
  return "system";
}
