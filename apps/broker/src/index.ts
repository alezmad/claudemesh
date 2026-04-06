#!/usr/bin/env bun
/**
 * @claudemesh/broker entry point.
 *
 * Single-port HTTP + WebSocket server. Routes:
 *   GET  /health              → liveness + build info (503 if DB down)
 *   GET  /metrics             → Prometheus plaintext
 *   POST /hook/set-status     → Claude Code hook scripts report status
 *   WS   /ws                  → authenticated peer connections
 *
 * Graceful shutdown on SIGTERM/SIGINT: stops sweepers, marks all
 * active presences disconnected in the DB, closes servers.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { env } from "./env";
import { db } from "./db";
import { messageQueue } from "@turbostarter/db/schema/mesh";
import {
  connectPresence,
  disconnectPresence,
  drainForMember,
  findMemberByPubkey,
  forgetMemory,
  getState,
  handleHookSetStatus,
  heartbeat,
  joinGroup,
  joinMesh,
  leaveGroup,
  listPeersInMesh,
  listState,
  queueMessage,
  recallMemory,
  refreshQueueDepth,
  refreshStatusFromJsonl,
  rememberMemory,
  setSummary,
  setState,
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
import { log } from "./logger";
import { metrics, metricsToText } from "./metrics";
import { TokenBucket } from "./rate-limit";
import { isDbHealthy, startDbHealth, stopDbHealth } from "./db-health";
import { buildInfo } from "./build-info";
import { verifyHelloSignature } from "./crypto";

const PORT = env.BROKER_PORT;
const WS_PATH = "/ws";

// --- Runtime connection registry ---

interface PeerConn {
  ws: WebSocket;
  meshId: string;
  memberId: string;
  memberPubkey: string;
  sessionPubkey: string | null;
  cwd: string;
  groups: Array<{ name: string; role?: string }>;
}

const connections = new Map<string, PeerConn>();
const connectionsPerMesh = new Map<string, number>();
const hookRateLimit = new TokenBucket(
  env.HOOK_RATE_LIMIT_PER_MIN,
  env.HOOK_RATE_LIMIT_PER_MIN,
);

function sendToPeer(presenceId: string, msg: WSServerMessage): void {
  const conn = connections.get(presenceId);
  if (!conn) return;
  if (conn.ws.readyState !== conn.ws.OPEN) return;
  try {
    conn.ws.send(JSON.stringify(msg));
  } catch (e) {
    log.warn("push failed", {
      presence_id: presenceId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function maybePushQueuedMessages(
  presenceId: string,
  excludeSenderSessionPubkey?: string,
): Promise<void> {
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
    conn.sessionPubkey ?? undefined,
    excludeSenderSessionPubkey,
    conn.groups.map((g) => g.name),
  );
  for (const m of messages) {
    const push: WSPushMessage = {
      type: "push",
      messageId: m.id,
      meshId: conn.meshId,
      senderPubkey: m.senderPubkey,
      priority: m.priority,
      nonce: m.nonce,
      ciphertext: m.ciphertext,
      createdAt: m.createdAt.toISOString(),
    };
    sendToPeer(presenceId, push);
    metrics.messagesRoutedTotal.inc({ priority: m.priority });
  }
}

// --- HTTP request routing ---

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
  const started = Date.now();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const route = `${req.method} ${req.url}`;

  if (req.method === "GET" && req.url === "/health") {
    const healthy = isDbHealthy();
    const status = healthy ? 200 : 503;
    writeJson(res, status, {
      status: healthy ? "ok" : "degraded",
      db: healthy ? "up" : "down",
      ...buildInfo(),
    });
    log.debug("http", { route, status, latency_ms: Date.now() - started });
    return;
  }

  if (req.method === "GET" && req.url === "/metrics") {
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
    res.end(metricsToText());
    return;
  }

  if (req.method === "POST" && req.url === "/hook/set-status") {
    handleHookPost(req, res, started);
    return;
  }

  if (req.method === "POST" && req.url === "/join") {
    handleJoinPost(req, res, started);
    return;
  }

  res.writeHead(404);
  res.end("not found");
  log.debug("http", { route, status: 404, latency_ms: Date.now() - started });
}

function handleHookPost(
  req: IncomingMessage,
  res: ServerResponse,
  started: number,
): void {
  metrics.hookRequestsTotal.inc();
  const chunks: Buffer[] = [];
  let total = 0;
  let aborted = false;

  req.on("data", (chunk: Buffer) => {
    if (aborted) return;
    total += chunk.length;
    if (total > env.MAX_MESSAGE_BYTES) {
      aborted = true;
      writeJson(res, 413, { ok: false, error: "payload too large" });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", async () => {
    if (aborted) return;
    try {
      const payload = JSON.parse(
        Buffer.concat(chunks).toString(),
      ) as HookSetStatusRequest;
      // Rate limit per (pid, cwd) if both present, else per cwd alone.
      const rlKey = `${payload.pid ?? 0}:${payload.cwd ?? ""}`;
      if (!hookRateLimit.take(rlKey)) {
        metrics.hookRequestsRateLimited.inc();
        writeJson(res, 429, { ok: false, error: "rate limited" });
        log.warn("hook rate limited", {
          cwd: payload.cwd,
          pid: payload.pid,
        });
        return;
      }
      const result = await handleHookSetStatus(payload);
      writeJson(res, 200, result);
      log.info("hook", {
        route: "POST /hook/set-status",
        cwd: payload.cwd,
        pid: payload.pid,
        status: payload.status,
        presence_id: result.presence_id,
        pending: result.pending ?? false,
        latency_ms: Date.now() - started,
      });
      if (result.ok && result.presence_id && !result.pending) {
        void maybePushQueuedMessages(result.presence_id);
      }
    } catch (e) {
      writeJson(res, 500, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      log.error("hook handler error", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

function handleJoinPost(
  req: IncomingMessage,
  res: ServerResponse,
  started: number,
): void {
  const chunks: Buffer[] = [];
  let total = 0;
  let aborted = false;

  req.on("data", (chunk: Buffer) => {
    if (aborted) return;
    total += chunk.length;
    if (total > env.MAX_MESSAGE_BYTES) {
      aborted = true;
      writeJson(res, 413, { ok: false, error: "payload too large" });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", async () => {
    if (aborted) return;
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString()) as {
        invite_token?: string;
        invite_payload?: unknown;
        peer_pubkey?: string;
        display_name?: string;
      };
      if (
        !payload.invite_token ||
        !payload.invite_payload ||
        !payload.peer_pubkey ||
        !payload.display_name
      ) {
        writeJson(res, 400, {
          ok: false,
          error:
            "invite_token, invite_payload, peer_pubkey, display_name required",
        });
        return;
      }
      if (!/^[0-9a-f]{64}$/i.test(payload.peer_pubkey)) {
        writeJson(res, 400, {
          ok: false,
          error: "peer_pubkey must be 64 hex chars (32 bytes)",
        });
        return;
      }
      const result = await joinMesh({
        inviteToken: payload.invite_token,
        invitePayload: payload.invite_payload as Parameters<
          typeof joinMesh
        >[0]["invitePayload"],
        peerPubkey: payload.peer_pubkey,
        displayName: payload.display_name,
      });
      writeJson(res, result.ok ? 200 : 400, result);
      log.info("join", {
        route: "POST /join",
        pubkey: payload.peer_pubkey.slice(0, 12),
        ok: result.ok,
        error: !result.ok ? result.error : undefined,
        already_member:
          "alreadyMember" in result ? result.alreadyMember : false,
        latency_ms: Date.now() - started,
      });
    } catch (e) {
      writeJson(res, 500, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      log.error("join handler error", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

function handleUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  if (req.url !== WS_PATH) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
}

// --- WS protocol handlers ---

function incMeshCount(meshId: string): number {
  const n = (connectionsPerMesh.get(meshId) ?? 0) + 1;
  connectionsPerMesh.set(meshId, n);
  metrics.connectionsActive.set(connections.size + 1);
  return n;
}

function decMeshCount(meshId: string): void {
  const n = (connectionsPerMesh.get(meshId) ?? 1) - 1;
  if (n <= 0) connectionsPerMesh.delete(meshId);
  else connectionsPerMesh.set(meshId, n);
  metrics.connectionsActive.set(connections.size);
}

function sendError(
  ws: WebSocket,
  code: string,
  message: string,
  id?: string,
): void {
  const err: WSServerMessage = { type: "error", code, message, id };
  try {
    ws.send(JSON.stringify(err));
  } catch {
    /* ws already closed */
  }
}

async function handleHello(
  ws: WebSocket,
  hello: Extract<WSClientMessage, { type: "hello" }>,
): Promise<{ presenceId: string; memberDisplayName: string } | null> {
  // Capacity check BEFORE touching DB.
  const existing = connectionsPerMesh.get(hello.meshId) ?? 0;
  if (existing >= env.MAX_CONNECTIONS_PER_MESH) {
    metrics.connectionsRejected.inc({ reason: "capacity" });
    log.warn("mesh at capacity", {
      mesh_id: hello.meshId,
      existing,
      cap: env.MAX_CONNECTIONS_PER_MESH,
    });
    sendError(ws, "capacity", "mesh at connection capacity");
    ws.close(1008, "capacity");
    return null;
  }
  // Signature + skew check. Proves the client holds the secret key
  // for the pubkey they're claiming as identity.
  const sig = await verifyHelloSignature({
    meshId: hello.meshId,
    memberId: hello.memberId,
    pubkey: hello.pubkey,
    timestamp: hello.timestamp,
    signature: hello.signature,
  });
  if (!sig.ok) {
    metrics.connectionsRejected.inc({ reason: sig.reason });
    log.warn("hello sig rejected", {
      reason: sig.reason,
      mesh_id: hello.meshId,
      pubkey: hello.pubkey?.slice(0, 12),
    });
    sendError(ws, sig.reason, `hello rejected: ${sig.reason}`);
    ws.close(1008, sig.reason);
    return null;
  }
  const member = await findMemberByPubkey(hello.meshId, hello.pubkey);
  if (!member) {
    metrics.connectionsRejected.inc({ reason: "unauthorized" });
    sendError(ws, "unauthorized", "pubkey not found in mesh");
    ws.close(1008, "unauthorized");
    return null;
  }
  const initialGroups = hello.groups ?? [];
  const presenceId = await connectPresence({
    memberId: member.id,
    sessionId: hello.sessionId,
    sessionPubkey: hello.sessionPubkey,
    displayName: hello.displayName,
    pid: hello.pid,
    cwd: hello.cwd,
    groups: initialGroups,
  });
  connections.set(presenceId, {
    ws,
    meshId: hello.meshId,
    memberId: member.id,
    memberPubkey: hello.pubkey,
    sessionPubkey: hello.sessionPubkey ?? null,
    cwd: hello.cwd,
    groups: initialGroups,
  });
  incMeshCount(hello.meshId);
  const effectiveDisplayName = hello.displayName || member.displayName;
  log.info("ws hello", {
    mesh_id: hello.meshId,
    member: effectiveDisplayName,
    presence_id: presenceId,
    session_id: hello.sessionId,
  });
  // Drain any queued messages in the background. The hello_ack is
  // sent by the CALLER after it assigns presenceId — sending it here
  // races the caller's closure assignment, causing subsequent client
  // messages to fail the "no_hello" check.
  void maybePushQueuedMessages(presenceId);
  return { presenceId, memberDisplayName: effectiveDisplayName };
}

async function handleSend(
  conn: PeerConn,
  msg: Extract<WSClientMessage, { type: "send" }>,
): Promise<void> {
  const messageId = await queueMessage({
    meshId: conn.meshId,
    senderMemberId: conn.memberId,
    senderSessionPubkey: conn.sessionPubkey ?? undefined,
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

  // Find sender's presenceId to exclude from fan-out.
  let senderPresenceId: string | undefined;
  for (const [pid, peer] of connections) {
    if (peer.ws === conn.ws) { senderPresenceId = pid; break; }
  }

  // Fan-out over connected peers in the same mesh — skip sender.
  const isGroupTarget = msg.targetSpec.startsWith("@");
  const isBroadcast =
    msg.targetSpec === "*" ||
    (isGroupTarget && msg.targetSpec === "@all");
  const groupName = isGroupTarget && !isBroadcast
    ? msg.targetSpec.slice(1)
    : null;
  const isMulticast = isBroadcast || !!groupName;

  // Build the push envelope once (reused for all recipients).
  const pushEnvelope: WSPushMessage = {
    type: "push",
    messageId,
    meshId: conn.meshId,
    senderPubkey: conn.sessionPubkey ?? conn.memberPubkey,
    priority: msg.priority,
    nonce: msg.nonce,
    ciphertext: msg.ciphertext,
    createdAt: new Date().toISOString(),
  };

  for (const [pid, peer] of connections) {
    if (pid === senderPresenceId) continue;
    if (peer.meshId !== conn.meshId) continue;

    if (isBroadcast) {
      // broadcast — deliver to everyone
    } else if (groupName) {
      // group routing — deliver only if peer is in the group
      if (!peer.groups.some((g) => g.name === groupName)) continue;
    } else {
      // direct routing — match by pubkey
      if (peer.memberPubkey !== msg.targetSpec
          && peer.sessionPubkey !== msg.targetSpec)
        continue;
    }

    if (isMulticast) {
      // Multicast: push directly to each connected peer. The queue
      // row has one delivered_at — can only be claimed once. Direct
      // push ensures every connected peer receives the message.
      sendToPeer(pid, pushEnvelope);
      metrics.messagesRoutedTotal.inc({ priority: msg.priority });
    } else {
      // Direct: drain from queue (handles priority gating + offline).
      void maybePushQueuedMessages(pid, conn.sessionPubkey ?? undefined);
    }
  }

  // Mark multicast messages as delivered (they've been pushed directly).
  if (isMulticast) {
    await db
      .update(messageQueue)
      .set({ deliveredAt: new Date() })
      .where(eq(messageQueue.id, messageId));
  }
}

function handleConnection(ws: WebSocket): void {
  metrics.connectionsTotal.inc();
  let presenceId: string | null = null;
  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as WSClientMessage;
      if (msg.type === "hello") {
        const result = await handleHello(ws, msg);
        if (!result) return;
        presenceId = result.presenceId;
        // Ack AFTER closure assignment — subsequent client messages
        // arriving immediately after will now see a non-null presenceId.
        try {
          ws.send(
            JSON.stringify({
              type: "hello_ack",
              presenceId: result.presenceId,
              memberDisplayName: result.memberDisplayName,
            }),
          );
        } catch {
          /* ws closed during hello */
        }
        return;
      }
      if (!presenceId) {
        sendError(ws, "no_hello", "must send hello first");
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
          log.info("ws set_status", {
            presence_id: presenceId,
            status: msg.status,
          });
          break;
        case "list_peers": {
          const peers = await listPeersInMesh(conn.meshId);
          const resp: WSServerMessage = {
            type: "peers_list",
            peers: peers.map((p) => ({
              pubkey: p.pubkey,
              displayName: p.displayName,
              status: p.status as "idle" | "working" | "dnd",
              summary: p.summary,
              groups: p.groups,
              sessionId: p.sessionId,
              connectedAt: p.connectedAt.toISOString(),
            })),
          };
          conn.ws.send(JSON.stringify(resp));
          log.info("ws list_peers", {
            presence_id: presenceId,
            mesh_id: conn.meshId,
            count: peers.length,
          });
          break;
        }
        case "set_summary": {
          const summary = (msg as { summary?: string }).summary ?? "";
          await setSummary(presenceId, summary);
          log.info("ws set_summary", {
            presence_id: presenceId,
            summary: summary.slice(0, 80),
          });
          break;
        }
        case "join_group": {
          const jg = msg as Extract<WSClientMessage, { type: "join_group" }>;
          const updatedGroups = await joinGroup(presenceId, jg.name, jg.role);
          conn.groups = updatedGroups;
          log.info("ws join_group", {
            presence_id: presenceId,
            group: jg.name,
            role: jg.role,
          });
          break;
        }
        case "leave_group": {
          const lg = msg as Extract<WSClientMessage, { type: "leave_group" }>;
          const updatedGroups = await leaveGroup(presenceId, lg.name);
          conn.groups = updatedGroups;
          log.info("ws leave_group", {
            presence_id: presenceId,
            group: lg.name,
          });
          break;
        }
        case "set_state": {
          const ss = msg as Extract<WSClientMessage, { type: "set_state" }>;
          // Look up the display name for attribution.
          const senderName =
            [...connections.entries()].find(
              ([pid]) => pid === presenceId,
            )?.[1]?.memberPubkey;
          const member = senderName
            ? await findMemberByPubkey(conn.meshId, senderName)
            : null;
          const displayName = member?.displayName ?? "unknown";
          const stateRow = await setState(
            conn.meshId,
            ss.key,
            ss.value,
            presenceId,
            displayName,
          );
          // Push state_change to ALL other peers in the same mesh.
          for (const [pid, peer] of connections) {
            if (pid === presenceId) continue;
            if (peer.meshId !== conn.meshId) continue;
            sendToPeer(pid, {
              type: "state_change",
              key: stateRow.key,
              value: stateRow.value,
              updatedBy: stateRow.updatedBy,
            });
          }
          // Send confirmation back to sender as state_result.
          sendToPeer(presenceId, {
            type: "state_result",
            key: stateRow.key,
            value: stateRow.value,
            updatedBy: stateRow.updatedBy,
            updatedAt: stateRow.updatedAt.toISOString(),
          });
          log.info("ws set_state", {
            presence_id: presenceId,
            key: ss.key,
          });
          break;
        }
        case "get_state": {
          const gs = msg as Extract<WSClientMessage, { type: "get_state" }>;
          const stateEntry = await getState(conn.meshId, gs.key);
          if (stateEntry) {
            sendToPeer(presenceId, {
              type: "state_result",
              key: stateEntry.key,
              value: stateEntry.value,
              updatedBy: stateEntry.updatedBy,
              updatedAt: stateEntry.updatedAt.toISOString(),
            });
          } else {
            sendToPeer(presenceId, {
              type: "state_result",
              key: gs.key,
              value: null,
              updatedBy: "",
              updatedAt: "",
            });
          }
          log.info("ws get_state", {
            presence_id: presenceId,
            key: gs.key,
            found: !!stateEntry,
          });
          break;
        }
        case "list_state": {
          const entries = await listState(conn.meshId);
          sendToPeer(presenceId, {
            type: "state_list",
            entries: entries.map((e) => ({
              key: e.key,
              value: e.value,
              updatedBy: e.updatedBy,
              updatedAt: e.updatedAt.toISOString(),
            })),
          });
          log.info("ws list_state", {
            presence_id: presenceId,
            count: entries.length,
          });
          break;
        }
        case "remember": {
          const rm = msg as Extract<WSClientMessage, { type: "remember" }>;
          const memberInfo = conn.memberPubkey
            ? await findMemberByPubkey(conn.meshId, conn.memberPubkey)
            : null;
          const memoryId = await rememberMemory(
            conn.meshId,
            rm.content,
            rm.tags ?? [],
            memberInfo?.id,
            memberInfo?.displayName,
          );
          sendToPeer(presenceId, {
            type: "memory_stored",
            id: memoryId,
          });
          log.info("ws remember", {
            presence_id: presenceId,
            memory_id: memoryId,
          });
          break;
        }
        case "recall": {
          const rc = msg as Extract<WSClientMessage, { type: "recall" }>;
          const memories = await recallMemory(conn.meshId, rc.query);
          sendToPeer(presenceId, {
            type: "memory_results",
            memories: memories.map((m) => ({
              id: m.id,
              content: m.content,
              tags: m.tags,
              rememberedBy: m.rememberedBy,
              rememberedAt: m.rememberedAt.toISOString(),
            })),
          });
          log.info("ws recall", {
            presence_id: presenceId,
            query: rc.query.slice(0, 80),
            results: memories.length,
          });
          break;
        }
        case "forget": {
          const fg = msg as Extract<WSClientMessage, { type: "forget" }>;
          await forgetMemory(conn.meshId, fg.memoryId);
          sendToPeer(presenceId, {
            type: "ack" as const,
            id: fg.memoryId,
            messageId: fg.memoryId,
            queued: false,
          });
          log.info("ws forget", {
            presence_id: presenceId,
            memory_id: fg.memoryId,
          });
          break;
        }
        case "message_status": {
          const ms = msg as Extract<WSClientMessage, { type: "message_status" }>;
          // Look up the message in the queue.
          const [mqRow] = await db
            .select({
              id: messageQueue.id,
              targetSpec: messageQueue.targetSpec,
              deliveredAt: messageQueue.deliveredAt,
              meshId: messageQueue.meshId,
            })
            .from(messageQueue)
            .where(eq(messageQueue.id, ms.messageId));
          if (!mqRow || mqRow.meshId !== conn.meshId) {
            sendError(conn.ws, "not_found", "message not found");
            break;
          }
          // Build per-recipient status from connected peers.
          const recipients: Array<{ name: string; pubkey: string; status: "delivered" | "held" | "disconnected" }> = [];
          const isMulti = mqRow.targetSpec === "*" || mqRow.targetSpec.startsWith("@");
          if (isMulti) {
            const groupNameMs = mqRow.targetSpec.startsWith("@") && mqRow.targetSpec !== "@all"
              ? mqRow.targetSpec.slice(1) : null;
            // Check all known presences for this mesh.
            const peers = await listPeersInMesh(conn.meshId);
            for (const p of peers) {
              if (groupNameMs && !p.groups.some((g: { name: string }) => g.name === groupNameMs)) continue;
              recipients.push({
                name: p.displayName,
                pubkey: p.pubkey,
                status: mqRow.deliveredAt ? "delivered" : "held",
              });
            }
          } else {
            // Direct message — find the target peer.
            const peers = await listPeersInMesh(conn.meshId);
            const target = peers.find((p) => p.pubkey === mqRow.targetSpec);
            if (target) {
              recipients.push({
                name: target.displayName,
                pubkey: target.pubkey,
                status: mqRow.deliveredAt ? "delivered" : (target.status === "idle" ? "held" : "held"),
              });
            } else {
              recipients.push({
                name: "unknown",
                pubkey: mqRow.targetSpec.slice(0, 16),
                status: "disconnected",
              });
            }
          }
          const resp: WSServerMessage = {
            type: "message_status_result",
            messageId: ms.messageId,
            targetSpec: mqRow.targetSpec,
            delivered: !!mqRow.deliveredAt,
            deliveredAt: mqRow.deliveredAt?.toISOString() ?? null,
            recipients,
          };
          sendToPeer(presenceId, resp);
          log.info("ws message_status", {
            presence_id: presenceId,
            message_id: ms.messageId,
            delivered: !!mqRow.deliveredAt,
          });
          break;
        }
      }
    } catch (e) {
      metrics.messagesRejectedTotal.inc({ reason: "parse_or_handler" });
      log.warn("ws message error", {
        presence_id: presenceId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
  ws.on("close", async () => {
    if (presenceId) {
      const conn = connections.get(presenceId);
      connections.delete(presenceId);
      if (conn) decMeshCount(conn.meshId);
      await disconnectPresence(presenceId);
      log.info("ws close", { presence_id: presenceId });
    }
  });
  ws.on("error", (err) => {
    log.warn("ws error", { error: err.message });
  });
  ws.on("pong", () => {
    if (presenceId) void heartbeat(presenceId);
  });
}

// --- Main ---

function main(): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: env.MAX_MESSAGE_BYTES,
  });
  wss.on("connection", handleConnection);

  const http = createServer(handleHttpRequest);
  http.on("upgrade", (req, socket, head) =>
    handleUpgrade(wss, req, socket, head),
  );
  http.on("error", (err) => {
    log.error("http server error", { error: err.message });
    process.exit(1);
  });
  http.listen(PORT, "0.0.0.0", () => {
    const info = buildInfo();
    log.info("broker listening", {
      port: PORT,
      version: info.version,
      gitSha: info.gitSha,
      ws_path: WS_PATH,
      ttl_seconds: env.STATUS_TTL_SECONDS,
      hook_fresh_seconds: env.HOOK_FRESH_WINDOW_SECONDS,
      max_connections_per_mesh: env.MAX_CONNECTIONS_PER_MESH,
      max_message_bytes: env.MAX_MESSAGE_BYTES,
      hook_rate_limit_per_min: env.HOOK_RATE_LIMIT_PER_MIN,
    });
  });

  // WS heartbeat ping every 30s; clients reply with pong → bumps lastPingAt.
  const pingInterval = setInterval(() => {
    for (const { ws } of connections.values()) {
      if (ws.readyState === ws.OPEN) ws.ping();
    }
  }, 30_000);
  pingInterval.unref();

  // GC rate-limit buckets periodically.
  const rlSweep = setInterval(() => hookRateLimit.sweep(), 5 * 60_000);
  rlSweep.unref();

  // Queue depth gauge refresh (fires the metric; cheap COUNT query).
  const queueDepthTimer = setInterval(() => {
    refreshQueueDepth().catch((e) =>
      log.warn("queue depth refresh failed", {
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }, 30_000);
  queueDepthTimer.unref();

  startSweepers();
  startDbHealth();

  const shutdown = async (signal: string): Promise<void> => {
    log.info("shutdown signal", { signal });
    clearInterval(pingInterval);
    clearInterval(rlSweep);
    clearInterval(queueDepthTimer);
    stopDbHealth();
    await stopSweepers();
    for (const { ws } of connections.values()) {
      try {
        ws.close(1001, "shutting down");
      } catch {
        /* ignore */
      }
    }
    wss.close();
    http.close();
    log.info("shutdown complete");
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
