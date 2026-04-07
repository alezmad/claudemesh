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
import { eq, sql } from "drizzle-orm";
import { env } from "./env";
import { db } from "./db";
import { messageQueue } from "@turbostarter/db/schema/mesh";
import {
  claimTask,
  completeTask,
  connectPresence,
  createTask,
  deleteFile,
  disconnectPresence,
  drainForMember,
  findMemberByPubkey,
  forgetMemory,
  getContext,
  getFile,
  getFileKey,
  getFileStatus,
  getState,
  grantFileKey,
  handleHookSetStatus,
  heartbeat,
  insertFileKeys,
  joinGroup,
  joinMesh,
  leaveGroup,
  listContexts,
  listFiles,
  listPeersInMesh,
  listState,
  listTasks,
  queueMessage,
  recallMemory,
  recordFileAccess,
  refreshQueueDepth,
  refreshStatusFromJsonl,
  rememberMemory,
  setSummary,
  setState,
  shareContext,
  startSweepers,
  stopSweepers,
  uploadFile,
  writeStatus,
  ensureMeshSchema,
  meshQuery,
  meshExecute,
  meshSchema,
  createStream,
  listStreams,
} from "./broker";
import { ensureBucket, meshBucketName, minioClient } from "./minio";
import { qdrant, meshCollectionName, ensureCollection } from "./qdrant";
import { neo4jDriver, meshDbName, ensureDatabase } from "./neo4j-client";
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

// Stream subscriptions: "meshId:streamName" → Set of presenceIds
const streamSubscriptions = new Map<string, Set<string>>();

/// Scheduled messages: meshId → Map<scheduledId, entry>
interface ScheduledEntry {
  id: string;
  meshId: string;
  presenceId: string;
  to: string;
  message: string;
  deliverAt: number;
  createdAt: number;
  subtype?: "reminder";
  timer: ReturnType<typeof setTimeout>;
}
const scheduledMessages = new Map<string, ScheduledEntry>(); // keyed by scheduledId
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
  if (!conn) {
    log.debug("maybePush: no connection for presence", { presence_id: presenceId });
    return;
  }
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
  log.info("maybePush", {
    presence_id: presenceId,
    status,
    session_pubkey: conn.sessionPubkey?.slice(0, 12),
    exclude: excludeSenderSessionPubkey?.slice(0, 12),
    drained: messages.length,
  });
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Mesh-Id, X-Member-Id, X-File-Name, X-Tags, X-Persistent, X-Target-Spec");
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

  if (req.method === "POST" && req.url === "/upload") {
    handleUploadPost(req, res, started);
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

function handleUploadPost(
  req: IncomingMessage,
  res: ServerResponse,
  started: number,
): void {
  const meshId = req.headers["x-mesh-id"] as string | undefined;
  const memberId = req.headers["x-member-id"] as string | undefined;
  const fileName = req.headers["x-file-name"] as string | undefined;
  const tagsRaw = req.headers["x-tags"] as string | undefined;
  const persistentRaw = req.headers["x-persistent"] as string | undefined;
  const targetSpec = req.headers["x-target-spec"] as string | undefined;
  const encryptedRaw = req.headers["x-encrypted"] as string | undefined;
  const ownerPubkey = req.headers["x-owner-pubkey"] as string | undefined;
  const fileKeysRaw = req.headers["x-file-keys"] as string | undefined;

  if (!meshId || !memberId || !fileName) {
    writeJson(res, 400, {
      ok: false,
      error: "X-Mesh-Id, X-Member-Id, and X-File-Name headers required",
    });
    return;
  }

  const persistent = persistentRaw !== "false";
  let tags: string[] = [];
  if (tagsRaw) {
    try {
      tags = JSON.parse(tagsRaw);
    } catch {
      tags = [];
    }
  }

  const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB
  const chunks: Buffer[] = [];
  let total = 0;
  let aborted = false;

  req.on("data", (chunk: Buffer) => {
    if (aborted) return;
    total += chunk.length;
    if (total > MAX_UPLOAD_SIZE) {
      aborted = true;
      writeJson(res, 413, { ok: false, error: "file too large (max 50MB)" });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", async () => {
    if (aborted) return;
    try {
      const body = Buffer.concat(chunks);
      if (body.length === 0) {
        writeJson(res, 400, { ok: false, error: "empty body" });
        return;
      }

      // Generate a file ID for the MinIO key
      const { generateId } = await import("@turbostarter/shared/utils");
      const fileId = generateId();
      const dateStr = new Date().toISOString().split("T")[0];
      const keyPrefix = persistent
        ? `shared/${fileId}`
        : `ephemeral/${dateStr}/${fileId}`;
      const minioKey = `${keyPrefix}/${fileName}`;
      const bucket = meshBucketName(meshId);

      // Ensure bucket exists + upload
      await ensureBucket(bucket);
      await minioClient.putObject(
        bucket,
        minioKey,
        body,
        body.length,
        req.headers["content-type"]
          ? { "Content-Type": req.headers["content-type"] }
          : undefined,
      );

      // Insert DB row — normalise tags to a real JS Array (Drizzle PgArray
      // mapper calls .map() on the value; non-Array iterables break it).
      // Skip uploadedByMember FK — memberId from the client header is the
      // mesh slug, not a mesh.member primary key.
      const encrypted = encryptedRaw === "true";
      let fileKeys: Array<{ peerPubkey: string; sealedKey: string }> = [];
      if (encrypted && fileKeysRaw) {
        try {
          fileKeys = JSON.parse(fileKeysRaw);
        } catch { /* ignore */ }
      }

      const dbFileId = await uploadFile({
        meshId,
        name: fileName,
        sizeBytes: body.length,
        mimeType: (req.headers["content-type"] as string) || undefined,
        minioKey,
        tags: Array.isArray(tags) ? tags : [],
        persistent,
        uploadedByName: memberId || undefined,
        uploadedByMember: undefined,
        targetSpec: targetSpec || undefined,
        encrypted: encrypted || false,
        ownerPubkey: ownerPubkey || undefined,
      });

      if (encrypted && fileKeys.length > 0) {
        await insertFileKeys(
          dbFileId,
          fileKeys.map((k) => ({
            peerPubkey: k.peerPubkey,
            sealedKey: k.sealedKey,
            grantedByPubkey: ownerPubkey,
          })),
        );
      }

      writeJson(res, 200, { ok: true, fileId: dbFileId });
      log.info("upload", {
        route: "POST /upload",
        mesh_id: meshId,
        file_id: dbFileId,
        name: fileName,
        size: body.length,
        persistent,
        latency_ms: Date.now() - started,
      });
    } catch (e) {
      writeJson(res, 500, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      log.error("upload handler error", {
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
  reqId?: string,
): void {
  const err: WSServerMessage = { type: "error", code, message, id, ...(reqId ? { _reqId: reqId } : {}) };
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
  subtype?: "reminder",
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
    ...(subtype ? { subtype } : {}),
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
      const _reqId = (msg as any)._reqId as string | undefined;
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
            ...(_reqId ? { _reqId } : {}),
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
          // Fire-and-forget: no state_result sent back to sender.
          // The client (server.ts) returns success immediately without waiting.
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
              ...(_reqId ? { _reqId } : {}),
            });
          } else {
            sendToPeer(presenceId, {
              type: "state_result",
              key: gs.key,
              value: null,
              updatedBy: "",
              updatedAt: "",
              ...(_reqId ? { _reqId } : {}),
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
            ...(_reqId ? { _reqId } : {}),
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
            ...(_reqId ? { _reqId } : {}),
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
            ...(_reqId ? { _reqId } : {}),
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
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws forget", {
            presence_id: presenceId,
            memory_id: fg.memoryId,
          });
          break;
        }
        case "get_file": {
          const gf = msg as Extract<WSClientMessage, { type: "get_file" }>;
          const file = await getFile(conn.meshId, gf.fileId);
          if (!file) {
            sendError(conn.ws, "not_found", "file not found", undefined, _reqId);
            break;
          }
          // Access control: if targetSpec is set, verify peer matches
          if (file.targetSpec) {
            const matches =
              file.targetSpec === conn.memberPubkey ||
              file.targetSpec === conn.sessionPubkey ||
              file.targetSpec === "*";
            if (!matches) {
              sendError(conn.ws, "forbidden", "file not targeted at you", undefined, _reqId);
              break;
            }
          }
          // E2E: for encrypted files, fetch the sealed key for this peer.
          // Owners are not blocked if their key is missing (edge case), but
          // they still get it returned so the CLI can decrypt normally.
          let sealedKey: string | null = null;
          if (file.encrypted) {
            const peerPubkey = conn.sessionPubkey ?? conn.memberPubkey;
            const isOwner = !!(file.ownerPubkey && peerPubkey === file.ownerPubkey);
            sealedKey = peerPubkey ? await getFileKey(gf.fileId, peerPubkey) : null;
            if (!sealedKey && !isOwner) {
              sendError(conn.ws, "forbidden", "no decryption key for this file", undefined, _reqId);
              break;
            }
          }
          // Generate presigned URL (60s expiry)
          const bucket = meshBucketName(conn.meshId);
          const presignedUrl = await minioClient.presignedGetObject(
            bucket,
            file.minioKey,
            60,
          );
          // Record access
          const memberInfo = conn.memberPubkey
            ? await findMemberByPubkey(conn.meshId, conn.memberPubkey)
            : null;
          await recordFileAccess(
            gf.fileId,
            conn.sessionPubkey ?? undefined,
            memberInfo?.displayName,
          );
          sendToPeer(presenceId, {
            type: "file_url",
            fileId: gf.fileId,
            url: presignedUrl,
            name: file.name,
            encrypted: file.encrypted,
            sealedKey: sealedKey ?? undefined,
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws get_file", {
            presence_id: presenceId,
            file_id: gf.fileId,
          });
          break;
        }
        case "list_files": {
          const lf = msg as Extract<WSClientMessage, { type: "list_files" }>;
          const files = await listFiles(conn.meshId, lf.query, lf.from);
          sendToPeer(presenceId, {
            type: "file_list",
            files: files.map((f) => ({
              id: f.id,
              name: f.name,
              size: f.sizeBytes,
              tags: f.tags,
              uploadedBy: f.uploadedBy,
              uploadedAt: f.uploadedAt.toISOString(),
              persistent: f.persistent,
              encrypted: f.encrypted,
            })),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws list_files", {
            presence_id: presenceId,
            mesh_id: conn.meshId,
            count: files.length,
          });
          break;
        }
        case "file_status": {
          const fs = msg as Extract<WSClientMessage, { type: "file_status" }>;
          const accesses = await getFileStatus(fs.fileId);
          sendToPeer(presenceId, {
            type: "file_status_result",
            fileId: fs.fileId,
            accesses: accesses.map((a) => ({
              peerName: a.peerName,
              accessedAt: a.accessedAt.toISOString(),
            })),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws file_status", {
            presence_id: presenceId,
            file_id: fs.fileId,
          });
          break;
        }
        case "grant_file_access": {
          const gfa = msg as { type: "grant_file_access"; fileId: string; peerPubkey: string; sealedKey: string };
          const file = await getFile(conn.meshId, gfa.fileId);
          if (!file) {
            sendError(conn.ws, "not_found", "file not found", undefined, _reqId);
            break;
          }
          const requestorPubkey = conn.sessionPubkey ?? conn.memberPubkey;
          if (file.ownerPubkey && file.ownerPubkey !== requestorPubkey) {
            sendError(conn.ws, "forbidden", "only the file owner can grant access", undefined, _reqId);
            break;
          }
          await grantFileKey(gfa.fileId, gfa.peerPubkey, gfa.sealedKey, requestorPubkey ?? undefined);
          sendToPeer(presenceId, { type: "grant_file_access_ok", fileId: gfa.fileId, peerPubkey: gfa.peerPubkey, ...(_reqId ? { _reqId } : {}) });
          log.info("ws grant_file_access", { presence_id: presenceId, file_id: gfa.fileId, peer: gfa.peerPubkey });
          break;
        }
        case "delete_file": {
          const df = msg as Extract<WSClientMessage, { type: "delete_file" }>;
          await deleteFile(conn.meshId, df.fileId);
          sendToPeer(presenceId, {
            type: "ack" as const,
            id: df.fileId,
            messageId: df.fileId,
            queued: false,
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws delete_file", {
            presence_id: presenceId,
            file_id: df.fileId,
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
            sendError(conn.ws, "not_found", "message not found", undefined, _reqId);
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
            ...(_reqId ? { _reqId } : {}),
          };
          sendToPeer(presenceId, resp);
          log.info("ws message_status", {
            presence_id: presenceId,
            message_id: ms.messageId,
            delivered: !!mqRow.deliveredAt,
          });
          break;
        }
        case "share_context": {
          const sc = msg as Extract<WSClientMessage, { type: "share_context" }>;
          const memberInfo = conn.memberPubkey
            ? await findMemberByPubkey(conn.meshId, conn.memberPubkey)
            : null;
          const ctxId = await shareContext(
            conn.meshId,
            presenceId,
            memberInfo?.displayName,
            sc.summary,
            sc.filesRead,
            sc.keyFindings,
            sc.tags,
            conn.memberId,
          );
          sendToPeer(presenceId, {
            type: "context_shared",
            id: ctxId,
          });
          // Notify all other peers in the mesh that context was shared.
          for (const [pid, peer] of connections) {
            if (pid === presenceId) continue;
            if (peer.meshId !== conn.meshId) continue;
            sendToPeer(pid, {
              type: "state_change",
              key: `_context:${memberInfo?.displayName ?? "unknown"}`,
              value: sc.summary,
              updatedBy: memberInfo?.displayName ?? "unknown",
            });
          }
          log.info("ws share_context", {
            presence_id: presenceId,
            context_id: ctxId,
          });
          break;
        }
        case "get_context": {
          const gc = msg as Extract<WSClientMessage, { type: "get_context" }>;
          const contexts = await getContext(conn.meshId, gc.query);
          sendToPeer(presenceId, {
            type: "context_results",
            contexts: contexts.map((c) => ({
              peerName: c.peerName,
              summary: c.summary,
              filesRead: c.filesRead,
              keyFindings: c.keyFindings,
              tags: c.tags,
              updatedAt: c.updatedAt.toISOString(),
            })),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws get_context", {
            presence_id: presenceId,
            query: gc.query.slice(0, 80),
            results: contexts.length,
          });
          break;
        }
        case "list_contexts": {
          const allContexts = await listContexts(conn.meshId);
          sendToPeer(presenceId, {
            type: "context_list",
            contexts: allContexts.map((c) => ({
              peerName: c.peerName,
              summary: c.summary,
              tags: c.tags,
              updatedAt: c.updatedAt.toISOString(),
            })),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws list_contexts", {
            presence_id: presenceId,
            mesh_id: conn.meshId,
            count: allContexts.length,
          });
          break;
        }
        case "create_task": {
          const ct = msg as Extract<WSClientMessage, { type: "create_task" }>;
          const memberInfo = conn.memberPubkey
            ? await findMemberByPubkey(conn.meshId, conn.memberPubkey)
            : null;
          const taskId = await createTask(
            conn.meshId,
            ct.title,
            ct.assignee,
            ct.priority,
            ct.tags,
            memberInfo?.displayName,
          );
          sendToPeer(presenceId, {
            type: "task_created",
            id: taskId,
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws create_task", {
            presence_id: presenceId,
            task_id: taskId,
            title: ct.title.slice(0, 80),
          });
          break;
        }
        case "claim_task": {
          const clm = msg as Extract<WSClientMessage, { type: "claim_task" }>;
          const memberInfo = conn.memberPubkey
            ? await findMemberByPubkey(conn.meshId, conn.memberPubkey)
            : null;
          const claimed = await claimTask(
            conn.meshId,
            clm.taskId,
            presenceId,
            memberInfo?.displayName,
          );
          if (!claimed) {
            sendError(conn.ws, "task_not_claimable", "task is not open or does not exist", undefined, _reqId);
            break;
          }
          // Return updated task list so caller sees the change.
          const tasksAfterClaim = await listTasks(conn.meshId);
          sendToPeer(presenceId, {
            type: "task_list",
            tasks: tasksAfterClaim.map((t) => ({
              id: t.id,
              title: t.title,
              assignee: t.assignee,
              claimedBy: t.claimedBy,
              status: t.status,
              priority: t.priority,
              createdBy: t.createdBy,
              tags: t.tags,
              createdAt: t.createdAt.toISOString(),
            })),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws claim_task", {
            presence_id: presenceId,
            task_id: clm.taskId,
          });
          break;
        }
        case "complete_task": {
          const cpt = msg as Extract<WSClientMessage, { type: "complete_task" }>;
          const completed = await completeTask(
            conn.meshId,
            cpt.taskId,
            cpt.result,
          );
          if (!completed) {
            sendError(conn.ws, "task_not_found", "task not found in this mesh", undefined, _reqId);
            break;
          }
          // Return updated task list.
          const tasksAfterComplete = await listTasks(conn.meshId);
          sendToPeer(presenceId, {
            type: "task_list",
            tasks: tasksAfterComplete.map((t) => ({
              id: t.id,
              title: t.title,
              assignee: t.assignee,
              claimedBy: t.claimedBy,
              status: t.status,
              priority: t.priority,
              createdBy: t.createdBy,
              tags: t.tags,
              createdAt: t.createdAt.toISOString(),
            })),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws complete_task", {
            presence_id: presenceId,
            task_id: cpt.taskId,
          });
          break;
        }
        case "list_tasks": {
          const lt = msg as Extract<WSClientMessage, { type: "list_tasks" }>;
          const tasks = await listTasks(conn.meshId, lt.status, lt.assignee);
          sendToPeer(presenceId, {
            type: "task_list",
            tasks: tasks.map((t) => ({
              id: t.id,
              title: t.title,
              assignee: t.assignee,
              claimedBy: t.claimedBy,
              status: t.status,
              priority: t.priority,
              createdBy: t.createdBy,
              tags: t.tags,
              createdAt: t.createdAt.toISOString(),
            })),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws list_tasks", {
            presence_id: presenceId,
            mesh_id: conn.meshId,
            count: tasks.length,
          });
          break;
        }

        // --- Streams ---

        case "create_stream": {
          const cs = msg as Extract<WSClientMessage, { type: "create_stream" }>;
          const memberInfo = conn.memberPubkey
            ? await findMemberByPubkey(conn.meshId, conn.memberPubkey)
            : null;
          const streamId = await createStream(
            conn.meshId,
            cs.name,
            memberInfo?.displayName ?? "peer",
          );
          sendToPeer(presenceId, {
            type: "stream_created",
            id: streamId,
            name: cs.name,
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws create_stream", {
            presence_id: presenceId,
            stream: cs.name,
          });
          break;
        }

        case "subscribe": {
          const sub = msg as Extract<WSClientMessage, { type: "subscribe" }>;
          const key = `${conn.meshId}:${sub.stream}`;
          if (!streamSubscriptions.has(key))
            streamSubscriptions.set(key, new Set());
          streamSubscriptions.get(key)!.add(presenceId);
          sendToPeer(presenceId, { type: "subscribed", stream: sub.stream, ...(_reqId ? { _reqId } : {}) });
          log.info("ws subscribe", {
            presence_id: presenceId,
            stream: sub.stream,
          });
          break;
        }

        case "unsubscribe": {
          const unsub = msg as Extract<
            WSClientMessage,
            { type: "unsubscribe" }
          >;
          const key = `${conn.meshId}:${unsub.stream}`;
          streamSubscriptions.get(key)?.delete(presenceId);
          log.info("ws unsubscribe", {
            presence_id: presenceId,
            stream: unsub.stream,
          });
          break;
        }

        case "publish": {
          const pub = msg as Extract<WSClientMessage, { type: "publish" }>;
          const key = `${conn.meshId}:${pub.stream}`;
          const subs = streamSubscriptions.get(key);
          if (subs) {
            const memberInfo = conn.memberPubkey
              ? await findMemberByPubkey(conn.meshId, conn.memberPubkey)
              : null;
            const push: WSServerMessage = {
              type: "stream_data",
              stream: pub.stream,
              data: pub.data,
              publishedBy: memberInfo?.displayName ?? "peer",
            };
            for (const subPid of subs) {
              if (subPid === presenceId) continue; // don't echo to publisher
              sendToPeer(subPid, push);
            }
          }
          metrics.messagesRoutedTotal.inc({ priority: "stream" });
          break;
        }

        case "list_streams": {
          const streams = await listStreams(conn.meshId);
          sendToPeer(presenceId, {
            type: "stream_list",
            streams: streams.map((s) => {
              const key = `${conn.meshId}:${s.name}`;
              return {
                id: s.id,
                name: s.name,
                createdBy: s.createdBy ?? "",
                createdAt: s.createdAt.toISOString(),
                subscriberCount: streamSubscriptions.get(key)?.size ?? 0,
              };
            }),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws list_streams", {
            presence_id: presenceId,
            mesh_id: conn.meshId,
            count: streams.length,
          });
          break;
        }

        // --- Vector storage ---

        case "vector_store": {
          const vs = msg as Extract<WSClientMessage, { type: "vector_store" }>;
          const collName = meshCollectionName(conn.meshId, vs.collection);
          try {
            await ensureCollection(collName);
            const { generateId } = await import("@turbostarter/shared/utils");
            const pointId = generateId();
            // Store text + metadata as payload. Use a zero vector as placeholder
            // — real embeddings should be computed client-side and sent directly
            // to Qdrant in a future version.
            const zeroVector = new Array(1536).fill(0) as number[];
            await qdrant.upsert(collName, {
              wait: true,
              points: [
                {
                  id: pointId,
                  vector: zeroVector,
                  payload: {
                    text: vs.text,
                    mesh_id: conn.meshId,
                    stored_by: conn.memberPubkey,
                    stored_at: new Date().toISOString(),
                    ...(vs.metadata ?? {}),
                  },
                },
              ],
            });
            sendToPeer(presenceId, {
              type: "vector_stored",
              id: pointId,
              ...(_reqId ? { _reqId } : {}),
            });
            log.info("ws vector_store", {
              presence_id: presenceId,
              collection: vs.collection,
              point_id: pointId,
            });
          } catch (e) {
            sendError(conn.ws, "vector_error", e instanceof Error ? e.message : String(e), undefined, _reqId);
          }
          break;
        }
        case "vector_search": {
          const vq = msg as Extract<WSClientMessage, { type: "vector_search" }>;
          const searchCollName = meshCollectionName(conn.meshId, vq.collection);
          const searchLimit = vq.limit ?? 10;
          try {
            // Keyword search via payload scroll + filter.
            // Full vector similarity requires client-computed embeddings (future).
            const queryLower = vq.query.toLowerCase();
            const scrollResult = await qdrant.scroll(searchCollName, {
              limit: 100,
              with_payload: true,
              with_vector: false,
            });
            const matches = (scrollResult.points ?? [])
              .filter((p) => {
                const text = (p.payload as Record<string, unknown>)?.text;
                return typeof text === "string" && text.toLowerCase().includes(queryLower);
              })
              .slice(0, searchLimit)
              .map((p) => {
                const payload = p.payload as Record<string, unknown>;
                return {
                  id: String(p.id),
                  text: (payload.text as string) ?? "",
                  score: 1.0, // keyword match — no vector similarity score
                  metadata: payload,
                };
              });
            sendToPeer(presenceId, {
              type: "vector_results",
              results: matches,
              ...(_reqId ? { _reqId } : {}),
            });
          } catch {
            // Collection may not exist yet — return empty results.
            sendToPeer(presenceId, {
              type: "vector_results",
              results: [],
              ...(_reqId ? { _reqId } : {}),
            });
          }
          log.info("ws vector_search", {
            presence_id: presenceId,
            collection: vq.collection,
            query: vq.query.slice(0, 80),
          });
          break;
        }
        case "vector_delete": {
          const vd = msg as Extract<WSClientMessage, { type: "vector_delete" }>;
          const deleteCollName = meshCollectionName(conn.meshId, vd.collection);
          try {
            await qdrant.delete(deleteCollName, {
              wait: true,
              points: [vd.id],
            });
          } catch {
            /* collection or point may not exist — idempotent */
          }
          sendToPeer(presenceId, {
            type: "ack" as const,
            id: vd.id,
            messageId: vd.id,
            queued: false,
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws vector_delete", {
            presence_id: presenceId,
            collection: vd.collection,
            point_id: vd.id,
          });
          break;
        }
        case "list_collections": {
          try {
            const qdrantResponse = await qdrant.getCollections();
            const prefix = `mesh_${conn.meshId}_`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
            const meshCollections = (qdrantResponse.collections ?? [])
              .map((c) => c.name)
              .filter((name) => name.startsWith(prefix))
              .map((name) => name.slice(prefix.length));
            sendToPeer(presenceId, {
              type: "collection_list",
              collections: meshCollections,
              ...(_reqId ? { _reqId } : {}),
            });
          } catch {
            sendToPeer(presenceId, {
              type: "collection_list",
              collections: [],
              ...(_reqId ? { _reqId } : {}),
            });
          }
          log.info("ws list_collections", {
            presence_id: presenceId,
            mesh_id: conn.meshId,
          });
          break;
        }

        // --- Graph database ---

        case "graph_query": {
          const gq = msg as Extract<WSClientMessage, { type: "graph_query" }>;
          const gqDbName = meshDbName(conn.meshId);
          let gqSession;
          try {
            await ensureDatabase(gqDbName);
            gqSession = neo4jDriver.session({ database: gqDbName });
          } catch {
            // Community edition — fall back to default db.
            gqSession = neo4jDriver.session();
          }
          try {
            const gqResult = await gqSession.run(gq.cypher);
            const gqRecords = gqResult.records.map((r) => {
              const obj: Record<string, unknown> = {};
              for (const key of r.keys) {
                obj[key] = r.get(key);
              }
              return obj;
            });
            sendToPeer(presenceId, {
              type: "graph_result",
              records: gqRecords,
              ...(_reqId ? { _reqId } : {}),
            });
          } catch (gqErr) {
            sendError(conn.ws, "graph_error", gqErr instanceof Error ? gqErr.message : String(gqErr), undefined, _reqId);
          } finally {
            await gqSession.close();
          }
          log.info("ws graph_query", {
            presence_id: presenceId,
            cypher: gq.cypher.slice(0, 80),
          });
          break;
        }
        case "graph_execute": {
          const ge = msg as Extract<WSClientMessage, { type: "graph_execute" }>;
          const geDbName = meshDbName(conn.meshId);
          let geSession;
          try {
            await ensureDatabase(geDbName);
            geSession = neo4jDriver.session({ database: geDbName });
          } catch {
            geSession = neo4jDriver.session();
          }
          try {
            const geResult = await geSession.run(ge.cypher);
            const geRecords = geResult.records.map((r) => {
              const obj: Record<string, unknown> = {};
              for (const key of r.keys) {
                obj[key] = r.get(key);
              }
              return obj;
            });
            sendToPeer(presenceId, {
              type: "graph_result",
              records: geRecords,
              ...(_reqId ? { _reqId } : {}),
            });
          } catch (geErr) {
            sendError(conn.ws, "graph_error", geErr instanceof Error ? geErr.message : String(geErr), undefined, _reqId);
          } finally {
            await geSession.close();
          }
          log.info("ws graph_execute", {
            presence_id: presenceId,
            cypher: ge.cypher.slice(0, 80),
          });
          break;
        }

        // --- Mesh database (per-mesh PostgreSQL schema) ---

        case "mesh_query": {
          const mq = msg as Extract<WSClientMessage, { type: "mesh_query" }>;
          try {
            const result = await meshQuery(conn.meshId, mq.sql);
            sendToPeer(presenceId, { type: "mesh_query_result", ...result, ...(_reqId ? { _reqId } : {}) });
          } catch (e) {
            sendError(
              conn.ws,
              "query_error",
              e instanceof Error ? e.message : String(e),
              undefined,
              _reqId,
            );
          }
          log.info("ws mesh_query", {
            presence_id: presenceId,
            sql: mq.sql.slice(0, 80),
          });
          break;
        }
        case "mesh_execute": {
          const me = msg as Extract<WSClientMessage, { type: "mesh_execute" }>;
          try {
            const result = await meshExecute(conn.meshId, me.sql);
            sendToPeer(presenceId, {
              type: "mesh_query_result",
              columns: [],
              rows: [],
              rowCount: result.rowCount,
              ...(_reqId ? { _reqId } : {}),
            });
          } catch (e) {
            sendError(
              conn.ws,
              "execute_error",
              e instanceof Error ? e.message : String(e),
              undefined,
              _reqId,
            );
          }
          log.info("ws mesh_execute", {
            presence_id: presenceId,
            sql: me.sql.slice(0, 80),
          });
          break;
        }
        case "mesh_schema": {
          try {
            const tables = await meshSchema(conn.meshId);
            sendToPeer(presenceId, { type: "mesh_schema_result", tables, ...(_reqId ? { _reqId } : {}) });
          } catch (e) {
            sendError(
              conn.ws,
              "schema_error",
              e instanceof Error ? e.message : String(e),
              undefined,
              _reqId,
            );
          }
          log.info("ws mesh_schema", { presence_id: presenceId });
          break;
        }
        case "mesh_info": {
          const [peers, stateEntries, memCount, fileCount, taskCounts, streams, tables] = await Promise.all([
            listPeersInMesh(conn.meshId),
            listState(conn.meshId),
            db.execute(sql`SELECT COUNT(*) as n FROM mesh.memory WHERE mesh_id = ${conn.meshId} AND forgotten_at IS NULL`).then(r => Number(((r.rows ?? r) as any[])[0]?.n ?? 0)),
            db.execute(sql`SELECT COUNT(*) as n FROM mesh.file WHERE mesh_id = ${conn.meshId} AND deleted_at IS NULL`).then(r => Number(((r.rows ?? r) as any[])[0]?.n ?? 0)),
            db.execute(sql`SELECT status, COUNT(*) as n FROM mesh.task WHERE mesh_id = ${conn.meshId} GROUP BY status`).then(r => {
              const rows = (r.rows ?? r) as Array<{ status: string; n: string }>;
              const counts = { open: 0, claimed: 0, done: 0 };
              for (const row of rows) counts[row.status as keyof typeof counts] = Number(row.n);
              return counts;
            }),
            listStreams(conn.meshId),
            meshSchema(conn.meshId).catch(() => []),
          ]);
          const allGroups = new Set<string>();
          for (const p of peers) for (const g of p.groups) allGroups.add(`@${g.name}`);
          const peerConn = connections.get(presenceId);
          // Find own display name: match sessionPubkey from the peer list
          const selfPubkey = peerConn?.sessionPubkey ?? peerConn?.memberPubkey;
          const selfPeer = peers.find(p => p.pubkey === selfPubkey);
          sendToPeer(presenceId, {
            type: "mesh_info_result",
            mesh: conn.meshId,
            peers: peers.length,
            groups: [...allGroups],
            stateKeys: stateEntries.map((e: any) => e.key),
            memoryCount: memCount,
            fileCount: fileCount,
            tasks: taskCounts,
            streams: streams.map(s => s.name),
            tables: tables.map((t: any) => t.name),
            collections: [],
            yourName: selfPeer?.displayName ?? "unknown",
            yourGroups: peerConn?.groups ?? [],
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws mesh_info", { presence_id: presenceId });
          break;
        }

        // --- Scheduled messages ---

        case "schedule": {
          const sm = msg as Extract<WSClientMessage, { type: "schedule" }>;
          const scheduledId = crypto.randomUUID();
          const now = Date.now();
          const delay = Math.max(0, sm.deliverAt - now);

          const deliver = (): void => {
            scheduledMessages.delete(scheduledId);
            // Deliver via the normal send path by constructing a WSSendMessage
            // and routing it through handleSend so encryption + push logic applies.
            const conn2 = connections.get(presenceId);
            if (!conn2) return; // session gone — drop
            const fakeMsg: Extract<WSClientMessage, { type: "send" }> = {
              type: "send",
              id: crypto.randomUUID(),
              targetSpec: sm.to,
              priority: "now",
              nonce: "",
              ciphertext: Buffer.from(sm.message, "utf-8").toString("base64"),
            };
            handleSend(conn2, fakeMsg, sm.subtype).catch((e) =>
              log.warn("scheduled delivery error", { scheduled_id: scheduledId, error: String(e) }),
            );
            log.info("ws schedule deliver", { scheduled_id: scheduledId, to: sm.to });
          };

          const entry: ScheduledEntry = {
            id: scheduledId,
            meshId: conn.meshId,
            presenceId,
            to: sm.to,
            message: sm.message,
            deliverAt: sm.deliverAt,
            createdAt: now,
            ...(sm.subtype ? { subtype: sm.subtype } : {}),
            timer: setTimeout(deliver, delay),
          };
          scheduledMessages.set(scheduledId, entry);

          sendToPeer(presenceId, {
            type: "scheduled_ack",
            scheduledId,
            deliverAt: sm.deliverAt,
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws schedule", {
            presence_id: presenceId,
            scheduled_id: scheduledId,
            delay_ms: delay,
            to: sm.to,
          });
          break;
        }

        case "list_scheduled": {
          const mine = [...scheduledMessages.values()]
            .filter((e) => e.meshId === conn.meshId && e.presenceId === presenceId)
            .map((e) => ({ id: e.id, to: e.to, message: e.message, deliverAt: e.deliverAt, createdAt: e.createdAt }));
          sendToPeer(presenceId, {
            type: "scheduled_list",
            messages: mine,
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws list_scheduled", { presence_id: presenceId, count: mine.length });
          break;
        }

        case "cancel_scheduled": {
          const cs = msg as Extract<WSClientMessage, { type: "cancel_scheduled" }>;
          const entry = scheduledMessages.get(cs.scheduledId);
          let ok = false;
          if (entry && entry.meshId === conn.meshId && entry.presenceId === presenceId) {
            clearTimeout(entry.timer);
            scheduledMessages.delete(cs.scheduledId);
            ok = true;
          }
          sendToPeer(presenceId, {
            type: "cancel_scheduled_ack",
            scheduledId: cs.scheduledId,
            ok,
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws cancel_scheduled", { presence_id: presenceId, scheduled_id: cs.scheduledId, ok });
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
      // Clean up stream subscriptions for this peer
      for (const [key, subs] of streamSubscriptions) {
        subs.delete(presenceId);
        if (subs.size === 0) streamSubscriptions.delete(key);
      }
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
