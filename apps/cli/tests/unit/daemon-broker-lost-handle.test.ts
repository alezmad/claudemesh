/**
 * DaemonBrokerClient — Addendum 3 regression (2026-09-08 mesh blackout).
 *
 * The broker, busy with a reconnect storm, took >5s to ack the daemon's
 * member `hello`. The old `connect()` did `this.lifecycle = await
 * connectWsWithBackoff(...)`; the timeout REJECTED that promise so
 * `lifecycle` stayed null forever, while the helper's own reconnect flipped
 * `_status` to "open". `listPeers()` then short-circuited on
 * `!this.lifecycle` and returned [] in ~30ms on every mesh — `peer list`
 * showed 0 peers for as long as the daemon lived.
 *
 * Now: first hello times out, second is acked, and `listPeers()` returns
 * the broker's list.
 */

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import sodium from "libsodium-wrappers";

import { DaemonBrokerClient } from "~/daemon/broker.js";
import type { JoinedMesh } from "~/services/config/schemas.js";

const silent = () => { /* quiet */ };

describe("DaemonBrokerClient keeps its lifecycle handle across a first-ack timeout", () => {
  let wss: WebSocketServer | null = null;
  let client: DaemonBrokerClient | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    await client?.close();
    client = null;
    for (const s of sockets) { try { s.terminate(); } catch { /* ignore */ } }
    sockets.length = 0;
    await new Promise<void>((r) => (wss ? wss.close(() => r()) : r()));
    wss = null;
  });

  it("listPeers() returns the broker's peers after the second hello is acked", async () => {
    await sodium.ready;
    const kp = sodium.crypto_sign_keypair();

    let hellos = 0;
    let listPeersSeen = 0;
    wss = new WebSocketServer({ port: 0 });
    wss.on("connection", (sock) => {
      sockets.push(sock);
      sock.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === "hello") {
          hellos++;
          if (hellos === 1) return; // simulate a broker stalled under load
          sock.send(JSON.stringify({ type: "hello_ack", presenceId: "p1", memberDisplayName: "d" }));
          return;
        }
        if (msg.type === "list_peers") {
          listPeersSeen++;
          sock.send(JSON.stringify({
            type: "peers_list",
            _reqId: msg._reqId,
            peers: [
              { pubkey: "a".repeat(64), displayName: "alpha", status: "idle", summary: null, groups: [], sessionId: "s1", connectedAt: new Date().toISOString(), peerRole: "session" },
              { pubkey: "b".repeat(64), displayName: "beta",  status: "idle", summary: null, groups: [], sessionId: "s2", connectedAt: new Date().toISOString(), peerRole: "session" },
            ],
          }));
        }
      });
    });
    await new Promise<void>((r) => wss!.on("listening", () => r()));
    const { port } = wss.address() as AddressInfo;

    const mesh: JoinedMesh = {
      meshId: "mesh_test",
      memberId: "member_test",
      slug: "test",
      name: "test",
      pubkey: sodium.to_hex(kp.publicKey),
      secretKey: sodium.to_hex(kp.privateKey),
      brokerUrl: `ws://127.0.0.1:${port}`,
      joinedAt: new Date().toISOString(),
    };

    const statuses: string[] = [];
    client = new DaemonBrokerClient(mesh, {
      onStatusChange: (s) => statuses.push(s),
      log: silent,
      // Real client-side hello-ack timeout path, shortened for the test.
      lifecycle: { helloAckTimeoutMs: 150, backoffCapsMs: [50] },
    });

    await client.connect(); // resolves once the SECOND hello is acked

    expect(statuses).toEqual(["connecting", "reconnecting", "connecting", "open"]);

    expect(hellos).toBe(2);
    expect(client.status).toBe("open");
    expect(client.isOpen()).toBe(true);

    const peers = await client.listPeers(2_000);
    expect(listPeersSeen).toBe(1);
    expect(peers.map((p) => p.displayName)).toEqual(["alpha", "beta"]);

    const d = client.diagnostics();
    expect(d.status).toBe("open");
    expect(d.isOpen).toBe(true);
    expect(d.reconnects).toBe(1);
    expect(d.lastAckAt).not.toBeNull();
  }, 10_000);
});
