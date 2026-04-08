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

/**
 * Detect the Claude Code session ID from the filesystem.
 * Fallback for when CLAUDEMESH_SESSION_ID env var isn't set
 * (e.g., claude --resume without going through claudemesh launch).
 *
 * Scans ~/.claude/projects/<project-hash>/ for the most recently
 * modified .jsonl file and extracts its sessionId.
 */
function detectClaudeSessionId(): string | null {
  try {
    const { readdirSync, statSync, readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const { homedir } = require("node:os");
    const cwd = process.cwd();
    // Claude Code hashes the project path for the directory name
    const projectsDir = join(homedir(), ".claude", "projects");
    // Find matching project dir — the hash includes the full path with dashes
    const cwdHash = cwd.replace(/\//g, "-");
    const entries = readdirSync(projectsDir) as string[];
    const projectDir = entries.find((e: string) => e === cwdHash || e.startsWith(cwdHash));
    if (!projectDir) return null;

    const fullDir = join(projectsDir, projectDir);
    const jsonls = (readdirSync(fullDir) as string[])
      .filter((f: string) => f.endsWith(".jsonl"))
      .map((f: string) => ({ name: f, mtime: statSync(join(fullDir, f)).mtimeMs }))
      .sort((a: any, b: any) => b.mtime - a.mtime);

    if (jsonls.length === 0) return null;
    const latest = jsonls[0]!;
    // Session ID is the filename without .jsonl
    return latest.name.replace(".jsonl", "");
  } catch {
    return null;
  }
}

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
  cwd?: string;
  hostname?: string;
  peerType?: "ai" | "human" | "connector";
  channel?: string;
  model?: string;
  stats?: {
    messagesIn?: number;
    messagesOut?: number;
    toolCalls?: number;
    uptime?: number;
    errors?: number;
  };
  visible?: boolean;
  profile?: {
    avatar?: string;
    title?: string;
    bio?: string;
    capabilities?: string[];
  };
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
  /** Optional semantic tag — "reminder" when fired by the scheduler,
   *  "system" for broker-originated topology events. */
  subtype?: "reminder" | "system";
  /** Machine-readable event name (e.g. "peer_joined", "peer_left"). */
  event?: string;
  /** Structured payload for the event. */
  eventData?: Record<string, unknown>;
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
  private peerFileResponseResolvers = new Map<string, { resolve: (result: { content?: string; error?: string }) => void; timer: NodeJS.Timeout }>();
  private peerDirResponseResolvers = new Map<string, { resolve: (result: { entries?: string[]; error?: string }) => void; timer: NodeJS.Timeout }>();
  /** Directories from which this peer serves files. Default: [process.cwd()]. */
  private sharedDirs: string[] = [process.cwd()];
  private _serviceCatalog: Array<{ name: string; description: string; status: string; tools: Array<{ name: string; description: string; inputSchema: object }>; deployed_by: string }> = [];
  get serviceCatalog() { return this._serviceCatalog; }
  private closed = false;
  private reconnectAttempt = 0;
  private helloTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  // --- Stats counters ---
  private _statsCounters = {
    messagesIn: 0,
    messagesOut: 0,
    toolCalls: 0,
    errors: 0,
  };
  private _sessionStartedAt = Date.now();
  private _statsReportTimer: NodeJS.Timeout | null = null;

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
  /** Mesh member public key hex (stable across sessions). */
  getMeshPubkey(): string { return this.mesh.pubkey; }
  /** Mesh member secret key hex (stable across sessions). */
  getMeshSecretKey(): string { return this.mesh.secretKey; }

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
              sessionId: process.env.CLAUDEMESH_SESSION_ID || detectClaudeSessionId() || `${process.pid}-${Date.now()}`,
              pid: process.pid,
              cwd: process.cwd(),
              hostname: require("os").hostname(),
              peerType: "ai" as const,
              channel: "claude-code",
              model: process.env.CLAUDE_MODEL || undefined,
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
          this.startStatsReporting();
          // Restore cumulative stats from a previous session if available.
          if (msg.restored) {
            const groups = msg.restoredGroups
              ? (msg.restoredGroups as Array<{ name: string; role?: string }>).map((g) => g.role ? `@${g.name}:${g.role}` : `@${g.name}`).join(", ")
              : "none";
            process.stderr.write(
              `[claudemesh] session restored — last seen ${msg.lastSeenAt ?? "unknown"}, groups: ${groups}\n`,
            );
            if (msg.restoredStats) {
              const rs = msg.restoredStats as { messagesIn: number; messagesOut: number; toolCalls: number; errors: number };
              this._statsCounters.messagesIn = rs.messagesIn ?? 0;
              this._statsCounters.messagesOut = rs.messagesOut ?? 0;
              this._statsCounters.toolCalls = rs.toolCalls ?? 0;
              this._statsCounters.errors = rs.errors ?? 0;
            }
          }
          if ((msg as any).services) {
            this._serviceCatalog = (msg as any).services;
          }
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

    this._statsCounters.messagesOut++;

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

  /** Toggle visibility in the mesh. Hidden peers don't appear in list_peers and skip broadcasts. */
  async setVisible(visible: boolean): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "set_visible", visible }));
  }

  /** Set public profile metadata visible to other peers. */
  async setProfile(profile: { avatar?: string; title?: string; bio?: string; capabilities?: string[] }): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "set_profile", ...profile }));
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

  /** Report resource usage stats to the broker. */
  setStats(stats?: Record<string, number>): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const payload = stats ?? {
      ...this._statsCounters,
      uptime: Math.round((Date.now() - this._sessionStartedAt) / 1000),
    };
    this.ws.send(JSON.stringify({ type: "set_stats", stats: payload }));
  }

  /** Increment the tool call counter. */
  incrementToolCalls(): void {
    this._statsCounters.toolCalls++;
  }

  /** Increment the error counter. */
  incrementErrors(): void {
    this._statsCounters.errors++;
  }

  /** Start auto-reporting stats every 60 seconds. */
  startStatsReporting(): void {
    if (this._statsReportTimer) return;
    this._statsReportTimer = setInterval(() => {
      this.setStats();
    }, 60_000);
  }

  /** Stop auto-reporting stats. */
  stopStatsReporting(): void {
    if (this._statsReportTimer) {
      clearInterval(this._statsReportTimer);
      this._statsReportTimer = null;
    }
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

  // --- Scheduled messages ---

  /** Schedule a message for future delivery. Returns { scheduledId, deliverAt, cron? } or null on timeout. */
  async scheduleMessage(
    to: string,
    message: string,
    deliverAt: number,
    isReminder = false,
    cron?: string,
  ): Promise<{ scheduledId: string; deliverAt: number; cron?: string } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.scheduledAckResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.scheduledAckResolvers.delete(reqId)) resolve(null);
      }, 8_000) });
      this.ws!.send(JSON.stringify({
        type: "schedule",
        to,
        message,
        deliverAt,
        ...(isReminder ? { subtype: "reminder" } : {}),
        ...(cron ? { cron, recurring: true } : {}),
        _reqId: reqId,
      }));
    });
  }

  /** List all pending scheduled messages for this session. */
  async listScheduled(): Promise<Array<{ id: string; to: string; message: string; deliverAt: number; createdAt: number }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.scheduledListResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.scheduledListResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "list_scheduled", _reqId: reqId }));
    });
  }

  /** Cancel a scheduled message by id. Returns true if found and cancelled. */
  async cancelScheduled(scheduledId: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return false;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.cancelScheduledResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.cancelScheduledResolvers.delete(reqId)) resolve(false);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "cancel_scheduled", scheduledId, _reqId: reqId }));
    });
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
  private scheduledAckResolvers = new Map<string, { resolve: (result: { scheduledId: string; deliverAt: number } | null) => void; timer: NodeJS.Timeout }>();
  private scheduledListResolvers = new Map<string, { resolve: (messages: Array<{ id: string; to: string; message: string; deliverAt: number; createdAt: number }>) => void; timer: NodeJS.Timeout }>();
  private cancelScheduledResolvers = new Map<string, { resolve: (ok: boolean) => void; timer: NodeJS.Timeout }>();
  private mcpRegisterResolvers = new Map<string, { resolve: (result: { serverName: string; toolCount: number } | null) => void; timer: NodeJS.Timeout }>();
  private mcpListResolvers = new Map<string, { resolve: (servers: Array<{ name: string; description: string; hostedBy: string; tools: Array<{ name: string; description: string }> }>) => void; timer: NodeJS.Timeout }>();
  private mcpCallResolvers = new Map<string, { resolve: (result: { result?: unknown; error?: string }) => void; timer: NodeJS.Timeout }>();
  /** Handler for inbound mcp_call_forward messages. Set by the MCP server. */
  private mcpCallForwardHandler: ((forward: { callId: string; serverName: string; toolName: string; args: Record<string, unknown>; callerName: string }) => Promise<{ result?: unknown; error?: string }>) | null = null;
  private vaultAckResolvers = new Map<string, { resolve: (ok: boolean) => void; timer: NodeJS.Timeout }>();
  private vaultListResolvers = new Map<string, { resolve: (entries: any[]) => void; timer: NodeJS.Timeout }>();
  private mcpDeployResolvers = new Map<string, { resolve: (result: any) => void; timer: NodeJS.Timeout }>();
  private mcpLogsResolvers = new Map<string, { resolve: (lines: string[]) => void; timer: NodeJS.Timeout }>();
  private mcpSchemaServiceResolvers = new Map<string, { resolve: (tools: any[]) => void; timer: NodeJS.Timeout }>();
  private mcpCatalogResolvers = new Map<string, { resolve: (services: any[]) => void; timer: NodeJS.Timeout }>();
  private mcpScopeResolvers = new Map<string, { resolve: (result: any) => void; timer: NodeJS.Timeout }>();
  private skillDeployResolvers = new Map<string, { resolve: (result: any) => void; timer: NodeJS.Timeout }>();

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

  // --- MCP proxy ---

  /** Register an MCP server with the mesh. */
  async mcpRegister(
    serverName: string,
    description: string,
    tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
    persistent?: boolean,
  ): Promise<{ serverName: string; toolCount: number } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.mcpRegisterResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.mcpRegisterResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "mcp_register", serverName, description, tools, ...(persistent ? { persistent: true } : {}), _reqId: reqId }));
    });
  }

  /** Unregister an MCP server from the mesh. */
  async mcpUnregister(serverName: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "mcp_unregister", serverName }));
  }

  /** List MCP servers available in the mesh. */
  async mcpList(): Promise<Array<{ name: string; description: string; hostedBy: string; tools: Array<{ name: string; description: string }> }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.mcpListResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.mcpListResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "mcp_list", _reqId: reqId }));
    });
  }

  /** Call a tool on a mesh-registered MCP server. 30s timeout. */
  async mcpCall(serverName: string, toolName: string, args: Record<string, unknown>): Promise<{ result?: unknown; error?: string }> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return { error: "not connected" };
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.mcpCallResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.mcpCallResolvers.delete(reqId)) resolve({ error: "MCP call timed out (30s)" });
      }, 30_000) });
      this.ws!.send(JSON.stringify({ type: "mcp_call", serverName, toolName, args, _reqId: reqId }));
    });
  }

  /** Set the handler for inbound forwarded MCP calls. */
  onMcpCallForward(handler: (forward: { callId: string; serverName: string; toolName: string; args: Record<string, unknown>; callerName: string }) => Promise<{ result?: unknown; error?: string }>): void {
    this.mcpCallForwardHandler = handler;
  }

  /** Send a response to a forwarded MCP call back to the broker. */
  private sendMcpCallResponse(callId: string, result?: unknown, error?: string): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "mcp_call_response", callId, result, error }));
  }

  // --- Mesh info ---
  private meshInfoResolvers = new Map<string, { resolve: (result: Record<string, unknown> | null) => void; timer: NodeJS.Timeout }>();
  private clockStatusResolvers = new Map<string, { resolve: (result: { speed: number; paused: boolean; tick: number; simTime: string; startedAt: string } | null) => void; timer: NodeJS.Timeout }>();

  /** Set the simulation clock speed. Returns clock status. */
  async setClock(speed: number): Promise<{ speed: number; paused: boolean; tick: number; simTime: string; startedAt: string } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.clockStatusResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.clockStatusResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "set_clock", speed, _reqId: reqId }));
    });
  }

  /** Pause the simulation clock. Returns clock status. */
  async pauseClock(): Promise<{ speed: number; paused: boolean; tick: number; simTime: string; startedAt: string } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.clockStatusResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.clockStatusResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "pause_clock", _reqId: reqId }));
    });
  }

  /** Resume the simulation clock. Returns clock status. */
  async resumeClock(): Promise<{ speed: number; paused: boolean; tick: number; simTime: string; startedAt: string } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.clockStatusResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.clockStatusResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "resume_clock", _reqId: reqId }));
    });
  }

  /** Get current simulation clock status. */
  async getClock(): Promise<{ speed: number; paused: boolean; tick: number; simTime: string; startedAt: string } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.clockStatusResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.clockStatusResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "get_clock", _reqId: reqId }));
    });
  }

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

  // --- Skills ---
  private skillAckResolvers = new Map<string, { resolve: (result: { name: string; action: string } | null) => void; timer: NodeJS.Timeout }>();
  private skillDataResolvers = new Map<string, { resolve: (skill: { name: string; description: string; instructions: string; tags: string[]; author: string; createdAt: string } | null) => void; timer: NodeJS.Timeout }>();
  private skillListResolvers = new Map<string, { resolve: (skills: Array<{ name: string; description: string; tags: string[]; author: string; createdAt: string }>) => void; timer: NodeJS.Timeout }>();

  /** Publish a reusable skill to the mesh. */
  async shareSkill(name: string, description: string, instructions: string, tags?: string[]): Promise<{ ok: boolean; action?: string } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.skillAckResolvers.set(reqId, { resolve: (result) => {
        resolve(result ? { ok: true, action: result.action } : null);
      }, timer: setTimeout(() => {
        if (this.skillAckResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "share_skill", name, description, instructions, tags, _reqId: reqId }));
    });
  }

  /** Load a skill's full instructions by name. */
  async getSkill(name: string): Promise<{ name: string; description: string; instructions: string; tags: string[]; author: string; createdAt: string } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.skillDataResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.skillDataResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "get_skill", name, _reqId: reqId }));
    });
  }

  /** Browse available skills in the mesh. */
  async listSkills(query?: string): Promise<Array<{ name: string; description: string; tags: string[]; author: string; createdAt: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.skillListResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.skillListResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "list_skills", query, _reqId: reqId }));
    });
  }

  /** Remove a skill you published. */
  async removeSkill(name: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return false;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.skillAckResolvers.set(reqId, { resolve: (result) => {
        resolve(result?.action === "removed");
      }, timer: setTimeout(() => {
        if (this.skillAckResolvers.delete(reqId)) resolve(false);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "remove_skill", name, _reqId: reqId }));
    });
  }

  // --- Webhooks ---
  private webhookAckResolvers = new Map<string, { resolve: (result: { name: string; url: string; secret: string } | null) => void; timer: NodeJS.Timeout }>();
  private webhookListResolvers = new Map<string, { resolve: (webhooks: Array<{ name: string; url: string; active: boolean; createdAt: string }>) => void; timer: NodeJS.Timeout }>();

  /** Create an inbound webhook. Returns the URL and secret. */
  async createWebhook(name: string): Promise<{ name: string; url: string; secret: string } | null> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return null;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.webhookAckResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.webhookAckResolvers.delete(reqId)) resolve(null);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "create_webhook", name, _reqId: reqId }));
    });
  }

  /** List active webhooks for this mesh. */
  async listWebhooks(): Promise<Array<{ name: string; url: string; active: boolean; createdAt: string }>> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.webhookListResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.webhookListResolvers.delete(reqId)) resolve([]);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "list_webhooks", _reqId: reqId }));
    });
  }

  /** Deactivate a webhook by name. */
  async deleteWebhook(name: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return false;
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.webhookAckResolvers.set(reqId, { resolve: () => resolve(true), timer: setTimeout(() => {
        if (this.webhookAckResolvers.delete(reqId)) resolve(false);
      }, 5_000) });
      this.ws!.send(JSON.stringify({ type: "delete_webhook", name, _reqId: reqId }));
    });
  }

  // --- Peer file sharing ---

  /** Set the directories this peer shares. Default: [cwd]. */
  setSharedDirs(dirs: string[]): void {
    this.sharedDirs = dirs.map(d => {
      const { resolve } = require("node:path");
      return resolve(d);
    });
  }

  /** Request a file from another peer's local filesystem. Returns base64 content or error. */
  async requestFile(targetPubkey: string, filePath: string): Promise<{ content?: string; error?: string }> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return { error: "not connected" };
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.peerFileResponseResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.peerFileResponseResolvers.delete(reqId)) resolve({ error: "timeout waiting for peer response" });
      }, 15_000) });
      this.ws!.send(JSON.stringify({ type: "peer_file_request", targetPubkey, filePath, _reqId: reqId }));
    });
  }

  /** Request a directory listing from another peer. */
  async requestDir(targetPubkey: string, dirPath: string, pattern?: string): Promise<{ entries?: string[]; error?: string }> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return { error: "not connected" };
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      this.peerDirResponseResolvers.set(reqId, { resolve, timer: setTimeout(() => {
        if (this.peerDirResponseResolvers.delete(reqId)) resolve({ error: "timeout waiting for peer response" });
      }, 15_000) });
      this.ws!.send(JSON.stringify({ type: "peer_dir_request", targetPubkey, dirPath, ...(pattern ? { pattern } : {}), _reqId: reqId }));
    });
  }

  // --- Vault ---

  async vaultSet(key: string, ciphertext: string, nonce: string, sealedKey: string, entryType: "env" | "file", mountPath?: string, description?: string): Promise<boolean> {
    return new Promise(resolve => {
      const reqId = `vset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => { this.vaultAckResolvers.delete(reqId); resolve(false); }, 10_000);
      this.vaultAckResolvers.set(reqId, { resolve, timer });
      this.sendRaw({ type: "vault_set", key, ciphertext, nonce, sealed_key: sealedKey, entry_type: entryType, mount_path: mountPath, description, _reqId: reqId } as any);
    });
  }

  async vaultList(): Promise<any[]> {
    return new Promise(resolve => {
      const reqId = `vlist_${Date.now()}`;
      const timer = setTimeout(() => { this.vaultListResolvers.delete(reqId); resolve([]); }, 10_000);
      this.vaultListResolvers.set(reqId, { resolve, timer });
      this.sendRaw({ type: "vault_list", _reqId: reqId } as any);
    });
  }

  async vaultDelete(key: string): Promise<boolean> {
    return new Promise(resolve => {
      const reqId = `vdel_${Date.now()}`;
      const timer = setTimeout(() => { this.vaultAckResolvers.delete(reqId); resolve(false); }, 10_000);
      this.vaultAckResolvers.set(reqId, { resolve, timer });
      this.sendRaw({ type: "vault_delete", key, _reqId: reqId } as any);
    });
  }

  async vaultGet(keys: string[]): Promise<Array<{ key: string; ciphertext: string; nonce: string; sealed_key: string; entry_type: string; mount_path?: string }>> {
    return new Promise(resolve => {
      const reqId = `vget_${Date.now()}`;
      const timer = setTimeout(() => { this.vaultListResolvers.delete(reqId); resolve([]); }, 10_000);
      this.vaultListResolvers.set(reqId, { resolve, timer });
      this.sendRaw({ type: "vault_get", keys, _reqId: reqId } as any);
    });
  }

  // --- MCP Deploy ---

  async mcpDeploy(serverName: string, source: any, config?: any, scope?: any): Promise<any> {
    return new Promise(resolve => {
      const reqId = `deploy_${Date.now()}`;
      const timer = setTimeout(() => { this.mcpDeployResolvers.delete(reqId); resolve({ status: "timeout" }); }, 60_000);
      this.mcpDeployResolvers.set(reqId, { resolve, timer });
      this.sendRaw({ type: "mcp_deploy", server_name: serverName, source, config, scope, _reqId: reqId } as any);
    });
  }

  async mcpUndeploy(serverName: string): Promise<boolean> {
    return new Promise(resolve => {
      const reqId = `undeploy_${Date.now()}`;
      const timer = setTimeout(() => { this.mcpDeployResolvers.delete(reqId); resolve(false); }, 10_000);
      this.mcpDeployResolvers.set(reqId, { resolve: (r: any) => resolve(r.status === "stopped"), timer });
      this.sendRaw({ type: "mcp_undeploy", server_name: serverName, _reqId: reqId } as any);
    });
  }

  async mcpUpdate(serverName: string): Promise<any> {
    return new Promise(resolve => {
      const reqId = `update_${Date.now()}`;
      const timer = setTimeout(() => { this.mcpDeployResolvers.delete(reqId); resolve({ status: "timeout" }); }, 60_000);
      this.mcpDeployResolvers.set(reqId, { resolve, timer });
      this.sendRaw({ type: "mcp_update", server_name: serverName, _reqId: reqId } as any);
    });
  }

  async mcpLogs(serverName: string, lines?: number): Promise<string[]> {
    return new Promise(resolve => {
      const reqId = `logs_${Date.now()}`;
      const timer = setTimeout(() => { this.mcpLogsResolvers.delete(reqId); resolve([]); }, 10_000);
      this.mcpLogsResolvers.set(reqId, { resolve, timer });
      this.sendRaw({ type: "mcp_logs", server_name: serverName, lines, _reqId: reqId } as any);
    });
  }

  async mcpScope(serverName: string, scope?: any): Promise<any> {
    return new Promise(resolve => {
      const reqId = `scope_${Date.now()}`;
      const timer = setTimeout(() => { this.mcpScopeResolvers.delete(reqId); resolve({ scope: { type: "peer" }, deployed_by: "unknown" }); }, 10_000);
      this.mcpScopeResolvers.set(reqId, { resolve, timer });
      this.sendRaw({ type: "mcp_scope", server_name: serverName, scope, _reqId: reqId } as any);
    });
  }

  async mcpServiceSchema(serverName: string, toolName?: string): Promise<any[]> {
    return new Promise(resolve => {
      const reqId = `schema_${Date.now()}`;
      const timer = setTimeout(() => { this.mcpSchemaServiceResolvers.delete(reqId); resolve([]); }, 10_000);
      this.mcpSchemaServiceResolvers.set(reqId, { resolve, timer });
      this.sendRaw({ type: "mcp_schema", server_name: serverName, tool_name: toolName, _reqId: reqId } as any);
    });
  }

  async mcpCatalog(): Promise<any[]> {
    return new Promise(resolve => {
      const reqId = `catalog_${Date.now()}`;
      const timer = setTimeout(() => { this.mcpCatalogResolvers.delete(reqId); resolve([]); }, 10_000);
      this.mcpCatalogResolvers.set(reqId, { resolve, timer });
      this.sendRaw({ type: "mcp_catalog", _reqId: reqId } as any);
    });
  }

  // --- Skill Deploy ---

  async skillDeploy(source: any): Promise<any> {
    return new Promise(resolve => {
      const reqId = `skilldeploy_${Date.now()}`;
      const timer = setTimeout(() => { this.skillDeployResolvers.delete(reqId); resolve({ name: "unknown", files: [] }); }, 30_000);
      this.skillDeployResolvers.set(reqId, { resolve, timer });
      this.sendRaw({ type: "skill_deploy", source, _reqId: reqId } as any);
    });
  }

  async getServiceTools(serviceName: string): Promise<any[]> {
    // Check cached catalog first
    const cached = this._serviceCatalog.find(s => s.name === serviceName);
    if (cached?.tools?.length) return cached.tools;
    // Fall back to schema query
    return this.mcpServiceSchema(serviceName);
  }

  /** Send a raw JSON frame to the broker (fire-and-forget). */
  private sendRaw(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  close(): void {
    this.closed = true;
    this.stopStatsReporting();
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

  // --- Peer file request handlers (serving local files to remote peers) ---

  private static readonly MAX_FILE_SIZE = 1_048_576; // 1MB

  /** Handle an inbound file request from another peer (forwarded by broker). */
  private async handlePeerFileRequest(msg: { requesterPubkey: string; filePath: string; _reqId?: string }): Promise<void> {
    const { resolve, join, normalize } = await import("node:path");
    const { readFileSync, statSync } = await import("node:fs");

    const reqId = msg._reqId;
    const sendResponse = (content?: string, error?: string) => {
      if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
      this.ws.send(JSON.stringify({
        type: "peer_file_response",
        requesterPubkey: msg.requesterPubkey,
        filePath: msg.filePath,
        ...(content !== undefined ? { content } : {}),
        ...(error ? { error } : {}),
        ...(reqId ? { _reqId: reqId } : {}),
      }));
    };

    // Security: reject path traversal
    if (msg.filePath.includes("..")) {
      sendResponse(undefined, "path traversal not allowed");
      return;
    }

    // Resolve against shared directories
    let resolvedPath: string | null = null;
    for (const dir of this.sharedDirs) {
      const candidate = resolve(join(dir, msg.filePath));
      const normalizedCandidate = normalize(candidate);
      const normalizedDir = normalize(dir);
      if (normalizedCandidate.startsWith(normalizedDir + "/") || normalizedCandidate === normalizedDir) {
        resolvedPath = candidate;
        break;
      }
    }
    if (!resolvedPath) {
      sendResponse(undefined, "file outside shared directories");
      return;
    }

    try {
      const stat = statSync(resolvedPath);
      if (!stat.isFile()) {
        sendResponse(undefined, "not a file");
        return;
      }
      if (stat.size > BrokerClient.MAX_FILE_SIZE) {
        sendResponse(undefined, `file too large (${stat.size} bytes, max ${BrokerClient.MAX_FILE_SIZE})`);
        return;
      }
      const content = readFileSync(resolvedPath);
      sendResponse(content.toString("base64"));
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes("ENOENT")) {
        sendResponse(undefined, "file not found");
      } else {
        sendResponse(undefined, `read error: ${errMsg}`);
      }
    }
  }

  /** Handle an inbound directory listing request from another peer. */
  private async handlePeerDirRequest(msg: { requesterPubkey: string; dirPath: string; pattern?: string; _reqId?: string }): Promise<void> {
    const { resolve, join, normalize, relative } = await import("node:path");
    const { readdirSync, statSync } = await import("node:fs");

    const reqId = msg._reqId;
    const sendResponse = (entries?: string[], error?: string) => {
      if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
      this.ws.send(JSON.stringify({
        type: "peer_dir_response",
        requesterPubkey: msg.requesterPubkey,
        dirPath: msg.dirPath,
        ...(entries ? { entries } : {}),
        ...(error ? { error } : {}),
        ...(reqId ? { _reqId: reqId } : {}),
      }));
    };

    const dirPath = msg.dirPath || ".";

    // Security: reject path traversal
    if (dirPath.includes("..")) {
      sendResponse(undefined, "path traversal not allowed");
      return;
    }

    let resolvedPath: string | null = null;
    for (const dir of this.sharedDirs) {
      const candidate = resolve(join(dir, dirPath));
      const normalizedCandidate = normalize(candidate);
      const normalizedDir = normalize(dir);
      if (normalizedCandidate.startsWith(normalizedDir + "/") || normalizedCandidate === normalizedDir) {
        resolvedPath = candidate;
        break;
      }
    }
    if (!resolvedPath) {
      sendResponse(undefined, "directory outside shared directories");
      return;
    }

    try {
      const stat = statSync(resolvedPath);
      if (!stat.isDirectory()) {
        sendResponse(undefined, "not a directory");
        return;
      }

      // Collect entries recursively (up to 2 levels, max 500 entries)
      const entries: string[] = [];
      const MAX_ENTRIES = 500;
      const MAX_DEPTH = 2;
      const pattern = msg.pattern ? new RegExp(msg.pattern.replace(/\*/g, ".*").replace(/\?/g, "."), "i") : null;

      const walk = (dir: string, depth: number) => {
        if (entries.length >= MAX_ENTRIES || depth > MAX_DEPTH) return;
        try {
          const items = readdirSync(dir, { withFileTypes: true });
          for (const item of items) {
            if (entries.length >= MAX_ENTRIES) break;
            if (item.name.startsWith(".")) continue; // skip hidden
            const relPath = relative(resolvedPath!, join(dir, item.name));
            const label = item.isDirectory() ? relPath + "/" : relPath;
            if (pattern && !pattern.test(item.name)) {
              // If directory, still recurse (pattern may match children)
              if (item.isDirectory()) walk(join(dir, item.name), depth + 1);
              continue;
            }
            entries.push(label);
            if (item.isDirectory()) walk(join(dir, item.name), depth + 1);
          }
        } catch { /* permission errors, etc. */ }
      };

      walk(resolvedPath, 0);
      sendResponse(entries.sort());
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes("ENOENT")) {
        sendResponse(undefined, "directory not found");
      } else {
        sendResponse(undefined, `read error: ${errMsg}`);
      }
    }
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
      this._statsCounters.messagesIn++;
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
          ...(msg.subtype ? { subtype: msg.subtype as "reminder" | "system" } : {}),
          ...(msg.event ? { event: String(msg.event) } : {}),
          ...(msg.eventData ? { eventData: msg.eventData as Record<string, unknown> } : {}),
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
    if (msg.type === "clock_status") {
      this.resolveFromMap(this.clockStatusResolvers, msgReqId, {
        speed: Number(msg.speed ?? 0),
        paused: Boolean(msg.paused),
        tick: Number(msg.tick ?? 0),
        simTime: String(msg.simTime ?? ""),
        startedAt: String(msg.startedAt ?? ""),
      });
      return;
    }
    if (msg.type === "mesh_info_result") {
      this.resolveFromMap(this.meshInfoResolvers, msgReqId, msg as Record<string, unknown>);
      return;
    }
    if (msg.type === "skill_ack") {
      this.resolveFromMap(this.skillAckResolvers, msgReqId, { name: String(msg.name ?? ""), action: String(msg.action ?? "") });
      return;
    }
    if (msg.type === "skill_data") {
      const skill = msg.skill as { name: string; description: string; instructions: string; tags: string[]; author: string; createdAt: string } | null;
      this.resolveFromMap(this.skillDataResolvers, msgReqId, skill ?? null);
      return;
    }
    if (msg.type === "skill_list") {
      const skills = (msg.skills as Array<{ name: string; description: string; tags: string[]; author: string; createdAt: string }>) ?? [];
      this.resolveFromMap(this.skillListResolvers, msgReqId, skills);
      return;
    }
    if (msg.type === "scheduled_ack") {
      this.resolveFromMap(this.scheduledAckResolvers, msgReqId, {
        scheduledId: String(msg.scheduledId ?? ""),
        deliverAt: Number(msg.deliverAt ?? 0),
        ...(msg.cron ? { cron: String(msg.cron) } : {}),
      });
      return;
    }
    if (msg.type === "scheduled_list") {
      const messages = (msg.messages as Array<{ id: string; to: string; message: string; deliverAt: number; createdAt: number }>) ?? [];
      this.resolveFromMap(this.scheduledListResolvers, msgReqId, messages);
      return;
    }
    if (msg.type === "cancel_scheduled_ack") {
      this.resolveFromMap(this.cancelScheduledResolvers, msgReqId, Boolean(msg.ok));
      return;
    }
    if (msg.type === "mcp_register_ack") {
      this.resolveFromMap(this.mcpRegisterResolvers, msgReqId, {
        serverName: String(msg.serverName ?? ""),
        toolCount: Number(msg.toolCount ?? 0),
      });
      return;
    }
    if (msg.type === "mcp_list_result") {
      const servers = (msg.servers as Array<{ name: string; description: string; hostedBy: string; tools: Array<{ name: string; description: string }> }>) ?? [];
      this.resolveFromMap(this.mcpListResolvers, msgReqId, servers);
      return;
    }
    if (msg.type === "mcp_call_result") {
      this.resolveFromMap(this.mcpCallResolvers, msgReqId, {
        ...(msg.result !== undefined ? { result: msg.result } : {}),
        ...(msg.error ? { error: String(msg.error) } : {}),
      });
      return;
    }
    if (msg.type === "mcp_call_forward") {
      const forward = {
        callId: String(msg.callId ?? ""),
        serverName: String(msg.serverName ?? ""),
        toolName: String(msg.toolName ?? ""),
        args: (msg.args as Record<string, unknown>) ?? {},
        callerName: String(msg.callerName ?? ""),
      };
      if (this.mcpCallForwardHandler) {
        this.mcpCallForwardHandler(forward)
          .then((res) => this.sendMcpCallResponse(forward.callId, res.result, res.error))
          .catch((e) => this.sendMcpCallResponse(forward.callId, undefined, e instanceof Error ? e.message : String(e)));
      } else {
        this.sendMcpCallResponse(forward.callId, undefined, "No MCP call handler registered on this peer");
      }
      return;
    }
    // --- Peer file sharing handlers ---
    if (msg.type === "peer_file_request_forward") {
      void this.handlePeerFileRequest(msg as { requesterPubkey: string; filePath: string; _reqId?: string });
      return;
    }
    if (msg.type === "peer_file_response_forward") {
      this.resolveFromMap(this.peerFileResponseResolvers, msgReqId, {
        content: msg.content ? String(msg.content) : undefined,
        error: msg.error ? String(msg.error) : undefined,
      });
      return;
    }
    if (msg.type === "peer_dir_request_forward") {
      void this.handlePeerDirRequest(msg as { requesterPubkey: string; dirPath: string; pattern?: string; _reqId?: string });
      return;
    }
    if (msg.type === "peer_dir_response_forward") {
      this.resolveFromMap(this.peerDirResponseResolvers, msgReqId, {
        entries: (msg.entries as string[] | undefined) ?? undefined,
        error: msg.error ? String(msg.error) : undefined,
      });
      return;
    }
    if (msg.type === "webhook_ack") {
      this.resolveFromMap(this.webhookAckResolvers, msgReqId, {
        name: String(msg.name ?? ""),
        url: String(msg.url ?? ""),
        secret: String(msg.secret ?? ""),
      });
      return;
    }
    if (msg.type === "webhook_list") {
      const webhooks = (msg.webhooks as Array<{ name: string; url: string; active: boolean; createdAt: string }>) ?? [];
      this.resolveFromMap(this.webhookListResolvers, msgReqId, webhooks);
      return;
    }
    if (msg.type === "vault_ack") {
      const reqId = (msg as any)._reqId;
      if (reqId && this.vaultAckResolvers.has(reqId)) {
        const r = this.vaultAckResolvers.get(reqId)!;
        clearTimeout(r.timer);
        this.vaultAckResolvers.delete(reqId);
        r.resolve(msg.action !== "not_found");
      }
    }
    if (msg.type === "vault_list_result") {
      const reqId = (msg as any)._reqId;
      if (reqId && this.vaultListResolvers.has(reqId)) {
        const r = this.vaultListResolvers.get(reqId)!;
        clearTimeout(r.timer);
        this.vaultListResolvers.delete(reqId);
        r.resolve((msg as any).entries ?? []);
      }
    }
    if (msg.type === "vault_get_result") {
      const reqId = (msg as any)._reqId;
      if (reqId && this.vaultListResolvers.has(reqId)) {
        const r = this.vaultListResolvers.get(reqId)!;
        clearTimeout(r.timer);
        this.vaultListResolvers.delete(reqId);
        r.resolve((msg as any).entries ?? []);
      }
    }
    if (msg.type === "mcp_deploy_status") {
      const reqId = (msg as any)._reqId;
      if (reqId && this.mcpDeployResolvers.has(reqId)) {
        const r = this.mcpDeployResolvers.get(reqId)!;
        clearTimeout(r.timer);
        this.mcpDeployResolvers.delete(reqId);
        r.resolve({ status: (msg as any).status, tools: (msg as any).tools, error: (msg as any).error });
      }
    }
    if (msg.type === "mcp_logs_result") {
      const reqId = (msg as any)._reqId;
      if (reqId && this.mcpLogsResolvers.has(reqId)) {
        const r = this.mcpLogsResolvers.get(reqId)!;
        clearTimeout(r.timer);
        this.mcpLogsResolvers.delete(reqId);
        r.resolve((msg as any).lines ?? []);
      }
    }
    if (msg.type === "mcp_schema_result") {
      const reqId = (msg as any)._reqId;
      if (reqId && this.mcpSchemaServiceResolvers.has(reqId)) {
        const r = this.mcpSchemaServiceResolvers.get(reqId)!;
        clearTimeout(r.timer);
        this.mcpSchemaServiceResolvers.delete(reqId);
        r.resolve((msg as any).tools ?? []);
      }
    }
    if (msg.type === "mcp_catalog_result") {
      const reqId = (msg as any)._reqId;
      if (reqId && this.mcpCatalogResolvers.has(reqId)) {
        const r = this.mcpCatalogResolvers.get(reqId)!;
        clearTimeout(r.timer);
        this.mcpCatalogResolvers.delete(reqId);
        r.resolve((msg as any).services ?? []);
      }
    }
    if (msg.type === "mcp_scope_result") {
      const reqId = (msg as any)._reqId;
      if (reqId && this.mcpScopeResolvers.has(reqId)) {
        const r = this.mcpScopeResolvers.get(reqId)!;
        clearTimeout(r.timer);
        this.mcpScopeResolvers.delete(reqId);
        r.resolve({ scope: (msg as any).scope, deployed_by: (msg as any).deployed_by });
      }
    }
    if (msg.type === "skill_deploy_ack") {
      const reqId = (msg as any)._reqId;
      if (reqId && this.skillDeployResolvers.has(reqId)) {
        const r = this.skillDeployResolvers.get(reqId)!;
        clearTimeout(r.timer);
        this.skillDeployResolvers.delete(reqId);
        r.resolve({ name: (msg as any).name, files: (msg as any).files ?? [] });
      }
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
          [this.scheduledAckResolvers, null],
          [this.scheduledListResolvers, []],
          [this.cancelScheduledResolvers, false],
          [this.messageStatusResolvers, null],
          [this.grantFileAccessResolvers, false],
          [this.collectionListResolvers, []],
          [this.meshSchemaResolvers, []],
          [this.taskCreatedResolvers, null],
          [this.streamCreatedResolvers, null],
          [this.listPeersResolvers, []],
          [this.meshInfoResolvers, null],
          [this.clockStatusResolvers, null],
          [this.mcpRegisterResolvers, null],
          [this.mcpListResolvers, []],
          [this.mcpCallResolvers, { error: "broker error" }],
          [this.skillAckResolvers, null],
          [this.skillDataResolvers, null],
          [this.skillListResolvers, []],
          [this.peerFileResponseResolvers, { error: "broker error" }],
          [this.peerDirResponseResolvers, { error: "broker error" }],
          [this.webhookAckResolvers, null],
          [this.webhookListResolvers, []],
          [this.vaultAckResolvers, false],
          [this.vaultListResolvers, []],
          [this.mcpDeployResolvers, { status: "error" }],
          [this.mcpLogsResolvers, []],
          [this.mcpSchemaServiceResolvers, []],
          [this.mcpCatalogResolvers, []],
          [this.mcpScopeResolvers, { scope: { type: "peer" }, deployed_by: "unknown" }],
          [this.skillDeployResolvers, { name: "unknown", files: [] }],
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
