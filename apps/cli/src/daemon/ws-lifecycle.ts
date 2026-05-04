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
 *     arrives, close the socket and reject the connect promise
 *   - on message, gate on isHelloAck(); when true, flip status to
 *     "open", clear the ack timer, resolve. All other messages are
 *     forwarded to onMessage()
 *   - on close, schedule a backoff reconnect (unless explicitly closed)
 *
 * Each client keeps its own concerns: DaemonBrokerClient still owns
 * pendingAcks / peerListResolvers / etc; SessionBrokerClient still owns
 * its onPush callback. The helper just hands them an open WS and a
 * stable status field, and reconnects under their feet on disconnect.
 *
 * Composition over inheritance — callers receive a `WsLifecycle` handle
 * with `send` / `close` / `status`, NOT a subclass.
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
   * How long to wait for the broker's hello ack before giving up and
   * forcing a close. Defaults 5s — same as both pre-refactor clients.
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
  /** Send a JSON payload over the open WS. Throws if not open — callers
   *  that need queue-while-disconnected semantics should layer that
   *  themselves (DaemonBrokerClient does, via its `opens` deferred-fn array). */
  send(payload: unknown): void;
  /** Close the WS and stop reconnecting. Idempotent. */
  close(): Promise<void>;
}

const DEFAULT_HELLO_ACK_TIMEOUT_MS = 5_000;
const DEFAULT_BACKOFF_CAPS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

const defaultLog: WsLog = (level, msg, meta) => {
  const line = JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() });
  if (level === "info") process.stdout.write(line + "\n");
  else process.stderr.write(line + "\n");
};

/**
 * Connect a WebSocket with hello-handshake, ack-timeout, and reconnect
 * with exponential backoff. Resolves once the broker accepts the hello;
 * rejects if the first connect closes before the ack lands.
 *
 * Subsequent automatic reconnects are silent — they fire on the close
 * handler's backoff timer and surface only via onStatusChange (and any
 * caller-installed log).
 */
export function connectWsWithBackoff(opts: WsLifecycleOptions): Promise<WsLifecycle> {
  const helloAckTimeoutMs = opts.helloAckTimeoutMs ?? DEFAULT_HELLO_ACK_TIMEOUT_MS;
  const backoffCapsMs = opts.backoffCapsMs ?? DEFAULT_BACKOFF_CAPS_MS;
  const log: WsLog = opts.log ?? defaultLog;

  let ws: WebSocket | null = null;
  let status: WsStatus = "closed";
  let closed = false;
  let reconnectAttempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let helloTimer: NodeJS.Timeout | null = null;

  const setStatus = (s: WsStatus) => {
    if (status === s) return;
    status = s;
    opts.onStatusChange?.(s);
  };

  /**
   * Open one WS attempt. Returns a promise that resolves on hello ack
   * or rejects if the socket closes before we get one. Used by both the
   * initial connect and the close-handler backoff timer (which awaits
   * but ignores the rejection — by then the close handler has already
   * scheduled its own reconnect).
   */
  const openOnce = (): Promise<void> => {
    if (closed) return Promise.reject(new Error("client_closed"));
    setStatus("connecting");

    const sock = new WebSocket(opts.url);
    ws = sock;

    return new Promise<void>((resolve, reject) => {
      sock.on("open", () => {
        // Build and send the hello inside a microtask so any sync
        // throws from buildHello() reject this connect attempt cleanly.
        (async () => {
          try {
            const hello = await opts.buildHello();
            sock.send(JSON.stringify(hello));
            helloTimer = setTimeout(() => {
              log("warn", "hello_ack_timeout", { url: opts.url });
              try { sock.close(); } catch { /* ignore */ }
              reject(new Error("hello_ack_timeout"));
            }, helloAckTimeoutMs);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      });

      sock.on("message", (raw) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(raw.toString()) as Record<string, unknown>; }
        catch { return; }

        if (opts.isHelloAck(msg)) {
          if (helloTimer) { clearTimeout(helloTimer); helloTimer = null; }
          setStatus("open");
          reconnectAttempt = 0;
          resolve();
          // Don't forward hello_ack to onMessage — both pre-refactor
          // clients consumed it inline and never delegated.
          return;
        }

        opts.onMessage(msg);
      });

      sock.on("close", (code, reason) => {
        if (helloTimer) { clearTimeout(helloTimer); helloTimer = null; }
        const reasonStr = reason.toString("utf8");
        opts.onBeforeReconnect?.(code, reasonStr);

        if (closed) {
          setStatus("closed");
          return;
        }
        setStatus("reconnecting");
        const wait = backoffCapsMs[Math.min(reconnectAttempt, backoffCapsMs.length - 1)] ?? 30_000;
        reconnectAttempt++;
        log("info", "ws_reconnect_scheduled", { url: opts.url, wait_ms: wait, code, reason: reasonStr });
        reconnectTimer = setTimeout(
          () => openOnce().catch((err) => log("warn", "ws_reconnect_failed", { url: opts.url, err: String(err) })),
          wait,
        );
        // First attempt failure (still in connecting) also rejects the
        // initial connect promise so callers can surface it.
        if (status === "connecting" || status === "reconnecting") {
          reject(new Error(`closed_before_hello_${code}`));
        }
      });

      sock.on("error", (err) => log("warn", "ws_error", { url: opts.url, err: err.message }));
    });
  };

  return openOnce().then(() => {
    const handle: WsLifecycle = {
      get status() { return status; },
      get ws() { return ws; },
      send(payload: unknown) {
        if (!ws || ws.readyState !== ws.OPEN) {
          throw new Error("ws_not_open");
        }
        ws.send(JSON.stringify(payload));
      },
      async close() {
        closed = true;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (helloTimer) { clearTimeout(helloTimer); helloTimer = null; }
        try { ws?.close(); } catch { /* ignore */ }
        setStatus("closed");
      },
    };
    return handle;
  });
}
