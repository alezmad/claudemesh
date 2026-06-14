/**
 * Per-launch session broker WebSocket.
 *
 * Owned by the daemon, one per registered session. Holds a long-lived
 * presence row on the broker keyed on the session's ephemeral pubkey
 * (rather than the parent member's stable pubkey). Sibling sessions —
 * two `claudemesh launch` runs in the same cwd — finally see each other
 * in `peer list` because their presence rows coexist instead of fighting
 * over the same memberPubkey snapshot.
 *
 * Differences from `DaemonBrokerClient`:
 *   - Uses session_hello (1.30.0+ broker), with a parent-vouched
 *     attestation provided at construction time.
 *   - Does NOT carry list_peers / state / memory RPCs. This client is
 *     presence + inbound DM delivery + (1.34.0) outbound send for
 *     messages that originate from this session. Routing those through
 *     here is what makes the broker fan-out attribute the push to the
 *     session pubkey instead of the daemon's stable member pubkey.
 *
 * Outbox routing (1.34.0): the drain worker now consults
 * `outbox.sender_session_pubkey`. If a row was written by an
 * authenticated session and the matching session-WS is `open`, the
 * drain dispatches via `SessionBrokerClient.send()` — this
 * connection's `conn.sessionPubkey` server-side is the session pubkey,
 * so the broker's existing fan-out attribution
 * (`senderPubkey: conn.sessionPubkey ?? conn.memberPubkey`) just works.
 * Pre-1.34.0 every drain went through DaemonBrokerClient (member-WS),
 * so every push showed up as "from <daemon-member-pubkey>" regardless
 * of which session typed `claudemesh send`.
 *
 * Old brokers reply with `unknown_message_type` on session_hello — we
 * surface that as a one-shot `error` event and the daemon decides
 * whether to fall back. For 1.30.0 we just log + retry; the broker is
 * expected to be deployed first.
 *
 * Spec: .artifacts/specs/2026-05-04-per-session-presence.md.
 *
 * 2026-05-04: lifecycle (connect / hello-ack / close-reconnect) lives
 * in `ws-lifecycle.ts`. This class supplies session_hello content and
 * routes the inbound onPush; the helper handles the rest.
 */

import { hostname as osHostname } from "node:os";

import type { JoinedMesh } from "~/services/config/facade.js";
import { signSessionHello, signParentAttestation } from "~/services/broker/session-hello-sig.js";
import { connectWsWithBackoff, type WsLifecycle, type WsStatus } from "./ws-lifecycle.js";
import type { BrokerSendArgs, BrokerSendResult } from "./broker.js";

export type SessionBrokerStatus = WsStatus;

/** Ack-tracking shape, mirrors DaemonBrokerClient.PendingAck. Kept
 *  internal — callers see only the resolved BrokerSendResult. */
interface PendingAck {
  resolve: (r: BrokerSendResult) => void;
  timer: NodeJS.Timeout;
}

const SEND_ACK_TIMEOUT_MS = 15_000;

/** Heuristic: which broker-reported send errors are permanent enough
 *  that the drain worker should give up rather than retry. Mirrors the
 *  daemon-WS classifier so behavior is identical regardless of which
 *  socket the row went out on. */
function classifyPermanent(error: string): boolean {
  return /unknown|invalid|forbidden|not_authorized|target_not_found/i.test(error);
}

export interface ParentAttestation {
  sessionPubkey: string;
  parentMemberPubkey: string;
  /** Unix ms. Broker rejects > now+24h or already past. */
  expiresAt: number;
  signature: string;
}

export interface SessionBrokerOptions {
  mesh: JoinedMesh;
  /** Per-launch ephemeral keypair. */
  sessionPubkey: string;
  sessionSecretKey: string;
  /** Parent-vouched attestation, signed by mesh.secretKey at launch time. */
  parentAttestation: ParentAttestation;
  /** Stable session_id from the launch (used for dedup on the broker). */
  sessionId: string;
  /** Display name override for this session. */
  displayName?: string;
  /** Initial groups. Format mirrors the regular hello. */
  groups?: Array<{ name: string; role?: string }>;
  /** Role tag (informational, not auth-bearing). */
  role?: string;
  /** Working directory (informational, surfaced in peer list). */
  cwd?: string;
  /** Pid of the launched session (NOT the daemon). */
  pid: number;
  onStatusChange?: (s: SessionBrokerStatus) => void;
  /**
   * Inbound push/inbound dispatch. The broker fans messages targeted at
   * a session pubkey out over the corresponding session WS — without
   * this callback they hit the floor and the daemon's inbox.db never
   * sees them. Wired in run.ts to a handleBrokerPush call that decrypts
   * with this session's secret key (member key as fallback).
   */
  onPush?: (msg: Record<string, unknown>) => void;
  log?: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
}

export class SessionBrokerClient {
  private lifecycle: WsLifecycle | null = null;
  private _status: SessionBrokerStatus = "closed";
  private closed = false;
  /** Set when the broker rejects session_hello with `unknown_message_type` —
   *  older brokers without the 1.30.0 surface. We stop retrying. */
  private brokerUnsupported = false;
  /** 1.34.0: outbound send tracking. Keyed by client_message_id. The
   *  drain worker registers an entry on dispatch; the WS message
   *  handler resolves it on broker `ack`. Times out after 15s. */
  private pendingAcks = new Map<string, PendingAck>();
  /** 1.34.0: dispatchers queued while the WS is reconnecting — flushed
   *  in onStatusChange when status flips to `open`. Mirrors the
   *  daemon-WS `opens` array. */
  private opens: Array<() => void> = [];

  constructor(private opts: SessionBrokerOptions) {}

  get status(): SessionBrokerStatus { return this._status; }
  get meshSlug(): string { return this.opts.mesh.slug; }
  get sessionPubkey(): string { return this.opts.sessionPubkey; }

  private log = (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => {
    (this.opts.log ?? defaultLog)(level, msg, {
      mesh: this.opts.mesh.slug,
      session_pubkey: this.opts.sessionPubkey.slice(0, 12),
      ...meta,
    });
  };

  /** Open the WS, run session_hello, resolve once the broker accepts. */
  async connect(): Promise<void> {
    if (this.closed) throw new Error("client_closed");
    if (this._status === "connecting" || this._status === "open") return;

    this.lifecycle = await connectWsWithBackoff({
      url: this.opts.mesh.brokerUrl,
      buildHello: async () => {
        const { timestamp, signature } = await signSessionHello({
          meshId: this.opts.mesh.meshId,
          parentMemberPubkey: this.opts.mesh.pubkey,
          sessionPubkey: this.opts.sessionPubkey,
          sessionSecretKey: this.opts.sessionSecretKey,
        });
        // Re-mint the parent attestation fresh on every (re)connect rather
        // than reusing the one signed at `claudemesh launch`. The minted
        // attestation has a 12h TTL; reusing the stored instance meant any
        // reconnect past launch+12h — a network blip, a sleep/wake, or
        // (most commonly) a broker redeploy that drops every WS at once —
        // was rejected by the broker with `expired`, after which the daemon
        // reconnect-looped forever with the same dead token and the session
        // silently fell off the mesh (its ephemeral pubkey lingering in
        // peer rosters, undeliverable). The member secret key is in memory
        // (`mesh.secretKey`, already used at daemon rehydration), so the
        // daemon can self-renew: fresh-minting keeps live attestations
        // short-lived AND makes presence self-healing across reconnects.
        let parentAttestation = this.opts.parentAttestation;
        try {
          parentAttestation = await signParentAttestation({
            parentMemberPubkey: this.opts.mesh.pubkey,
            parentSecretKey: this.opts.mesh.secretKey,
            sessionPubkey: this.opts.sessionPubkey,
          });
        } catch (e) {
          this.log("warn", "parent attestation re-mint failed; reusing stored token (may be expired)", { err: String(e) });
        }
        return {
          type: "session_hello",
          meshId: this.opts.mesh.meshId,
          parentMemberId: this.opts.mesh.memberId,
          parentMemberPubkey: this.opts.mesh.pubkey,
          sessionPubkey: this.opts.sessionPubkey,
          parentAttestation,
          displayName: this.opts.displayName,
          sessionId: this.opts.sessionId,
          pid: this.opts.pid,
          cwd: this.opts.cwd ?? process.cwd(),
          hostname: osHostname(),
          peerType: "ai" as const,
          channel: "claudemesh-session",
          ...(this.opts.groups && this.opts.groups.length > 0 ? { groups: this.opts.groups } : {}),
          ...(this.opts.role ? { role: this.opts.role } : {}),
          timestamp,
          signature,
        };
      },
      isHelloAck: (msg) => msg.type === "hello_ack",
      onMessage: (msg) => {
        if (msg.type === "error") {
          // Older brokers respond with `unknown_message_type` to session_hello;
          // surface that so the daemon can decide to skip per-session presence
          // rather than churn through reconnects. Setting `closed` halts the
          // helper's reconnect loop on the next close.
          this.log("warn", "broker_error", { code: msg.code, message: msg.message });
          if (msg.code === "unknown_message_type") {
            this.brokerUnsupported = true;
            this.closed = true;
            void this.lifecycle?.close();
          }
          return;
        }

        // 1.34.0: outbox `send` ack arriving on the session-WS. Resolves
        // the Promise the drain worker is awaiting. Mirrors the
        // daemon-WS handler exactly.
        if (msg.type === "ack") {
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

        // 1.32.1 — DMs targeted at the launched session's pubkey arrive
        // here, NOT on the daemon's member-keyed WS. Forward to the
        // daemon-level push handler so they land in inbox.db.
        if (msg.type === "push" || msg.type === "inbound") {
          // 1.34.9: skip system events on the session-WS — the daemon-WS
          // already receives the same broker broadcast and publishes it
          // to the bus, so forwarding here just produces duplicate
          // `[system] Peer "X" joined the mesh` channel pushes (one per
          // connection: 1 member-WS + 1 session-WS = 2 messages, +
          // another set per sibling session). Caught in the 2026-05-04
          // peer-rejoin smoke.
          if ((msg as Record<string, unknown>).subtype === "system") return;
          // 1.34.8: drop self-echoes. Some broker fan-out paths mirror an
          // outbound DM back to the originating session-WS; without this
          // guard the sender's own message lands in inbox.db, publishes a
          // `message` bus event, and Claude Code surfaces it as
          // `← claudemesh: <self>: <text>` immediately after the user
          // typed `claudemesh send`. Caught in the 2026-05-04 two-session
          // smoke. Match on session pubkey only — sibling sessions of the
          // same member share `senderMemberPubkey`, so a member-level
          // filter would wrongly drop legit sibling DMs.
          const senderPubkey = String((msg as Record<string, unknown>).senderPubkey ?? "").toLowerCase();
          if (senderPubkey && senderPubkey === this.opts.sessionPubkey.toLowerCase()) {
            this.log("info", "self_echo_dropped", { sender: senderPubkey.slice(0, 12) });
            return;
          }
          this.opts.onPush?.(msg);
          return;
        }
      },
      onStatusChange: (s) => {
        this._status = s;
        this.opts.onStatusChange?.(s);
        if (s === "open") {
          // 1.34.0: flush queued send dispatchers so any outbox row that
          // tried to dispatch while we were reconnecting goes out now.
          const queued = this.opens.slice();
          this.opens.length = 0;
          for (const fn of queued) {
            try { fn(); } catch (e) { this.log("warn", "session_open_handler_failed", { err: String(e) }); }
          }
        } else if (s === "closed" || s === "reconnecting") {
          // Fail any in-flight acks so the drain worker can retry/backoff
          // instead of hanging on a dead promise. The daemon-WS does the
          // same thing via onBeforeReconnect; we centralize it here
          // because session-broker uses status transitions directly.
          this.failPendingAcks(`session_ws_${s}`);
        }
      },
      log: (level, msg, meta) => this.log(level, `session_broker_${msg}`, meta),
    });
  }

  /** v2 agentic-comms (M1): send `client_ack` back to the broker after
   *  successfully landing an inbound push in inbox.db. Broker uses the
   *  ack to set `delivered_at`. Best-effort. */
  sendClientAck(clientMessageId: string, brokerMessageId: string | null): void {
    if (this._status !== "open" || !this.lifecycle) return;
    try {
      this.lifecycle.send({
        type: "client_ack",
        clientMessageId,
        ...(brokerMessageId ? { brokerMessageId } : {}),
      });
    } catch { /* drop; lease re-delivers */ }
  }

  /** True when underlying socket is OPEN-ready for direct sends. */
  isOpen(): boolean {
    const sock = this.lifecycle?.ws;
    return !!sock && sock.readyState === sock.OPEN;
  }

  /**
   * 1.34.0 — Send one outbox row over the session-WS. Same wire format
   * as DaemonBrokerClient.send, but routed via this connection so the
   * broker's fan-out attributes the push to the session pubkey.
   *
   * Used by the drain worker for rows whose `sender_session_pubkey`
   * matches this client's session pubkey. When the WS is reconnecting
   * the dispatcher is queued via `opens` and flushed on the next
   * status flip.
   */
  send(req: BrokerSendArgs): Promise<BrokerSendResult> {
    return new Promise<BrokerSendResult>((resolve) => {
      const dispatch = () => {
        if (!this.isOpen() || !this.lifecycle) {
          resolve({ ok: false, error: "session_ws_not_open", permanent: false });
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
          this.lifecycle.send({
            type: "send",
            id,
            client_message_id: id,
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

  /** Resolve every in-flight ack with a synthetic failure. Called on
   *  WS close so the drain worker stops waiting and either retries or
   *  reroutes via the daemon-WS. */
  private failPendingAcks(reason: string): void {
    if (this.pendingAcks.size === 0) return;
    const entries = [...this.pendingAcks.entries()];
    this.pendingAcks.clear();
    for (const [, ack] of entries) {
      clearTimeout(ack.timer);
      ack.resolve({ ok: false, error: reason, permanent: false });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.lifecycle) {
      try { await this.lifecycle.close(); } catch { /* ignore */ }
      this.lifecycle = null;
    }
    this._status = "closed";
  }

  /** True when the broker rejected our session_hello as unknown — caller
   *  may want to skip per-session presence entirely on this mesh. */
  get isBrokerUnsupported(): boolean { return this.brokerUnsupported; }
}

function defaultLog(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() });
  if (level === "info") process.stdout.write(line + "\n");
  else process.stderr.write(line + "\n");
}
