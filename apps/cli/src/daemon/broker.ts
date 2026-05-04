// Minimal broker WS connector for the daemon. Reuses the existing CLI
// hello-sign protocol so it speaks the wire current brokers understand.
//
// Differences from BrokerClient (services/broker/ws-client.ts):
//   - Slim: no in-memory pending-sends queue, no list_peers/state/topic
//     RPCs. The daemon's outbox is the source of truth.
//   - Wire envelope adds `client_message_id` (broker may ignore in legacy
//     mode; Sprint 7 promotes it to authoritative dedupe).
//   - Reconnect with exponential backoff, signaled to the drain worker.
//
// 2026-05-04: lifecycle (connect / hello-ack / close-reconnect) now
// lives in `ws-lifecycle.ts`. This class supplies the daemon-WS hello
// content and routes incoming RPC replies / pushes; the helper handles
// the rest. The hello no longer carries an ephemeral `sessionPubkey` —
// session-targeted DMs land on the per-session WS (SessionBrokerClient)
// since 1.32.1, so this socket only needs the member identity.

import type { JoinedMesh } from "~/services/config/facade.js";
import { signHello } from "~/services/broker/hello-sig.js";
import { connectWsWithBackoff, type WsLifecycle, type WsStatus } from "./ws-lifecycle.js";

export type ConnStatus = WsStatus;

export interface BrokerSendArgs {
  /** Target as the broker expects it: peer name | pubkey | @group | * | topic. */
  targetSpec: string;
  priority: "now" | "next" | "low";
  nonce: string;
  ciphertext: string;
  /** Daemon-issued idempotency id. Echoed back by the broker for dedupe. */
  client_message_id: string;
  /** Sha256-32 fingerprint of the request, hex. Forwarded for Sprint 7 dedupe. */
  request_fingerprint_hex: string;
}

export type BrokerSendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; permanent: boolean };

interface PendingAck {
  resolve: (r: BrokerSendResult) => void;
  timer: NodeJS.Timeout;
}

export interface PeerSummary {
  pubkey: string;
  memberPubkey?: string;
  displayName: string;
  status: string;
  summary: string | null;
  groups: Array<{ name: string; role?: string }>;
  sessionId: string;
  connectedAt: string;
  cwd?: string;
  hostname?: string;
  peerType?: string;
  channel?: string;
  /** Broker-side classification, added 2026-05-04. Missing in older brokers. */
  role?: "control-plane" | "session" | "service";
}

interface PendingPeerList {
  resolve: (peers: PeerSummary[]) => void;
  timer: NodeJS.Timeout;
}

export interface SkillSummary {
  name: string;
  description: string;
  tags: string[];
  author: string;
  createdAt: string;
}

export interface SkillFull extends SkillSummary {
  instructions: string;
  manifest?: unknown;
}

export interface StateRow {
  key: string;
  value: unknown;
  updatedBy: string;
  updatedAt: string;
}

export interface MemoryRow {
  id: string;
  content: string;
  tags: string[];
  rememberedBy: string;
  rememberedAt: string;
}

const SEND_ACK_TIMEOUT_MS = 15_000;

export interface DaemonBrokerOptions {
  displayName?: string;
  onStatusChange?: (s: ConnStatus) => void;
  onPush?: (msg: Record<string, unknown>) => void;
  log?: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
}

export class DaemonBrokerClient {
  private lifecycle: WsLifecycle | null = null;
  private _status: ConnStatus = "closed";
  private closed = false;
  private pendingAcks = new Map<string, PendingAck>();
  private peerListResolvers = new Map<string, PendingPeerList>();
  private skillListResolvers = new Map<string, { resolve: (rows: SkillSummary[]) => void; timer: NodeJS.Timeout }>();
  private skillDataResolvers = new Map<string, { resolve: (row: SkillFull | null) => void; timer: NodeJS.Timeout }>();
  private stateGetResolvers = new Map<string, { resolve: (row: StateRow | null) => void; timer: NodeJS.Timeout }>();
  private stateListResolvers = new Map<string, { resolve: (rows: StateRow[]) => void; timer: NodeJS.Timeout }>();
  private memoryStoreResolvers = new Map<string, { resolve: (id: string | null) => void; timer: NodeJS.Timeout }>();
  private memoryRecallResolvers = new Map<string, { resolve: (rows: MemoryRow[]) => void; timer: NodeJS.Timeout }>();
  private opens: Array<() => void> = [];
  private reqCounter = 0;

  constructor(private mesh: JoinedMesh, private opts: DaemonBrokerOptions = {}) {}

  get status(): ConnStatus { return this._status; }
  get meshSlug(): string { return this.mesh.slug; }
  get meshId(): string { return this.mesh.meshId; }

  private log = (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => {
    (this.opts.log ?? defaultLog)(level, msg, { mesh: this.mesh.slug, ...meta });
  };

  /** Open the WS, run the hello handshake, resolve once the broker accepts. */
  async connect(): Promise<void> {
    if (this.closed) throw new Error("client_closed");
    if (this._status === "connecting" || this._status === "open") return;

    this.lifecycle = await connectWsWithBackoff({
      url: this.mesh.brokerUrl,
      buildHello: async () => {
        const { timestamp, signature } = await signHello(
          this.mesh.meshId, this.mesh.memberId, this.mesh.pubkey, this.mesh.secretKey,
        );
        return {
          type: "hello",
          meshId: this.mesh.meshId,
          memberId: this.mesh.memberId,
          pubkey: this.mesh.pubkey,
          // No `sessionPubkey` — daemon-WS is member-keyed only. The
          // per-session presence WS (SessionBrokerClient) carries the
          // ephemeral session pubkey. Spec §"Layer 1: Identity → Member identity".
          displayName: this.opts.displayName,
          sessionId: `daemon-${process.pid}`,
          pid: process.pid,
          cwd: process.cwd(),
          hostname: require("node:os").hostname(),
          peerType: "ai" as const,
          channel: "claudemesh-daemon",
          timestamp,
          signature,
        };
      },
      isHelloAck: (msg) => msg.type === "hello_ack",
      onMessage: (msg) => this.handleMessage(msg),
      onStatusChange: (s) => {
        this._status = s;
        this.opts.onStatusChange?.(s);
        if (s === "open") {
          // Flush deferred openers (drain worker, etc.).
          const queued = this.opens.slice();
          this.opens.length = 0;
          for (const fn of queued) {
            try { fn(); } catch (e) { this.log("warn", "open_handler_failed", { err: String(e) }); }
          }
        }
      },
      onBeforeReconnect: (code) => this.failPendingAcks(`broker_disconnected_${code}`),
      log: (level, msg, meta) => this.log(level, `broker_${msg}`, meta),
    });
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (msg.type === "ack") {
      // Broker shape: { type: "ack", id, messageId, queued, error? }
      const id = String(msg.id ?? "");
      const ack = this.pendingAcks.get(id);
      if (ack) {
        this.pendingAcks.delete(id);
        clearTimeout(ack.timer);
        if (typeof msg.error === "string" && msg.error.length > 0) {
          ack.resolve({ ok: false, error: msg.error, permanent: classifyPermanent(msg.error) });
        } else {
          ack.resolve({ ok: true, messageId: String(msg.messageId ?? id) });
        }
      }
      return;
    }

    if (msg.type === "peers_list") {
      const reqId = String(msg._reqId ?? "");
      const pending = this.peerListResolvers.get(reqId);
      if (pending) {
        this.peerListResolvers.delete(reqId);
        clearTimeout(pending.timer);
        pending.resolve(Array.isArray(msg.peers) ? (msg.peers as PeerSummary[]) : []);
      }
      return;
    }

    if (msg.type === "skill_list") {
      const reqId = String(msg._reqId ?? "");
      const pending = this.skillListResolvers.get(reqId);
      if (pending) {
        this.skillListResolvers.delete(reqId);
        clearTimeout(pending.timer);
        pending.resolve(Array.isArray(msg.skills) ? (msg.skills as SkillSummary[]) : []);
      }
      return;
    }

    if (msg.type === "skill_data") {
      const reqId = String(msg._reqId ?? "");
      const pending = this.skillDataResolvers.get(reqId);
      if (pending) {
        this.skillDataResolvers.delete(reqId);
        clearTimeout(pending.timer);
        pending.resolve((msg.skill as SkillFull) ?? null);
      }
      return;
    }

    if (msg.type === "state_value" || msg.type === "state_data") {
      const reqId = String(msg._reqId ?? "");
      const pending = this.stateGetResolvers.get(reqId);
      if (pending) {
        this.stateGetResolvers.delete(reqId);
        clearTimeout(pending.timer);
        pending.resolve((msg.state ?? msg.row ?? null) as StateRow | null);
      }
      return;
    }

    if (msg.type === "state_list") {
      const reqId = String(msg._reqId ?? "");
      const pending = this.stateListResolvers.get(reqId);
      if (pending) {
        this.stateListResolvers.delete(reqId);
        clearTimeout(pending.timer);
        pending.resolve(Array.isArray(msg.entries) ? (msg.entries as StateRow[]) : []);
      }
      return;
    }

    if (msg.type === "memory_stored") {
      const reqId = String(msg._reqId ?? "");
      const pending = this.memoryStoreResolvers.get(reqId);
      if (pending) {
        this.memoryStoreResolvers.delete(reqId);
        clearTimeout(pending.timer);
        pending.resolve(typeof msg.memoryId === "string" ? msg.memoryId : null);
      }
      return;
    }

    if (msg.type === "memory_recall_result") {
      const reqId = String(msg._reqId ?? "");
      const pending = this.memoryRecallResolvers.get(reqId);
      if (pending) {
        this.memoryRecallResolvers.delete(reqId);
        clearTimeout(pending.timer);
        pending.resolve(Array.isArray(msg.matches) ? (msg.matches as MemoryRow[]) : []);
      }
      return;
    }

    if (msg.type === "push" || msg.type === "inbound") {
      this.opts.onPush?.(msg);
      return;
    }
  }

  /** True when underlying socket is OPEN-ready for direct sends. */
  private isOpen(): boolean {
    const sock = this.lifecycle?.ws;
    return !!sock && sock.readyState === sock.OPEN;
  }

  /** v2 agentic-comms (M1): send `client_ack` back to the broker after
   *  successfully landing an inbound push in inbox.db. Broker uses the
   *  ack to set `delivered_at` (atomic at-least-once). Best-effort —
   *  if the WS isn't open, drop the ack; broker's 30s lease will
   *  re-deliver. */
  sendClientAck(clientMessageId: string, brokerMessageId: string | null): void {
    if (!this.isOpen()) return;
    try {
      this.lifecycle!.send({
        type: "client_ack",
        clientMessageId,
        ...(brokerMessageId ? { brokerMessageId } : {}),
      });
    } catch { /* drop; lease re-delivers */ }
  }

  /** Send one outbox row. Resolves on broker ack/timeout. */
  send(req: BrokerSendArgs): Promise<BrokerSendResult> {
    return new Promise<BrokerSendResult>((resolve) => {
      const dispatch = () => {
        if (!this.isOpen()) {
          resolve({ ok: false, error: "broker_not_open", permanent: false });
          return;
        }
        const id = req.client_message_id;
        const timer = setTimeout(() => {
          if (this.pendingAcks.delete(id)) {
            resolve({ ok: false, error: "ack_timeout", permanent: false });
          }
        }, SEND_ACK_TIMEOUT_MS);
        this.pendingAcks.set(id, { resolve, timer });
        try {
          this.lifecycle!.send({
            type: "send",
            id,                                  // legacy correlation id
            client_message_id: id,               // forward-compat per spec §4.2
            request_fingerprint: req.request_fingerprint_hex,
            targetSpec: req.targetSpec,
            priority: req.priority,
            nonce: req.nonce,
            ciphertext: req.ciphertext,
          });
        } catch (e) {
          this.pendingAcks.delete(id);
          clearTimeout(timer);
          resolve({ ok: false, error: `ws_write_failed: ${String(e)}`, permanent: false });
        }
      };

      if (this._status === "open") dispatch();
      else this.opens.push(dispatch);
    });
  }

  /** Ask the broker for the current peer list. */
  async listPeers(timeoutMs = 5_000): Promise<PeerSummary[]> {
    if (this._status !== "open" || !this.lifecycle) return [];
    return new Promise<PeerSummary[]>((resolve) => {
      const reqId = `pl-${++this.reqCounter}`;
      const timer = setTimeout(() => {
        if (this.peerListResolvers.delete(reqId)) resolve([]);
      }, timeoutMs);
      this.peerListResolvers.set(reqId, { resolve, timer });
      try { this.lifecycle!.send({ type: "list_peers", _reqId: reqId }); }
      catch { this.peerListResolvers.delete(reqId); clearTimeout(timer); resolve([]); }
    });
  }

  /** List mesh-published skills. Empty array on disconnect / timeout. */
  async listSkills(query?: string, timeoutMs = 5_000): Promise<SkillSummary[]> {
    if (this._status !== "open" || !this.lifecycle) return [];
    return new Promise<SkillSummary[]>((resolve) => {
      const reqId = `sl-${++this.reqCounter}`;
      const timer = setTimeout(() => {
        if (this.skillListResolvers.delete(reqId)) resolve([]);
      }, timeoutMs);
      this.skillListResolvers.set(reqId, { resolve, timer });
      try { this.lifecycle!.send({ type: "list_skills", query, _reqId: reqId }); }
      catch { this.skillListResolvers.delete(reqId); clearTimeout(timer); resolve([]); }
    });
  }

  /** Fetch one skill's full body. Null on not-found / disconnect / timeout. */
  async getSkill(name: string, timeoutMs = 5_000): Promise<SkillFull | null> {
    if (this._status !== "open" || !this.lifecycle) return null;
    return new Promise<SkillFull | null>((resolve) => {
      const reqId = `sg-${++this.reqCounter}`;
      const timer = setTimeout(() => {
        if (this.skillDataResolvers.delete(reqId)) resolve(null);
      }, timeoutMs);
      this.skillDataResolvers.set(reqId, { resolve, timer });
      try { this.lifecycle!.send({ type: "get_skill", name, _reqId: reqId }); }
      catch { this.skillDataResolvers.delete(reqId); clearTimeout(timer); resolve(null); }
    });
  }

  /** Read a single shared state row. Null on disconnect / timeout / not-found. */
  async getState(key: string, timeoutMs = 5_000): Promise<StateRow | null> {
    if (this._status !== "open" || !this.lifecycle) return null;
    return new Promise<StateRow | null>((resolve) => {
      const reqId = `sg-${++this.reqCounter}`;
      const timer = setTimeout(() => {
        if (this.stateGetResolvers.delete(reqId)) resolve(null);
      }, timeoutMs);
      this.stateGetResolvers.set(reqId, { resolve, timer });
      try { this.lifecycle!.send({ type: "get_state", key, _reqId: reqId }); }
      catch { this.stateGetResolvers.delete(reqId); clearTimeout(timer); resolve(null); }
    });
  }

  /** List all shared state rows in the mesh. */
  async listState(timeoutMs = 5_000): Promise<StateRow[]> {
    if (this._status !== "open" || !this.lifecycle) return [];
    return new Promise<StateRow[]>((resolve) => {
      const reqId = `sl-${++this.reqCounter}`;
      const timer = setTimeout(() => {
        if (this.stateListResolvers.delete(reqId)) resolve([]);
      }, timeoutMs);
      this.stateListResolvers.set(reqId, { resolve, timer });
      try { this.lifecycle!.send({ type: "list_state", _reqId: reqId }); }
      catch { this.stateListResolvers.delete(reqId); clearTimeout(timer); resolve([]); }
    });
  }

  /** Set a shared state value. Fire-and-forget. */
  setState(key: string, value: unknown): void {
    if (this._status !== "open" || !this.lifecycle) return;
    try { this.lifecycle.send({ type: "set_state", key, value }); }
    catch { /* ignore */ }
  }

  /** Store a memory in the mesh. Returns the assigned id, or null on timeout. */
  async remember(content: string, tags?: string[], timeoutMs = 5_000): Promise<string | null> {
    if (this._status !== "open" || !this.lifecycle) return null;
    return new Promise<string | null>((resolve) => {
      const reqId = `mr-${++this.reqCounter}`;
      const timer = setTimeout(() => {
        if (this.memoryStoreResolvers.delete(reqId)) resolve(null);
      }, timeoutMs);
      this.memoryStoreResolvers.set(reqId, { resolve, timer });
      try { this.lifecycle!.send({ type: "remember", content, tags, _reqId: reqId }); }
      catch { this.memoryStoreResolvers.delete(reqId); clearTimeout(timer); resolve(null); }
    });
  }

  /** Search memories by relevance. */
  async recall(query: string, timeoutMs = 5_000): Promise<MemoryRow[]> {
    if (this._status !== "open" || !this.lifecycle) return [];
    return new Promise<MemoryRow[]>((resolve) => {
      const reqId = `mc-${++this.reqCounter}`;
      const timer = setTimeout(() => {
        if (this.memoryRecallResolvers.delete(reqId)) resolve([]);
      }, timeoutMs);
      this.memoryRecallResolvers.set(reqId, { resolve, timer });
      try { this.lifecycle!.send({ type: "recall", query, _reqId: reqId }); }
      catch { this.memoryRecallResolvers.delete(reqId); clearTimeout(timer); resolve([]); }
    });
  }

  /** Forget a memory by id. Fire-and-forget. */
  forget(memoryId: string): void {
    if (this._status !== "open" || !this.lifecycle) return;
    try { this.lifecycle.send({ type: "forget", memoryId }); }
    catch { /* ignore */ }
  }

  /** Set the daemon's profile (avatar/title/bio/capabilities). Fire-and-forget. */
  setProfile(profile: { avatar?: string; title?: string; bio?: string; capabilities?: string[] }): void {
    if (this._status !== "open" || !this.lifecycle) return;
    try { this.lifecycle.send({ type: "set_profile", ...profile }); }
    catch { /* ignore */ }
  }

  setSummary(summary: string): void {
    if (this._status !== "open" || !this.lifecycle) return;
    try { this.lifecycle.send({ type: "set_summary", summary }); }
    catch { /* ignore */ }
  }

  setStatus(status: "idle" | "working" | "dnd"): void {
    if (this._status !== "open" || !this.lifecycle) return;
    try { this.lifecycle.send({ type: "set_status", status }); }
    catch { /* ignore */ }
  }

  setVisible(visible: boolean): void {
    if (this._status !== "open" || !this.lifecycle) return;
    try { this.lifecycle.send({ type: "set_visible", visible }); }
    catch { /* ignore */ }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failPendingAcks("daemon_shutdown");
    if (this.lifecycle) {
      try { await this.lifecycle.close(); } catch { /* ignore */ }
      this.lifecycle = null;
    }
    this._status = "closed";
  }

  private failPendingAcks(reason: string) {
    for (const [id, ack] of this.pendingAcks) {
      clearTimeout(ack.timer);
      ack.resolve({ ok: false, error: reason, permanent: false });
      this.pendingAcks.delete(id);
    }
  }
}

function defaultLog(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() });
  if (level === "info") process.stdout.write(line + "\n");
  else process.stderr.write(line + "\n");
}

/** Heuristic: which broker errors are unrecoverable for this id. */
function classifyPermanent(err: string): boolean {
  return /payload_too_large|forbidden|not_found|invalid|schema|auth|signature/i.test(err);
}
