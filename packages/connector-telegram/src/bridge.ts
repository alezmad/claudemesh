/**
 * Bidirectional bridge between Telegram and a claudemesh mesh.
 *
 * Telegram -> Mesh: incoming Telegram messages are formatted as
 *   "[TelegramUser] message" and broadcast to the mesh.
 *
 * Mesh -> Telegram: inbound mesh pushes are formatted as
 *   "[MeshPeerName] message" and posted to the Telegram chat.
 */

import type { TelegramClient, TelegramMessage } from "./telegram.js";
import type { MeshClient, InboundPush } from "./mesh-client.js";

export class Bridge {
  constructor(
    private telegram: TelegramClient,
    private mesh: MeshClient,
  ) {}

  /** Wire up both directions. Call once after both clients are connected. */
  start(): void {
    // Telegram -> Mesh
    this.telegram.onMessage((msg: TelegramMessage) => {
      this.handleTelegramMessage(msg);
    });

    // Mesh -> Telegram
    this.mesh.onPush((push: InboundPush) => {
      this.handleMeshPush(push);
    });

    console.log("[bridge] relay active");
  }

  private handleTelegramMessage(msg: TelegramMessage): void {
    if (!msg.text) {
      // Skip non-text messages (photos, stickers, etc.)
      const type = msg.from
        ? "non-text content"
        : "system message";
      console.log(`[bridge] skipping ${type} from Telegram`);
      return;
    }

    const senderName = formatTelegramSender(msg);
    const meshMessage = `[${senderName}] ${msg.text}`;

    console.log(`[bridge] tg->mesh: ${meshMessage.slice(0, 80)}...`);

    // Broadcast to all mesh peers
    this.mesh.send("*", meshMessage).catch((err) => {
      console.error(`[bridge] failed to relay to mesh:`, err);
    });
  }

  private handleMeshPush(push: InboundPush): void {
    // Decode the message content
    const plaintext = push.plaintext ?? tryDecodeBase64(push.ciphertext);
    if (!plaintext) return;

    // Skip messages that originated from this connector (prevent echo)
    if (push.senderPubkey === this.mesh.pubkey) return;

    // Find the sender's display name from the push metadata
    const senderName = push.senderDisplayName || push.senderPubkey.slice(0, 8);
    const telegramMessage = `<b>[${escapeHtml(senderName)}]</b> ${escapeHtml(plaintext)}`;

    console.log(`[bridge] mesh->tg: [${senderName}] ${plaintext.slice(0, 60)}...`);

    this.telegram.sendMessage(telegramMessage).catch((err) => {
      console.error(`[bridge] failed to relay to Telegram:`, err);
    });
  }
}

function formatTelegramSender(msg: TelegramMessage): string {
  if (!msg.from) return "Unknown";
  const parts = [msg.from.first_name];
  if (msg.from.last_name) parts.push(msg.from.last_name);
  return parts.join(" ");
}

function tryDecodeBase64(b64: string): string | null {
  try {
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
