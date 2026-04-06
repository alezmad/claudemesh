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
  private listPeersResolvers: Array<(peers: PeerInfo[]) => void> = [];
  private stateResolvers: Array<(result: { key: string; value: unknown; updatedBy: string; updatedAt: string } | null) => void> = [];
  private stateListResolvers: Array<(entries: Array<{ key: string; value: unknown; updatedBy: string; updatedAt: string }>) => void> = [];
  private memoryStoreResolvers: Array<(id: string | null) => void> = [];
  private memoryRecallResolvers: Array<(memories: Array<{ id: string; content: string; tags: string[]; rememberedBy: string; rememberedAt: string }>) => void> = [];
  private stateChangeHandlers = new Set<(change: { key: string; value: unknown; updatedBy: string }) => void>();
  private sessionPubkey: string | null = null;
  private sessionSecretKey: string | null = null;
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
      this.listPeersResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "list_peers" }));
      // Timeout after 5s — return empty list rather than hang.
      setTimeout(() => {
        const idx = this.listPeersResolvers.indexOf(resolve);
        if (idx !== -1) {
          this.listPeersResolvers.splice(idx, 1);
          resolve([]);
        }
      }, 5_000);
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
      this.stateResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "get_state", key }));
      setTimeout(() => {
        const idx = this.stateResolvers.indexOf(resolve);
        if (idx !== -1) {
          this.stateResolvers.splice(idx, 1);
          resolve(null);
        }
      }, 5_000);
    });
  }

  /** List all shared state keys and values. */
  async listState(): Promise<Array<{ key: string; value: unknown; updatedBy: string; updatedAt: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      this.stateListResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "list_state" }));
      setTimeout(() => {
        const idx = this.stateListResolvers.indexOf(resolve);
        if (idx !== -1) {
          this.stateListResolvers.splice(idx, 1);
          resolve([]);
        }
      }, 5_000);
    });
  }

  // --- Memory ---

  /** Store persistent knowledge in the mesh's shared memory. */
  async remember(content: string, tags?: string[]): Promise<string | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      this.memoryStoreResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "remember", content, tags }));
      setTimeout(() => {
        const idx = this.memoryStoreResolvers.indexOf(resolve);
        if (idx !== -1) {
          this.memoryStoreResolvers.splice(idx, 1);
          resolve(null);
        }
      }, 5_000);
    });
  }

  /** Search the mesh's shared memory by relevance. */
  async recall(query: string): Promise<Array<{ id: string; content: string; tags: string[]; rememberedBy: string; rememberedAt: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      this.memoryRecallResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "recall", query }));
      setTimeout(() => {
        const idx = this.memoryRecallResolvers.indexOf(resolve);
        if (idx !== -1) {
          this.memoryRecallResolvers.splice(idx, 1);
          resolve([]);
        }
      }, 5_000);
    });
  }

  /** Remove a memory from the mesh's shared knowledge. */
  async forget(memoryId: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "forget", memoryId }));
  }

  /** Check delivery status of a sent message. */
  private messageStatusResolvers: Array<(result: { messageId: string; targetSpec: string; delivered: boolean; deliveredAt: string | null; recipients: Array<{ name: string; pubkey: string; status: string }> } | null) => void> = [];
  private fileUrlResolvers: Array<(result: { url: string; name: string } | null) => void> = [];
  private fileListResolvers: Array<(files: Array<{ id: string; name: string; size: number; tags: string[]; uploadedBy: string; uploadedAt: string; persistent: boolean }>) => void> = [];
  private fileStatusResolvers: Array<(accesses: Array<{ peerName: string; accessedAt: string }>) => void> = [];
  private vectorStoredResolvers: Array<(id: string | null) => void> = [];
  private vectorResultsResolvers: Array<(results: Array<{ id: string; text: string; score: number; metadata?: Record<string, unknown> }>) => void> = [];
  private collectionListResolvers: Array<(collections: string[]) => void> = [];
  private graphResultResolvers: Array<(rows: Array<Record<string, unknown>>) => void> = [];
  private contextListResolvers: Array<(contexts: Array<{ peerName: string; summary: string; tags: string[]; updatedAt: string }>) => void> = [];
  private contextResultsResolvers: Array<(contexts: Array<{ peerName: string; summary: string; filesRead: string[]; keyFindings: string[]; tags: string[]; updatedAt: string }>) => void> = [];
  private taskCreatedResolvers: Array<(id: string | null) => void> = [];
  private taskListResolvers: Array<(tasks: Array<{ id: string; title: string; assignee: string; status: string; priority: string; createdBy: string }>) => void> = [];
  private meshQueryResolvers: Array<(result: { columns: string[]; rows: Array<Record<string, unknown>>; rowCount: number } | null) => void> = [];
  private meshSchemaResolvers: Array<(tables: Array<{ name: string; columns: Array<{ name: string; type: string; nullable: boolean }> }>) => void> = [];
  private streamCreatedResolvers: Array<(id: string | null) => void> = [];
  private streamListResolvers: Array<(streams: Array<{ id: string; name: string; createdBy: string; subscriberCount: number }>) => void> = [];
  private streamDataHandlers = new Set<(data: { stream: string; data: unknown; publishedBy: string }) => void>();

  async messageStatus(messageId: string): Promise<{ messageId: string; targetSpec: string; delivered: boolean; deliveredAt: string | null; recipients: Array<{ name: string; pubkey: string; status: string }> } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      this.messageStatusResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "message_status", messageId }));
      setTimeout(() => {
        const idx = this.messageStatusResolvers.indexOf(resolve);
        if (idx !== -1) { this.messageStatusResolvers.splice(idx, 1); resolve(null); }
      }, 5_000);
    });
  }

  // --- Files ---

  /** Get a download URL for a shared file. */
  async getFile(fileId: string): Promise<{ url: string; name: string } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      this.fileUrlResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "get_file", fileId }));
      setTimeout(() => {
        const idx = this.fileUrlResolvers.indexOf(resolve);
        if (idx !== -1) {
          this.fileUrlResolvers.splice(idx, 1);
          resolve(null);
        }
      }, 5_000);
    });
  }

  /** List files shared in the mesh. */
  async listFiles(query?: string, from?: string): Promise<Array<{ id: string; name: string; size: number; tags: string[]; uploadedBy: string; uploadedAt: string; persistent: boolean }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      this.fileListResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "list_files", query, from }));
      setTimeout(() => {
        const idx = this.fileListResolvers.indexOf(resolve);
        if (idx !== -1) {
          this.fileListResolvers.splice(idx, 1);
          resolve([]);
        }
      }, 5_000);
    });
  }

  /** Check who has accessed a shared file. */
  async fileStatus(fileId: string): Promise<Array<{ peerName: string; accessedAt: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      this.fileStatusResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "file_status", fileId }));
      setTimeout(() => {
        const idx = this.fileStatusResolvers.indexOf(resolve);
        if (idx !== -1) {
          this.fileStatusResolvers.splice(idx, 1);
          resolve([]);
        }
      }, 5_000);
    });
  }

  /** Delete a shared file from the mesh. */
  async deleteFile(fileId: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "delete_file", fileId }));
  }

  /** Upload a file to the broker via HTTP POST. Returns file ID or null. */
  async uploadFile(filePath: string, meshId: string, memberId: string, opts: {
    name?: string; tags?: string[]; persistent?: boolean; targetSpec?: string;
  }): Promise<string | null> {
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

  // --- Vectors ---

  /** Store an embedding in a per-mesh Qdrant collection. */
  async vectorStore(collection: string, text: string, metadata?: Record<string, unknown>): Promise<string | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      this.vectorStoredResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "vector_store", collection, text, metadata }));
      setTimeout(() => {
        const idx = this.vectorStoredResolvers.indexOf(resolve);
        if (idx !== -1) { this.vectorStoredResolvers.splice(idx, 1); resolve(null); }
      }, 5_000);
    });
  }

  /** Semantic search over stored embeddings. */
  async vectorSearch(collection: string, query: string, limit?: number): Promise<Array<{ id: string; text: string; score: number; metadata?: Record<string, unknown> }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      this.vectorResultsResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "vector_search", collection, query, limit }));
      setTimeout(() => {
        const idx = this.vectorResultsResolvers.indexOf(resolve);
        if (idx !== -1) { this.vectorResultsResolvers.splice(idx, 1); resolve([]); }
      }, 5_000);
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
      this.collectionListResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "list_collections" }));
      setTimeout(() => {
        const idx = this.collectionListResolvers.indexOf(resolve);
        if (idx !== -1) { this.collectionListResolvers.splice(idx, 1); resolve([]); }
      }, 5_000);
    });
  }

  // --- Graph ---

  /** Run a read query on the per-mesh Neo4j database. */
  async graphQuery(cypher: string): Promise<Array<Record<string, unknown>>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      this.graphResultResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "graph_query", cypher }));
      setTimeout(() => {
        const idx = this.graphResultResolvers.indexOf(resolve);
        if (idx !== -1) { this.graphResultResolvers.splice(idx, 1); resolve([]); }
      }, 5_000);
    });
  }

  /** Run a write query (CREATE, MERGE, DELETE) on the per-mesh Neo4j database. */
  async graphExecute(cypher: string): Promise<Array<Record<string, unknown>>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      this.graphResultResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "graph_execute", cypher }));
      setTimeout(() => {
        const idx = this.graphResultResolvers.indexOf(resolve);
        if (idx !== -1) { this.graphResultResolvers.splice(idx, 1); resolve([]); }
      }, 5_000);
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
      this.contextResultsResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "get_context", query }));
      setTimeout(() => {
        const idx = this.contextResultsResolvers.indexOf(resolve);
        if (idx !== -1) { this.contextResultsResolvers.splice(idx, 1); resolve([]); }
      }, 5_000);
    });
  }

  /** See what all peers currently know. */
  async listContexts(): Promise<Array<{ peerName: string; summary: string; tags: string[]; updatedAt: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      this.contextListResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "list_contexts" }));
      setTimeout(() => {
        const idx = this.contextListResolvers.indexOf(resolve);
        if (idx !== -1) { this.contextListResolvers.splice(idx, 1); resolve([]); }
      }, 5_000);
    });
  }

  // --- Tasks ---

  /** Create a work item. */
  async createTask(title: string, assignee?: string, priority?: string, tags?: string[]): Promise<string | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      this.taskCreatedResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "create_task", title, assignee, priority, tags }));
      setTimeout(() => {
        const idx = this.taskCreatedResolvers.indexOf(resolve);
        if (idx !== -1) { this.taskCreatedResolvers.splice(idx, 1); resolve(null); }
      }, 5_000);
    });
  }

  /** Claim an unclaimed task. */
  async claimTask(id: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "claim_task", id }));
  }

  /** Mark a task done with optional result. */
  async completeTask(id: string, result?: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "complete_task", id, result }));
  }

  /** List tasks filtered by status/assignee. */
  async listTasks(status?: string, assignee?: string): Promise<Array<{ id: string; title: string; assignee: string; status: string; priority: string; createdBy: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      this.taskListResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "list_tasks", status, assignee }));
      setTimeout(() => {
        const idx = this.taskListResolvers.indexOf(resolve);
        if (idx !== -1) { this.taskListResolvers.splice(idx, 1); resolve([]); }
      }, 5_000);
    });
  }

  // --- Mesh Database ---

  /** Run a SELECT query on the per-mesh shared database. */
  async meshQuery(sql: string): Promise<{ columns: string[]; rows: Array<Record<string, unknown>>; rowCount: number } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      this.meshQueryResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "mesh_query", sql }));
      setTimeout(() => {
        const idx = this.meshQueryResolvers.indexOf(resolve);
        if (idx !== -1) { this.meshQueryResolvers.splice(idx, 1); resolve(null); }
      }, 5_000);
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
      this.meshSchemaResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "mesh_schema" }));
      setTimeout(() => {
        const idx = this.meshSchemaResolvers.indexOf(resolve);
        if (idx !== -1) { this.meshSchemaResolvers.splice(idx, 1); resolve([]); }
      }, 5_000);
    });
  }

  // --- Streams ---

  /** Create a real-time data stream in the mesh. */
  async createStream(name: string): Promise<string | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      this.streamCreatedResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "create_stream", name }));
      setTimeout(() => {
        const idx = this.streamCreatedResolvers.indexOf(resolve);
        if (idx !== -1) { this.streamCreatedResolvers.splice(idx, 1); resolve(null); }
      }, 5_000);
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
      this.streamListResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "list_streams" }));
      setTimeout(() => {
        const idx = this.streamListResolvers.indexOf(resolve);
        if (idx !== -1) { this.streamListResolvers.splice(idx, 1); resolve([]); }
      }, 5_000);
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
  private meshInfoResolvers: Array<(result: Record<string, unknown> | null) => void> = [];

  async meshInfo(): Promise<Record<string, unknown> | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      this.meshInfoResolvers.push(resolve);
      this.ws!.send(JSON.stringify({ type: "mesh_info" }));
      setTimeout(() => {
        const idx = this.meshInfoResolvers.indexOf(resolve);
        if (idx !== -1) { this.meshInfoResolvers.splice(idx, 1); resolve(null); }
      }, 5_000);
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

  private handleServerMessage(msg: Record<string, unknown>): void {
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
      const resolver = this.listPeersResolvers.shift();
      if (resolver) resolver(peers);
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
      const resolver = this.stateResolvers.shift();
      if (resolver) {
        if (msg.key) {
          resolver({
            key: String(msg.key),
            value: msg.value,
            updatedBy: String(msg.updatedBy ?? ""),
            updatedAt: String(msg.updatedAt ?? ""),
          });
        } else {
          resolver(null);
        }
      }
      return;
    }
    if (msg.type === "state_list") {
      const entries = (msg.entries as Array<{ key: string; value: unknown; updatedBy: string; updatedAt: string }>) ?? [];
      const resolver = this.stateListResolvers.shift();
      if (resolver) resolver(entries);
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
      const resolver = this.memoryStoreResolvers.shift();
      if (resolver) resolver(msg.id ? String(msg.id) : null);
      return;
    }
    if (msg.type === "memory_results") {
      const memories = (msg.memories as Array<{ id: string; content: string; tags: string[]; rememberedBy: string; rememberedAt: string }>) ?? [];
      const resolver = this.memoryRecallResolvers.shift();
      if (resolver) resolver(memories);
      return;
    }
    if (msg.type === "message_status_result") {
      const resolver = this.messageStatusResolvers.shift();
      if (resolver) resolver(msg as any);
      return;
    }
    if (msg.type === "file_url") {
      const resolver = this.fileUrlResolvers.shift();
      if (resolver) {
        if (msg.url) {
          resolver({ url: String(msg.url), name: String(msg.name ?? "") });
        } else {
          resolver(null);
        }
      }
      return;
    }
    if (msg.type === "file_list") {
      const files = (msg.files as Array<{ id: string; name: string; size: number; tags: string[]; uploadedBy: string; uploadedAt: string; persistent: boolean }>) ?? [];
      const resolver = this.fileListResolvers.shift();
      if (resolver) resolver(files);
      return;
    }
    if (msg.type === "file_status_result") {
      const accesses = (msg.accesses as Array<{ peerName: string; accessedAt: string }>) ?? [];
      const resolver = this.fileStatusResolvers.shift();
      if (resolver) resolver(accesses);
      return;
    }
    if (msg.type === "vector_stored") {
      const resolver = this.vectorStoredResolvers.shift();
      if (resolver) resolver(msg.id ? String(msg.id) : null);
      return;
    }
    if (msg.type === "vector_results") {
      const results = (msg.results as Array<{ id: string; text: string; score: number; metadata?: Record<string, unknown> }>) ?? [];
      const resolver = this.vectorResultsResolvers.shift();
      if (resolver) resolver(results);
      return;
    }
    if (msg.type === "collection_list") {
      const collections = (msg.collections as string[]) ?? [];
      const resolver = this.collectionListResolvers.shift();
      if (resolver) resolver(collections);
      return;
    }
    if (msg.type === "graph_result") {
      const rows = (msg.rows as Array<Record<string, unknown>>) ?? [];
      const resolver = this.graphResultResolvers.shift();
      if (resolver) resolver(rows);
      return;
    }
    if (msg.type === "context_list") {
      const contexts = (msg.contexts as Array<{ peerName: string; summary: string; tags: string[]; updatedAt: string }>) ?? [];
      const resolver = this.contextListResolvers.shift();
      if (resolver) resolver(contexts);
      return;
    }
    if (msg.type === "context_results") {
      const contexts = (msg.contexts as Array<{ peerName: string; summary: string; filesRead: string[]; keyFindings: string[]; tags: string[]; updatedAt: string }>) ?? [];
      const resolver = this.contextResultsResolvers.shift();
      if (resolver) resolver(contexts);
      return;
    }
    if (msg.type === "task_created") {
      const resolver = this.taskCreatedResolvers.shift();
      if (resolver) resolver(msg.id ? String(msg.id) : null);
      return;
    }
    if (msg.type === "task_list") {
      const tasks = (msg.tasks as Array<{ id: string; title: string; assignee: string; status: string; priority: string; createdBy: string }>) ?? [];
      const resolver = this.taskListResolvers.shift();
      if (resolver) resolver(tasks);
      return;
    }
    if (msg.type === "mesh_query_result") {
      const resolver = this.meshQueryResolvers.shift();
      if (resolver) {
        if (msg.columns) {
          resolver({
            columns: (msg.columns as string[]) ?? [],
            rows: (msg.rows as Array<Record<string, unknown>>) ?? [],
            rowCount: (msg.rowCount as number) ?? 0,
          });
        } else {
          resolver(null);
        }
      }
      return;
    }
    if (msg.type === "mesh_schema_result") {
      const tables = (msg.tables as Array<{ name: string; columns: Array<{ name: string; type: string; nullable: boolean }> }>) ?? [];
      const resolver = this.meshSchemaResolvers.shift();
      if (resolver) resolver(tables);
      return;
    }
    if (msg.type === "stream_created") {
      const resolver = this.streamCreatedResolvers.shift();
      if (resolver) resolver(msg.id ? String(msg.id) : null);
      return;
    }
    if (msg.type === "stream_list") {
      const streams = (msg.streams as Array<{ id: string; name: string; createdBy: string; subscriberCount: number }>) ?? [];
      const resolver = this.streamListResolvers.shift();
      if (resolver) resolver(streams);
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
      const resolver = this.meshInfoResolvers.shift();
      if (resolver) resolver(msg as Record<string, unknown>);
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
