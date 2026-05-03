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
    ctx.bus.publish(mapSystemEventKind(msg.event), {
      mesh: ctx.meshSlug,
      event: msg.event,
      ...(msg.eventData as Record<string, unknown> | undefined ?? {}),
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
  });

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
