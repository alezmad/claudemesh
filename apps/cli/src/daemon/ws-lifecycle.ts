/**
 * Shared WS lifecycle helper for the daemon's two broker clients.
 *
 * Both `DaemonBrokerClient` (member-keyed, one per joined mesh) and
 * `SessionBrokerClient` (session-keyed, one per launched session) used
 * to inline the same connect/hello/ack-timeout/close-reconnect logic.
 * They drifted apart subtly — different ack-timeout names, different
 * reconnect log messages, slightly different status flips — and that's
 * how 1.32.x bugs shipped (push handler attached to the wrong client,
 * etc).
 *
 * This helper owns ONLY the lifecycle:
 *   - new WebSocket(url), wire up open/message/close/error
 *   - on open → call buildHello() and send the result
 *   - start an ack-timeout timer; if it fires before the hello ack
 *     arrives, close the socket — the close handler then schedules a
 *     backoff reconnect exactly like any other disconnect
 *   - on message, gate on isHelloAck(); when true, flip status to
 *     "open", clear the ack timer, resolve `ready` (first time only).
 *     All other messages are forwarded to onMessage()
 *   - on close, schedule a backoff reconnect (unless explicitly closed)
 *
 * 1.37.1 — the handle is returned SYNCHRONOUSLY (`createWsLifecycle`),
 * with readiness exposed separately as `handle.ready`. Before this, the
 * helper returned `Promise<WsLifecycle>` that resolved on the FIRST ack
 * and REJECTED on a first-attempt hello-ack timeout — while its internal
 * close handler kept reconnecting the same socket under the caller's
 * feet. The caller (`DaemonBrokerClient.connect`) then never received
 * the handle: `lifecycle === null` forever while `onStatusChange`
 * flipped `_status` to "open" on the silent reconnect. Every RPC gated
 * on `this.lifecycle` (listPeers, send, …) short-circuited → `peer list`
 * returned [] on every mesh for as long as the daemon lived
 * (2026-09-08 incident, spec addendum 3). With a synchronous handle the
 * caller always owns the socket it started, and a hello-ack timeout is
 * just another reconnect — never an orphan.
 *
 * Each client keeps its own concerns: DaemonBrokerClient still owns
 * pendingAcks / peerListResolvers / etc; SessionBrokerClient still owns
 * its onPush callback. The helper just hands them an open WS and a
 * stable status field, and reconnects under their feet on disconnect.
 *
 * Composition over inheritance — callers receive a `WsLifecycle` handle
 * with `send` / `close` / `status` / `ready`, NOT a subclass.
 */

import WebSocket from "ws";

export type WsStatus = "connecting" | "open" | "closed" | "reconnecting";

export type WsLogLevel = "info" | "warn" | "error";
export type WsLog = (level: WsLogLevel, msg: string, meta?: Record<string, unknown>) => void;

export interface WsLifecycleOptions {
  /** Broker URL (e.g. wss://ic.claudemesh.com/ws). */
  url: string;
  /**
   * Build the hello frame to send right after the WS opens. Async because
   * signing the hello may need libsodium initialization. Whatever this
   * returns is JSON.stringified and sent verbatim — the helper does NOT
   * inspect or modify it.
   */
  buildHello: () => Promise<unknown>;
  /**
   * Returns true iff `msg` is the hello ack the helper should treat as
   * "broker accepted us; flip status to open". Both daemon-WS and
   * session-WS use `{ type: "hello_ack" }` today, but keeping this a
   * predicate lets either client narrow further (e.g. on a `code` field)
   * without leaking client-specific shape into the helper.
   */
  isHelloAck: (msg: Record<string, unknown>) => boolean;
  /**
   * Called for every parsed message that is NOT the hello ack. The
   * helper does NOT decide which messages are pushes vs RPCs vs errors;
   * that's the caller's concern.
   */
  onMessage: (msg: Record<string, unknown>) => void;
  onStatusChange?: (s: WsStatus) => void;
  /**
   * How long to wait for the broker's hello ack before giving up on THIS
   * attempt and forcing a close (→ backoff reconnect). Defaults 15s.
   * Was 5s until 1.37.1; a broker under a reconnect storm took 4–5s per
   * hello (2026-09-08), which tripped the old timeout on healthy sockets.
   * Because a timeout is now just a reconnect, a generous value costs
   * nothing on the happy path and avoids churning a slow-but-alive broker.
   */
  helloAckTimeoutMs?: number;
  /**
   * Reconnect backoff schedule. Defaults [1s, 2s, 4s, 8s, 16s, 30s] —
   * matches both pre-refactor clients exactly.
   */
  backoffCapsMs?: readonly number[];
  log?: WsLog;
  /**
   * Hook for the close path BEFORE the helper schedules a reconnect.
   * Used by DaemonBrokerClient to fail its in-flight pendingAcks map
   * with a "broker_disconnected_<code>" reason. The helper passes the
   * raw close code so the caller can shape its rejection text.
   *
   * Returns nothing — close handling continues regardless.
   */
  onBeforeReconnect?: (code: number, reason: string) => void;
}

export interface WsLifecycle {
  /** Current connection status. Updated synchronously before onStatusChange fires. */
  readonly status: WsStatus;
  /** Underlying socket. Exposed for callers that need OPEN-state checks
   *  before sending (mirrors the pre-refactor `this.ws.readyState` checks). */
  readonly ws: WebSocket | null;
  /**
   * Resolves once the broker has accepted a hello for the first time
   * (any attempt — a first-attempt ack timeout does NOT reject). Rejects
   * only if `close()` is called before any ack ever arrived.
   */
  readonly ready: Promise<void>;
  /** Unix ms of the most recent hello ack, null before the first. Diagnostics. */
  readonly lastAckAt: number | null;
  /** Number of reconnect attempts scheduled since creation. Diagnostics. */
  readonly reconnects: number;
  /** True once the broker closed us with `1000 session_replaced` — another
   *  socket owns this identity now and this lifecycle will not reconnect. */
  readonly replaced: boolean;
  /** Send a JSON payload over the open WS. Throws if not open — callers
   *  that need queue-while-disconnected semantics should layer that
   *  themselves (DaemonBrokerClient does, via its `opens` deferred-fn array). */
  send(payload: unknown): void;
  /** Close the WS and stop reconnecting. Idempotent. Effective at any
   *  point in the lifecycle, including mid-connect before the first ack. */
  close(): Promise<void>;
}

export const DEFAULT_HELLO_ACK_TIMEOUT_MS = 15_000;
/** Upper bound `close()` waits for the close handshake to reach the wire. */
export const CLOSE_FLUSH_MS = 1_000;
const DEFAULT_BACKOFF_CAPS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

const defaultLog: WsLog = (level, msg, meta) => {
  const line = JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() });
  if (level === "info") process.stdout.write(line + "\n");
  else process.stderr.write(line + "\n");
};

/**
 * Create a WebSocket lifecycle with hello-handshake, ack-timeout, and
 * reconnect with exponential backoff. Returns the handle synchronously;
 * the first connection attempt starts immediately. Await `handle.ready`
 * to know when the broker has accepted a hello.
 *
 * Reconnects (after a close, or after a hello-ack timeout) are silent —
 * they fire on the close handler's backoff timer and surface only via
 * onStatusChange (and any caller-installed log).
 */
export function createWsLifecycle(opts: WsLifecycleOptions): WsLifecycle {
  const helloAckTimeoutMs = opts.helloAckTimeoutMs ?? DEFAULT_HELLO_ACK_TIMEOUT_MS;
  const backoffCapsMs = opts.backoffCapsMs ?? DEFAULT_BACKOFF_CAPS_MS;
  const log: WsLog = opts.log ?? defaultLog;

  let ws: WebSocket | null = null;
  let status: WsStatus = "closed";
  let closed = false;
  let reconnectAttempt = 0;
  let reconnects = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let helloTimer: NodeJS.Timeout | null = null;
  let lastAckAt: number | null = null;
  let replaced = false;

  let readyResolve!: () => void;
  let readyReject!: (err: Error) => void;
  let readySettled = false;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // A rejected `ready` nobody awaits must not surface as an unhandled
  // rejection (callers that fire-and-forget connect() are legitimate).
  ready.catch(() => { /* observed via status */ });

  const setStatus = (s: WsStatus) => {
    if (status === s) return;
    status = s;
    opts.onStatusChange?.(s);
  };

  // Liveness watchdog: same cadence (30s) as the broker's outbound
  // ping. Two jobs per tick:
  //   1. If we haven't heard from the broker in >75s (2.5x the ping
  //      cadence — covers one missed ping plus some slack), terminate
  //      the socket. Fires the close handler → backoff reconnect runs
  //      its normal path. This is what catches NAT-dropped half-dead
  //      connections that the kernel won't RST for ~2 hours.
  //   2. Otherwise, send our own ping. The broker's `ws` library
  //      auto-replies with a pong, which bumps lastActivity. This
  //      keeps the broker's stale-pong watchdog seeing us as alive.
  //
  // Bare `ping` and `pong` events both bump lastActivity, as does
  // any inbound application message — any sign of life resets the
  // dead-man's-switch.
  const PING_INTERVAL_MS = 30_000;
  const STALE_THRESHOLD_MS = 75_000;
  let lastActivity = Date.now();
  let watchdogTimer: NodeJS.Timeout | null = null;

  const clearTimers = () => {
    if (helloTimer) { clearTimeout(helloTimer); helloTimer = null; }
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  };

  /** Open one WS attempt. Every attempt — initial or reconnect — goes through here. */
  const openOnce = (): void => {
    if (closed) return;
    setStatus("connecting");

    log("info", "ws_open_attempt", { url: opts.url });
    const sock = new WebSocket(opts.url);
    ws = sock;
    lastActivity = Date.now();

    sock.on("open", () => {
      if (closed) { try { sock.close(); } catch { /* ignore */ } return; }
      log("info", "ws_open_ok", { url: opts.url });
      // Build and send the hello inside a microtask so any sync throws
      // from buildHello() are caught and turned into a reconnect.
      (async () => {
        try {
          const hello = await opts.buildHello();
          if (closed || ws !== sock) return;
          sock.send(JSON.stringify(hello));
          log("info", "ws_hello_sent", { url: opts.url });
          helloTimer = setTimeout(() => {
            helloTimer = null;
            // Not a failure of the lifecycle — just this attempt. Closing
            // the socket routes through the close handler, which schedules
            // the backoff reconnect. `ready` stays pending until an ack
            // lands on some later attempt.
            log("warn", "hello_ack_timeout", { url: opts.url, timeout_ms: helloAckTimeoutMs });
            // terminate(), not close(): a broker that never acked our hello
            // may also never ack a close frame, and `ws` would then wait its
            // 30 s closeTimeout before emitting `close` (→ reconnect). A hard
            // teardown makes the retry start on the backoff schedule instead.
            try { sock.terminate(); } catch { /* ignore */ }
          }, helloAckTimeoutMs);
        } catch (e) {
          log("warn", "ws_build_hello_threw", { err: String(e) });
          try { sock.close(); } catch { /* ignore */ }
        }
      })();
    });

    sock.on("message", (raw) => {
      if (ws !== sock) return; // stale socket after a swap — ignore
      lastActivity = Date.now();
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()) as Record<string, unknown>; }
      catch { return; }

      if (opts.isHelloAck(msg)) {
        if (helloTimer) { clearTimeout(helloTimer); helloTimer = null; }
        lastAckAt = Date.now();
        setStatus("open");
        reconnectAttempt = 0;
        log("info", "ws_hello_acked", { url: opts.url });
        // Start liveness watchdog only after a successful handshake.
        if (watchdogTimer) clearInterval(watchdogTimer);
        watchdogTimer = setInterval(() => {
          if (sock.readyState !== sock.OPEN) return;
          const idle = Date.now() - lastActivity;
          if (idle > STALE_THRESHOLD_MS) {
            log("warn", "ws_stale_terminate", { url: opts.url, idle_ms: idle });
            try { sock.terminate(); } catch { /* socket already gone */ }
            return;
          }
          try { sock.ping(); } catch { /* ignore */ }
        }, PING_INTERVAL_MS);
        if (!readySettled) { readySettled = true; readyResolve(); }
        return;
      }

      opts.onMessage(msg);
    });

    sock.on("ping", () => { lastActivity = Date.now(); });
    sock.on("pong", () => { lastActivity = Date.now(); });

    sock.on("close", (code, reason) => {
      if (ws !== sock) return; // an older socket closing after a swap — nothing to do
      clearTimers();
      const reasonStr = reason.toString("utf8");
      log("warn", "ws_closed", { url: opts.url, code, reason: reasonStr, status });
      opts.onBeforeReconnect?.(code, reasonStr);

      if (closed) {
        setStatus("closed");
        return;
      }
      // 1.37.1: `1000 session_replaced` means the broker attached this
      // identity (member or session pubkey) to ANOTHER live socket that
      // hello'd after us. Reconnecting would replace it right back — two
      // daemons holding the same sessions did exactly that at a 1 s
      // cadence in the 2026-09-08 drill (each hello kicked the other's
      // socket, forever). Our own reconnects never trigger this: the
      // socket the broker kicks is the one this lifecycle already left
      // (`ws !== sock` above). So treat it as terminal for this lifecycle:
      // whoever replaced us owns the identity now.
      if (code === 1000 && reasonStr === "session_replaced") {
        replaced = true;
        closed = true;
        log("warn", "ws_replaced_terminal", { url: opts.url });
        setStatus("closed");
        if (!readySettled) { readySettled = true; readyReject(new Error("session_replaced")); }
        return;
      }
      setStatus("reconnecting");
      const wait = backoffCapsMs[Math.min(reconnectAttempt, backoffCapsMs.length - 1)] ?? 30_000;
      reconnectAttempt++;
      reconnects++;
      log("info", "ws_reconnect_scheduled", { url: opts.url, wait_ms: wait, code, reason: reasonStr });
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openOnce();
      }, wait);
    });

    sock.on("error", (err) => log("warn", "ws_error", { url: opts.url, err: err.message }));
  };

  const handle: WsLifecycle = {
    get status() { return status; },
    get ws() { return ws; },
    ready,
    get lastAckAt() { return lastAckAt; },
    get reconnects() { return reconnects; },
    get replaced() { return replaced; },
    send(payload: unknown) {
      if (!ws || ws.readyState !== ws.OPEN) {
        throw new Error("ws_not_open");
      }
      ws.send(JSON.stringify(payload));
    },
    async close() {
      closed = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      clearTimers();
      const sock = ws;
      if (sock) {
        // A socket still in CONNECTING can't be close()d cleanly; terminate
        // tears the TCP attempt down without waiting for the handshake.
        try {
          if (sock.readyState === sock.CONNECTING) sock.terminate();
          else sock.close();
        } catch { /* ignore */ }
        // 1.37.1: wait (bounded) for the close handshake to actually reach
        // the wire. `shutdown()` calls close() on every client and then
        // `process.exit()`; without this the close frames were still in
        // the kernel buffer when the process died, so the broker saw no
        // close at all, kept the leases "online" for 75–90 s until its
        // stale-pong watchdog killed them, and the NEXT daemon's hellos
        // reattached onto still-"online" leases — the exact precondition
        // for the RC-C eviction (2026-09-08 20:40Z clean restart: 4
        // reattached presences evicted at 20:42:05). A flushed close makes
        // the broker start grace immediately and the reattach lands on an
        // `offline` lease — the safe path, even on pre-fix brokers.
        if (sock.readyState !== sock.CLOSED) {
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, CLOSE_FLUSH_MS);
            sock.once("close", () => { clearTimeout(t); resolve(); });
          });
        }
      }
      setStatus("closed");
      if (!readySettled) {
        readySettled = true;
        readyReject(new Error("client_closed"));
      }
    },
  };

  openOnce();
  return handle;
}
