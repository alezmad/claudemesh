#!/usr/bin/env bun
/**
 * Smoke-test peer A (sender).
 *
 * Reads the seed JSON from /tmp/smoke-seed.json, connects to the
 * broker, sends hello, then sends one direct message to peer B.
 * Exits after 5s whether or not it gets anything back.
 */

import { readFileSync } from "node:fs";
import WebSocket from "ws";

const seed = JSON.parse(readFileSync("/tmp/smoke-seed.json", "utf-8")) as {
  meshId: string;
  peerA: { memberId: string; pubkey: string };
  peerB: { memberId: string; pubkey: string };
};

const BROKER = process.env.BROKER_WS_URL ?? "ws://localhost:7900/ws";
const ws = new WebSocket(BROKER);

let helloAcked = false;

ws.on("open", () => {
  console.log("[peer-a] connected, sending hello");
  ws.send(
    JSON.stringify({
      type: "hello",
      meshId: seed.meshId,
      memberId: seed.peerA.memberId,
      pubkey: seed.peerA.pubkey,
      sessionId: "peer-a-session",
      pid: process.pid,
      cwd: "/tmp/peer-a",
      signature: "stub",
      nonce: "stub",
    }),
  );
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  console.log("[peer-a] recv:", JSON.stringify(msg));
  if (!helloAcked) {
    // Broker doesn't currently ack hello explicitly; first message we
    // get is a push OR error. Assume success and fire our send after
    // a short delay.
  }
});

ws.on("error", (e) => console.error("[peer-a] error:", e.message));
ws.on("close", () => console.log("[peer-a] closed"));

// After a short delay to let hello complete, send the test message.
setTimeout(() => {
  console.log("[peer-a] sending direct message to peer-b");
  ws.send(
    JSON.stringify({
      type: "send",
      targetSpec: seed.peerB.pubkey,
      priority: "now",
      nonce: "fake-nonce-aaa",
      ciphertext: "hello-from-a",
      id: "msg-1",
    }),
  );
}, 500);

setTimeout(() => {
  console.log("[peer-a] done, closing");
  ws.close();
  process.exit(0);
}, 5000);
