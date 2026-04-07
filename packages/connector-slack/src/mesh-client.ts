/**
 * Minimal WebSocket client for the claudemesh broker.
 *
 * Handles:
 *   - hello handshake with ed25519 signature (peerType: "connector")
 *   - send / ack message flow
 *   - broadcast (targetSpec: "*")
 *   - inbound push messages
 *   - auto-reconnect with exponential backoff
 *
 * Kept intentionally standalone — no dependency on the CLI's BrokerClient
 * so this package can be installed and run independently.
 */

import WebSocket from "ws";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { randomBytes } from "node:crypto";
import type { SlackConnectorConfig } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Priority = "now" | "next" | "low";

export interface InboundPush {
  messageId: string;
  meshId: string;
  senderPubkey: string;
  senderName: string;
  priority: Priority;
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

type PushHandler = (push: InboundPush) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomId(): string {
  return randomBytes(12).toString("hex");
}

/**
 * Sign the hello handshake.
 *
 * Canonical bytes: `${meshId}|${memberId}|${pubkey}|${timestamp}`
 * Must match the broker's canonicalHello() exactly.
 */
function signHello(
  meshId: string,
  memberId: string,
  pubkey: string,
  secretKeyHex: string,
): { timestamp: number; signature: string } {
  const timestamp = Date.now();
  const canonical = `${meshId}|${memberId}|${pubkey}|${timestamp}`;
  const messageBytes = naclUtil.decodeUTF8(canonical);
  const secretKey = Buffer.from(secretKeyHex, "hex");
  const sig = nacl.sign.detached(messageBytes, secretKey);
  return {
    timestamp,
    signature: Buffer.from(sig).toString("hex"),
  };
}

// ---------------------------------------------------------------------------
// MeshClient
// ---------------------------------------------------------------------------

const HELLO_ACK_TIMEOUT_MS = 5_000;
const BACKOFF_CAPS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export class MeshClient {
  private ws: WebSocket | null = null;
  private config: SlackConnectorConfig;
  private closed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private helloTimer: NodeJS.Timeout | null = null;
  private pushHandlers = new Set<PushHandler>();
  private pushBuffer: InboundPush[] = [];
  private pendingAcks = new Map<
    string,
    { resolve: (v: { ok: boolean; messageId?: string; error?: string }) => void }
  >();
  private outbound: Array<() => void> = [];
  private _status: "connecting" | "open" | "closed" | "reconnecting" = "closed";

  /** Generate a fresh ed25519 session keypair for this process. */
  private sessionKeypair = nacl.sign.keyPair();
  private sessionPubkeyHex = Buffer.from(this.sessionKeypair.publicKey).toString("hex");

  constructor(config: SlackConnectorConfig) {
    this.config = config;
  }

  get status(): string {
    return this._status;
  }

  // -----------------------------------------------------------------------
  // Connection
  // -----------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.closed) throw new Error("client is closed");
    this._status = "connecting";

    const ws = new WebSocket(this.config.brokerUrl);
    this.ws = ws;

    return new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        const { timestamp, signature } = signHello(
          this.config.meshId,
          this.config.memberId,
          this.config.pubkey,
          this.config.secretKey,
        );

        ws.send(
          JSON.stringify({
            type: "hello",
            meshId: this.config.meshId,
            memberId: this.config.memberId,
            pubkey: this.config.pubkey,
            sessionPubkey: this.sessionPubkeyHex,
            displayName: this.config.displayName,
            sessionId: `connector-${process.pid}-${Date.now()}`,
            pid: process.pid,
            cwd: process.cwd(),
            peerType: "connector" as const,
            channel: "slack",
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
          this._status = "open";
          this.reconnectAttempt = 0;
          this.flushOutbound();
          resolve();
          return;
        }

        this.handleServerMessage(msg);
      });

      ws.on("close", () => {
        if (this.helloTimer) clearTimeout(this.helloTimer);
        this.helloTimer = null;
        this.ws = null;
        if (this._status !== "open" && this._status !== "reconnecting") {
          reject(new Error("ws closed before hello_ack"));
        }
        if (!this.closed) this.scheduleReconnect();
        else this._status = "closed";
      });

      ws.on("error", (err: Error) => {
        console.error("[mesh-client] ws error:", err.message);
      });
    });
  }

  /** Gracefully close the connection. */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.helloTimer) clearTimeout(this.helloTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this._status = "closed";
  }

  // -----------------------------------------------------------------------
  // Sending
  // -----------------------------------------------------------------------

  /**
   * Send a message to a targetSpec ("*" for broadcast, pubkey hex for
   * direct, "@group" for group).
   */
  async send(
    targetSpec: string,
    message: string,
    priority: Priority = "next",
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const id = randomId();
    // Connectors send broadcasts/channels as base64 plaintext.
    // Direct crypto_box encryption is not implemented here to keep
    // the connector simple — mesh peers can still identify the sender
    // by the connector's pubkey.
    const nonce = randomBytes(24).toString("base64");
    const ciphertext = Buffer.from(message, "utf-8").toString("base64");

    return new Promise((resolve) => {
      this.pendingAcks.set(id, { resolve });

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

      if (this._status === "open") {
        dispatch();
      } else {
        this.outbound.push(dispatch);
      }

      // Ack timeout
      setTimeout(() => {
        if (this.pendingAcks.has(id)) {
          this.pendingAcks.delete(id);
          resolve({ ok: false, error: "ack timeout" });
        }
      }, 10_000);
    });
  }

  /** Broadcast a message to all mesh peers. */
  async broadcast(
    message: string,
    priority: Priority = "next",
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    return this.send("*", message, priority);
  }

  // -----------------------------------------------------------------------
  // Push subscriptions
  // -----------------------------------------------------------------------

  /** Subscribe to inbound push messages. Returns an unsubscribe function. */
  onPush(handler: PushHandler): () => void {
    this.pushHandlers.add(handler);
    return () => this.pushHandlers.delete(handler);
  }

  /** Drain buffered pushes (for polling). */
  drainPushBuffer(): InboundPush[] {
    const drained = this.pushBuffer.slice();
    this.pushBuffer.length = 0;
    return drained;
  }

  // -----------------------------------------------------------------------
  // Set summary / status (fire-and-forget)
  // -----------------------------------------------------------------------

  setSummary(summary: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "set_summary", summary }));
  }

  setStatus(status: "idle" | "working" | "dnd"): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "set_status", status }));
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private handleServerMessage(msg: Record<string, unknown>): void {
    if (msg.type === "ack") {
      const pending = this.pendingAcks.get(String(msg.id ?? ""));
      if (pending) {
        pending.resolve({ ok: true, messageId: String(msg.messageId ?? "") });
        this.pendingAcks.delete(String(msg.id ?? ""));
      }
      return;
    }

    if (msg.type === "push") {
      const nonce = String(msg.nonce ?? "");
      const ciphertext = String(msg.ciphertext ?? "");
      const senderPubkey = String(msg.senderPubkey ?? "");

      // Decode plaintext — connector receives broadcasts as base64 UTF-8.
      // Direct (crypto_box) messages from peers will fail to decrypt here
      // since we don't implement crypto_box_open. That's acceptable —
      // the connector is meant for broadcast/channel relay, not private DMs.
      let plaintext: string | null = null;
      if (ciphertext) {
        try {
          const decoded = Buffer.from(ciphertext, "base64").toString("utf-8");
          // Sanity: check it looks like valid UTF-8 text
          if (/^[\x20-\x7E\s\u00A0-\uFFFF]*$/.test(decoded) && decoded.length > 0) {
            plaintext = decoded;
          }
        } catch {
          plaintext = null;
        }
      }

      const push: InboundPush = {
        messageId: String(msg.messageId ?? ""),
        meshId: String(msg.meshId ?? ""),
        senderPubkey,
        senderName: String(
          (msg as Record<string, unknown>).senderName ??
            (msg as Record<string, unknown>).displayName ??
            senderPubkey.slice(0, 8),
        ),
        priority: (msg.priority as Priority) ?? "next",
        nonce,
        ciphertext,
        createdAt: String(msg.createdAt ?? ""),
        receivedAt: new Date().toISOString(),
        plaintext,
        kind: senderPubkey ? "direct" : "unknown",
        ...(msg.subtype
          ? { subtype: msg.subtype as "reminder" | "system" }
          : {}),
        ...(msg.event ? { event: String(msg.event) } : {}),
        ...(msg.eventData
          ? { eventData: msg.eventData as Record<string, unknown> }
          : {}),
      };

      this.pushBuffer.push(push);
      if (this.pushBuffer.length > 500) this.pushBuffer.shift();

      for (const h of this.pushHandlers) {
        try {
          h(push);
        } catch {
          /* handler errors are not our problem */
        }
      }
      return;
    }

    // Other message types (peers_list, state_result, etc.) are ignored
    // by the connector — it only needs send/ack + push.
  }

  private flushOutbound(): void {
    const queued = this.outbound.splice(0);
    for (const fn of queued) {
      try {
        fn();
      } catch {
        /* best effort */
      }
    }
  }

  private scheduleReconnect(): void {
    this._status = "reconnecting";
    const delay =
      BACKOFF_CAPS[Math.min(this.reconnectAttempt, BACKOFF_CAPS.length - 1)];
    this.reconnectAttempt++;
    console.log(
      `[mesh-client] reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        console.error("[mesh-client] reconnect failed:", err.message);
      });
    }, delay);
  }
}
