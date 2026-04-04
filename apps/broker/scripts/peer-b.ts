#!/usr/bin/env bun
/**
 * Smoke-test peer B (receiver).
 *
 * Connects, sends hello, then waits up to 5s for a push from peer A.
 * Exits 0 on successful receive with matching senderPubkey, 1 on
 * timeout or mismatch.
 */

import { readFileSync } from "node:fs";
import sodium from "libsodium-wrappers";
import WebSocket from "ws";

const seed = JSON.parse(readFileSync("/tmp/smoke-seed.json", "utf-8")) as {
  meshId: string;
  peerA: { memberId: string; pubkey: string; secretKey: string };
  peerB: { memberId: string; pubkey: string; secretKey: string };
};

const BROKER = process.env.BROKER_WS_URL ?? "ws://localhost:7900/ws";
const ws = new WebSocket(BROKER);

let received = false;

ws.on("open", async () => {
  await sodium.ready;
  const timestamp = Date.now();
  const canonical = `${seed.meshId}|${seed.peerB.memberId}|${seed.peerB.pubkey}|${timestamp}`;
  const signature = sodium.to_hex(
    sodium.crypto_sign_detached(
      sodium.from_string(canonical),
      sodium.from_hex(seed.peerB.secretKey),
    ),
  );
  console.log("[peer-b] connected, sending signed hello");
  ws.send(
    JSON.stringify({
      type: "hello",
      meshId: seed.meshId,
      memberId: seed.peerB.memberId,
      pubkey: seed.peerB.pubkey,
      sessionId: "peer-b-session",
      pid: process.pid,
      cwd: "/tmp/peer-b",
      timestamp,
      signature,
    }),
  );
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString()) as {
    type: string;
    senderPubkey?: string;
    ciphertext?: string;
    code?: string;
    message?: string;
  };
  console.log("[peer-b] recv:", JSON.stringify(msg));
  if (msg.type === "push") {
    if (msg.senderPubkey === seed.peerA.pubkey) {
      console.log("[peer-b] ✓ got expected push from peer-a");
      received = true;
      ws.close();
      process.exit(0);
    } else {
      console.error(
        `[peer-b] ✗ wrong senderPubkey: got ${msg.senderPubkey}, expected ${seed.peerA.pubkey}`,
      );
      ws.close();
      process.exit(1);
    }
  }
  if (msg.type === "error") {
    console.error(`[peer-b] ✗ broker error: ${msg.code} ${msg.message}`);
    ws.close();
    process.exit(1);
  }
});

ws.on("error", (e) => console.error("[peer-b] ws error:", e.message));
ws.on("close", () => console.log("[peer-b] closed"));

setTimeout(() => {
  if (!received) {
    console.error("[peer-b] ✗ timeout waiting for push (5s)");
    process.exit(1);
  }
}, 5000);
