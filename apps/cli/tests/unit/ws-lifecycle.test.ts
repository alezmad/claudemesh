/**
 * ws-lifecycle: the 1.37.1 synchronous-handle contract.
 *
 * Regression for the 2026-09-08 mesh blackout (spec addendum 3): a
 * first-attempt hello-ack timeout used to REJECT the connect promise while
 * the helper kept reconnecting on its own — the caller never got the
 * handle. Now the handle is returned synchronously, a timeout only forces a
 * reconnect, and `ready` resolves on whichever attempt the broker acks.
 */

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";

import { createWsLifecycle, type WsLifecycle } from "~/daemon/ws-lifecycle.js";

interface FakeBroker {
  url: string;
  connections: number;
  hellos: number;
  sockets: WebSocket[];
  close(): Promise<void>;
}

/** Minimal broker: `onHello(sock, attemptIndex)` decides whether/when to ack. */
function startFakeBroker(onHello: (sock: WebSocket, attempt: number) => void): Promise<FakeBroker> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    const state: FakeBroker = {
      url: "",
      connections: 0,
      hellos: 0,
      sockets: [],
      close: () => new Promise<void>((r) => {
        for (const s of state.sockets) { try { s.terminate(); } catch { /* ignore */ } }
        wss.close(() => r());
      }),
    };
    wss.on("connection", (sock) => {
      state.connections++;
      state.sockets.push(sock);
      sock.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { type: string };
        if (msg.type === "hello") {
          const attempt = state.hellos++;
          onHello(sock, attempt);
        } else if (msg.type === "echo") {
          sock.send(JSON.stringify({ type: "echoed" }));
        }
      });
    });
    wss.on("listening", () => {
      const { port } = wss.address() as AddressInfo;
      state.url = `ws://127.0.0.1:${port}`;
      resolve(state);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const silent = () => { /* quiet logs in tests */ };

function makeClient(url: string, extra: Partial<Parameters<typeof createWsLifecycle>[0]> = {}) {
  const received: Array<Record<string, unknown>> = [];
  const statuses: string[] = [];
  const handle: WsLifecycle = createWsLifecycle({
    url,
    buildHello: async () => ({ type: "hello" }),
    isHelloAck: (m) => m.type === "hello_ack",
    onMessage: (m) => received.push(m),
    onStatusChange: (s) => statuses.push(s),
    helloAckTimeoutMs: 150,
    backoffCapsMs: [50],
    log: silent,
    ...extra,
  });
  return { handle, received, statuses };
}

describe("createWsLifecycle", () => {
  let broker: FakeBroker | null = null;
  let handle: WsLifecycle | null = null;

  afterEach(async () => {
    await handle?.close().catch(() => { /* ignore */ });
    handle = null;
    await broker?.close();
    broker = null;
  });

  it("first hello_ack times out, second attempt acked → same handle, ready resolves, send works", async () => {
    broker = await startFakeBroker((sock, attempt) => {
      if (attempt === 0) return; // never ack the first attempt → client times out at 150ms
      sock.send(JSON.stringify({ type: "hello_ack" }));
    });
    const c = makeClient(broker.url);
    handle = c.handle;

    // Handle is available synchronously, before any network round trip.
    expect(handle.status).toBe("connecting");
    expect(handle.lastAckAt).toBeNull();

    await handle.ready;

    expect(handle.status).toBe("open");
    expect(handle.reconnects).toBe(1);
    expect(handle.lastAckAt).not.toBeNull();
    expect(broker.hellos).toBe(2);
    expect(c.statuses).toEqual(["connecting", "reconnecting", "connecting", "open"]);

    handle.send({ type: "echo" });
    await sleep(50);
    expect(c.received).toEqual([{ type: "echoed" }]);
  });

  it("close() before the first ack stops reconnecting and rejects ready", async () => {
    broker = await startFakeBroker(() => { /* never ack */ });
    const c = makeClient(broker.url, { helloAckTimeoutMs: 60, backoffCapsMs: [20] });
    handle = c.handle;

    // Let the first attempt connect + send hello, then close mid-handshake.
    await sleep(30);
    const connectionsAtClose = broker.connections;
    await handle.close();

    await expect(handle.ready).rejects.toThrow("client_closed");
    expect(handle.status).toBe("closed");

    await sleep(300);
    expect(broker.connections).toBe(connectionsAtClose); // no further attempts
  });

  it("server-initiated close → client reconnects and re-hellos", async () => {
    broker = await startFakeBroker((sock) => sock.send(JSON.stringify({ type: "hello_ack" })));
    const c = makeClient(broker.url);
    handle = c.handle;
    await handle.ready;
    expect(broker.hellos).toBe(1);

    // Broker drops the socket (e.g. presence_evicted 4004).
    broker.sockets[0]!.close(4004, "presence_evicted");
    await sleep(250);

    expect(broker.hellos).toBe(2);
    expect(handle.status).toBe("open");
    expect(handle.reconnects).toBe(1);
    expect(c.statuses.slice(-2)).toEqual(["connecting", "open"]);
  });
});

describe("createWsLifecycle — session_replaced is terminal (spec addendum 6)", () => {
  let broker: FakeBroker | null = null;
  afterEach(async () => { if (broker) { await broker.close(); broker = null; } });

  it("stops reconnecting when the broker closes the current socket with 1000 session_replaced", async () => {
    broker = await startFakeBroker((sock) => {
      sock.send(JSON.stringify({ type: "hello_ack" }));
    });
    const { handle, statuses } = makeClient(broker.url);
    await handle.ready;
    expect(handle.status).toBe("open");
    expect(handle.replaced).toBe(false);

    // Another socket took over this identity: broker kicks us.
    broker.sockets[0]!.close(1000, "session_replaced");
    await sleep(300);

    expect(handle.replaced).toBe(true);
    expect(handle.status).toBe("closed");
    expect(statuses.at(-1)).toBe("closed");
    // No reconnect attempt was made (backoff is 50 ms, we waited 300 ms).
    expect(broker.connections).toBe(1);
    expect(handle.reconnects).toBe(0);
  });

  it("an ordinary 1006 close still reconnects", async () => {
    broker = await startFakeBroker((sock) => {
      sock.send(JSON.stringify({ type: "hello_ack" }));
    });
    const { handle } = makeClient(broker.url);
    await handle.ready;
    broker.sockets[0]!.terminate();
    await sleep(400);
    expect(handle.replaced).toBe(false);
    expect(broker.connections).toBe(2);
    expect(handle.status).toBe("open");
    await handle.close();
  });
});

describe("createWsLifecycle — close() flushes the close handshake (spec addendum 7)", () => {
  let broker: FakeBroker | null = null;
  afterEach(async () => { if (broker) { await broker.close(); broker = null; } });

  it("resolves only after the broker has observed the close (so process.exit right after is safe)", async () => {
    const serverCloses: number[] = [];
    broker = await startFakeBroker((sock) => {
      sock.on("close", (code) => serverCloses.push(code));
      sock.send(JSON.stringify({ type: "hello_ack" }));
    });
    const { handle } = makeClient(broker.url);
    await handle.ready;
    const t0 = Date.now();
    await handle.close();
    // close() waited for the handshake: the client socket is fully CLOSED
    // (not merely CLOSING) and the broker's own close event lands within a
    // few ms — well inside CLOSE_FLUSH_MS, not after a process.exit.
    expect(handle.ws?.readyState).toBe(3 /* CLOSED */);
    for (let i = 0; i < 30 && serverCloses.length === 0; i++) await sleep(10);
    expect(serverCloses).toHaveLength(1);
    expect(serverCloses[0]).toBe(1005); // close() without a code → no status
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(handle.status).toBe("closed");
  });
});
