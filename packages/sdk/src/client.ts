/**
 * MeshClient -- lightweight WebSocket client for connecting any process
 * to a claudemesh mesh. Handles:
 *   - hello handshake + ack
 *   - send / ack / push message flow
 *   - auto-reconnect with exponential backoff
 *   - crypto_box encryption for direct messages
 *   - EventEmitter interface for messages, connection, and peer events
 */

import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import {
  signHello,
  generateKeyPair,
  encryptDirect,
  decryptDirect,
  isDirectTarget,
} from "./crypto.js";
import type {
  MeshClientOptions,
  PeerInfo,
  InboundMessage,
  Priority,
  ConnStatus,
} from "./types.js";

interface PendingSend {
  id: string;
  targetSpec: string;
  priority: Priority;
  nonce: string;
  ciphertext: string;
  resolve: (v: { ok: boolean; messageId?: string; error?: string }) => void;
}

const MAX_QUEUED = 100;
const HELLO_ACK_TIMEOUT_MS = 5_000;
const BACKOFF_CAPS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export interface MeshClientEvents {
  message: [msg: InboundMessage];
  connected: [];
  disconnected: [];
  peer_joined: [peer: PeerInfo];
  peer_left: [peer: PeerInfo];
  state_change: [change: { key: string; value: unknown; updatedBy: string }];
}

export class MeshClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private _status: ConnStatus = "closed";
  private pendingSends = new Map<string, PendingSend>();
  private outbound: Array<() => void> = [];
  private closed = false;
  private reconnectAttempt = 0;
  private helloTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  // Session keypair (generated on first connect, reused across reconnects)
  private sessionPubkey: string | null = null;
  private sessionSecretKey: string | null = null;

  // Request-response resolvers
  private listPeersResolvers = new Map<
    string,
    { resolve: (peers: PeerInfo[]) => void; timer: NodeJS.Timeout }
  >();
  private stateResolvers = new Map<
    string,
    {
      resolve: (
        result: {
          key: string;
          value: unknown;
          updatedBy: string;
          updatedAt: string;
        } | null,
      ) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(private opts: MeshClientOptions) {
    super();
  }

  /** Current connection status. */
  get status(): ConnStatus {
    return this._status;
  }

  /** Session public key hex (null before first connect). */
  get pubkey(): string | null {
    return this.sessionPubkey;
  }

  /** Open the WebSocket, send hello, resolve when hello_ack received. */
  async connect(): Promise<void> {
    if (this.closed) throw new Error("client is closed");
    this._status = "connecting";
    const ws = new WebSocket(this.opts.brokerUrl);
    this.ws = ws;

    return new Promise<void>((resolve, reject) => {
      const onOpen = async (): Promise<void> => {
        this.debug("ws open -> generating session keypair + signing hello");
        try {
          if (!this.sessionPubkey) {
            const sessionKP = await generateKeyPair();
            this.sessionPubkey = sessionKP.publicKey;
            this.sessionSecretKey = sessionKP.secretKey;
          }

          const { timestamp, signature } = await signHello(
            this.opts.meshId,
            this.opts.memberId,
            this.opts.pubkey,
            this.opts.secretKey,
          );
          ws.send(
            JSON.stringify({
              type: "hello",
              meshId: this.opts.meshId,
              memberId: this.opts.memberId,
              pubkey: this.opts.pubkey,
              sessionPubkey: this.sessionPubkey,
              displayName: this.opts.displayName,
              sessionId: `sdk-${process.pid}-${Date.now()}`,
              pid: process.pid,
              peerType: this.opts.peerType ?? "connector",
              channel: this.opts.channel ?? "sdk",
              timestamp,
              signature,
            }),
          );
        } catch (e) {
          reject(
            new Error(
              `hello sign failed: ${e instanceof Error ? e.message : e}`,
            ),
          );
          return;
        }
        this.helloTimer = setTimeout(() => {
          this.debug("hello_ack timeout");
          ws.close();
          reject(new Error("hello_ack timeout"));
        }, HELLO_ACK_TIMEOUT_MS);
      };

      const onMessage = (raw: WebSocket.RawData): void => {
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
          this.emit("connected");
          resolve();
          return;
        }
        this.handleServerMessage(msg);
      };

      const onClose = (): void => {
        if (this.helloTimer) clearTimeout(this.helloTimer);
        this.helloTimer = null;
        const wasOpen = this._status === "open" || this._status === "reconnecting";
        this.ws = null;
        if (!wasOpen && this._status === "connecting") {
          reject(new Error("ws closed before hello_ack"));
        }
        if (!this.closed) {
          this.emit("disconnected");
          this.scheduleReconnect();
        } else {
          this._status = "closed";
          this.emit("disconnected");
        }
      };

      const onError = (err: Error): void => {
        this.debug(`ws error: ${err.message}`);
      };

      ws.on("open", onOpen);
      ws.on("message", onMessage);
      ws.on("close", onClose);
      ws.on("error", onError);
    });
  }

  /** Gracefully close the connection. */
  disconnect(): void {
    this.closed = true;
    if (this.helloTimer) clearTimeout(this.helloTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this._status = "closed";
  }

  // --- Messaging ---

  /**
   * Send a message to a peer. `to` can be:
   * - A hex pubkey (64 chars) for encrypted direct message
   * - A display name (resolved via listPeers)
   * - "*" for broadcast
   * - "@groupname" for group message
   */
  async send(
    to: string,
    message: string,
    priority: Priority = "next",
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    // Resolve display name to pubkey for direct encryption
    let targetSpec = to;
    if (!isDirectTarget(to) && to !== "*" && !to.startsWith("@") && !to.startsWith("#")) {
      const peers = await this.listPeers();
      const match = peers.find(
        (p) => p.displayName.toLowerCase() === to.toLowerCase(),
      );
      if (match) {
        targetSpec = match.pubkey;
      }
      // If no match found, send as-is and let the broker resolve
    }

    const id = randomBytes(8).toString("hex");
    let nonce: string;
    let ciphertext: string;

    if (isDirectTarget(targetSpec)) {
      const env = await encryptDirect(
        message,
        targetSpec,
        this.sessionSecretKey ?? this.opts.secretKey,
      );
      nonce = env.nonce;
      ciphertext = env.ciphertext;
    } else {
      nonce = randomBytes(24).toString("base64");
      ciphertext = Buffer.from(message, "utf-8").toString("base64");
    }

    return new Promise((resolve) => {
      if (this.pendingSends.size >= MAX_QUEUED) {
        resolve({ ok: false, error: "outbound queue full" });
        return;
      }
      this.pendingSends.set(id, {
        id,
        targetSpec,
        priority,
        nonce,
        ciphertext,
        resolve,
      });
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
      if (this._status === "open") dispatch();
      else {
        if (this.outbound.length >= MAX_QUEUED) {
          this.pendingSends.delete(id);
          resolve({ ok: false, error: "outbound queue full" });
          return;
        }
        this.outbound.push(dispatch);
      }
      setTimeout(() => {
        if (this.pendingSends.has(id)) {
          this.pendingSends.delete(id);
          resolve({ ok: false, error: "ack timeout" });
        }
      }, 10_000);
    });
  }

  /** Broadcast a message to all peers in the mesh. */
  async broadcast(
    message: string,
    priority: Priority = "next",
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    return this.send("*", message, priority);
  }

  // --- Peers ---

  /** Request the list of connected peers from the broker. */
  async listPeers(): Promise<PeerInfo[]> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.listPeersResolvers.set(reqId, {
        resolve,
        timer: setTimeout(() => {
          if (this.listPeersResolvers.delete(reqId)) resolve([]);
        }, 5_000),
      });
      this.ws!.send(JSON.stringify({ type: "list_peers", _reqId: reqId }));
    });
  }

  // --- State ---

  /** Read a shared state value. */
  async getState(
    key: string,
  ): Promise<string | null> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.stateResolvers.set(reqId, {
        resolve: (result) => resolve(result ? String(result.value) : null),
        timer: setTimeout(() => {
          if (this.stateResolvers.delete(reqId)) resolve(null);
        }, 5_000),
      });
      this.ws!.send(JSON.stringify({ type: "get_state", key, _reqId: reqId }));
    });
  }

  /** Set a shared state value visible to all peers. */
  async setState(key: string, value: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "set_state", key, value }));
  }

  // --- Summary / Status ---

  /** Update this session's summary visible to other peers. */
  async setSummary(summary: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "set_summary", summary }));
  }

  /** Override connection status visible to peers. */
  async setStatus(status: "idle" | "working" | "dnd"): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "set_status", status }));
  }

  // --- Internals ---

  private makeReqId(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  private flushOutbound(): void {
    const queued = this.outbound.slice();
    this.outbound.length = 0;
    for (const send of queued) send();
  }

  private scheduleReconnect(): void {
    this._status = "reconnecting";
    const delay =
      BACKOFF_CAPS[Math.min(this.reconnectAttempt, BACKOFF_CAPS.length - 1)]!;
    this.reconnectAttempt += 1;
    this.debug(`reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      if (this.closed) return;
      this.connect().catch((e) => {
        this.debug(
          `reconnect failed: ${e instanceof Error ? e.message : e}`,
        );
      });
    }, delay);
  }

  private handleServerMessage(msg: Record<string, unknown>): void {
    const reqId = msg._reqId as string | undefined;

    if (msg.type === "ack") {
      const pending = this.pendingSends.get(String(msg.id ?? ""));
      if (pending) {
        pending.resolve({
          ok: true,
          messageId: String(msg.messageId ?? ""),
        });
        this.pendingSends.delete(pending.id);
      }
      return;
    }

    if (msg.type === "peers_list") {
      const peers = (msg.peers as PeerInfo[]) ?? [];
      this.resolveFromMap(this.listPeersResolvers, reqId, peers);
      return;
    }

    if (msg.type === "push") {
      void this.handlePush(msg);
      return;
    }

    if (msg.type === "state_result") {
      if (msg.key) {
        this.resolveFromMap(this.stateResolvers, reqId, {
          key: String(msg.key),
          value: msg.value,
          updatedBy: String(msg.updatedBy ?? ""),
          updatedAt: String(msg.updatedAt ?? ""),
        });
      } else {
        this.resolveFromMap(this.stateResolvers, reqId, null);
      }
      return;
    }

    if (msg.type === "state_change") {
      this.emit("state_change", {
        key: String(msg.key ?? ""),
        value: msg.value,
        updatedBy: String(msg.updatedBy ?? ""),
      });
      return;
    }

    if (msg.type === "error") {
      this.debug(`broker error: ${msg.code} ${msg.message}`);
      const id = msg.id ? String(msg.id) : null;
      if (id) {
        const pending = this.pendingSends.get(id);
        if (pending) {
          pending.resolve({
            ok: false,
            error: `${msg.code}: ${msg.message}`,
          });
          this.pendingSends.delete(id);
        }
      }
      return;
    }
  }

  private async handlePush(msg: Record<string, unknown>): Promise<void> {
    const nonce = String(msg.nonce ?? "");
    const ciphertext = String(msg.ciphertext ?? "");
    const senderPubkey = String(msg.senderPubkey ?? "");

    const kind: InboundMessage["kind"] = senderPubkey ? "direct" : "unknown";
    let plaintext: string | null = null;

    // Try crypto_box decryption for direct messages
    if (senderPubkey && nonce && ciphertext) {
      plaintext = await decryptDirect(
        { nonce, ciphertext },
        senderPubkey,
        this.sessionSecretKey ?? this.opts.secretKey,
      );
    }

    // Broadcast/channel fallback: base64 UTF-8 decode
    if (plaintext === null && ciphertext && !senderPubkey) {
      try {
        plaintext = Buffer.from(ciphertext, "base64").toString("utf-8");
      } catch {
        plaintext = null;
      }
    }

    // Last resort: try base64 decode even for direct (handles broadcasts
    // and key mismatches gracefully)
    if (plaintext === null && ciphertext) {
      try {
        const decoded = Buffer.from(ciphertext, "base64").toString("utf-8");
        if (
          /^[\x20-\x7E\s\u00A0-\uFFFF]*$/.test(decoded) &&
          decoded.length > 0
        ) {
          plaintext = decoded;
        }
      } catch {
        plaintext = null;
      }
    }

    const push: InboundMessage = {
      messageId: String(msg.messageId ?? ""),
      meshId: String(msg.meshId ?? ""),
      senderPubkey,
      priority: (msg.priority as Priority) ?? "next",
      nonce,
      ciphertext,
      createdAt: String(msg.createdAt ?? ""),
      receivedAt: new Date().toISOString(),
      plaintext,
      kind,
      ...(msg.subtype
        ? { subtype: msg.subtype as "reminder" | "system" }
        : {}),
      ...(msg.event ? { event: String(msg.event) } : {}),
      ...(msg.eventData
        ? { eventData: msg.eventData as Record<string, unknown> }
        : {}),
    };

    this.emit("message", push);

    // Emit peer_joined / peer_left convenience events
    if (push.event === "peer_joined" && push.eventData) {
      this.emit("peer_joined", push.eventData as unknown as PeerInfo);
    }
    if (push.event === "peer_left" && push.eventData) {
      this.emit("peer_left", push.eventData as unknown as PeerInfo);
    }
  }

  private resolveFromMap<T>(
    map: Map<string, { resolve: (v: T) => void; timer: NodeJS.Timeout }>,
    reqId: string | undefined,
    value: T,
  ): boolean {
    let entry = reqId ? map.get(reqId) : undefined;
    if (!entry) {
      // Fallback: oldest pending (FIFO, for brokers that don't echo _reqId)
      const first = map.entries().next().value as
        | [string, { resolve: (v: T) => void; timer: NodeJS.Timeout }]
        | undefined;
      if (first) {
        entry = first[1];
        map.delete(first[0]);
      }
    } else {
      map.delete(reqId!);
    }
    if (entry) {
      clearTimeout(entry.timer);
      entry.resolve(value);
      return true;
    }
    return false;
  }

  private debug(msg: string): void {
    if (this.opts.debug) console.error(`[claudemesh-sdk] ${msg}`);
  }
}
