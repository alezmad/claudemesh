/**
 * BrokerClient — WebSocket client connecting a CLI session to a claudemesh
 * broker. Handles:
 *   - hello handshake + ack
 *   - send / ack / push message flow
 *   - auto-reconnect with exponential backoff (1s, 2s, 4s, ..., max 30s)
 *   - in-memory outbound queue while reconnecting
 *   - push buffer so the MCP check_messages tool can drain inbound history
 *
 * Encryption is deferred to Step 18 (libsodium). Until then, ciphertext
 * is plaintext UTF-8, nonce is a random 24-byte base64 string (for
 * future-compat layout only).
 */

import WebSocket from "ws";
import { randomBytes } from "node:crypto";
import type { JoinedMesh } from "../state/config";
import {
  decryptDirect,
  encryptDirect,
  isDirectTarget,
} from "../crypto/envelope";
import { signHello } from "../crypto/hello-sig";
import { generateKeypair } from "../crypto/keypair";

export type Priority = "now" | "next" | "low";
export type ConnStatus = "connecting" | "open" | "closed" | "reconnecting";

export interface PeerInfo {
  pubkey: string;
  displayName: string;
  status: string;
  summary: string | null;
  groups: Array<{ name: string; role?: string }>;
  sessionId: string;
  connectedAt: string;
}

export interface InboundPush {
  messageId: string;
  meshId: string;
  senderPubkey: string;
  priority: Priority;
  nonce: string;
  ciphertext: string;
  createdAt: string;
  receivedAt: string;
  /** Decrypted plaintext (if encryption succeeded). null = broadcast
   *  or channel (no per-recipient crypto yet), or decryption failed. */
  plaintext: string | null;
  /** Hint for UI: "direct" (crypto_box), "channel"/"broadcast"
   *  (plaintext for now). */
  kind: "direct" | "broadcast" | "channel" | "unknown";
}

type PushHandler = (msg: InboundPush) => void;

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

export class BrokerClient {
  private ws: WebSocket | null = null;
  private _status: ConnStatus = "closed";
  private pendingSends = new Map<string, PendingSend>();
  private outbound: Array<() => void> = []; // closures that send once ws is open
  private pushHandlers = new Set<PushHandler>();
  private pushBuffer: InboundPush[] = [];
  private listPeersResolvers = new Map<string, { resolve: (peers: PeerInfo[]) => void; timer: NodeJS.Timeout }>();
  private stateResolvers = new Map<string, { resolve: (result: { key: string; value: unknown; updatedBy: string; updatedAt: string } | null) => void; timer: NodeJS.Timeout }>();
  private stateListResolvers = new Map<string, { resolve: (entries: Array<{ key: string; value: unknown; updatedBy: string; updatedAt: string }>) => void; timer: NodeJS.Timeout }>();
  private memoryStoreResolvers = new Map<string, { resolve: (id: string | null) => void; timer: NodeJS.Timeout }>();
  private memoryRecallResolvers = new Map<string, { resolve: (memories: Array<{ id: string; content: string; tags: string[]; rememberedBy: string; rememberedAt: string }>) => void; timer: NodeJS.Timeout }>();
  private stateChangeHandlers = new Set<(change: { key: string; value: unknown; updatedBy: string }) => void>();
  private sessionPubkey: string | null = null;
  private sessionSecretKey: string | null = null;
  private grantFileAccessResolvers = new Map<string, { resolve: (ok: boolean) => void; timer: NodeJS.Timeout }>();
  private closed = false;
  private reconnectAttempt = 0;
  private helloTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private mesh: JoinedMesh,
    private opts: {
      onStatusChange?: (status: ConnStatus) => void;
      displayName?: string;
      debug?: boolean;
    } = {},
  ) {}

  get status(): ConnStatus {
    return this._status;
  }
  get meshId(): string {
    return this.mesh.meshId;
  }
  get meshSlug(): string {
    return this.mesh.slug;
  }
  get pushHistory(): readonly InboundPush[] {
    return this.pushBuffer;
  }

  /** Session public key hex (null before first connection). */
  getSessionPubkey(): string | null { return this.sessionPubkey; }
  /** Session secret key hex (null before first connection). */
  getSessionSecretKey(): string | null { return this.sessionSecretKey; }

  private makeReqId(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  /** Open WS, send hello, resolve when hello_ack received. */
  async connect(): Promise<void> {
    if (this.closed) throw new Error("client is closed");
    this.setConnStatus("connecting");
    const ws = new WebSocket(this.mesh.brokerUrl);
    this.ws = ws;

    return new Promise<void>((resolve, reject) => {
      const onOpen = async (): Promise<void> => {
        this.debug("ws open → generating session keypair + signing hello");
        try {
          // Only generate session keypair on first connect, not reconnects
          if (!this.sessionPubkey) {
            const sessionKP = await generateKeypair();
            this.sessionPubkey = sessionKP.publicKey;
            this.sessionSecretKey = sessionKP.secretKey;
          }

          const { timestamp, signature } = await signHello(
            this.mesh.meshId,
            this.mesh.memberId,
            this.mesh.pubkey,
            this.mesh.secretKey,
          );
          ws.send(
            JSON.stringify({
              type: "hello",
              meshId: this.mesh.meshId,
              memberId: this.mesh.memberId,
              pubkey: this.mesh.pubkey,
              sessionPubkey: this.sessionPubkey,
              displayName: process.env.CLAUDEMESH_DISPLAY_NAME || this.opts.displayName || undefined,
              sessionId: `${process.pid}-${Date.now()}`,
              pid: process.pid,
              cwd: process.cwd(),
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
        // Arm the hello_ack timeout.
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
          this.setConnStatus("open");
          this.reconnectAttempt = 0;
          this.flushOutbound();
          resolve();
          return;
        }
        this.handleServerMessage(msg);
      };

      const onClose = (): void => {
        if (this.helloTimer) clearTimeout(this.helloTimer);
        this.helloTimer = null;
        this.ws = null;
        if (this._status !== "open" && this._status !== "reconnecting") {
          reject(new Error("ws closed before hello_ack"));
        }
        if (!this.closed) this.scheduleReconnect();
        else this.setConnStatus("closed");
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

  /** Fire-and-wait send: resolves when broker acks. */
  async send(
    targetSpec: string,
    message: string,
    priority: Priority = "next",
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const id = randomId();
    // Direct messages get crypto_box encryption; broadcasts + channels
    // still pass through as base64 plaintext until channel crypto lands.
    let nonce: string;
    let ciphertext: string;
    if (isDirectTarget(targetSpec)) {
      const env = await encryptDirect(
        message,
        targetSpec,
        this.sessionSecretKey ?? this.mesh.secretKey,
      );
      nonce = env.nonce;
      ciphertext = env.ciphertext;
    } else {
      nonce = randomNonce();
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
        if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
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
        // Queue the dispatch closure; flushed on (re)connect.
        if (this.outbound.length >= MAX_QUEUED) {
          this.pendingSends.delete(id);
          resolve({ ok: false, error: "outbound queue full" });
          return;
        }
        this.outbound.push(dispatch);
      }
      // Ack timeout: 10s to hear back.
      setTimeout(() => {
        if (this.pendingSends.has(id)) {
          this.pendingSends.delete(id);
          resolve({ ok: false, error: "ack timeout" });
        }
      }, 10_000);
    });
  }

  /** Subscribe to inbound pushes. Returns an unsubscribe function. */
  onPush(handler: PushHandler): () => void {
    this.pushHandlers.add(handler);
    return () => this.pushHandlers.delete(handler);
  }

  /** Drain the buffered push history (used by check_messages tool). */
  drainPushBuffer(): InboundPush[] {
    const drained = this.pushBuffer.slice();
    this.pushBuffer.length = 0;
    return drained;
  }

  /** Send a manual status override. Fire-and-forget (no ack). */
  async setStatus(status: "idle" | "working" | "dnd"): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "set_status", status }));
  }

  /** Request the list of connected peers from the broker. */
  async listPeers(): Promise<PeerInfo[]> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.listPeersResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.listPeersResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "list_peers", _reqId: reqId }));
    });
  }

  /** Update this session's summary visible to other peers. */
  async setSummary(summary: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "set_summary", summary }));
  }

  /** Join a group with an optional role. */
  async joinGroup(name: string, role?: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "join_group", name, role }));
  }

  /** Leave a group. */
  async leaveGroup(name: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "leave_group", name }));
  }

  // --- State ---

  /** Set a shared state value visible to all peers in the mesh. */
  async setState(key: string, value: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "set_state", key, value }));
  }

  /** Read a shared state value. */
  async getState(key: string): Promise<{ key: string; value: unknown; updatedBy: string; updatedAt: string } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.stateResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.stateResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "get_state", key, _reqId: reqId }));
    });
  }

  /** List all shared state keys and values. */
  async listState(): Promise<Array<{ key: string; value: unknown; updatedBy: string; updatedAt: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.stateListResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.stateListResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "list_state", _reqId: reqId }));
    });
  }

  // --- Memory ---

  /** Store persistent knowledge in the mesh's shared memory. */
  async remember(content: string, tags?: string[]): Promise<string | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.memoryStoreResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.memoryStoreResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "remember", content, tags, _reqId: reqId }));
    });
  }

  /** Search the mesh's shared memory by relevance. */
  async recall(query: string): Promise<Array<{ id: string; content: string; tags: string[]; rememberedBy: string; rememberedAt: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.memoryRecallResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.memoryRecallResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "recall", query, _reqId: reqId }));
    });
  }

  /** Remove a memory from the mesh's shared knowledge. */
  async forget(memoryId: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "forget", memoryId }));
  }

  /** Check delivery status of a sent message. */
  private messageStatusResolvers = new Map<string, { resolve: (result: { messageId: string; targetSpec: string; delivered: boolean; deliveredAt: string | null; recipients: Array<{ name: string; pubkey: string; status: string }> } | null) => void; timer: NodeJS.Timeout }>();
  private fileUrlResolvers = new Map<string, { resolve: (result: { url: string; name: string; encrypted?: boolean; sealedKey?: string } | null) => void; timer: NodeJS.Timeout }>();
  private fileListResolvers = new Map<string, { resolve: (files: Array<{ id: string; name: string; size: number; tags: string[]; uploadedBy: string; uploadedAt: string; persistent: boolean }>) => void; timer: NodeJS.Timeout }>();
  private fileStatusResolvers = new Map<string, { resolve: (accesses: Array<{ peerName: string; accessedAt: string }>) => void; timer: NodeJS.Timeout }>();
  private vectorStoredResolvers = new Map<string, { resolve: (id: string | null) => void; timer: NodeJS.Timeout }>();
  private vectorResultsResolvers = new Map<string, { resolve: (results: Array<{ id: string; text: string; score: number; metadata?: Record<string, unknown> }>) => void; timer: NodeJS.Timeout }>();
  private collectionListResolvers = new Map<string, { resolve: (collections: string[]) => void; timer: NodeJS.Timeout }>();
  private graphResultResolvers = new Map<string, { resolve: (rows: Array<Record<string, unknown>>) => void; timer: NodeJS.Timeout }>();
  private contextListResolvers = new Map<string, { resolve: (contexts: Array<{ peerName: string; summary: string; tags: string[]; updatedAt: string }>) => void; timer: NodeJS.Timeout }>();
  private contextResultsResolvers = new Map<string, { resolve: (contexts: Array<{ peerName: string; summary: string; filesRead: string[]; keyFindings: string[]; tags: string[]; updatedAt: string }>) => void; timer: NodeJS.Timeout }>();
  private taskCreatedResolvers = new Map<string, { resolve: (id: string | null) => void; timer: NodeJS.Timeout }>();
  private taskListResolvers = new Map<string, { resolve: (tasks: Array<{ id: string; title: string; assignee: string; status: string; priority: string; createdBy: string }>) => void; timer: NodeJS.Timeout }>();
  private meshQueryResolvers = new Map<string, { resolve: (result: { columns: string[]; rows: Array<Record<string, unknown>>; rowCount: number } | null) => void; timer: NodeJS.Timeout }>();
  private meshSchemaResolvers = new Map<string, { resolve: (tables: Array<{ name: string; columns: Array<{ name: string; type: string; nullable: boolean }> }>) => void; timer: NodeJS.Timeout }>();
  private streamCreatedResolvers = new Map<string, { resolve: (id: string | null) => void; timer: NodeJS.Timeout }>();
  private streamListResolvers = new Map<string, { resolve: (streams: Array<{ id: string; name: string; createdBy: string; subscriberCount: number }>) => void; timer: NodeJS.Timeout }>();
  private streamDataHandlers = new Set<(data: { stream: string; data: unknown; publishedBy: string }) => void>();

  async messageStatus(messageId: string): Promise<{ messageId: string; targetSpec: string; delivered: boolean; deliveredAt: string | null; recipients: Array<{ name: string; pubkey: string; status: string }> } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.messageStatusResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.messageStatusResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "message_status", messageId, _reqId: reqId }));
    });
  }

  // --- Files ---

  /** Get a download URL for a shared file. */
  async getFile(fileId: string): Promise<{ url: string; name: string; encrypted?: boolean; sealedKey?: string } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.fileUrlResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.fileUrlResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "get_file", fileId, _reqId: reqId }));
    });
  }

  /** List files shared in the mesh. */
  async listFiles(query?: string, from?: string): Promise<Array<{ id: string; name: string; size: number; tags: string[]; uploadedBy: string; uploadedAt: string; persistent: boolean }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.fileListResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.fileListResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "list_files", query, from, _reqId: reqId }));
    });
  }

  /** Check who has accessed a shared file. */
  async fileStatus(fileId: string): Promise<Array<{ peerName: string; accessedAt: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.fileStatusResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.fileStatusResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "file_status", fileId, _reqId: reqId }));
    });
  }

  /** Delete a shared file from the mesh. */
  async deleteFile(fileId: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "delete_file", fileId }));
  }

  /** Upload a file to the broker via HTTP POST. Returns file ID. */
  async uploadFile(filePath: string, meshId: string, memberId: string, opts: {
    name?: string; tags?: string[]; persistent?: boolean; targetSpec?: string;
    encrypted?: boolean; ownerPubkey?: string; fileKeys?: Array<{ peerPubkey: string; sealedKey: string }>;
  }): Promise<string> {
    const { readFileSync } = await import("node:fs");
    const { basename } = await import("node:path");
    const data = readFileSync(filePath);
    const fileName = opts.name ?? basename(filePath);

    // Convert WS broker URL to HTTP
    const brokerHttp = this.mesh.brokerUrl
      .replace("wss://", "https://")
      .replace("ws://", "http://")
      .replace("/ws", "");

    const res = await fetch(`${brokerHttp}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Mesh-Id": meshId,
        "X-Member-Id": memberId,
        "X-File-Name": fileName,
        "X-Tags": JSON.stringify(opts.tags ?? []),
        "X-Persistent": String(opts.persistent ?? true),
        "X-Target-Spec": opts.targetSpec ?? "",
        ...(opts.encrypted ? { "X-Encrypted": "true" } : {}),
        ...(opts.ownerPubkey ? { "X-Owner-Pubkey": opts.ownerPubkey } : {}),
        ...(opts.fileKeys?.length ? { "X-File-Keys": JSON.stringify(opts.fileKeys) } : {}),
      },
      body: data,
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json() as { ok?: boolean; fileId?: string; error?: string };
    if (!res.ok || !body.fileId) {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return body.fileId;
  }

  /** Grant a peer access to an encrypted file (owner only). */
  async grantFileAccess(fileId: string, peerPubkey: string, sealedKey: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return false;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.grantFileAccessResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.grantFileAccessResolvers.delete(reqId)) resolve(false);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "grant_file_access", fileId, peerPubkey, sealedKey, _reqId: reqId }));
    });
  }

  // --- Vectors ---

  /** Store an embedding in a per-mesh Qdrant collection. */
  async vectorStore(collection: string, text: string, metadata?: Record<string, unknown>): Promise<string | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.vectorStoredResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.vectorStoredResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "vector_store", collection, text, metadata, _reqId: reqId }));
    });
  }

  /** Semantic search over stored embeddings. */
  async vectorSearch(collection: string, query: string, limit?: number): Promise<Array<{ id: string; text: string; score: number; metadata?: Record<string, unknown> }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.vectorResultsResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.vectorResultsResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "vector_search", collection, query, limit, _reqId: reqId }));
    });
  }

  /** Remove an embedding from a collection. */
  async vectorDelete(collection: string, id: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "vector_delete", collection, id }));
  }

  /** List vector collections in this mesh. */
  async listCollections(): Promise<string[]> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.collectionListResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.collectionListResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "list_collections", _reqId: reqId }));
    });
  }

  // --- Graph ---

  /** Run a read query on the per-mesh Neo4j database. */
  async graphQuery(cypher: string): Promise<Array<Record<string, unknown>>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.graphResultResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.graphResultResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "graph_query", cypher, _reqId: reqId }));
    });
  }

  /** Run a write query (CREATE, MERGE, DELETE) on the per-mesh Neo4j database. */
  async graphExecute(cypher: string): Promise<Array<Record<string, unknown>>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.graphResultResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.graphResultResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "graph_execute", cypher, _reqId: reqId }));
    });
  }

  // --- Context ---

  /** Share session understanding with the mesh. */
  async shareContext(summary: string, filesRead?: string[], keyFindings?: string[], tags?: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "share_context", summary, filesRead, keyFindings, tags }));
  }

  /** Find context from peers who explored an area. */
  async getContext(query: string): Promise<Array<{ peerName: string; summary: string; filesRead: string[]; keyFindings: string[]; tags: string[]; updatedAt: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.contextResultsResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.contextResultsResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "get_context", query, _reqId: reqId }));
    });
  }

  /** See what all peers currently know. */
  async listContexts(): Promise<Array<{ peerName: string; summary: string; tags: string[]; updatedAt: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.contextListResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.contextListResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "list_contexts", _reqId: reqId }));
    });
  }

  // --- Tasks ---

  /** Create a work item. */
  async createTask(title: string, assignee?: string, priority?: string, tags?: string[]): Promise<string | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.taskCreatedResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.taskCreatedResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "create_task", title, assignee, priority, tags, _reqId: reqId }));
    });
  }

  /** Claim an unclaimed task. */
  async claimTask(id: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "claim_task", taskId: id }));
  }

  /** Mark a task done with optional result. */
  async completeTask(id: string, result?: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "complete_task", taskId: id, result }));
  }

  /** List tasks filtered by status/assignee. */
  async listTasks(status?: string, assignee?: string): Promise<Array<{ id: string; title: string; assignee: string; status: string; priority: string; createdBy: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.taskListResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.taskListResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "list_tasks", status, assignee, _reqId: reqId }));
    });
  }

  // --- Mesh Database ---

  /** Run a SELECT query on the per-mesh shared database. */
  async meshQuery(sql: string): Promise<{ columns: string[]; rows: Array<Record<string, unknown>>; rowCount: number } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.meshQueryResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.meshQueryResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "mesh_query", sql, _reqId: reqId }));
    });
  }

  /** Run DDL/DML on the per-mesh database (CREATE TABLE, INSERT, UPDATE, DELETE). */
  async meshExecute(sql: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "mesh_execute", sql }));
  }

  /** List tables and columns in the per-mesh shared database. */
  async meshSchema(): Promise<Array<{ name: string; columns: Array<{ name: string; type: string; nullable: boolean }> }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.meshSchemaResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.meshSchemaResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "mesh_schema", _reqId: reqId }));
    });
  }

  // --- Streams ---

  /** Create a real-time data stream in the mesh. */
  async createStream(name: string): Promise<string | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.streamCreatedResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.streamCreatedResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "create_stream", name, _reqId: reqId }));
    });
  }

  /** Push data to a stream. Subscribers receive it in real-time. */
  async publish(stream: string, data: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "publish", stream, data }));
  }

  /** Subscribe to a stream. Data pushes arrive via onStreamData handler. */
  async subscribe(stream: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "subscribe", stream }));
  }

  /** Unsubscribe from a stream. */
  async unsubscribe(stream: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "unsubscribe", stream }));
  }

  /** List active streams in the mesh. */
  async listStreams(): Promise<Array<{ id: string; name: string; createdBy: string; subscriberCount: number }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.streamListResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.streamListResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "list_streams", _reqId: reqId }));
    });
  }

  /** Subscribe to stream data pushes. Returns an unsubscribe function. */
  onStreamData(handler: (data: { stream: string; data: unknown; publishedBy: string }) => void): () => void {
    this.streamDataHandlers.add(handler);
    return () => this.streamDataHandlers.delete(handler);
  }

  /** Subscribe to state change notifications. Returns an unsubscribe function. */
  onStateChange(handler: (change: { key: string; value: unknown; updatedBy: string }) => void): () => void {
    this.stateChangeHandlers.add(handler);
    return () => this.stateChangeHandlers.delete(handler);
  }

  // --- Mesh info ---
  private meshInfoResolvers = new Map<string, { resolve: (result: Record<string, unknown> | null) => void; timer: NodeJS.Timeout }>();

  async meshInfo(): Promise<Record<string, unknown> | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.meshInfoResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.meshInfoResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "mesh_info", _reqId: reqId }));
    });
  }

  close(): void {
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
    this.setConnStatus("closed");
  }

  // --- Internals ---

  private resolveFromMap<T>(
    map: Map<string, { resolve: (v: T) => void; timer: NodeJS.Timeout }>,
    reqId: string | undefined,
    value: T,
  ): boolean {
    let entry = reqId ? map.get(reqId) : undefined;
    if (!entry) {
      // Fallback: oldest pending (FIFO, for brokers that don't echo _reqId)
      const first = map.entries().next().value as [string, { resolve: (v: T) => void; timer: NodeJS.Timeout }] | undefined;
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

  private handleServerMessage(msg: Record<string, unknown>): void {
    const msgReqId = msg._reqId as string | undefined;

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
      this.resolveFromMap(this.listPeersResolvers, msgReqId, peers);
      return;
    }
    if (msg.type === "push") {
      const nonce = String(msg.nonce ?? "");
      const ciphertext = String(msg.ciphertext ?? "");
      const senderPubkey = String(msg.senderPubkey ?? "");
      // Decrypt asynchronously, then enqueue. Ordering within the
      // buffer is preserved by awaiting before push.
      void (async (): Promise<void> => {
        const kind: InboundPush["kind"] = senderPubkey
          ? "direct"
          : "unknown";
        let plaintext: string | null = null;
        if (senderPubkey && nonce && ciphertext) {
          plaintext = await decryptDirect(
            { nonce, ciphertext },
            senderPubkey,
            this.sessionSecretKey ?? this.mesh.secretKey,
          );
        }
        // Legacy/broadcast path: no senderPubkey means the message
        // was not crypto_box'd, so base64 UTF-8 unwrap is correct.
        // For direct messages (senderPubkey present) we MUST NOT
        // base64-decode the ciphertext on decrypt failure — that
        // produces garbage binary that surfaces as garbled bytes
        // to Claude. Leave plaintext=null and let consumers emit
        // a clear "failed to decrypt" warning.
        if (plaintext === null && ciphertext && !senderPubkey) {
          try {
            plaintext = Buffer.from(ciphertext, "base64").toString("utf-8");
          } catch {
            plaintext = null;
          }
        }
        // Fallback: if direct decrypt failed, try plaintext base64 decode.
        // This handles broadcasts and key mismatches gracefully.
        if (plaintext === null && ciphertext) {
          try {
            const decoded = Buffer.from(ciphertext, "base64").toString("utf-8");
            // Sanity check: valid UTF-8 text (not binary garbage)
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
          priority: (msg.priority as Priority) ?? "next",
          nonce,
          ciphertext,
          createdAt: String(msg.createdAt ?? ""),
          receivedAt: new Date().toISOString(),
          plaintext,
          kind,
        };
        this.pushBuffer.push(push);
        if (this.pushBuffer.length > 500) this.pushBuffer.shift();
        for (const h of this.pushHandlers) {
          try {
            h(push);
          } catch {
            /* handler errors are not the transport's problem */
          }
        }
      })();
      return;
    }
    if (msg.type === "state_result") {
      // DEPENDENCY: The broker must NOT send state_result for set_state
      // operations (only for get_state). If the broker sends state_result for
      // both, it would be consumed here by the next pending get_state resolver,
      // returning the wrong value (cross-contamination). The broker's set_state
      // handler was fixed to omit state_result; only get_state sends it.
      if (msg.key) {
        this.resolveFromMap(this.stateResolvers, msgReqId, {
          key: String(msg.key),
          value: msg.value,
          updatedBy: String(msg.updatedBy ?? ""),
          updatedAt: String(msg.updatedAt ?? ""),
        });
      } else {
        this.resolveFromMap(this.stateResolvers, msgReqId, null);
      }
      return;
    }
    if (msg.type === "state_list") {
      const entries = (msg.entries as Array<{ key: string; value: unknown; updatedBy: string; updatedAt: string }>) ?? [];
      this.resolveFromMap(this.stateListResolvers, msgReqId, entries);
      return;
    }
    if (msg.type === "state_change") {
      const change = {
        key: String(msg.key ?? ""),
        value: msg.value,
        updatedBy: String(msg.updatedBy ?? ""),
      };
      for (const h of this.stateChangeHandlers) {
        try { h(change); } catch { /* handler errors are not the transport's problem */ }
      }
      return;
    }
    if (msg.type === "memory_stored") {
      this.resolveFromMap(this.memoryStoreResolvers, msgReqId, msg.id ? String(msg.id) : null);
      return;
    }
    if (msg.type === "memory_results") {
      const memories = (msg.memories as Array<{ id: string; content: string; tags: string[]; rememberedBy: string; rememberedAt: string }>) ?? [];
      this.resolveFromMap(this.memoryRecallResolvers, msgReqId, memories);
      return;
    }
    if (msg.type === "message_status_result") {
      this.resolveFromMap(this.messageStatusResolvers, msgReqId, msg as any);
      return;
    }
    if (msg.type === "file_url") {
      if (msg.url) {
        this.resolveFromMap(this.fileUrlResolvers, msgReqId, {
          url: String(msg.url),
          name: String(msg.name ?? ""),
          encrypted: msg.encrypted ? true : undefined,
          sealedKey: msg.sealedKey ? String(msg.sealedKey) : undefined,
        });
      } else {
        this.resolveFromMap(this.fileUrlResolvers, msgReqId, null);
      }
      return;
    }
    if (msg.type === "file_list") {
      const files = (msg.files as Array<{ id: string; name: string; size: number; tags: string[]; uploadedBy: string; uploadedAt: string; persistent: boolean }>) ?? [];
      this.resolveFromMap(this.fileListResolvers, msgReqId, files);
      return;
    }
    if (msg.type === "file_status_result") {
      const accesses = (msg.accesses as Array<{ peerName: string; accessedAt: string }>) ?? [];
      this.resolveFromMap(this.fileStatusResolvers, msgReqId, accesses);
      return;
    }
    if (msg.type === "grant_file_access_ok") {
      this.resolveFromMap(this.grantFileAccessResolvers, msgReqId, true);
      return;
    }
    if (msg.type === "vector_stored") {
      this.resolveFromMap(this.vectorStoredResolvers, msgReqId, msg.id ? String(msg.id) : null);
      return;
    }
    if (msg.type === "vector_results") {
      const results = (msg.results as Array<{ id: string; text: string; score: number; metadata?: Record<string, unknown> }>) ?? [];
      this.resolveFromMap(this.vectorResultsResolvers, msgReqId, results);
      return;
    }
    if (msg.type === "collection_list") {
      const collections = (msg.collections as string[]) ?? [];
      this.resolveFromMap(this.collectionListResolvers, msgReqId, collections);
      return;
    }
    if (msg.type === "graph_result") {
      // Broker sends { type: "graph_result", records: [...] }
      const rows = (msg.records as Array<Record<string, unknown>>) ?? [];
      this.resolveFromMap(this.graphResultResolvers, msgReqId, rows);
      return;
    }
    if (msg.type === "context_list") {
      const contexts = (msg.contexts as Array<{ peerName: string; summary: string; tags: string[]; updatedAt: string }>) ?? [];
      this.resolveFromMap(this.contextListResolvers, msgReqId, contexts);
      return;
    }
    if (msg.type === "context_results") {
      const contexts = (msg.contexts as Array<{ peerName: string; summary: string; filesRead: string[]; keyFindings: string[]; tags: string[]; updatedAt: string }>) ?? [];
      this.resolveFromMap(this.contextResultsResolvers, msgReqId, contexts);
      return;
    }
    if (msg.type === "task_created") {
      this.resolveFromMap(this.taskCreatedResolvers, msgReqId, msg.id ? String(msg.id) : null);
      return;
    }
    if (msg.type === "task_list") {
      const tasks = (msg.tasks as Array<{ id: string; title: string; assignee: string; status: string; priority: string; createdBy: string }>) ?? [];
      this.resolveFromMap(this.taskListResolvers, msgReqId, tasks);
      return;
    }
    if (msg.type === "mesh_query_result") {
      if (msg.columns) {
        this.resolveFromMap(this.meshQueryResolvers, msgReqId, {
          columns: (msg.columns as string[]) ?? [],
          rows: (msg.rows as Array<Record<string, unknown>>) ?? [],
          rowCount: (msg.rowCount as number) ?? 0,
        });
      } else {
        this.resolveFromMap(this.meshQueryResolvers, msgReqId, null);
      }
      return;
    }
    if (msg.type === "mesh_schema_result") {
      const tables = (msg.tables as Array<{ name: string; columns: Array<{ name: string; type: string; nullable: boolean }> }>) ?? [];
      this.resolveFromMap(this.meshSchemaResolvers, msgReqId, tables);
      return;
    }
    if (msg.type === "stream_created") {
      this.resolveFromMap(this.streamCreatedResolvers, msgReqId, msg.id ? String(msg.id) : null);
      return;
    }
    if (msg.type === "stream_list") {
      const streams = (msg.streams as Array<{ id: string; name: string; createdBy: string; subscriberCount: number }>) ?? [];
      this.resolveFromMap(this.streamListResolvers, msgReqId, streams);
      return;
    }
    if (msg.type === "stream_data") {
      const evt = {
        stream: String(msg.stream ?? ""),
        data: msg.data,
        publishedBy: String(msg.publishedBy ?? ""),
      };
      for (const h of this.streamDataHandlers) {
        try { h(evt); } catch { /* handler errors are not the transport's problem */ }
      }
      return;
    }
    if (msg.type === "mesh_info_result") {
      this.resolveFromMap(this.meshInfoResolvers, msgReqId, msg as Record<string, unknown>);
      return;
    }
    if (msg.type === "error") {
      this.debug(`broker error: ${msg.code} ${msg.message}`);
      const id = msg.id ? String(msg.id) : null;
      let handledByPendingSend = false;
      if (id) {
        const pending = this.pendingSends.get(id);
        if (pending) {
          pending.resolve({
            ok: false,
            error: `${msg.code}: ${msg.message}`,
          });
          this.pendingSends.delete(id);
          handledByPendingSend = true;
        }
      }
      if (!handledByPendingSend) {
        // Best-effort: unblock the first waiting resolver so callers don't
        // hang for 5s. We don't know which tool triggered the error, so we
        // pop the first non-empty resolver map in priority order.
        const allMaps: Array<[Map<string, { resolve: (v: any) => void; timer: NodeJS.Timeout }>, unknown]> = [
          [this.stateResolvers, null],
          [this.stateListResolvers, []],
          [this.memoryStoreResolvers, null],
          [this.memoryRecallResolvers, []],
          [this.fileUrlResolvers, null],
          [this.fileListResolvers, []],
          [this.fileStatusResolvers, []],
          [this.graphResultResolvers, []],
          [this.vectorStoredResolvers, null],
          [this.vectorResultsResolvers, []],
          [this.taskListResolvers, []],
          [this.meshQueryResolvers, null],
          [this.contextResultsResolvers, []],
          [this.contextListResolvers, []],
          [this.streamListResolvers, []],
          [this.messageStatusResolvers, null],
          [this.grantFileAccessResolvers, false],
          [this.collectionListResolvers, []],
          [this.meshSchemaResolvers, []],
          [this.taskCreatedResolvers, null],
          [this.streamCreatedResolvers, null],
          [this.listPeersResolvers, []],
          [this.meshInfoResolvers, null],
        ];
        for (const [map, defaultVal] of allMaps) {
          const first = (map as Map<string, any>).entries().next().value as [string, { resolve: (v: unknown) => void; timer: NodeJS.Timeout }] | undefined;
          if (first) {
            (map as Map<string, any>).delete(first[0]);
            clearTimeout(first[1].timer);
            first[1].resolve(defaultVal);
            break; // only pop one
          }
        }
      }
    }
  }

  private flushOutbound(): void {
    const queued = this.outbound.slice();
    this.outbound.length = 0;
    for (const send of queued) send();
  }

  private scheduleReconnect(): void {
    this.setConnStatus("reconnecting");
    const delay =
      BACKOFF_CAPS[Math.min(this.reconnectAttempt, BACKOFF_CAPS.length - 1)]!;
    this.reconnectAttempt += 1;
    this.debug(
      `reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`,
    );
    this.reconnectTimer = setTimeout(() => {
      if (this.closed) return;
      this.connect().catch((e) => {
        this.debug(`reconnect failed: ${e instanceof Error ? e.message : e}`);
      });
    }, delay);
  }

  private setConnStatus(s: ConnStatus): void {
    if (this._status === s) return;
    this._status = s;
    this.opts.onStatusChange?.(s);
  }

  private debug(msg: string): void {
    if (this.opts.debug) console.error(`[broker-client] ${msg}`);
  }
}

function randomId(): string {
  return randomBytes(8).toString("hex");
}

function randomNonce(): string {
  // 24-byte nonce layout (compatible with libsodium crypto_secretbox later)
  return randomBytes(24).toString("base64");
}
