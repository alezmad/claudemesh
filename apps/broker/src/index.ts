#!/usr/bin/env bun
/**
 * @claudemesh/broker entry point.
 *
 * Spins up two servers in a single process:
 *   - HTTP on BROKER_PORT+1 for the /hook/set-status endpoint
 *     (Claude Code hook scripts POST here on turn boundaries).
 *   - WebSocket on BROKER_PORT for authenticated peer connections
 *     (routes E2E-encrypted envelopes between mesh members).
 *
 * Background: TTL sweeper + pending-status sweeper.
 * Shutdown: clean SIGTERM/SIGINT marks all presences disconnected.
 */

import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { env } from "./env";
import {
  connectPresence,
  disconnectPresence,
  drainForMember,
  findMemberByPubkey,
  handleHookSetStatus,
  heartbeat,
  queueMessage,
  refreshStatusFromJsonl,
  startSweepers,
  stopSweepers,
  writeStatus,
} from "./broker";
import type {
  HookSetStatusRequest,
  WSClientMessage,
  WSPushMessage,
  WSServerMessage,
} from "./types";

const VERSION = "0.1.0";
const WS_PORT = env.BROKER_PORT;
const HTTP_PORT = env.BROKER_PORT + 1;

function log(msg: string): void {
  console.error(`[broker] ${msg}`);
}

// --- Runtime connection registry ---

/** In-memory map of presenceId → authenticated WS connection. */
const connections = new Map<
  string,
  {
    ws: WebSocket;
    meshId: string;
    memberId: string;
    memberPubkey: string;
    cwd: string;
  }
>();

function sendToPeer(presenceId: string, msg: WSServerMessage): void {
  const conn = connections.get(presenceId);
  if (!conn) return;
  if (conn.ws.readyState !== conn.ws.OPEN) return;
  try {
    conn.ws.send(JSON.stringify(msg));
  } catch (e) {
    log(`push failed to ${presenceId}: ${e instanceof Error ? e.message : e}`);
  }
}

// --- HTTP server (hook endpoint) ---

function startHttpServer(): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: VERSION }));
      return;
    }

    if (req.method === "POST" && req.url === "/hook/set-status") {
      let body = "";
      req.on("data", (chunk) => (body += chunk.toString()));
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body) as HookSetStatusRequest;
          const result = await handleHookSetStatus(payload);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));

          // If the hook flipped a presence to idle, drain any queued
          // "next" messages immediately so the peer gets them on next tick.
          if (result.ok && result.presence_id && !result.pending) {
            void maybePushQueuedMessages(result.presence_id);
          }
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });
  server.listen(HTTP_PORT, "0.0.0.0", () => {
    log(`http (hooks + health) listening on :${HTTP_PORT}`);
  });
  return server;
}

async function maybePushQueuedMessages(presenceId: string): Promise<void> {
  const conn = connections.get(presenceId);
  if (!conn) return;
  const status = await refreshStatusFromJsonl(
    presenceId,
    conn.cwd,
    new Date(),
  );
  const messages = await drainForMember(
    conn.meshId,
    conn.memberId,
    conn.memberPubkey,
    status,
  );
  for (const m of messages) {
    const push: WSPushMessage = {
      type: "push",
      messageId: m.id,
      meshId: conn.meshId,
      senderPubkey: "", // resolved client-side via senderMemberId lookup, or cache
      priority: m.priority,
      nonce: m.nonce,
      ciphertext: m.ciphertext,
      createdAt: m.createdAt.toISOString(),
    };
    sendToPeer(presenceId, push);
  }
}

// --- WebSocket server (peer connections) ---

async function handleHello(
  ws: WebSocket,
  hello: Extract<WSClientMessage, { type: "hello" }>,
): Promise<string | null> {
  // Authenticate: member with this pubkey must exist in this mesh and
  // not be revoked. Signature verification is TODO (crypto not wired
  // yet; client-side libsodium sign_detached is planned).
  const member = await findMemberByPubkey(hello.meshId, hello.pubkey);
  if (!member) {
    const err: WSServerMessage = {
      type: "error",
      code: "unauthorized",
      message: "pubkey not found in mesh",
    };
    ws.send(JSON.stringify(err));
    return null;
  }
  const presenceId = await connectPresence({
    memberId: member.id,
    sessionId: hello.sessionId,
    pid: hello.pid,
    cwd: hello.cwd,
  });
  connections.set(presenceId, {
    ws,
    meshId: hello.meshId,
    memberId: member.id,
    memberPubkey: hello.pubkey,
    cwd: hello.cwd,
  });
  log(
    `hello: mesh=${hello.meshId} member=${member.displayName} presence=${presenceId}`,
  );
  // Drain any messages already queued for this member.
  await maybePushQueuedMessages(presenceId);
  return presenceId;
}

async function handleSend(
  conn: NonNullable<ReturnType<typeof connections.get>>,
  msg: Extract<WSClientMessage, { type: "send" }>,
): Promise<void> {
  const messageId = await queueMessage({
    meshId: conn.meshId,
    senderMemberId: conn.memberId,
    targetSpec: msg.targetSpec,
    priority: msg.priority,
    nonce: msg.nonce,
    ciphertext: msg.ciphertext,
  });
  const ack: WSServerMessage = {
    type: "ack",
    id: msg.id ?? "",
    messageId,
    queued: true,
  };
  conn.ws.send(JSON.stringify(ack));

  // Fan-out: push to any currently-connected peer whose pubkey matches
  // the target (or to everyone on broadcast). Drain their queue which
  // handles priority gating automatically.
  for (const [pid, peer] of connections) {
    if (peer.meshId !== conn.meshId) continue;
    if (msg.targetSpec !== "*" && peer.memberPubkey !== msg.targetSpec) continue;
    void maybePushQueuedMessages(pid);
  }
}

function handleConnection(ws: WebSocket): void {
  let presenceId: string | null = null;
  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as WSClientMessage;
      if (msg.type === "hello") {
        presenceId = await handleHello(ws, msg);
        return;
      }
      if (!presenceId) {
        const err: WSServerMessage = {
          type: "error",
          code: "no_hello",
          message: "must send hello first",
        };
        ws.send(JSON.stringify(err));
        return;
      }
      const conn = connections.get(presenceId);
      if (!conn) return;
      switch (msg.type) {
        case "send":
          await handleSend(conn, msg);
          break;
        case "set_status":
          await writeStatus(presenceId, msg.status, "manual", new Date());
          break;
      }
    } catch (e) {
      log(`ws msg error: ${e instanceof Error ? e.message : e}`);
    }
  });
  ws.on("close", async () => {
    if (presenceId) {
      connections.delete(presenceId);
      await disconnectPresence(presenceId);
      log(`disconnect: ${presenceId}`);
    }
  });
  ws.on("error", (err) => log(`ws error: ${err.message}`));
  ws.on("pong", () => {
    if (presenceId) void heartbeat(presenceId);
  });
}

function startWsServer(): WebSocketServer {
  const wss = new WebSocketServer({ host: "0.0.0.0", port: WS_PORT });
  wss.on("connection", handleConnection);
  wss.on("listening", () => {
    log(
      `@claudemesh/broker v${VERSION} ws listening on :${WS_PORT} | ttl=${env.STATUS_TTL_SECONDS}s hook_fresh=${env.HOOK_FRESH_WINDOW_SECONDS}s`,
    );
  });
  wss.on("error", (err) => {
    log(`ws server error: ${err.message}`);
    process.exit(1);
  });
  // Heartbeat ping every 30s; clients reply with pong → bumps lastPingAt.
  setInterval(() => {
    for (const { ws } of connections.values()) {
      if (ws.readyState === ws.OPEN) ws.ping();
    }
  }, 30_000).unref();
  return wss;
}

// --- Main ---

function main(): void {
  const http = startHttpServer();
  const wss = startWsServer();
  startSweepers();

  const shutdown = async (signal: string): Promise<void> => {
    log(`${signal} received, shutting down`);
    await stopSweepers();
    for (const { ws } of connections.values()) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    wss.close();
    http.close();
    log("closed, bye");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main();
