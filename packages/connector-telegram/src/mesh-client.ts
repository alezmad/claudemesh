/**
 * Minimal WebSocket client for connecting to a claudemesh broker.
 * Uses tweetnacl for ed25519 signing (hello handshake).
 * Stripped down from apps/cli/src/ws/client.ts — hello + send/receive only.
 */

import WebSocket from "ws";
import nacl from "tweetnacl";
import { decodeUTF8, encodeBase64 } from "tweetnacl-util";
import type { TelegramConnectorConfig } from "./config.js";

export interface InboundPush {
  messageId: string;
  meshId: string;
  senderPubkey: string;
  senderDisplayName?: string;
  priority: "now" | "next" | "low";
  nonce: string;
  ciphertext: string;
  createdAt: string;
  receivedAt: string;
  plaintext: string | null;
  kind: "direct" | "broadcast" | "channel" | "unknown";
  subtype?: "reminder" | "system";
  event?: string;
  eventData?: Record<string, unknown>;
}

type PushHandler = (msg: InboundPush) => void;

const HELLO_ACK_TIMEOUT_MS = 5_000;
const BACKOFF_CAPS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export class MeshClient {
  private ws: WebSocket | null = null;
  private pushHandlers = new Set<PushHandler>();
  private closed = false;
  private reconnectAttempt = 0;
  private helloTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private outbound: Array<() => void> = [];
  private peerNames = new Map<string, string>(); // pubkey -> displayName

  readonly pubkey: string;

  constructor(private config: TelegramConnectorConfig) {
    this.pubkey = config.pubkey;
  }

  onPush(handler: PushHandler): void {
    this.pushHandlers.add(handler);
  }

  /** Open WS, send hello, resolve when hello_ack received. */
  async connect(): Promise<void> {
    if (this.closed) throw new Error("client is closed");

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.config.brokerUrl);
      this.ws = ws;

      ws.on("open", () => {
        console.log("[mesh] ws open, sending hello");

        const timestamp = Date.now();
        const canonical = `${this.config.meshId}|${this.config.memberId}|${this.config.pubkey}|${timestamp}`;
        const secretKey = hexToUint8(this.config.secretKey);
        const sigBytes = nacl.sign.detached(decodeUTF8(canonical), secretKey);
        const signature = uint8ToHex(sigBytes);

        ws.send(
          JSON.stringify({
            type: "hello",
            meshId: this.config.meshId,
            memberId: this.config.memberId,
            pubkey: this.config.pubkey,
            displayName: this.config.displayName,
            sessionId: `connector-tg-${Date.now()}`,
            pid: process.pid,
            cwd: process.cwd(),
            peerType: "connector",
            channel: "telegram",
            timestamp,
            signature,
          }),
        );

        this.helloTimer = setTimeout(() => {
          ws.close();
          reject(new Error("hello_ack timeout"));
        }, HELLO_ACK_TIMEOUT_MS);
      });

      ws.on("message", (raw: WebSocket.RawData) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (msg.type === "hello_ack") {
          if (this.helloTimer) clearTimeout(this.helloTimer);
          this.helloTimer = null;
          this.connected = true;
          this.reconnectAttempt = 0;
          this.flushOutbound();
          console.log("[mesh] connected to broker");
          resolve();
          return;
        }

        this.handleServerMessage(msg);
      });

      ws.on("close", () => {
        if (this.helloTimer) clearTimeout(this.helloTimer);
        this.helloTimer = null;
        this.ws = null;
        const wasConnected = this.connected;
        this.connected = false;
        if (!wasConnected) {
          reject(new Error("ws closed before hello_ack"));
        }
        if (!this.closed) this.scheduleReconnect();
      });

      ws.on("error", (err: Error) => {
        console.error(`[mesh] ws error: ${err.message}`);
      });
    });
  }

  /** Send a message to the mesh. targetSpec: "*" for broadcast, pubkey for direct. */
  async send(
    targetSpec: string,
    message: string,
    priority: "now" | "next" | "low" = "next",
  ): Promise<{ ok: boolean; error?: string }> {
    const id = randomId();
    // Connectors send plaintext broadcasts (base64 encoded) —
    // direct crypto_box encryption is omitted for simplicity.
    const nonce = encodeBase64(nacl.randomBytes(24));
    const ciphertext = Buffer.from(message, "utf-8").toString("base64");

    return new Promise((resolve) => {
      const dispatch = (): void => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(
          JSON.stringify({
            type: "send",
            id,
            targetSpec,
            priority,
            nonce,
            ciphertext,
          }),
        );
      };

      if (this.connected) {
        dispatch();
      } else {
        this.outbound.push(dispatch);
      }

      // Ack timeout
      setTimeout(() => {
        resolve({ ok: false, error: "ack timeout" });
      }, 10_000);
    });
  }

  /** Gracefully close. */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private handleServerMessage(msg: Record<string, unknown>): void {
    if (msg.type === "push") {
      const push = msg as unknown as InboundPush & { senderDisplayName?: string };

      // Decode plaintext for broadcasts/channel messages
      if (!push.plaintext && push.ciphertext) {
        try {
          push.plaintext = Buffer.from(push.ciphertext, "base64").toString("utf-8");
        } catch {
          // leave null
        }
      }

      // Cache peer display name if provided
      if (push.senderDisplayName && push.senderPubkey) {
        this.peerNames.set(push.senderPubkey, push.senderDisplayName);
      }

      for (const handler of this.pushHandlers) {
        try {
          handler(push);
        } catch (err) {
          console.error("[mesh] push handler error:", err);
        }
      }
    }

    if (msg.type === "peers") {
      // Cache peer names from peer list responses
      const peers = (msg as Record<string, unknown>).peers as Array<{ pubkey: string; displayName: string }> | undefined;
      if (peers) {
        for (const p of peers) {
          this.peerNames.set(p.pubkey, p.displayName);
        }
      }
    }
  }

  private flushOutbound(): void {
    const fns = this.outbound.splice(0);
    for (const fn of fns) fn();
  }

  private scheduleReconnect(): void {
    const delay = BACKOFF_CAPS[Math.min(this.reconnectAttempt, BACKOFF_CAPS.length - 1)]!;
    this.reconnectAttempt++;
    console.log(`[mesh] reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        console.error(`[mesh] reconnect failed:`, err);
      });
    }, delay);
  }
}

// --- Hex helpers (avoid libsodium dependency) ---

function hexToUint8(hex: string): Uint8Array {
  const len = hex.length / 2;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function uint8ToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
