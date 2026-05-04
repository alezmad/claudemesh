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
 *   - Does NOT drain the outbox — that stays the parent member-keyed
 *     DaemonBrokerClient's job. Keeps the responsibility split clean
 *     and avoids two clients fighting over the same outbox row.
 *   - Does NOT carry list_peers / state / memory RPCs. This client is
 *     presence-only PLUS inbound DM delivery for messages targeted at
 *     the session pubkey — pushes are forwarded via the `onPush`
 *     callback to the daemon's shared handleBrokerPush, decrypted with
 *     this session's secret key.
 *
 * Old brokers reply with `unknown_message_type` on session_hello — we
 * surface that as a one-shot `error` event and the daemon decides
 * whether to fall back. For 1.30.0 we just log + retry; the broker is
 * expected to be deployed first.
 *
 * Spec: .artifacts/specs/2026-05-04-per-session-presence.md.
 */

import { hostname as osHostname } from "node:os";
import WebSocket from "ws";

import type { JoinedMesh } from "~/services/config/facade.js";
import { signSessionHello } from "~/services/broker/session-hello-sig.js";

export type SessionBrokerStatus = "connecting" | "open" | "closed" | "reconnecting";

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

const HELLO_ACK_TIMEOUT_MS = 5_000;
const BACKOFF_CAPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export class SessionBrokerClient {
  private ws: WebSocket | null = null;
  private _status: SessionBrokerStatus = "closed";
  private closed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private helloTimer: NodeJS.Timeout | null = null;

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

  private setStatus(s: SessionBrokerStatus) {
    if (this._status === s) return;
    this._status = s;
    this.opts.onStatusChange?.(s);
  }

  /** Open the WS, run session_hello, resolve once the broker accepts. */
  async connect(): Promise<void> {
    if (this.closed) throw new Error("client_closed");
    if (this._status === "connecting" || this._status === "open") return;
    this.setStatus("connecting");

    const ws = new WebSocket(this.opts.mesh.brokerUrl);
    this.ws = ws;

    return new Promise<void>((resolve, reject) => {
      ws.on("open", async () => {
        try {
          const { timestamp, signature } = await signSessionHello({
            meshId: this.opts.mesh.meshId,
            parentMemberPubkey: this.opts.mesh.pubkey,
            sessionPubkey: this.opts.sessionPubkey,
            sessionSecretKey: this.opts.sessionSecretKey,
          });
          ws.send(JSON.stringify({
            type: "session_hello",
            meshId: this.opts.mesh.meshId,
            parentMemberId: this.opts.mesh.memberId,
            parentMemberPubkey: this.opts.mesh.pubkey,
            sessionPubkey: this.opts.sessionPubkey,
            parentAttestation: this.opts.parentAttestation,
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
          }));
          this.helloTimer = setTimeout(() => {
            this.log("warn", "session_hello_ack_timeout");
            try { ws.close(); } catch { /* ignore */ }
            reject(new Error("session_hello_ack_timeout"));
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
          this.setStatus("open");
          this.reconnectAttempt = 0;
          resolve();
          return;
        }

        if (msg.type === "error") {
          // Older brokers respond with `unknown_message_type` to session_hello;
          // surface that so the daemon can decide to skip per-session presence
          // rather than churn through reconnects.
          this.log("warn", "broker_error", { code: msg.code, message: msg.message });
          if (msg.code === "unknown_message_type") {
            this.closed = true;
          }
          return;
        }

        // 1.32.1 — DMs targeted at the launched session's pubkey arrive
        // here, NOT on the daemon's member-keyed WS. Forward to the
        // daemon-level push handler so they land in inbox.db.
        if (msg.type === "push" || msg.type === "inbound") {
          this.opts.onPush?.(msg);
          return;
        }
      });

      ws.on("close", (code, reason) => {
        if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
        if (this.closed) { this.setStatus("closed"); return; }
        this.setStatus("reconnecting");
        const wait = BACKOFF_CAPS_MS[Math.min(this.reconnectAttempt, BACKOFF_CAPS_MS.length - 1)] ?? 30_000;
        this.reconnectAttempt++;
        this.log("info", "session_broker_reconnect_scheduled", { wait_ms: wait, code, reason: reason.toString("utf8") });
        this.reconnectTimer = setTimeout(
          () => this.connect().catch((err) => this.log("warn", "session_broker_reconnect_failed", { err: String(err) })),
          wait,
        );
        if (this._status === "connecting") reject(new Error(`closed_before_hello_${code}`));
      });

      ws.on("error", (err) => this.log("warn", "session_broker_ws_error", { err: err.message }));
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.setStatus("closed");
  }
}

function defaultLog(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() });
  if (level === "info") process.stdout.write(line + "\n");
  else process.stderr.write(line + "\n");
}
