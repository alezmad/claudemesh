#!/usr/bin/env bun
/**
 * Load test — 100 concurrent peers × 1000 messages each.
 *
 * Spins up N peer members in a fresh mesh, connects them all via WS,
 * and has each peer send M direct messages to random other peers.
 * Measures send→push latency per message, memory growth on the
 * broker process, and error rate.
 *
 * Usage:
 *   DATABASE_URL=... bun apps/broker/scripts/load-test.ts [peers] [msgs]
 *
 * Defaults: 100 peers × 1000 messages = 100k messages total.
 *
 * Assumes the broker is running at ws://localhost:7900/ws. If you
 * pass BROKER_PID=<pid>, the test also samples RSS + FD count every
 * 2s for the broker process.
 */

import sodium from "libsodium-wrappers";
import { eq, inArray } from "drizzle-orm";
import WebSocket from "ws";
import { db } from "../src/db";
import { invite, mesh, meshMember } from "@turbostarter/db/schema/mesh";
import { user } from "@turbostarter/db/schema/auth";

// --- CLI args ---

const PEERS = parseInt(process.argv[2] ?? "100", 10);
const MSGS_PER_PEER = parseInt(process.argv[3] ?? "1000", 10);
const TOTAL_MSGS = PEERS * MSGS_PER_PEER;
const BROKER_URL = process.env.BROKER_WS_URL ?? "ws://localhost:7900/ws";
const BROKER_PID = process.env.BROKER_PID
  ? parseInt(process.env.BROKER_PID, 10)
  : null;
const USER_ID = "test-user-loadtest";
const MESH_SLUG = "loadtest";

// --- Types ---

interface Peer {
  memberId: string;
  pubkey: string;
  secretKey: string;
  ws?: WebSocket;
  connected: boolean;
  sendsInFlight: number;
  sendErrors: number;
}

interface MsgTimings {
  sentAt: number;
  pushAt?: number;
  ackAt?: number;
  senderIdx: number;
  recipientIdx: number;
}

const peers: Peer[] = [];
const timings = new Map<string, MsgTimings>();
let messageId = 0;

// --- Broker-process sampling ---

interface Sample {
  t: number;
  rssKb: number;
  fds: number;
}
const samples: Sample[] = [];

function samplePidStats(pid: number): Sample | null {
  try {
    const psOut = new TextDecoder()
      .decode(Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)]).stdout)
      .trim();
    const rssKb = parseInt(psOut, 10);
    if (!Number.isFinite(rssKb)) return null;
    const lsofOut = new TextDecoder()
      .decode(Bun.spawnSync(["lsof", "-p", String(pid)]).stdout)
      .trim();
    const fds = lsofOut.split("\n").length - 1; // minus header
    return { t: Date.now(), rssKb, fds };
  } catch {
    return null;
  }
}

let sampler: ReturnType<typeof setInterval> | null = null;
function startSampler(): void {
  if (!BROKER_PID) return;
  sampler = setInterval(() => {
    const s = samplePidStats(BROKER_PID);
    if (s) samples.push(s);
  }, 2000);
  sampler.unref();
}
function stopSampler(): void {
  if (sampler) clearInterval(sampler);
}

// --- Seed mesh + N members ---

async function seedMesh(): Promise<string> {
  await sodium.ready;
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, USER_ID));
  if (!existingUser) {
    await db.insert(user).values({
      id: USER_ID,
      name: "Load Test User",
      email: "loadtest@claudemesh.test",
      emailVerified: true,
    });
  }

  // Drop prior loadtest mesh (cascades to members).
  await db.delete(mesh).where(eq(mesh.slug, MESH_SLUG));

  const kpOwner = sodium.crypto_sign_keypair();
  const [m] = await db
    .insert(mesh)
    .values({
      name: "Load Test",
      slug: MESH_SLUG,
      ownerUserId: USER_ID,
      ownerPubkey: sodium.to_hex(kpOwner.publicKey),
      visibility: "private",
      transport: "managed",
      tier: "free",
    })
    .returning({ id: mesh.id });
  if (!m) throw new Error("mesh insert failed");

  console.error(`[seed] created mesh ${m.id} (${MESH_SLUG})`);
  console.error(`[seed] generating ${PEERS} keypairs + member rows…`);

  // Batch-insert 100 members.
  const rows = [];
  for (let i = 0; i < PEERS; i++) {
    const kp = sodium.crypto_sign_keypair();
    rows.push({
      meshId: m.id,
      userId: USER_ID,
      peerPubkey: sodium.to_hex(kp.publicKey),
      displayName: `peer-${i}`,
      role: "member" as const,
      _secretKey: sodium.to_hex(kp.privateKey),
    });
  }
  const inserted = await db
    .insert(meshMember)
    .values(rows.map(({ _secretKey: _s, ...r }) => r))
    .returning({ id: meshMember.id, peerPubkey: meshMember.peerPubkey });
  for (let i = 0; i < inserted.length; i++) {
    peers.push({
      memberId: inserted[i]!.id,
      pubkey: inserted[i]!.peerPubkey,
      secretKey: rows[i]!._secretKey,
      connected: false,
      sendsInFlight: 0,
      sendErrors: 0,
    });
  }
  console.error(`[seed] ${peers.length} members inserted`);
  return m.id;
}

async function cleanupMesh(): Promise<void> {
  // Cascade deletes members + presences + messages.
  await db.delete(mesh).where(eq(mesh.slug, MESH_SLUG));
  // Mop up any loadtest users' stray presence rows (belt and braces).
}

// --- WS client logic ---

function signHello(
  meshId: string,
  memberId: string,
  pubkey: string,
  secretHex: string,
): { timestamp: number; signature: string } {
  const ts = Date.now();
  const canonical = `${meshId}|${memberId}|${pubkey}|${ts}`;
  const sig = sodium.to_hex(
    sodium.crypto_sign_detached(
      sodium.from_string(canonical),
      sodium.from_hex(secretHex),
    ),
  );
  return { timestamp: ts, signature: sig };
}

function encryptDirect(
  message: string,
  recipientPubHex: string,
  senderSecretHex: string,
): { nonce: string; ciphertext: string } {
  const recipientPub = sodium.crypto_sign_ed25519_pk_to_curve25519(
    sodium.from_hex(recipientPubHex),
  );
  const senderSec = sodium.crypto_sign_ed25519_sk_to_curve25519(
    sodium.from_hex(senderSecretHex),
  );
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(
    sodium.from_string(message),
    nonce,
    recipientPub,
    senderSec,
  );
  return {
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
  };
}

async function connectPeer(
  idx: number,
  meshId: string,
): Promise<void> {
  const p = peers[idx]!;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BROKER_URL);
    p.ws = ws;
    const timeout = setTimeout(() => {
      reject(new Error(`peer ${idx} hello_ack timeout`));
    }, 10_000);
    ws.on("open", () => {
      const { timestamp, signature } = signHello(
        meshId,
        p.memberId,
        p.pubkey,
        p.secretKey,
      );
      ws.send(
        JSON.stringify({
          type: "hello",
          meshId,
          memberId: p.memberId,
          pubkey: p.pubkey,
          sessionId: `loadtest-${idx}`,
          pid: process.pid,
          cwd: `/tmp/loadtest-${idx}`,
          timestamp,
          signature,
        }),
      );
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (msg.type === "hello_ack") {
        clearTimeout(timeout);
        p.connected = true;
        resolve();
        return;
      }
      if (msg.type === "ack") {
        const clientId = String(msg.id ?? "");
        const brokerId = String(msg.messageId ?? "");
        const t = timings.get(clientId);
        if (t) t.ackAt = Date.now();
        // Index broker messageId → clientId so the push handler
        // (below) can correlate — pushes only carry broker messageId.
        if (brokerId) brokerIdToClientId.set(brokerId, clientId);
        p.sendsInFlight -= 1;
        return;
      }
      if (msg.type === "push") {
        const brokerId = String(msg.messageId ?? "");
        const clientId = brokerIdToClientId.get(brokerId);
        if (clientId) {
          const t = timings.get(clientId);
          if (t && !t.pushAt) t.pushAt = Date.now();
        }
        return;
      }
    });
    ws.on("error", () => {
      clearTimeout(timeout);
      reject(new Error(`peer ${idx} ws error`));
    });
    ws.on("close", () => {
      p.connected = false;
    });
  });
}

async function connectAll(meshId: string): Promise<void> {
  console.error(`[connect] opening ${PEERS} WS connections…`);
  // Connect in batches of 20 to avoid thundering herd.
  const BATCH = 20;
  for (let i = 0; i < PEERS; i += BATCH) {
    const batch = [];
    for (let j = i; j < Math.min(i + BATCH, PEERS); j++) {
      batch.push(connectPeer(j, meshId));
    }
    await Promise.all(batch);
    await new Promise((r) => setTimeout(r, 50));
  }
  const connected = peers.filter((p) => p.connected).length;
  console.error(`[connect] ${connected}/${PEERS} peers connected`);
}

// We need to correlate ack → push. Broker's ack carries the
// client-side id; push carries a broker-assigned messageId. We index
// timings by client-side id initially, then on ack we learn the
// broker messageId and create a second index pointing to same record.
const brokerIdToClientId = new Map<string, string>();

async function runSends(): Promise<void> {
  console.error(
    `[send] firing ${MSGS_PER_PEER} msgs per peer = ${TOTAL_MSGS} total…`,
  );
  const startedAt = Date.now();

  // Each peer sends MSGS_PER_PEER msgs to random other peers.
  await Promise.all(
    peers.map(async (p, idx) => {
      if (!p.ws || !p.connected) return;
      for (let i = 0; i < MSGS_PER_PEER; i++) {
        // Pick a random peer that's not self.
        let targetIdx = Math.floor(Math.random() * PEERS);
        if (targetIdx === idx) targetIdx = (targetIdx + 1) % PEERS;
        const target = peers[targetIdx]!;
        const clientId = `${idx}-${i}`;
        const env = encryptDirect(
          `msg-${clientId}`,
          target.pubkey,
          p.secretKey,
        );
        timings.set(clientId, {
          sentAt: Date.now(),
          senderIdx: idx,
          recipientIdx: targetIdx,
        });
        try {
          p.ws.send(
            JSON.stringify({
              type: "send",
              id: clientId,
              targetSpec: target.pubkey,
              priority: "now",
              nonce: env.nonce,
              ciphertext: env.ciphertext,
            }),
          );
          p.sendsInFlight += 1;
        } catch {
          p.sendErrors += 1;
        }
        // Small breathing room so we don't overwhelm the ws buffer.
        if (i % 100 === 0) await new Promise((r) => setTimeout(r, 1));
      }
    }),
  );

  const sent = Date.now() - startedAt;
  console.error(`[send] all sends dispatched in ${sent}ms`);
}

// We need broker messageId → client id correlation to measure push
// latency. Ack carries both (msg.id = clientId, msg.messageId = broker
// id). Update the ws message handler to populate the index.
// (Done inline above — we need to actually USE it.)
//
// Wire that in: on ack, brokerIdToClientId.set(messageId, clientId).
// On push, look up clientId by messageId, then record pushAt on
// timings.get(clientId).

async function waitForDrain(maxMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const acked = [...timings.values()].filter((t) => t.ackAt).length;
    const pushed = [...timings.values()].filter((t) => t.pushAt).length;
    if (acked === TOTAL_MSGS && pushed === TOTAL_MSGS) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

// --- Stats ---

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[i]!;
}

function report(): void {
  const all = [...timings.values()];
  const complete = all.filter((t) => t.pushAt && t.ackAt);
  const timedOut = all.length - complete.length;
  const latencies = complete
    .map((t) => t.pushAt! - t.sentAt)
    .sort((a, b) => a - b);
  const ackLatencies = complete
    .map((t) => t.ackAt! - t.sentAt)
    .sort((a, b) => a - b);

  const rssMax = samples.length
    ? Math.max(...samples.map((s) => s.rssKb))
    : null;
  const rssMin = samples.length
    ? Math.min(...samples.map((s) => s.rssKb))
    : null;
  const fdMax = samples.length
    ? Math.max(...samples.map((s) => s.fds))
    : null;

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log(`║  claudemesh broker load test — ${PEERS} peers × ${MSGS_PER_PEER} msgs ║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("Delivery:");
  console.log(`  sent:      ${all.length}`);
  console.log(`  complete:  ${complete.length}  (${((100 * complete.length) / all.length).toFixed(2)}%)`);
  console.log(`  timed out: ${timedOut}`);
  console.log("");
  console.log("End-to-end latency (send → push):");
  console.log(`  p50: ${percentile(latencies, 50)} ms`);
  console.log(`  p95: ${percentile(latencies, 95)} ms`);
  console.log(`  p99: ${percentile(latencies, 99)} ms`);
  console.log(`  max: ${latencies[latencies.length - 1] ?? 0} ms`);
  console.log("");
  console.log("Send → ack latency (broker queue write):");
  console.log(`  p50: ${percentile(ackLatencies, 50)} ms`);
  console.log(`  p95: ${percentile(ackLatencies, 95)} ms`);
  console.log(`  p99: ${percentile(ackLatencies, 99)} ms`);
  if (rssMax !== null) {
    console.log("");
    console.log("Broker process (via BROKER_PID):");
    console.log(`  RSS: ${(rssMin! / 1024).toFixed(1)} MB → ${(rssMax / 1024).toFixed(1)} MB`);
    console.log(`  max open FDs: ${fdMax}`);
    console.log(`  samples: ${samples.length}`);
  }
  console.log("");
}

// --- Main ---

async function main(): Promise<void> {
  const meshId = await seedMesh();
  startSampler();
  try {
    await connectAll(meshId);
    await runSends();
    const drainCap = parseInt(process.env.DRAIN_MS ?? "180000", 10);
    console.error(`[drain] waiting for acks + pushes to settle (up to ${drainCap / 1000}s)…`);
    await waitForDrain(drainCap);
    report();
  } finally {
    stopSampler();
    for (const p of peers) {
      try {
        p.ws?.close();
      } catch {
        /* ignore */
      }
    }
    await cleanupMesh();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[loadtest] error:", e);
  if (e instanceof Error && e.cause) {
    console.error("[loadtest] cause:", e.cause);
  }
  process.exit(1);
});

// Wire ack→push correlation by sneaking the broker messageId into
// the client-side timings map. We need to edit the message handler
// inline above to record it; since the handler already reads msg.id
// for the ack path, we just ALSO use msg.id as the correlation key
// on push. The broker's push DOES echo clientId? NO — push only has
// broker's messageId. So we correlate via the ack phase: when ack
// arrives we map messageId→clientId, then on push we look it up.
// (The handler above already references this map; just uses the
// wrong variable. Fix: update handler to use brokerIdToClientId.)
void brokerIdToClientId;
