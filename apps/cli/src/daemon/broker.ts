// Minimal broker WS connector for the daemon. Reuses the existing CLI
// hello-sign protocol so it speaks the wire current brokers understand.
//
// Differences from BrokerClient (services/broker/ws-client.ts):
//   - Slim: no in-memory pending-sends queue, no list_peers/state/topic
//     RPCs. The daemon's outbox is the source of truth.
//   - Wire envelope adds `client_message_id` (broker may ignore in legacy
//     mode; Sprint 7 promotes it to authoritative dedupe).
//   - Reconnect with exponential backoff, signaled to the drain worker.

import WebSocket from "ws";

import type { JoinedMesh } from "~/services/config/facade.js";
import { signHello } from "~/services/broker/hello-sig.js";

export type ConnStatus = "connecting" | "open" | "closed" | "reconnecting";

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
}

interface PendingPeerList {
  resolve: (peers: PeerSummary[]) => void;
  timer: NodeJS.Timeout;
}

const HELLO_ACK_TIMEOUT_MS = 5_000;
const SEND_ACK_TIMEOUT_MS  = 15_000;
const BACKOFF_CAPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export interface DaemonBrokerOptions {
  displayName?: string;
  onStatusChange?: (s: ConnStatus) => void;
  onPush?: (msg: Record<string, unknown>) => void;
  log?: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
}

export class DaemonBrokerClient {
  private ws: WebSocket | null = null;
  private _status: ConnStatus = "closed";
  private closed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private helloTimer: NodeJS.Timeout | null = null;
  private pendingAcks = new Map<string, PendingAck>();
  private peerListResolvers = new Map<string, PendingPeerList>();
  private sessionPubkey: string | null = null;
  private sessionSecretKey: string | null = null;
  private opens: Array<() => void> = [];
  private reqCounter = 0;

  constructor(private mesh: JoinedMesh, private opts: DaemonBrokerOptions = {}) {}

  get status(): ConnStatus { return this._status; }
  get meshSlug(): string { return this.mesh.slug; }
  get meshId(): string { return this.mesh.meshId; }

  private log = (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => {
    (this.opts.log ?? defaultLog)(level, msg, { mesh: this.mesh.slug, ...meta });
  };

  private setConnStatus(s: ConnStatus) {
    if (this._status === s) return;
    this._status = s;
    this.opts.onStatusChange?.(s);
  }

  /** Open the WS, run the hello handshake, resolve once the broker accepts. */
  async connect(): Promise<void> {
    if (this.closed) throw new Error("client_closed");
    if (this._status === "connecting" || this._status === "open") return;
    this.setConnStatus("connecting");

    const ws = new WebSocket(this.mesh.brokerUrl);
    this.ws = ws;

    return new Promise<void>((resolve, reject) => {
      ws.on("open", async () => {
        try {
          if (!this.sessionPubkey) {
            const { generateKeypair } = await import("~/services/crypto/facade.js");
            const kp = await generateKeypair();
            this.sessionPubkey = kp.publicKey;
            this.sessionSecretKey = kp.secretKey;
          }
          const { timestamp, signature } = await signHello(
            this.mesh.meshId, this.mesh.memberId, this.mesh.pubkey, this.mesh.secretKey,
          );
          ws.send(JSON.stringify({
            type: "hello",
            meshId: this.mesh.meshId,
            memberId: this.mesh.memberId,
            pubkey: this.mesh.pubkey,
            sessionPubkey: this.sessionPubkey,
            displayName: this.opts.displayName,
            sessionId: `daemon-${process.pid}`,
            pid: process.pid,
            cwd: process.cwd(),
            hostname: require("node:os").hostname(),
            peerType: "ai" as const,
            channel: "claudemesh-daemon",
            timestamp,
            signature,
          }));
          this.helloTimer = setTimeout(() => {
            this.log("warn", "broker_hello_ack_timeout");
            try { ws.close(); } catch { /* ignore */ }
            reject(new Error("hello_ack_timeout"));
          }, HELLO_ACK_TIMEOUT_MS);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });

      ws.on("message", (raw) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(raw.toString()) as Record<string, unknown>; }
        catch { return; }

        if (msg.type === "hello_ack") {
          if (this.helloTimer) clearTimeout(this.helloTimer);
          this.helloTimer = null;
          this.setConnStatus("open");
          this.reconnectAttempt = 0;
          // Flush deferred openers (drain worker, etc.)
          const queued = this.opens.slice();
          this.opens.length = 0;
          for (const fn of queued) { try { fn(); } catch (e) { this.log("warn", "open_handler_failed", { err: String(e) }); } }
          resolve();
          return;
        }

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

        if (msg.type === "push" || msg.type === "inbound") {
          this.opts.onPush?.(msg);
          return;
        }
      });

      ws.on("close", (code, reason) => {
        if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
        this.failPendingAcks(`broker_disconnected_${code}`);
        if (this.closed) { this.setConnStatus("closed"); return; }
        this.setConnStatus("reconnecting");
        const wait = BACKOFF_CAPS_MS[Math.min(this.reconnectAttempt, BACKOFF_CAPS_MS.length - 1)] ?? 30_000;
        this.reconnectAttempt++;
        this.log("info", "broker_reconnect_scheduled", { wait_ms: wait, code, reason: reason.toString("utf8") });
        this.reconnectTimer = setTimeout(() => this.connect().catch((err) => this.log("warn", "broker_reconnect_failed", { err: String(err) })), wait);
        // First connection failure also rejects the original connect() promise.
        if (this._status === "connecting") reject(new Error(`closed_before_hello_${code}`));
      });

      ws.on("error", (err) => this.log("warn", "broker_ws_error", { err: err.message }));
    });
  }

  /** Send one outbox row. Resolves on broker ack/timeout. */
  send(req: BrokerSendArgs): Promise<BrokerSendResult> {
    return new Promise<BrokerSendResult>((resolve) => {
      const dispatch = () => {
        if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
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
          this.ws.send(JSON.stringify({
            type: "send",
            id,                                  // legacy correlation id
            client_message_id: id,               // forward-compat per spec §4.2
            request_fingerprint: req.request_fingerprint_hex,
            targetSpec: req.targetSpec,
            priority: req.priority,
            nonce: req.nonce,
            ciphertext: req.ciphertext,
          }));
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
    if (this._status !== "open" || !this.ws) return [];
    return new Promise<PeerSummary[]>((resolve) => {
      const reqId = `pl-${++this.reqCounter}`;
      const timer = setTimeout(() => {
        if (this.peerListResolvers.delete(reqId)) resolve([]);
      }, timeoutMs);
      this.peerListResolvers.set(reqId, { resolve, timer });
      try { this.ws!.send(JSON.stringify({ type: "list_peers", _reqId: reqId })); }
      catch { this.peerListResolvers.delete(reqId); clearTimeout(timer); resolve([]); }
    });
  }

  /** Set the daemon's profile (avatar/title/bio/capabilities). Fire-and-forget. */
  setProfile(profile: { avatar?: string; title?: string; bio?: string; capabilities?: string[] }): void {
    if (this._status !== "open" || !this.ws) return;
    try { this.ws.send(JSON.stringify({ type: "set_profile", ...profile })); }
    catch { /* ignore */ }
  }

  setSummary(summary: string): void {
    if (this._status !== "open" || !this.ws) return;
    try { this.ws.send(JSON.stringify({ type: "set_summary", summary })); }
    catch { /* ignore */ }
  }

  setStatus(status: "idle" | "working" | "dnd"): void {
    if (this._status !== "open" || !this.ws) return;
    try { this.ws.send(JSON.stringify({ type: "set_status", status })); }
    catch { /* ignore */ }
  }

  setVisible(visible: boolean): void {
    if (this._status !== "open" || !this.ws) return;
    try { this.ws.send(JSON.stringify({ type: "set_visible", visible })); }
    catch { /* ignore */ }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
    this.failPendingAcks("daemon_shutdown");
    try { this.ws?.close(); } catch { /* ignore */ }
    this.setConnStatus("closed");
  }

  getSessionKeys(): { sessionPubkey: string; sessionSecretKey: string } | null {
    if (!this.sessionPubkey || !this.sessionSecretKey) return null;
    return { sessionPubkey: this.sessionPubkey, sessionSecretKey: this.sessionSecretKey };
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
