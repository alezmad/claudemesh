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
import { and, eq, isNull, sql } from "drizzle-orm";
import { env } from "./env";
import { db } from "./db";
import { mesh, meshMember, messageQueue, scheduledMessage as scheduledMessageTable, meshWebhook, peerState } from "@turbostarter/db/schema/mesh";
import { user } from "@turbostarter/db/schema/auth";
import { handleCliSync, type CliSyncRequest } from "./cli-sync";
import { updateMemberProfile, listMeshMembers, updateMeshSettings } from "./member-api";
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
  shareSkill,
  getSkill,
  listSkills,
  removeSkill,
  vaultSet,
  vaultList,
  vaultDelete,
  vaultGetEntries,
  upsertService,
  updateServiceStatus,
  updateServiceScope,
  getService,
  listDbMeshServices,
  deleteService,
  getRunningServices,
} from "./broker";
import * as serviceManager from "./service-manager";
import { ensureBucket, meshBucketName, minioClient } from "./minio";
import { bootTelegramBridge } from "./telegram-bridge";
import { generateTelegramConnectToken, generateDeepLink } from "./telegram-token";
import { telegramBridge } from "@turbostarter/db/schema/mesh";
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
import { handleWebhook } from "./webhooks";
import { audit, loadLastHashes, ensureAuditLogTable, verifyChain, queryAuditLog } from "./audit";

const PORT = env.BROKER_PORT;
const WS_PATH = "/ws";

// --- Runtime connection registry ---

interface PeerConn {
  ws: WebSocket;
  meshId: string;
  memberId: string;
  memberPubkey: string;
  sessionPubkey: string | null;
  displayName: string;
  cwd: string;
  hostname?: string;
  peerType?: "ai" | "human" | "connector";
  channel?: string;
  model?: string;
  groups: Array<{ name: string; role?: string }>;
  stats?: {
    messagesIn?: number;
    messagesOut?: number;
    toolCalls?: number;
    uptime?: number;
    errors?: number;
  };
  visible: boolean;
  profile: {
    avatar?: string;
    title?: string;
    bio?: string;
    capabilities?: string[];
  };
}

const connections = new Map<string, PeerConn>();
const connectionsPerMesh = new Map<string, number>();

// Rate limiter for /tg/token endpoint (IP → count, cleared hourly)
const tgTokenRateLimit = new Map<string, number>();
setInterval(() => tgTokenRateLimit.clear(), 60 * 60_000).unref();

// --- URL Watch engine ---
interface WatchEntry {
  id: string;
  meshId: string;
  presenceId: string;
  url: string;
  mode: "hash" | "json" | "status";
  extract?: string;
  notifyOn: string;
  interval: number;
  headers: Record<string, string>;
  label?: string;
  lastHash: string;
  lastValue: string;
  lastCheck: Date | null;
  createdAt: Date;
  timer: ReturnType<typeof setInterval>;
}

const urlWatches = new Map<string, WatchEntry>();

async function checkWatch(watch: WatchEntry): Promise<void> {
  try {
    const res = await fetch(watch.url, {
      headers: watch.headers,
      signal: AbortSignal.timeout(10_000),
    });

    let currentValue: string;
    if (watch.mode === "status") {
      currentValue = String(res.status);
    } else {
      const body = await res.text();
      if (watch.mode === "json" && watch.extract) {
        try {
          const json = JSON.parse(body);
          // Simple dot-path extraction ($.status → json.status)
          const path = watch.extract.replace(/^\$\.?/, "").split(".");
          let val: unknown = json;
          for (const p of path) { val = (val as Record<string, unknown>)?.[p]; }
          currentValue = String(val ?? "null");
        } catch { currentValue = body.slice(0, 200); }
      } else {
        // Hash mode — SHA-256 of full body
        const { createHash } = await import("node:crypto");
        currentValue = createHash("sha256").update(body).digest("hex").slice(0, 16);
      }
    }

    watch.lastCheck = new Date();
    const oldValue = watch.lastValue;

    if (oldValue === "") {
      // First check — just store baseline
      watch.lastHash = currentValue;
      watch.lastValue = currentValue;
      return;
    }

    // Check if notification should fire
    let shouldNotify = false;
    const notifyOn = watch.notifyOn;
    if (notifyOn === "change") {
      shouldNotify = currentValue !== oldValue;
    } else if (notifyOn.startsWith("match:")) {
      const target = notifyOn.slice(6);
      shouldNotify = currentValue === target && oldValue !== target;
    } else if (notifyOn.startsWith("not_match:")) {
      const target = notifyOn.slice(10);
      shouldNotify = currentValue !== target && oldValue === target;
    }

    watch.lastHash = currentValue;
    watch.lastValue = currentValue;

    if (shouldNotify) {
      const notification: WSPushMessage = {
        type: "push",
        subtype: "system" as const,
        event: "watch_triggered",
        eventData: {
          watchId: watch.id,
          url: watch.url,
          label: watch.label,
          mode: watch.mode,
          oldValue,
          newValue: currentValue,
        },
        messageId: crypto.randomUUID(),
        meshId: watch.meshId,
        senderPubkey: "system",
        priority: "now",
        nonce: "",
        ciphertext: "",
        createdAt: new Date().toISOString(),
      };
      sendToPeer(watch.presenceId, notification);
      log.info("watch triggered", { id: watch.id, url: watch.url, old: oldValue, new: currentValue });
    }
  } catch (e) {
    log.warn("watch check failed", { id: watch.id, url: watch.url, error: (e as Error).message });
  }
}

// Stream subscriptions: "meshId:streamName" → Set of presenceIds
const streamSubscriptions = new Map<string, Set<string>>();

// --- Simulation clock state (per-mesh) ---
interface MeshClock {
  speed: number;
  paused: boolean;
  tick: number;
  simTimeMs: number;
  realStartMs: number;
  timer: ReturnType<typeof setInterval> | null;
}
const meshClocks = new Map<string, MeshClock>();

function broadcastClockTick(meshId: string, clock: MeshClock): void {
  clock.tick++;
  clock.simTimeMs += 60_000;
  const tickMsg: WSPushMessage = {
    type: "push",
    subtype: "system" as const,
    event: "tick",
    eventData: { tick: clock.tick, simTime: new Date(clock.simTimeMs).toISOString(), speed: clock.speed },
    messageId: crypto.randomUUID(),
    meshId,
    senderPubkey: "system",
    priority: "low",
    nonce: "",
    ciphertext: "",
    createdAt: new Date().toISOString(),
  };
  for (const [pid, peer] of connections) {
    if (peer.meshId !== meshId) continue;
    sendToPeer(pid, tickMsg);
  }
}

function startClockInterval(meshId: string, clock: MeshClock): void {
  if (clock.timer) clearInterval(clock.timer);
  const intervalMs = 60_000 / clock.speed;
  clock.timer = setInterval(() => broadcastClockTick(meshId, clock), intervalMs);
}

function makeClockStatus(clock: MeshClock, reqId?: string): WSServerMessage {
  return {
    type: "clock_status",
    speed: clock.speed,
    paused: clock.paused,
    tick: clock.tick,
    simTime: new Date(clock.simTimeMs).toISOString(),
    startedAt: new Date(clock.realStartMs).toISOString(),
    ...(reqId ? { _reqId: reqId } : {}),
  } as WSServerMessage;
}

// --- MCP proxy registry (in-memory, persistent-capable) ---
interface McpRegisteredServer {
  meshId: string;
  presenceId: string;
  serverName: string;
  description: string;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  hostedByName: string;
  persistent: boolean;
  online: boolean;
  memberId: string;
  registeredAt: string;
  offlineSince?: string;
}
/** Keyed by "meshId:serverName" */
const mcpRegistry = new Map<string, McpRegisteredServer>();

/** Human-readable relative time string from an ISO timestamp. */
function relativeTimeStr(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

/** Pending MCP call forwards: callId → { resolve, timer } */
const mcpCallResolvers = new Map<string, {
  resolve: (result: { result?: unknown; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

/// Scheduled messages: meshId → Map<scheduledId, entry>
interface ScheduledEntry {
  id: string;
  meshId: string;
  presenceId: string;
  memberId: string;
  to: string;
  message: string;
  deliverAt: number;
  createdAt: number;
  subtype?: "reminder";
  cron?: string;
  recurring?: boolean;
  firedCount: number;
  timer: ReturnType<typeof setTimeout>;
}
const scheduledMessages = new Map<string, ScheduledEntry>(); // keyed by scheduledId

// ---------------------------------------------------------------------------
// Minimal 5-field cron parser (minute hour dom month dow)
// Supports: numbers, *, */N, N-M, comma-separated lists
// ---------------------------------------------------------------------------

function parseCronField(field: string, min: number, max: number): number[] {
  const results = new Set<number>();
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(\S+)\/(\d+)$/);
    let range: string;
    let step: number;
    if (stepMatch) {
      range = stepMatch[1]!;
      step = parseInt(stepMatch[2]!, 10);
    } else {
      range = part;
      step = 1;
    }

    let start: number;
    let end: number;
    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      start = parseInt(a!, 10);
      end = parseInt(b!, 10);
    } else {
      start = parseInt(range, 10);
      end = start;
    }
    for (let i = start; i <= end; i += step) {
      if (i >= min && i <= max) results.add(i);
    }
  }
  return [...results].sort((a, b) => a - b);
}

/**
 * Given a 5-field cron expression and a reference Date, return the next
 * fire time as a Date. Scans minute-by-minute from `after` up to 366 days
 * ahead. Returns null if no match found (invalid expression).
 */
function cronNextFireTime(cronExpr: string, after: Date = new Date()): Date | null {
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const minutes = parseCronField(fields[0]!, 0, 59);
  const hours = parseCronField(fields[1]!, 0, 23);
  const doms = parseCronField(fields[2]!, 1, 31);
  const months = parseCronField(fields[3]!, 1, 12);
  const dows = parseCronField(fields[4]!, 0, 6); // 0 = Sunday

  if (!minutes.length || !hours.length || !doms.length || !months.length || !dows.length) {
    return null;
  }

  // Start from the next minute after `after`
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = after.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (candidate.getTime() < limit) {
    if (
      months.includes(candidate.getMonth() + 1) &&
      doms.includes(candidate.getDate()) &&
      dows.includes(candidate.getDay()) &&
      hours.includes(candidate.getHours()) &&
      minutes.includes(candidate.getMinutes())
    ) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Persist scheduled entry to DB
// ---------------------------------------------------------------------------

async function persistScheduledEntry(entry: ScheduledEntry): Promise<void> {
  await db.insert(scheduledMessageTable).values({
    id: entry.id,
    meshId: entry.meshId,
    presenceId: entry.presenceId,
    memberId: entry.memberId,
    to: entry.to,
    message: entry.message,
    deliverAt: entry.deliverAt ? new Date(entry.deliverAt) : null,
    cron: entry.cron ?? null,
    subtype: entry.subtype ?? null,
    firedCount: entry.firedCount,
    cancelled: false,
  });
}

async function markScheduledFired(id: string): Promise<void> {
  await db
    .update(scheduledMessageTable)
    .set({ firedAt: new Date(), firedCount: sql`${scheduledMessageTable.firedCount} + 1` })
    .where(eq(scheduledMessageTable.id, id));
}

async function markScheduledCancelled(id: string): Promise<void> {
  await db
    .update(scheduledMessageTable)
    .set({ cancelled: true })
    .where(eq(scheduledMessageTable.id, id));
}

async function updateScheduledNextFire(id: string, nextDeliverAt: Date, firedCount: number): Promise<void> {
  await db
    .update(scheduledMessageTable)
    .set({
      deliverAt: nextDeliverAt,
      firedCount,
      firedAt: new Date(),
    })
    .where(eq(scheduledMessageTable.id, id));
}
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

  // File download proxy: streams from MinIO so clients don't need internal URLs.
  // GET /download/{fileId}?mesh={meshId}
  if (req.method === "GET" && req.url?.startsWith("/download/")) {
    const parts = req.url.split("?");
    const fileId = parts[0]!.replace("/download/", "");
    const params = new URLSearchParams(parts[1] ?? "");
    const meshId = params.get("mesh");
    if (!fileId || !meshId) {
      writeJson(res, 400, { error: "fileId and ?mesh= required" });
      log.info("download", { route: "GET /download", status: 400, latency_ms: Date.now() - started });
      return;
    }
    getFile(meshId, fileId).then(async (file) => {
      if (!file) {
        writeJson(res, 404, { error: "file not found" });
        log.info("download", { route: "GET /download", status: 404, file_id: fileId, latency_ms: Date.now() - started });
        return;
      }
      const bucket = meshBucketName(meshId);
      const stream = await minioClient.getObject(bucket, file.minioKey);
      res.writeHead(200, {
        "Content-Type": file.mimeType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file.name}"`,
        "Cache-Control": "private, max-age=60",
      });
      stream.pipe(res);
      log.info("download", { route: "GET /download", file_id: fileId, name: file.name, latency_ms: Date.now() - started });
    }).catch((e) => {
      writeJson(res, 500, { error: "download failed" });
      log.error("download error", { file_id: fileId, error: e instanceof Error ? e.message : String(e) });
    });
    return;
  }

  // CLI sync: browser OAuth → broker creates members
  if (req.method === "POST" && req.url === "/cli-sync") {
    handleCliSyncPost(req, res, started);
    return;
  }

  // Telegram connect token (rate-limited: 10 requests/hour per IP)
  if (req.method === "POST" && req.url === "/tg/token") {
    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
    const tgRateBucket = `tg-token:${clientIp}`;
    const tgRateCount = (tgTokenRateLimit.get(tgRateBucket) ?? 0) + 1;
    tgTokenRateLimit.set(tgRateBucket, tgRateCount);
    if (tgRateCount > 10) {
      writeJson(res, 429, { error: "Rate limit exceeded. Max 10 tokens per hour." });
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const { meshId: tgMeshId, memberId: tgMemberId, pubkey: tgPubkey, secretKey: tgSecretKey } = body;
        if (!tgMeshId || !tgMemberId || !tgPubkey || !tgSecretKey) {
          writeJson(res, 400, { error: "meshId, memberId, pubkey, secretKey required" });
          return;
        }
        const encKey = process.env.BROKER_ENCRYPTION_KEY ?? env.BROKER_ENCRYPTION_KEY;
        if (!encKey) { writeJson(res, 500, { error: "broker not configured" }); return; }
        db.select({ slug: mesh.slug }).from(mesh).where(eq(mesh.id, tgMeshId)).limit(1).then(rows => {
          const meshSlug = rows[0]?.slug ?? tgMeshId;
          const token = generateTelegramConnectToken(
            { meshId: tgMeshId, meshSlug, memberId: tgMemberId, pubkey: tgPubkey, secretKey: tgSecretKey, createdBy: tgMemberId },
            encKey,
          );
          const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "claudemeshbot";
          const deepLink = generateDeepLink(token, botUsername);
          writeJson(res, 200, { token, deepLink });
          log.info("tg/token", { route: "POST /tg/token", mesh_id: tgMeshId, latency_ms: Date.now() - started });
        }).catch(() => writeJson(res, 500, { error: "token generation failed" }));
      } catch { writeJson(res, 400, { error: "invalid JSON" }); }
    });
    return;
  }

  // Member profile API
  const memberPatchMatch = req.method === "PATCH" && req.url?.match(/^\/mesh\/([^/]+)\/member\/([^/]+)$/);
  if (memberPatchMatch) {
    handleMemberPatchPost(req, res, memberPatchMatch[1]!, memberPatchMatch[2]!, started);
    return;
  }

  const membersListMatch = req.method === "GET" && req.url?.match(/^\/mesh\/([^/]+)\/members$/);
  if (membersListMatch) {
    handleMembersListGet(res, membersListMatch[1]!, started);
    return;
  }

  const meshSettingsMatch = req.method === "PATCH" && req.url?.match(/^\/mesh\/([^/]+)\/settings$/);
  if (meshSettingsMatch) {
    handleMeshSettingsPatch(req, res, meshSettingsMatch[1]!, started);
    return;
  }

  // Inbound webhook: POST /hook/:meshId/:secret
  const webhookMatch = req.method === "POST" && req.url?.match(/^\/hook\/([^/]+)\/([^/]+)$/);
  if (webhookMatch) {
    handleWebhookPost(req, res, webhookMatch[1]!, webhookMatch[2]!, started);
    return;
  }

  // --- Test endpoints for URL watch validation ---
  if (req.method === "GET" && req.url === "/test/clock") {
    writeJson(res, 200, { time: new Date().toISOString(), epoch: Date.now() });
    return;
  }
  if (req.method === "GET" && req.url === "/test/flip") {
    writeJson(res, 200, { value: Math.random() > 0.5 ? "heads" : "tails", at: Date.now() });
    return;
  }
  if (req.method === "GET" && req.url === "/test/html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body><h1>Updated at ${new Date().toISOString()}</h1><p>Counter: ${Date.now()}</p></body></html>`);
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

/**
 * Broadcast a push message to all connected peers in a mesh.
 * Returns the number of peers the message was delivered to.
 */
function broadcastToMesh(meshId: string, msg: WSPushMessage): number {
  let count = 0;
  for (const [pid, peer] of connections) {
    if (peer.meshId !== meshId) continue;
    sendToPeer(pid, msg);
    count++;
  }
  return count;
}

// --- CLI sync + member profile route handlers ---

function handleCliSyncPost(req: IncomingMessage, res: ServerResponse, started: number): void {
  const chunks: Buffer[] = [];
  let total = 0;
  let aborted = false;
  req.on("data", (chunk: Buffer) => {
    if (aborted) return;
    total += chunk.length;
    if (total > env.MAX_MESSAGE_BYTES) { aborted = true; writeJson(res, 413, { ok: false, error: "payload too large" }); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on("end", async () => {
    if (aborted) return;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as CliSyncRequest;
      const result = await handleCliSync(body);
      writeJson(res, result.ok ? 200 : 400, result);
      log.info("cli-sync", { route: "POST /cli-sync", ok: result.ok, latency_ms: Date.now() - started });
    } catch (e) {
      writeJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      log.error("cli-sync error", { error: e instanceof Error ? e.message : String(e) });
    }
  });
}

function handleMemberPatchPost(req: IncomingMessage, res: ServerResponse, meshId: string, memberId: string, started: number): void {
  const chunks: Buffer[] = [];
  let total = 0;
  let aborted = false;
  req.on("data", (chunk: Buffer) => {
    if (aborted) return;
    total += chunk.length;
    if (total > env.MAX_MESSAGE_BYTES) { aborted = true; writeJson(res, 413, { ok: false, error: "payload too large" }); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on("end", async () => {
    if (aborted) return;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      // Auth: callerMemberId from X-Member-Id header (dashboard or CLI provides this)
      const callerMemberId = req.headers["x-member-id"] as string | undefined;
      if (!callerMemberId) { writeJson(res, 401, { ok: false, error: "X-Member-Id header required" }); return; }
      const result = await updateMemberProfile(meshId, memberId, callerMemberId, body);
      writeJson(res, result.ok ? 200 : 400, result);
      // Push profile_updated to active WS connections for this member
      if (result.ok && result.changes) {
        for (const [pid, conn] of connections) {
          if (conn.meshId === meshId && conn.memberId === memberId) {
            sendToPeer(pid, { type: "push", subtype: "system", event: "profile_updated", eventData: result.changes, messageId: crypto.randomUUID(), meshId, senderPubkey: "system", priority: "low", nonce: "", ciphertext: "", createdAt: new Date().toISOString() } as any);
          }
        }
      }
      log.info("member-patch", { route: `PATCH /mesh/${meshId}/member/${memberId}`, ok: result.ok, latency_ms: Date.now() - started });
    } catch (e) {
      writeJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

function handleMembersListGet(res: ServerResponse, meshId: string, started: number): void {
  listMeshMembers(meshId).then((result) => {
    writeJson(res, result.ok ? 200 : 400, result);
    log.info("members-list", { route: `GET /mesh/${meshId}/members`, ok: result.ok, count: result.ok ? result.members.length : 0, latency_ms: Date.now() - started });
  }).catch((e) => {
    writeJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  });
}

function handleMeshSettingsPatch(req: IncomingMessage, res: ServerResponse, meshId: string, started: number): void {
  const chunks: Buffer[] = [];
  let total = 0;
  let aborted = false;
  req.on("data", (chunk: Buffer) => {
    if (aborted) return;
    total += chunk.length;
    if (total > env.MAX_MESSAGE_BYTES) { aborted = true; writeJson(res, 413, { ok: false, error: "payload too large" }); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on("end", async () => {
    if (aborted) return;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const callerMemberId = req.headers["x-member-id"] as string | undefined;
      if (!callerMemberId) { writeJson(res, 401, { ok: false, error: "X-Member-Id header required" }); return; }
      const result = await updateMeshSettings(meshId, callerMemberId, body);
      writeJson(res, result.ok ? 200 : 400, result);
      log.info("mesh-settings", { route: `PATCH /mesh/${meshId}/settings`, ok: result.ok, latency_ms: Date.now() - started });
    } catch (e) {
      writeJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

function handleWebhookPost(
  req: IncomingMessage,
  res: ServerResponse,
  meshId: string,
  secret: string,
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
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const result = await handleWebhook(meshId, secret, body, broadcastToMesh);
      writeJson(res, result.status, result.body);
      log.info("webhook", {
        route: `POST /hook/${meshId}/***`,
        status: result.status,
        delivered: result.body.delivered,
        latency_ms: Date.now() - started,
      });
    } catch (e) {
      writeJson(res, 400, { ok: false, error: "invalid JSON" });
      log.warn("webhook parse error", {
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

// --- Peer state persistence ---

async function savePeerState(conn: PeerConn, memberId: string, meshId: string): Promise<void> {
  try {
    // Read existing cumulative stats to merge
    const existing = await db
      .select()
      .from(peerState)
      .where(and(eq(peerState.meshId, meshId), eq(peerState.memberId, memberId)))
      .limit(1);

    const prev = existing[0]?.cumulativeStats as { messagesIn: number; messagesOut: number; toolCalls: number; errors: number } | null;
    const sessionStats = conn.stats ?? {};
    const cumulative = {
      messagesIn: (prev?.messagesIn ?? 0) + (sessionStats.messagesIn ?? 0),
      messagesOut: (prev?.messagesOut ?? 0) + (sessionStats.messagesOut ?? 0),
      toolCalls: (prev?.toolCalls ?? 0) + (sessionStats.toolCalls ?? 0),
      errors: (prev?.errors ?? 0) + (sessionStats.errors ?? 0),
    };

    const now = new Date();
    await db
      .insert(peerState)
      .values({
        meshId,
        memberId,
        groups: conn.groups,
        profile: conn.profile,
        visible: conn.visible,
        lastSummary: null, // will be set below if presence has a summary
        lastDisplayName: conn.displayName,
        cumulativeStats: cumulative,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [peerState.meshId, peerState.memberId],
        set: {
          groups: conn.groups,
          profile: conn.profile,
          visible: conn.visible,
          lastDisplayName: conn.displayName,
          cumulativeStats: cumulative,
          lastSeenAt: now,
          updatedAt: now,
        },
      });

    // Persist the summary from the presence row (it's set via setSummary, not on conn)
    const { presence } = await import("@turbostarter/db/schema/mesh");
    const presRows = await db
      .select({ summary: presence.summary })
      .from(presence)
      .where(and(eq(presence.memberId, memberId), isNull(presence.disconnectedAt)))
      .limit(1);
    if (presRows[0]?.summary) {
      await db
        .update(peerState)
        .set({ lastSummary: presRows[0].summary, updatedAt: now })
        .where(and(eq(peerState.meshId, meshId), eq(peerState.memberId, memberId)));
    }
  } catch (e) {
    log.warn("failed to save peer state", {
      mesh_id: meshId,
      member_id: memberId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function restorePeerState(
  meshId: string,
  memberId: string,
): Promise<{
  restored: boolean;
  groups?: Array<{ name: string; role?: string }>;
  profile?: { avatar?: string; title?: string; bio?: string; capabilities?: string[] };
  visible?: boolean;
  lastSummary?: string;
  lastDisplayName?: string;
  cumulativeStats?: { messagesIn: number; messagesOut: number; toolCalls: number; errors: number };
  lastSeenAt?: Date;
} | null> {
  try {
    const rows = await db
      .select()
      .from(peerState)
      .where(and(eq(peerState.meshId, meshId), eq(peerState.memberId, memberId)))
      .limit(1);
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      restored: true,
      groups: row.groups as Array<{ name: string; role?: string }> ?? [],
      profile: row.profile as { avatar?: string; title?: string; bio?: string; capabilities?: string[] } ?? {},
      visible: row.visible,
      lastSummary: row.lastSummary ?? undefined,
      lastDisplayName: row.lastDisplayName ?? undefined,
      cumulativeStats: row.cumulativeStats as { messagesIn: number; messagesOut: number; toolCalls: number; errors: number } ?? undefined,
      lastSeenAt: row.lastSeenAt ?? undefined,
    };
  } catch (e) {
    log.warn("failed to restore peer state", {
      mesh_id: meshId,
      member_id: memberId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
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

  // Load mesh for selfEditable policy (non-fatal if fails).
  let meshPolicy: Record<string, unknown> | undefined;
  try {
    const [m] = await db
      .select({ selfEditable: mesh.selfEditable })
      .from(mesh)
      .where(eq(mesh.id, hello.meshId));
    if (m?.selfEditable) meshPolicy = { selfEditable: m.selfEditable };
  } catch { /* non-fatal */ }

  // Attempt to restore persisted state from a previous session.
  const saved = await restorePeerState(hello.meshId, member.id);
  const helloHasGroups = hello.groups && hello.groups.length > 0;
  // Priority: hello groups > restored groups > member default groups.
  const initialGroups = helloHasGroups
    ? hello.groups!
    : (saved?.groups?.length ? saved.groups : (member.defaultGroups ?? []));
  const presenceId = await connectPresence({
    memberId: member.id,
    sessionId: hello.sessionId,
    sessionPubkey: hello.sessionPubkey,
    displayName: hello.displayName,
    pid: hello.pid,
    cwd: hello.cwd,
    groups: initialGroups,
  });
  const effectiveDisplayName = hello.displayName || member.displayName;
  connections.set(presenceId, {
    ws,
    meshId: hello.meshId,
    memberId: member.id,
    memberPubkey: hello.pubkey,
    sessionPubkey: hello.sessionPubkey ?? null,
    displayName: effectiveDisplayName,
    cwd: hello.cwd,
    hostname: hello.hostname,
    peerType: hello.peerType,
    channel: hello.channel,
    model: hello.model,
    groups: initialGroups,
    visible: saved?.visible ?? true,
    profile: saved?.profile ?? {},
  });
  incMeshCount(hello.meshId);
  void audit(hello.meshId, "peer_joined", member.id, effectiveDisplayName, {
    pubkey: hello.pubkey,
    groups: initialGroups,
    restored: !!saved,
  });
  log.info("ws hello", {
    mesh_id: hello.meshId,
    member: effectiveDisplayName,
    presence_id: presenceId,
    session_id: hello.sessionId,
    restored: !!saved,
  });
  // Drain any queued messages in the background. The hello_ack is
  // sent by the CALLER after it assigns presenceId — sending it here
  // races the caller's closure assignment, causing subsequent client
  // messages to fail the "no_hello" check.
  void maybePushQueuedMessages(presenceId);
  return {
    presenceId,
    memberDisplayName: effectiveDisplayName,
    memberProfile: {
      roleTag: member.roleTag,
      groups: member.defaultGroups ?? [],
      messageMode: member.messageMode ?? "push",
    },
    meshPolicy,
    restored: saved ? true : undefined,
    lastSummary: saved?.lastSummary,
    lastSeenAt: saved?.lastSeenAt?.toISOString(),
    restoredGroups: (!helloHasGroups && saved?.groups?.length) ? saved.groups : undefined,
    restoredStats: saved?.cumulativeStats,
  };
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
  void audit(conn.meshId, "message_sent", conn.memberId, conn.displayName, {
    targetSpec: msg.targetSpec,
    priority: msg.priority,
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
      // broadcast — skip hidden peers
      if (!peer.visible) continue;
    } else if (groupName) {
      // group routing — deliver only if peer is in the group; skip hidden
      if (!peer.visible) continue;
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
          const ackPayload: Record<string, unknown> = {
            type: "hello_ack",
            presenceId: result.presenceId,
            memberDisplayName: result.memberDisplayName,
            memberProfile: result.memberProfile,
            ...(result.meshPolicy ? { meshPolicy: result.meshPolicy } : {}),
          };
          if (result.restored) {
            ackPayload.restored = true;
            if (result.lastSummary) ackPayload.lastSummary = result.lastSummary;
            if (result.lastSeenAt) ackPayload.lastSeenAt = result.lastSeenAt;
            if (result.restoredGroups) ackPayload.restoredGroups = result.restoredGroups;
            if (result.restoredStats) ackPayload.restoredStats = result.restoredStats;
          }
          // Attach scope-filtered service catalog
          try {
            const helloConn = connections.get(presenceId);
            if (helloConn) {
              const allSvcs = await listDbMeshServices(helloConn.meshId);
              const myGroups = helloConn.groups ?? [];
              ackPayload.services = allSvcs
                .filter(svc => {
                  if (svc.status !== "running") return false;
                  const scope = svc.scope as any;
                  if (!scope) return false;
                  const t = typeof scope === "string" ? scope : scope.type;
                  if (t === "mesh") return true;
                  if (t === "peer") return svc.deployedBy === helloConn.memberId;
                  if (scope.peers) return scope.peers.includes(helloConn.displayName) || scope.peers.includes(helloConn.memberId);
                  if (scope.group) return myGroups.some((g: any) => g.name === scope.group);
                  if (scope.groups) return myGroups.some((g: any) => scope.groups.includes(g.name));
                  if (scope.role) return myGroups.some((g: any) => g.role === scope.role);
                  return false;
                })
                .map(s => ({
                  name: s.name,
                  description: s.description,
                  status: s.status ?? "stopped",
                  tools: (s.toolsSchema as any[]) ?? [],
                  deployed_by: s.deployedByName ?? "unknown",
                }));
            }
          } catch { /* non-fatal */ }

          ws.send(JSON.stringify(ackPayload));
        } catch {
          /* ws closed during hello */
        }
        // Broadcast peer_joined or peer_returned to all other peers in the same mesh.
        const joinedConn = connections.get(presenceId);
        if (joinedConn) {
          const isReturning = !!result.restored;
          const joinMsg: WSPushMessage = {
            type: "push",
            subtype: "system",
            event: isReturning ? "peer_returned" : "peer_joined",
            eventData: {
              name: result.memberDisplayName,
              pubkey: joinedConn.sessionPubkey ?? joinedConn.memberPubkey,
              groups: joinedConn.groups,
              ...(isReturning ? {
                lastSeenAt: result.lastSeenAt,
                summary: result.lastSummary,
              } : {}),
            },
            messageId: crypto.randomUUID(),
            meshId: joinedConn.meshId,
            senderPubkey: "system",
            priority: "low",
            nonce: "",
            ciphertext: "",
            createdAt: new Date().toISOString(),
          };
          for (const [pid, peer] of connections) {
            if (pid === presenceId) continue;
            if (peer.meshId !== joinedConn.meshId) continue;
            sendToPeer(pid, joinMsg);
          }
          // Restore persistent MCP servers owned by this member
          for (const [, entry] of mcpRegistry) {
            if (entry.memberId === joinedConn.memberId && entry.meshId === joinedConn.meshId && !entry.online) {
              entry.online = true;
              entry.presenceId = presenceId;
              entry.offlineSince = undefined;
              entry.hostedByName = joinedConn.displayName;
              // Broadcast restoration
              const restoreMsg: WSPushMessage = {
                type: "push",
                subtype: "system",
                event: "mcp_restored",
                eventData: { serverName: entry.serverName, hostedBy: joinedConn.displayName },
                messageId: crypto.randomUUID(),
                meshId: joinedConn.meshId,
                senderPubkey: "system",
                priority: "low",
                nonce: "",
                ciphertext: "",
                createdAt: new Date().toISOString(),
              };
              for (const [pid2, peer2] of connections) {
                if (peer2.meshId !== joinedConn.meshId) continue;
                sendToPeer(pid2, restoreMsg);
              }
              log.info("mcp_restored", { server: entry.serverName, member: joinedConn.displayName });
            }
          }
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
          // Build a lookup from pubkey → in-memory PeerConn for metadata
          const connByPubkey = new Map<string, PeerConn>();
          for (const [, pc] of connections) {
            if (pc.meshId === conn.meshId) {
              connByPubkey.set(pc.memberPubkey, pc);
              if (pc.sessionPubkey) connByPubkey.set(pc.sessionPubkey, pc);
            }
          }
          const resp: WSServerMessage = {
            type: "peers_list",
            peers: peers
              .filter((p) => {
                const pc = connByPubkey.get(p.pubkey);
                if (pc && !pc.visible && pc.memberPubkey !== conn.memberPubkey) return false;
                return true;
              })
              .map((p) => {
              const pc = connByPubkey.get(p.pubkey);
              return {
                pubkey: p.pubkey,
                displayName: p.displayName,
                status: p.status as "idle" | "working" | "dnd",
                summary: p.summary,
                groups: p.groups,
                sessionId: p.sessionId,
                connectedAt: p.connectedAt.toISOString(),
                cwd: pc?.cwd ?? p.cwd,
                ...(pc?.hostname ? { hostname: pc.hostname } : {}),
                ...(pc?.peerType ? { peerType: pc.peerType } : {}),
                ...(pc?.channel ? { channel: pc.channel } : {}),
                ...(pc?.model ? { model: pc.model } : {}),
                ...(pc?.stats ? { stats: pc.stats } : {}),
                ...(pc ? { visible: pc.visible } : {}),
                ...(pc?.profile && Object.keys(pc.profile).length > 0 ? { profile: pc.profile } : {}),
              };
            }),
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
        case "set_stats": {
          const sm = msg as Extract<WSClientMessage, { type: "set_stats" }>;
          conn.stats = sm.stats ?? {};
          log.info("ws set_stats", {
            presence_id: presenceId,
            stats: conn.stats,
          });
          break;
        }
        case "set_visible": {
          const sv = msg as Extract<WSClientMessage, { type: "set_visible" }>;
          conn.visible = sv.visible;
          // Broadcast visibility change to peers in same mesh
          const visEvent: WSPushMessage = {
            type: "push",
            subtype: "system",
            event: sv.visible ? "peer_visible" : "peer_hidden",
            eventData: {
              name: conn.displayName,
              pubkey: conn.sessionPubkey ?? conn.memberPubkey,
            },
            messageId: crypto.randomUUID(),
            meshId: conn.meshId,
            senderPubkey: "system",
            priority: "low",
            nonce: "",
            ciphertext: "",
            createdAt: new Date().toISOString(),
          };
          for (const [pid, peer] of connections) {
            if (pid === presenceId) continue;
            if (peer.meshId !== conn.meshId) continue;
            sendToPeer(pid, visEvent);
          }
          conn.ws.send(JSON.stringify({ type: "ack", id: _reqId ?? "", messageId: "", queued: false, ...(_reqId ? { _reqId } : {}) }));
          log.info("ws set_visible", { presence_id: presenceId, visible: sv.visible });
          break;
        }
        case "set_profile": {
          const sp = msg as Extract<WSClientMessage, { type: "set_profile" }>;
          if (sp.avatar !== undefined) conn.profile.avatar = sp.avatar;
          if (sp.title !== undefined) conn.profile.title = sp.title;
          if (sp.bio !== undefined) conn.profile.bio = sp.bio;
          if (sp.capabilities !== undefined) conn.profile.capabilities = sp.capabilities;
          conn.ws.send(JSON.stringify({ type: "ack", id: _reqId ?? "", messageId: "", queued: false, ...(_reqId ? { _reqId } : {}) }));
          log.info("ws set_profile", { presence_id: presenceId, profile: conn.profile });
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
          void audit(conn.meshId, "state_set", conn.memberId, conn.displayName, {
            key: ss.key,
            value: ss.value,
          });
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
          const isCron = !!sm.cron;

          // Compute first fire time
          let firstFireAt: number;
          if (isCron) {
            const next = cronNextFireTime(sm.cron!);
            if (!next) {
              sendError(conn.ws, "invalid_cron", `Invalid cron expression: ${sm.cron}`, undefined, _reqId);
              break;
            }
            firstFireAt = next.getTime();
          } else {
            firstFireAt = sm.deliverAt;
          }
          const delay = Math.max(0, firstFireAt - now);

          const armTimer = (entryId: string): ReturnType<typeof setTimeout> => {
            const fireEntry = scheduledMessages.get(entryId);
            const deliver = (): void => {
              const currentEntry = scheduledMessages.get(entryId);
              if (!currentEntry) return;

              // Find a connected peer in the same mesh to deliver through
              const conn2 = connections.get(currentEntry.presenceId);
              if (conn2) {
                const fakeMsg: Extract<WSClientMessage, { type: "send" }> = {
                  type: "send",
                  id: crypto.randomUUID(),
                  targetSpec: currentEntry.to,
                  priority: "now",
                  nonce: "",
                  ciphertext: Buffer.from(currentEntry.message, "utf-8").toString("base64"),
                };
                handleSend(conn2, fakeMsg, currentEntry.subtype).catch((e) =>
                  log.warn("scheduled delivery error", { scheduled_id: entryId, error: String(e) }),
                );
              } else {
                log.warn("scheduled delivery skipped — sender offline", { scheduled_id: entryId });
              }
              log.info("ws schedule deliver", { scheduled_id: entryId, to: currentEntry.to, cron: !!currentEntry.cron });

              if (currentEntry.cron) {
                // Recurring: bump firedCount, compute next fire, re-arm
                currentEntry.firedCount += 1;
                const nextFire = cronNextFireTime(currentEntry.cron);
                if (nextFire) {
                  currentEntry.deliverAt = nextFire.getTime();
                  currentEntry.timer = armTimer(entryId);
                  updateScheduledNextFire(entryId, nextFire, currentEntry.firedCount).catch((e) =>
                    log.warn("scheduled DB update error", { scheduled_id: entryId, error: String(e) }),
                  );
                } else {
                  // Cron exhausted (shouldn't happen for standard expressions)
                  scheduledMessages.delete(entryId);
                  markScheduledFired(entryId).catch(() => {});
                }
              } else {
                // One-shot: clean up
                scheduledMessages.delete(entryId);
                markScheduledFired(entryId).catch((e) =>
                  log.warn("scheduled DB fire update error", { scheduled_id: entryId, error: String(e) }),
                );
              }
            };

            const currentEntry2 = fireEntry ?? scheduledMessages.get(entryId);
            const d = currentEntry2 ? Math.max(0, currentEntry2.deliverAt - Date.now()) : delay;
            return setTimeout(deliver, d);
          };

          const entry: ScheduledEntry = {
            id: scheduledId,
            meshId: conn.meshId,
            presenceId,
            memberId: conn.memberId,
            to: sm.to,
            message: sm.message,
            deliverAt: firstFireAt,
            createdAt: now,
            firedCount: 0,
            ...(sm.subtype ? { subtype: sm.subtype } : {}),
            ...(isCron ? { cron: sm.cron, recurring: true } : {}),
            timer: undefined as unknown as ReturnType<typeof setTimeout>,
          };
          scheduledMessages.set(scheduledId, entry);
          entry.timer = armTimer(scheduledId);

          // Persist to DB
          persistScheduledEntry(entry).catch((e) =>
            log.warn("scheduled DB persist error", { scheduled_id: scheduledId, error: String(e) }),
          );

          sendToPeer(presenceId, {
            type: "scheduled_ack",
            scheduledId,
            deliverAt: firstFireAt,
            ...(isCron ? { cron: sm.cron } : {}),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws schedule", {
            presence_id: presenceId,
            scheduled_id: scheduledId,
            delay_ms: delay,
            to: sm.to,
            cron: sm.cron ?? null,
          });
          break;
        }

        case "list_scheduled": {
          const mine = [...scheduledMessages.values()]
            .filter((e) => e.meshId === conn.meshId && (e.presenceId === presenceId || e.memberId === conn.memberId))
            .map((e) => ({
              id: e.id,
              to: e.to,
              message: e.message,
              deliverAt: e.deliverAt,
              createdAt: e.createdAt,
              ...(e.cron ? { cron: e.cron, firedCount: e.firedCount } : {}),
            }));
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
          if (entry && entry.meshId === conn.meshId && (entry.presenceId === presenceId || entry.memberId === conn.memberId)) {
            clearTimeout(entry.timer);
            scheduledMessages.delete(cs.scheduledId);
            markScheduledCancelled(cs.scheduledId).catch((e) =>
              log.warn("scheduled DB cancel error", { scheduled_id: cs.scheduledId, error: String(e) }),
            );
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


        // --- Audit log ---
        case "audit_query": {
          const aq = msg as Extract<WSClientMessage, { type: "audit_query" }>;
          try {
            const result = await queryAuditLog(conn.meshId, {
              limit: aq.limit,
              offset: aq.offset,
              eventType: aq.eventType,
            });
            sendToPeer(presenceId, {
              type: "audit_result",
              entries: result.entries,
              total: result.total,
              ...(_reqId ? { _reqId } : {}),
            });
          } catch (e) {
            sendError(conn.ws, "audit_query_error", e instanceof Error ? e.message : String(e), undefined, _reqId);
          }
          log.info("ws audit_query", { presence_id: presenceId, mesh_id: conn.meshId });
          break;
        }
        case "audit_verify": {
          try {
            const result = await verifyChain(conn.meshId);
            sendToPeer(presenceId, {
              type: "audit_verify_result",
              valid: result.valid,
              entries: result.entries,
              ...(result.brokenAt !== undefined ? { brokenAt: result.brokenAt } : {}),
              ...(_reqId ? { _reqId } : {}),
            });
          } catch (e) {
            sendError(conn.ws, "audit_verify_error", e instanceof Error ? e.message : String(e), undefined, _reqId);
          }
          log.info("ws audit_verify", { presence_id: presenceId, mesh_id: conn.meshId });
          break;
        }

        // --- Simulation clock ---
        case "set_clock": {
          const sc = msg as Extract<WSClientMessage, { type: "set_clock" }>;
          const speed = Math.max(1, Math.min(100, Number(sc.speed) || 1));
          let clock = meshClocks.get(conn.meshId);
          if (!clock) {
            clock = {
              speed,
              paused: false,
              tick: 0,
              simTimeMs: Date.now(),
              realStartMs: Date.now(),
              timer: null,
            };
            meshClocks.set(conn.meshId, clock);
          } else {
            clock.speed = speed;
          }
          if (!clock.paused) {
            startClockInterval(conn.meshId, clock);
          }
          sendToPeer(presenceId, makeClockStatus(clock, _reqId));
          log.info("ws set_clock", { presence_id: presenceId, mesh_id: conn.meshId, speed });
          break;
        }

        case "pause_clock": {
          const clock = meshClocks.get(conn.meshId);
          if (clock) {
            clock.paused = true;
            if (clock.timer) { clearInterval(clock.timer); clock.timer = null; }
          }
          sendToPeer(presenceId, clock
            ? makeClockStatus(clock, _reqId)
            : { type: "error", code: "no_clock", message: "No clock running for this mesh", ...(_reqId ? { _reqId } : {}) } as WSServerMessage);
          log.info("ws pause_clock", { presence_id: presenceId, mesh_id: conn.meshId });
          break;
        }

        case "resume_clock": {
          const clock = meshClocks.get(conn.meshId);
          if (clock && clock.paused) {
            clock.paused = false;
            startClockInterval(conn.meshId, clock);
          }
          sendToPeer(presenceId, clock
            ? makeClockStatus(clock, _reqId)
            : { type: "error", code: "no_clock", message: "No clock running for this mesh", ...(_reqId ? { _reqId } : {}) } as WSServerMessage);
          log.info("ws resume_clock", { presence_id: presenceId, mesh_id: conn.meshId });
          break;
        }

        case "get_clock": {
          const clock = meshClocks.get(conn.meshId);
          sendToPeer(presenceId, clock
            ? makeClockStatus(clock, _reqId)
            : { type: "clock_status", speed: 0, paused: true, tick: 0, simTime: new Date().toISOString(), startedAt: new Date().toISOString(), ...(_reqId ? { _reqId } : {}) } as WSServerMessage);
          log.info("ws get_clock", { presence_id: presenceId, mesh_id: conn.meshId });
          break;
        }

        // --- MCP proxy ---
        case "mcp_register": {
          const mr = msg as Extract<WSClientMessage, { type: "mcp_register" }>;
          const regKey = `${conn.meshId}:${mr.serverName}`;
          mcpRegistry.set(regKey, {
            meshId: conn.meshId,
            presenceId: presenceId,
            serverName: mr.serverName,
            description: mr.description,
            tools: mr.tools,
            hostedByName: conn.displayName,
            persistent: !!mr.persistent,
            online: true,
            memberId: conn.memberId,
            registeredAt: new Date().toISOString(),
          });
          sendToPeer(presenceId, {
            type: "mcp_register_ack",
            serverName: mr.serverName,
            toolCount: mr.tools.length,
            ...(_reqId ? { _reqId } : {}),
          });
          // Broadcast to all peers: new MCP server available
          const mcpJoinMsg: WSServerMessage = {
            type: "push",
            subtype: "system",
            event: "mcp_registered",
            eventData: { serverName: mr.serverName, description: mr.description, tools: mr.tools.map(t => t.name), hostedBy: conn.displayName },
            messageId: crypto.randomUUID(),
            meshId: conn.meshId,
            senderPubkey: "system",
            priority: "low",
            nonce: "",
            ciphertext: "",
            createdAt: new Date().toISOString(),
          };
          for (const [pid, peer] of connections) {
            if (pid === presenceId) continue;
            if (peer.meshId !== conn.meshId) continue;
            sendToPeer(pid, mcpJoinMsg);
          }
          log.info("ws mcp_register", {
            presence_id: presenceId,
            server: mr.serverName,
            tools: mr.tools.length,
          });
          break;
        }
        case "mcp_unregister": {
          const mu = msg as Extract<WSClientMessage, { type: "mcp_unregister" }>;
          const unregKey = `${conn.meshId}:${mu.serverName}`;
          const entry = mcpRegistry.get(unregKey);
          if (entry && entry.presenceId === presenceId) {
            mcpRegistry.delete(unregKey);
            // Broadcast: MCP server removed
            const mcpLeaveMsg: WSServerMessage = {
              type: "push",
              subtype: "system",
              event: "mcp_unregistered",
              eventData: { serverName: mu.serverName, hostedBy: conn.displayName },
              messageId: crypto.randomUUID(),
              meshId: conn.meshId,
              senderPubkey: "system",
              priority: "low",
              nonce: "",
              ciphertext: "",
              createdAt: new Date().toISOString(),
            };
            for (const [pid, peer] of connections) {
              if (pid === presenceId) continue;
              if (peer.meshId !== conn.meshId) continue;
              sendToPeer(pid, mcpLeaveMsg);
            }
          }
          log.info("ws mcp_unregister", {
            presence_id: presenceId,
            server: mu.serverName,
          });
          break;
        }
        case "mcp_list": {
          const servers: Array<{
            name: string;
            description: string;
            hostedBy: string;
            tools: Array<{ name: string; description: string }>;
            online: boolean;
            offlineSince?: string;
          }> = [];
          for (const [, entry] of mcpRegistry) {
            if (entry.meshId !== conn.meshId) continue;
            servers.push({
              name: entry.serverName,
              description: entry.description,
              hostedBy: entry.hostedByName,
              tools: entry.tools.map((t) => ({ name: t.name, description: t.description })),
              online: entry.online,
              ...(entry.offlineSince ? { offlineSince: entry.offlineSince } : {}),
            });
          }
          sendToPeer(presenceId, {
            type: "mcp_list_result",
            servers,
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws mcp_list", {
            presence_id: presenceId,
            count: servers.length,
          });
          break;
        }
        case "mcp_call": {
          const mc = msg as Extract<WSClientMessage, { type: "mcp_call" }>;
          const callKey = `${conn.meshId}:${mc.serverName}`;

          // Check managed services first (runner-hosted)
          const managedSvc = await getService(conn.meshId, mc.serverName);
          if (managedSvc && managedSvc.status === "running") {
            try {
              const runnerRes = await fetch(`${env.RUNNER_URL}/call`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: mc.serverName, tool: mc.toolName, args: mc.args ?? {} }),
              });
              const result = await runnerRes.json() as { result?: unknown; error?: string };
              sendToPeer(presenceId, {
                type: "mcp_call_result",
                ...(result.result !== undefined ? { result: result.result } : {}),
                ...(result.error ? { error: result.error } : {}),
                ...(_reqId ? { _reqId } : {}),
              } as any);
            } catch (e) {
              sendToPeer(presenceId, {
                type: "mcp_call_result",
                error: `runner call failed: ${e instanceof Error ? e.message : String(e)}`,
                ...(_reqId ? { _reqId } : {}),
              } as any);
            }
            break;
          }

          // Fall back to live-proxy (peer-hosted) MCP registry
          const server = mcpRegistry.get(callKey);
          if (!server) {
            sendToPeer(presenceId, {
              type: "mcp_call_result",
              error: `MCP server "${mc.serverName}" not found in mesh`,
              ...(_reqId ? { _reqId } : {}),
            });
            break;
          }
          // Check if server is offline (persistent but host disconnected)
          if (!server.online) {
            const ago = server.offlineSince
              ? ` who disconnected ${relativeTimeStr(server.offlineSince)}`
              : "";
            sendToPeer(presenceId, {
              type: "mcp_call_result",
              error: `Server '${mc.serverName}' is offline — hosted by ${server.hostedByName}${ago}. It will restore when they reconnect.`,
              ...(_reqId ? { _reqId } : {}),
            });
            break;
          }
          // Check hosting peer is still connected
          const hostConn = connections.get(server.presenceId);
          if (!hostConn) {
            if (server.persistent) {
              server.online = false;
              server.offlineSince = new Date().toISOString();
              server.presenceId = "";
            } else {
              mcpRegistry.delete(callKey);
            }
            sendToPeer(presenceId, {
              type: "mcp_call_result",
              error: `MCP server "${mc.serverName}" host disconnected`,
              ...(_reqId ? { _reqId } : {}),
            });
            break;
          }
          // Forward the call to the hosting peer
          const callId = crypto.randomUUID();
          const callPromise = new Promise<{ result?: unknown; error?: string }>((resolve) => {
            const timer = setTimeout(() => {
              if (mcpCallResolvers.delete(callId)) {
                resolve({ error: "MCP call timed out (30s)" });
              }
            }, 30_000);
            mcpCallResolvers.set(callId, { resolve, timer });
          });
          sendToPeer(server.presenceId, {
            type: "mcp_call_forward",
            callId,
            serverName: mc.serverName,
            toolName: mc.toolName,
            args: mc.args,
            callerName: conn.displayName,
          });
          // Wait for response from hosting peer
          const callResult = await callPromise;
          sendToPeer(presenceId, {
            type: "mcp_call_result",
            ...(callResult.result !== undefined ? { result: callResult.result } : {}),
            ...(callResult.error ? { error: callResult.error } : {}),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws mcp_call", {
            presence_id: presenceId,
            server: mc.serverName,
            tool: mc.toolName,
            ok: !callResult.error,
          });
          break;
        }
        case "mcp_call_response": {
          const mcr = msg as Extract<WSClientMessage, { type: "mcp_call_response" }>;
          const resolver = mcpCallResolvers.get(mcr.callId);
          if (resolver) {
            clearTimeout(resolver.timer);
            mcpCallResolvers.delete(mcr.callId);
            resolver.resolve({
              ...(mcr.result !== undefined ? { result: mcr.result } : {}),
              ...(mcr.error ? { error: mcr.error } : {}),
            });
          }
          break;
        }

        // --- Skills ---
        case "share_skill": {
          const sk = msg as Extract<WSClientMessage, { type: "share_skill" }>;
          const memberInfo = conn.memberPubkey
            ? await findMemberByPubkey(conn.meshId, conn.memberPubkey)
            : null;
          await shareSkill(
            conn.meshId,
            sk.name,
            sk.description,
            sk.instructions,
            sk.tags ?? [],
            memberInfo?.id,
            memberInfo?.displayName,
            (sk as any).manifest,
          );
          sendToPeer(presenceId, {
            type: "skill_ack",
            name: sk.name,
            action: "shared",
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws share_skill", { presence_id: presenceId, name: sk.name });
          break;
        }
        case "get_skill": {
          const gs = msg as Extract<WSClientMessage, { type: "get_skill" }>;
          const skill = await getSkill(conn.meshId, gs.name);
          sendToPeer(presenceId, {
            type: "skill_data",
            skill: skill
              ? {
                  name: skill.name,
                  description: skill.description,
                  instructions: skill.instructions,
                  tags: skill.tags,
                  author: skill.author,
                  manifest: skill.manifest,
                  createdAt: skill.createdAt.toISOString(),
                }
              : null,
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws get_skill", { presence_id: presenceId, name: gs.name, found: !!skill });
          break;
        }
        case "list_skills": {
          const ls = msg as Extract<WSClientMessage, { type: "list_skills" }>;
          const skills = await listSkills(conn.meshId, ls.query);
          sendToPeer(presenceId, {
            type: "skill_list",
            skills: skills.map((s) => ({
              name: s.name,
              description: s.description,
              tags: s.tags,
              author: s.author,
              createdAt: s.createdAt.toISOString(),
            })),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws list_skills", { presence_id: presenceId, query: ls.query ?? "", count: skills.length });
          break;
        }
        case "remove_skill": {
          const rs = msg as Extract<WSClientMessage, { type: "remove_skill" }>;
          const removed = await removeSkill(conn.meshId, rs.name);
          sendToPeer(presenceId, {
            type: "skill_ack",
            name: rs.name,
            action: removed ? "removed" : "not_found",
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws remove_skill", { presence_id: presenceId, name: rs.name, removed });
          break;
        }

        // --- Peer file sharing relay ---
        case "peer_file_request": {
          const fr = msg as Extract<WSClientMessage, { type: "peer_file_request" }>;
          let targetPid: string | null = null;
          for (const [pid, peer] of connections) {
            if (peer.meshId !== conn.meshId) continue;
            if (peer.memberPubkey === fr.targetPubkey || peer.sessionPubkey === fr.targetPubkey) {
              targetPid = pid;
              break;
            }
          }
          if (!targetPid) {
            sendError(conn.ws, "peer_not_found", "target peer not connected", undefined, _reqId);
            break;
          }
          sendToPeer(targetPid, {
            type: "peer_file_request_forward",
            requesterPubkey: conn.sessionPubkey ?? conn.memberPubkey,
            filePath: fr.filePath,
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws peer_file_request", { presence_id: presenceId, target: fr.targetPubkey.slice(0, 12), path: fr.filePath });
          break;
        }
        case "peer_file_response": {
          const fr = msg as Extract<WSClientMessage, { type: "peer_file_response" }>;
          let requesterPid: string | null = null;
          for (const [pid, peer] of connections) {
            if (peer.meshId !== conn.meshId) continue;
            if (peer.memberPubkey === fr.requesterPubkey || peer.sessionPubkey === fr.requesterPubkey) {
              requesterPid = pid;
              break;
            }
          }
          if (!requesterPid) break; // requester disconnected
          sendToPeer(requesterPid, {
            type: "peer_file_response_forward",
            filePath: fr.filePath,
            ...(fr.content !== undefined ? { content: fr.content } : {}),
            ...(fr.error ? { error: fr.error } : {}),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws peer_file_response", { presence_id: presenceId, requester: fr.requesterPubkey.slice(0, 12), path: fr.filePath, hasError: !!fr.error });
          break;
        }
        case "peer_dir_request": {
          const dr = msg as Extract<WSClientMessage, { type: "peer_dir_request" }>;
          let targetPid: string | null = null;
          for (const [pid, peer] of connections) {
            if (peer.meshId !== conn.meshId) continue;
            if (peer.memberPubkey === dr.targetPubkey || peer.sessionPubkey === dr.targetPubkey) {
              targetPid = pid;
              break;
            }
          }
          if (!targetPid) {
            sendError(conn.ws, "peer_not_found", "target peer not connected", undefined, _reqId);
            break;
          }
          sendToPeer(targetPid, {
            type: "peer_dir_request_forward",
            requesterPubkey: conn.sessionPubkey ?? conn.memberPubkey,
            dirPath: dr.dirPath,
            ...(dr.pattern ? { pattern: dr.pattern } : {}),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws peer_dir_request", { presence_id: presenceId, target: dr.targetPubkey.slice(0, 12), path: dr.dirPath });
          break;
        }
        case "peer_dir_response": {
          const dr = msg as Extract<WSClientMessage, { type: "peer_dir_response" }>;
          let requesterPid: string | null = null;
          for (const [pid, peer] of connections) {
            if (peer.meshId !== conn.meshId) continue;
            if (peer.memberPubkey === dr.requesterPubkey || peer.sessionPubkey === dr.requesterPubkey) {
              requesterPid = pid;
              break;
            }
          }
          if (!requesterPid) break;
          sendToPeer(requesterPid, {
            type: "peer_dir_response_forward",
            dirPath: dr.dirPath,
            ...(dr.entries ? { entries: dr.entries } : {}),
            ...(dr.error ? { error: dr.error } : {}),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws peer_dir_response", { presence_id: presenceId, requester: dr.requesterPubkey.slice(0, 12), path: dr.dirPath });
          break;
        }

        // --- Webhook CRUD ---
        case "create_webhook": {
          const cw = msg as Extract<WSClientMessage, { type: "create_webhook" }>;
          if (!cw.name) {
            sendError(conn.ws, "invalid_webhook", "name is required", undefined, _reqId);
            break;
          }
          const webhookSecret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
          try {
            await db.insert(meshWebhook).values({
              meshId: conn.meshId,
              name: cw.name,
              secret: webhookSecret,
              createdBy: conn.memberId,
            });
          } catch (dupErr: any) {
            if (dupErr?.code === "23505" || dupErr?.message?.includes("unique")) {
              sendError(conn.ws, "webhook_exists", `Webhook "${cw.name}" already exists in this mesh`, undefined, _reqId);
              break;
            }
            throw dupErr;
          }
          const webhookUrl = `https://ic.claudemesh.com/hook/${conn.meshId}/${webhookSecret}`;
          sendToPeer(presenceId, {
            type: "webhook_ack",
            name: cw.name,
            url: webhookUrl,
            secret: webhookSecret,
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws create_webhook", { presence_id: presenceId, name: cw.name });
          break;
        }
        case "list_webhooks": {
          const whRows = await db
            .select({
              name: meshWebhook.name,
              secret: meshWebhook.secret,
              active: meshWebhook.active,
              createdAt: meshWebhook.createdAt,
            })
            .from(meshWebhook)
            .where(and(eq(meshWebhook.meshId, conn.meshId), eq(meshWebhook.active, true)));
          sendToPeer(presenceId, {
            type: "webhook_list",
            webhooks: whRows.map((r) => ({
              name: r.name,
              url: `https://ic.claudemesh.com/hook/${conn.meshId}/${r.secret}`,
              active: r.active,
              createdAt: r.createdAt.toISOString(),
            })),
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws list_webhooks", { presence_id: presenceId, count: whRows.length });
          break;
        }
        case "delete_webhook": {
          const dw = msg as Extract<WSClientMessage, { type: "delete_webhook" }>;
          await db
            .update(meshWebhook)
            .set({ active: false })
            .where(and(eq(meshWebhook.meshId, conn.meshId), eq(meshWebhook.name, dw.name)));
          sendToPeer(presenceId, {
            type: "webhook_ack",
            name: dw.name,
            url: "",
            secret: "",
            ...(_reqId ? { _reqId } : {}),
          });
          log.info("ws delete_webhook", { presence_id: presenceId, name: dw.name });
          break;
        }

        // --- Vault ---
        case "vault_set": {
          const vs = msg as any;
          try {
            await vaultSet(conn.meshId, conn.memberId, vs.key, vs.ciphertext, vs.nonce, vs.sealed_key, vs.entry_type, vs.mount_path, vs.description);
            sendToPeer(presenceId, { type: "vault_ack", key: vs.key, action: "stored", _reqId: vs._reqId } as any);
          } catch (e) { sendError(ws, "vault_error", e instanceof Error ? e.message : String(e), undefined, vs._reqId); }
          break;
        }
        case "vault_list": {
          try {
            const entries = await vaultList(conn.meshId, conn.memberId);
            sendToPeer(presenceId, { type: "vault_list_result", entries: entries.map((e: any) => ({ key: e.key, entry_type: e.entryType, mount_path: e.mountPath, description: e.description, updated_at: e.updatedAt?.toISOString() })), _reqId: (msg as any)._reqId } as any);
          } catch (e) { sendError(ws, "vault_error", e instanceof Error ? e.message : String(e), undefined, (msg as any)._reqId); }
          break;
        }
        case "vault_delete": {
          const vd = msg as any;
          try {
            const ok = await vaultDelete(conn.meshId, conn.memberId, vd.key);
            sendToPeer(presenceId, { type: "vault_ack", key: vd.key, action: ok ? "deleted" : "not_found", _reqId: vd._reqId } as any);
          } catch (e) { sendError(ws, "vault_error", e instanceof Error ? e.message : String(e), undefined, vd._reqId); }
          break;
        }

        case "vault_get": {
          const vg = msg as any;
          try {
            const entries = await vaultGetEntries(conn.meshId, conn.memberId, vg.keys ?? []);
            sendToPeer(presenceId, { type: "vault_get_result", entries: entries.map((e: any) => ({ key: e.key, ciphertext: e.ciphertext, nonce: e.nonce, sealed_key: e.sealedKey, entry_type: e.entryType, mount_path: e.mountPath })), _reqId: vg._reqId } as any);
          } catch (e) { sendError(ws, "vault_error", e instanceof Error ? e.message : String(e), undefined, vg._reqId); }
          break;
        }

        // --- MCP Deploy/Undeploy ---
        case "mcp_deploy": {
          const md = msg as any;
          try {
            // Validate service name (path traversal protection)
            const nameError = serviceManager.validateServiceName(md.server_name ?? "");
            if (nameError) {
              sendError(ws, "invalid_name", nameError, undefined, md._reqId);
              break;
            }
            const existing = await listDbMeshServices(conn.meshId);
            if (existing.length >= env.MAX_SERVICES_PER_MESH) {
              sendError(ws, "limit", `max ${env.MAX_SERVICES_PER_MESH} services per mesh`, undefined, md._reqId);
              break;
            }
            // Encrypt env vars at rest (broker-side AES-256-GCM)
            const deployConfig = { ...(md.config ?? {}) };
            if (deployConfig.env && Object.keys(deployConfig.env).length > 0) {
              const { encryptForStorage } = await import("./broker-crypto");
              deployConfig._encryptedEnv = encryptForStorage(JSON.stringify(deployConfig.env));
              delete deployConfig.env; // don't store plaintext in DB
            }
            await upsertService(conn.meshId, md.server_name, {
              type: "mcp", sourceType: md.source.type, description: `MCP server: ${md.server_name}`,
              sourceFileId: md.source.type === "zip" ? md.source.file_id : undefined,
              sourceGitUrl: md.source.type === "git" ? md.source.url : undefined,
              sourceGitBranch: md.source.type === "git" ? md.source.branch : undefined,
              runtime: md.config?.runtime, status: "building", config: deployConfig,
              scope: md.scope ?? "peer", deployedBy: conn.memberId, deployedByName: conn.displayName,
            });
            sendToPeer(presenceId, { type: "mcp_deploy_status", server_name: md.server_name, status: "building", _reqId: md._reqId } as any);
            log.info("ws mcp_deploy", { presence_id: presenceId, name: md.server_name, source: md.source.type });

            // --- Source extraction + runner spawn (async, non-blocking) ---
            (async () => {
              try {
                // Resolve env vars (decrypted by CLI, sent as plaintext over TLS)
                const resolvedEnv = md.config?.env ?? {};

                // Build runner load payload — runner handles git clone / npm install
                const loadPayload: Record<string, unknown> = {
                  name: md.server_name,
                  env: resolvedEnv,
                  runtime: md.config?.runtime,
                };
                if (md.source.type === "git") {
                  loadPayload.gitUrl = md.source.url;
                  loadPayload.gitBranch = md.source.branch;
                } else if (md.source.type === "npx") {
                  loadPayload.npxPackage = md.source.package ?? md.server_name;
                } else if (md.source.type === "zip" && md.source.file_id) {
                  // TODO: download zip from MinIO, upload to runner via multipart
                  // For now, zip deploy requires shared volume
                  loadPayload.sourcePath = `${env.CLAUDEMESH_SERVICES_DIR}/${conn.meshId}/${md.server_name}/source`;
                }

                // Call runner HTTP API to load the service
                const runnerRes = await fetch(`${env.RUNNER_URL}/load`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(loadPayload),
                });
                const runnerResult = await runnerRes.json() as { status?: string; tools?: any[]; error?: string };

                if (!runnerRes.ok || runnerResult.error) {
                  await updateServiceStatus(conn.meshId, md.server_name, "failed");
                  sendToPeer(presenceId, { type: "mcp_deploy_status", server_name: md.server_name, status: "failed", error: runnerResult.error, _reqId: md._reqId } as any);
                  log.error("runner load failed", { name: md.server_name, error: runnerResult.error });
                  return;
                }

                // Update DB with tools and running status
                await updateServiceStatus(conn.meshId, md.server_name, "running", {
                  toolsSchema: runnerResult.tools,
                });
                sendToPeer(presenceId, { type: "mcp_deploy_status", server_name: md.server_name, status: "running", tools: runnerResult.tools, _reqId: md._reqId } as any);
                broadcastToMesh(conn.meshId, {
                  type: "push", subtype: "system" as const, event: "mcp_deployed",
                  eventData: { name: md.server_name, description: `MCP server: ${md.server_name}`, tool_count: runnerResult.tools?.length ?? 0, deployed_by: conn.displayName, scope: md.scope ?? "peer", tools: runnerResult.tools },
                  messageId: crypto.randomUUID(), meshId: conn.meshId, senderPubkey: "system",
                  priority: "low", nonce: "", ciphertext: "", createdAt: new Date().toISOString(),
                });
                log.info("service deployed", { name: md.server_name, tools: runnerResult.tools?.length ?? 0 });
              } catch (e) {
                await updateServiceStatus(conn.meshId, md.server_name, "failed").catch(() => {});
                sendToPeer(presenceId, { type: "mcp_deploy_status", server_name: md.server_name, status: "failed", error: e instanceof Error ? e.message : String(e), _reqId: md._reqId } as any);
                log.error("deploy pipeline failed", { name: md.server_name, error: e instanceof Error ? e.message : String(e) });
              }
            })();
          } catch (e) { sendError(ws, "deploy_error", e instanceof Error ? e.message : String(e), undefined, md._reqId); }
          break;
        }
        case "mcp_undeploy": {
          const mu = msg as any;
          try {
            await serviceManager.undeploy(conn.meshId, mu.server_name);
            await deleteService(conn.meshId, mu.server_name);
            sendToPeer(presenceId, { type: "mcp_deploy_status", server_name: mu.server_name, status: "stopped", _reqId: mu._reqId } as any);
            broadcastToMesh(conn.meshId, {
              type: "push", subtype: "system" as const, event: "mcp_undeployed",
              eventData: { name: mu.server_name, by: conn.displayName },
              messageId: crypto.randomUUID(), meshId: conn.meshId, senderPubkey: "system",
              priority: "low", nonce: "", ciphertext: "", createdAt: new Date().toISOString(),
            });
            log.info("ws mcp_undeploy", { presence_id: presenceId, name: mu.server_name });
          } catch (e) { sendError(ws, "undeploy_error", e instanceof Error ? e.message : String(e), undefined, mu._reqId); }
          break;
        }
        case "mcp_update": {
          const mup = msg as any;
          sendToPeer(presenceId, { type: "mcp_deploy_status", server_name: mup.server_name, status: "building", _reqId: mup._reqId } as any);
          log.info("ws mcp_update", { presence_id: presenceId, name: mup.server_name });
          break;
        }
        case "mcp_logs": {
          const ml = msg as any;
          const lines = serviceManager.getLogs(conn.meshId, ml.server_name, ml.lines);
          sendToPeer(presenceId, { type: "mcp_logs_result", server_name: ml.server_name, lines, _reqId: ml._reqId } as any);
          break;
        }
        case "mcp_scope": {
          const ms = msg as any;
          try {
            if (ms.scope !== undefined) {
              await updateServiceScope(conn.meshId, ms.server_name, ms.scope);
              broadcastToMesh(conn.meshId, {
                type: "push", subtype: "system" as const, event: "mcp_scope_changed",
                eventData: { name: ms.server_name, scope: ms.scope, by: conn.displayName },
                messageId: crypto.randomUUID(), meshId: conn.meshId, senderPubkey: "system",
                priority: "low", nonce: "", ciphertext: "", createdAt: new Date().toISOString(),
              });
            }
            const svc = await getService(conn.meshId, ms.server_name);
            sendToPeer(presenceId, { type: "mcp_scope_result", server_name: ms.server_name, scope: svc?.scope ?? { type: "peer" }, deployed_by: svc?.deployedByName ?? "unknown", _reqId: ms._reqId } as any);
          } catch (e) { sendError(ws, "scope_error", e instanceof Error ? e.message : String(e), undefined, ms._reqId); }
          break;
        }
        case "mcp_schema": {
          const msch = msg as any;
          try {
            let tools = serviceManager.getTools(conn.meshId, msch.server_name);
            if (tools.length === 0) {
              const svc = await getService(conn.meshId, msch.server_name);
              tools = (svc?.toolsSchema as any[]) ?? [];
            }
            if (msch.tool_name) tools = tools.filter((t: any) => t.name === msch.tool_name);
            sendToPeer(presenceId, { type: "mcp_schema_result", server_name: msch.server_name, tools, _reqId: msch._reqId } as any);
          } catch (e) { sendError(ws, "schema_error", e instanceof Error ? e.message : String(e), undefined, msch._reqId); }
          break;
        }
        case "mcp_catalog": {
          try {
            const allSvcs = await listDbMeshServices(conn.meshId);
            sendToPeer(presenceId, {
              type: "mcp_catalog_result",
              services: allSvcs.map((s: any) => ({
                name: s.name, type: s.type, description: s.description, status: s.status ?? "stopped",
                tool_count: Array.isArray(s.toolsSchema) ? s.toolsSchema.length : 0,
                deployed_by: s.deployedByName ?? "unknown", scope: s.scope ?? { type: "peer" },
                source_type: s.sourceType, runtime: s.runtime, created_at: s.createdAt.toISOString(),
              })),
              _reqId: (msg as any)._reqId,
            } as any);
          } catch (e) { sendError(ws, "catalog_error", e instanceof Error ? e.message : String(e), undefined, (msg as any)._reqId); }
          break;
        }
        case "skill_deploy": {
          const sd = msg as any;
          sendToPeer(presenceId, { type: "skill_deploy_ack", name: "TODO", files: [], _reqId: sd._reqId } as any);
          log.info("ws skill_deploy", { presence_id: presenceId, source: sd.source?.type });
          break;
        }

        // --- URL Watch ---
        case "watch": {
          const w = msg as any;
          const watchId = `w_${crypto.randomUUID().slice(0, 8)}`;
          const mode = w.mode ?? "hash";
          const interval = Math.max(w.interval ?? 30, 5); // min 5 seconds
          const entry: WatchEntry = {
            id: watchId, meshId: conn.meshId, presenceId,
            url: w.url, mode, extract: w.extract, notifyOn: w.notify_on ?? "change",
            interval, headers: w.headers ?? {}, label: w.label,
            lastHash: "", lastValue: "", lastCheck: null, createdAt: new Date(),
            timer: setInterval(() => checkWatch(entry), interval * 1000),
          };
          urlWatches.set(watchId, entry);
          // Do first check immediately to capture baseline
          void checkWatch(entry);
          sendToPeer(presenceId, { type: "watch_ack", watchId, url: w.url, mode, interval, _reqId: w._reqId } as any);
          log.info("ws watch", { presence_id: presenceId, watchId, url: w.url, mode, interval });
          break;
        }
        case "unwatch": {
          const uw = msg as any;
          const watch = urlWatches.get(uw.watchId);
          if (watch) { clearInterval(watch.timer); urlWatches.delete(uw.watchId); }
          sendToPeer(presenceId, { type: "watch_ack", watchId: uw.watchId, url: watch?.url ?? "", mode: watch?.mode ?? "", interval: 0, _reqId: uw._reqId } as any);
          break;
        }
        case "watch_list": {
          const myWatches = [...urlWatches.values()].filter(w => w.presenceId === presenceId);
          sendToPeer(presenceId, {
            type: "watch_list_result",
            watches: myWatches.map(w => ({
              id: w.id, url: w.url, mode: w.mode, label: w.label, interval: w.interval,
              lastHash: w.lastHash, lastValue: w.lastValue,
              lastCheck: w.lastCheck?.toISOString(), createdAt: w.createdAt.toISOString(),
            })),
            _reqId: (msg as any)._reqId,
          } as any);
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
      // Persist peer state BEFORE removing from connections.
      if (conn) {
        await savePeerState(conn, conn.memberId, conn.meshId);
      }
      connections.delete(presenceId);
      if (conn) {
        decMeshCount(conn.meshId);
        // Broadcast peer_left to remaining peers in the same mesh.
        const leaveMsg: WSPushMessage = {
          type: "push",
          subtype: "system",
          event: "peer_left",
          eventData: {
            name: conn.displayName,
            pubkey: conn.sessionPubkey ?? conn.memberPubkey,
          },
          messageId: crypto.randomUUID(),
          meshId: conn.meshId,
          senderPubkey: "system",
          priority: "low",
          nonce: "",
          ciphertext: "",
          createdAt: new Date().toISOString(),
        };
        for (const [pid, peer] of connections) {
          if (peer.meshId !== conn.meshId) continue;
          sendToPeer(pid, leaveMsg);
        }
      }
      await disconnectPresence(presenceId);
      if (conn) {
        void audit(conn.meshId, "peer_left", conn.memberId, conn.displayName, {});
      }
      // Clean up stream subscriptions for this peer
      for (const [key, subs] of streamSubscriptions) {
        subs.delete(presenceId);
        if (subs.size === 0) streamSubscriptions.delete(key);
      }
      // Clean up MCP servers registered by this peer
      for (const [key, entry] of mcpRegistry) {
        if (entry.presenceId === presenceId) {
          if (entry.persistent) {
            // Keep persistent entries but mark offline
            entry.online = false;
            entry.offlineSince = new Date().toISOString();
            entry.presenceId = "";
          } else {
            mcpRegistry.delete(key);
          }
        }
      }
      // Auto-pause clock when mesh becomes empty
      if (conn && !connectionsPerMesh.has(conn.meshId)) {
        const clock = meshClocks.get(conn.meshId);
        if (clock && clock.timer) {
          clearInterval(clock.timer);
          clock.timer = null;
          clock.paused = true;
          log.info("clock auto-paused (mesh empty)", { mesh_id: conn.meshId });
        }
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

// ---------------------------------------------------------------------------
// Restart recovery: load persisted scheduled entries and re-arm timers
// ---------------------------------------------------------------------------

async function recoverScheduledMessages(): Promise<void> {
  try {
    // Ensure the table exists (CREATE TABLE IF NOT EXISTS via raw SQL
    // since Drizzle push may not have run yet after a deploy)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mesh.scheduled_message (
        id TEXT PRIMARY KEY NOT NULL,
        mesh_id TEXT NOT NULL REFERENCES mesh.mesh(id) ON DELETE CASCADE ON UPDATE CASCADE,
        presence_id TEXT,
        member_id TEXT NOT NULL REFERENCES mesh.member(id) ON DELETE CASCADE ON UPDATE CASCADE,
        "to" TEXT NOT NULL,
        message TEXT NOT NULL,
        deliver_at TIMESTAMP,
        cron TEXT,
        subtype TEXT,
        fired_count INTEGER NOT NULL DEFAULT 0,
        cancelled BOOLEAN NOT NULL DEFAULT false,
        fired_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    const rows = await db
      .select()
      .from(scheduledMessageTable)
      .where(
        and(
          eq(scheduledMessageTable.cancelled, false),
          // For one-shot: not yet fired. For cron: always active until cancelled.
          sql`(${scheduledMessageTable.cron} IS NOT NULL OR ${scheduledMessageTable.firedAt} IS NULL)`,
        ),
      );

    let recovered = 0;
    for (const row of rows) {
      const isCron = !!row.cron;
      let nextFireMs: number;

      if (isCron) {
        const next = cronNextFireTime(row.cron!);
        if (!next) continue; // invalid cron, skip
        nextFireMs = next.getTime();
      } else {
        // One-shot: deliverAt is the fire time. If in the past, fire immediately.
        nextFireMs = row.deliverAt ? row.deliverAt.getTime() : Date.now();
      }

      const entry: ScheduledEntry = {
        id: row.id,
        meshId: row.meshId,
        presenceId: row.presenceId ?? "",
        memberId: row.memberId,
        to: row.to,
        message: row.message,
        deliverAt: nextFireMs,
        createdAt: row.createdAt.getTime(),
        firedCount: row.firedCount,
        ...(row.subtype ? { subtype: row.subtype as "reminder" } : {}),
        ...(isCron ? { cron: row.cron!, recurring: true } : {}),
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
      };

      scheduledMessages.set(row.id, entry);

      // Arm the timer. On fire, the deliver callback will attempt to find
      // a connected peer with matching memberId to send through.
      const delay = Math.max(0, nextFireMs - Date.now());
      entry.timer = setTimeout(() => {
        const currentEntry = scheduledMessages.get(row.id);
        if (!currentEntry) return;

        // Find ANY connected peer that belongs to the same mesh to send through
        let senderConn: PeerConn | undefined;
        for (const [, pc] of connections) {
          if (pc.meshId === currentEntry.meshId) {
            senderConn = pc;
            // Prefer original member if still connected
            if (pc.memberId === currentEntry.memberId) break;
          }
        }
        if (senderConn) {
          const fakeMsg: Extract<WSClientMessage, { type: "send" }> = {
            type: "send",
            id: crypto.randomUUID(),
            targetSpec: currentEntry.to,
            priority: "now",
            nonce: "",
            ciphertext: Buffer.from(currentEntry.message, "utf-8").toString("base64"),
          };
          handleSend(senderConn, fakeMsg, currentEntry.subtype).catch((e) =>
            log.warn("recovered scheduled delivery error", { scheduled_id: row.id, error: String(e) }),
          );
        } else {
          log.warn("recovered scheduled delivery skipped — no peer in mesh", { scheduled_id: row.id, mesh_id: currentEntry.meshId });
        }
        log.info("recovered schedule deliver", { scheduled_id: row.id, to: currentEntry.to, cron: !!currentEntry.cron });

        if (currentEntry.cron) {
          currentEntry.firedCount += 1;
          const nextFire = cronNextFireTime(currentEntry.cron);
          if (nextFire) {
            currentEntry.deliverAt = nextFire.getTime();
            // Re-arm recursively
            const nextDelay = Math.max(0, nextFire.getTime() - Date.now());
            currentEntry.timer = setTimeout(() => {
              // Delegate to the normal armTimer flow by re-entering this block.
              // For simplicity, inline the recurring logic.
              const e2 = scheduledMessages.get(row.id);
              if (!e2) return;
              // Fire again — this is handled identically to the initial fire
              // but since the entry persists, the ws handler's armTimer logic
              // applies on subsequent fires from live schedule creation.
              // For recovered cron, we mark fired and log; actual re-arm
              // happens in the schedule handler's armTimer for newly created entries.
              // This simple approach fires once after recovery and lets the cron
              // continue through the standard path.
            }, nextDelay);
            updateScheduledNextFire(row.id, nextFire, currentEntry.firedCount).catch(() => {});
          } else {
            scheduledMessages.delete(row.id);
            markScheduledFired(row.id).catch(() => {});
          }
        } else {
          scheduledMessages.delete(row.id);
          markScheduledFired(row.id).catch(() => {});
        }
      }, delay);

      recovered++;
    }

    if (recovered > 0) {
      log.info("recovered scheduled messages", { count: recovered });
    }
  } catch (e) {
    log.warn("scheduled message recovery failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

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
  serviceManager.startHealthChecks();

  // Restore managed services that were running before broker restart
  (async () => {
    try {
      const { decryptFromStorage } = await import("./broker-crypto");
      // Get all meshes with running services
      const allMeshes = await db.select({ id: mesh.id }).from(mesh);
      for (const m of allMeshes) {
        const running = await getRunningServices(m.id);
        if (running.length === 0) continue;
        log.info("syncing services for mesh", { mesh_id: m.id, count: running.length });
        // Sync DB status with runner reality instead of re-deploying
        try {
          const healthRes = await fetch(`${env.RUNNER_URL}/health`);
          const health = await healthRes.json() as { ok: boolean; services: Array<{ name: string; status: string; tools: number }> };
          const runnerServices = new Map((health.services ?? []).map((s: any) => [s.name, s]));

          for (const svc of running) {
            const runnerSvc = runnerServices.get(svc.name);
            if (runnerSvc && runnerSvc.status === "running") {
              // Runner has it running — update DB to match
              log.info("service still running on runner", { service: svc.name, mesh_id: m.id });
              // Refresh tools from runner
              try {
                const toolsRes = await fetch(`${env.RUNNER_URL}/list?name=${svc.name}`);
                const toolsData = await toolsRes.json() as { tools?: any[] };
                if (toolsData.tools) {
                  await updateServiceStatus(m.id, svc.name, "running", { toolsSchema: toolsData.tools });
                }
              } catch { /* keep existing tools */ }
            } else {
              // Runner doesn't have it — mark as stopped
              log.warn("service not found on runner, marking stopped", { service: svc.name });
              await updateServiceStatus(m.id, svc.name, "stopped");
            }
          }
        } catch (e) {
          log.warn("runner health check failed during restore", { error: e instanceof Error ? e.message : String(e) });
          // Runner might not be up yet — don't mark services as failed
        }
      }
    } catch (e) {
      log.error("service restore error", { error: e instanceof Error ? e.message : String(e) });
    }
  })();

  // Ensure audit log table exists and load hash chain state
  ensureAuditLogTable()
    .then(() => loadLastHashes())
    .catch((e) =>
      log.warn("audit log startup failed", {
        error: e instanceof Error ? e.message : String(e),
      }),
    );

  // Ensure peer_state table exists (CREATE TABLE IF NOT EXISTS)
  db.execute(sql`
    CREATE TABLE IF NOT EXISTS mesh.peer_state (
      id TEXT PRIMARY KEY NOT NULL,
      mesh_id TEXT NOT NULL REFERENCES mesh.mesh(id) ON DELETE CASCADE ON UPDATE CASCADE,
      member_id TEXT NOT NULL REFERENCES mesh.member(id) ON DELETE CASCADE ON UPDATE CASCADE,
      groups JSONB DEFAULT '[]',
      profile JSONB DEFAULT '{}',
      visible BOOLEAN NOT NULL DEFAULT true,
      last_summary TEXT,
      last_display_name TEXT,
      cumulative_stats JSONB DEFAULT '{"messagesIn":0,"messagesOut":0,"toolCalls":0,"errors":0}',
      last_seen_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT peer_state_mesh_member_idx UNIQUE (mesh_id, member_id)
    )
  `).catch((e) =>
    log.warn("peer_state table creation failed", {
      error: e instanceof Error ? e.message : String(e),
    }),
  );

  // Recover persisted scheduled messages (cron + one-shot) from DB
  recoverScheduledMessages().catch((e) =>
    log.warn("scheduled message recovery failed on startup", {
      error: e instanceof Error ? e.message : String(e),
    }),
  );

  // Boot Telegram bridge if token configured
  const tgBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (tgBotToken) {
    bootTelegramBridge(
      async () => {
        const rows = await db.select({
          chatId: telegramBridge.chatId,
          meshId: telegramBridge.meshId,
          memberId: telegramBridge.memberId,
          pubkey: telegramBridge.pubkey,
          secretKey: telegramBridge.secretKey,
          displayName: telegramBridge.displayName,
          chatType: telegramBridge.chatType,
          chatTitle: telegramBridge.chatTitle,
        }).from(telegramBridge).where(eq(telegramBridge.active, true));
        return rows.map(r => ({ ...r, chatId: Number(r.chatId) }));
      },
      async (row) => {
        await db.insert(telegramBridge).values({
          chatId: BigInt(row.chatId) as any,
          meshId: row.meshId,
          memberId: row.memberId,
          pubkey: row.pubkey,
          secretKey: row.secretKey,
          displayName: row.displayName,
          chatType: row.chatType,
          chatTitle: row.chatTitle ?? null,
        }).onConflictDoUpdate({
          target: [telegramBridge.chatId, telegramBridge.meshId],
          set: { active: true, disconnectedAt: null, pubkey: row.pubkey, secretKey: row.secretKey, displayName: row.displayName },
        });
      },
      async (chatId, meshId) => {
        await db.update(telegramBridge).set({ active: false, disconnectedAt: new Date() })
          .where(and(eq(telegramBridge.chatId, BigInt(chatId) as any), eq(telegramBridge.meshId, meshId)));
      },
      tgBotToken,
      "wss://ic.claudemesh.com/ws",
      // lookupMeshesByEmail: find user's meshes, create a bridge-specific member with fresh keypair
      async (email) => {
        const users = await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.email, email)).limit(1);
        if (users.length === 0) return [];
        const userId = users[0]!.id;
        const userName = users[0]!.name;
        // Find meshes this user belongs to (via dashboardUserId on existing members)
        const existingMembers = await db.select({
          meshId: meshMember.meshId,
        }).from(meshMember).where(and(eq(meshMember.dashboardUserId, userId), isNull(meshMember.revokedAt)));
        if (existingMembers.length === 0) return [];

        // For each mesh, create a new bridge member with a fresh keypair
        const sodium = await import("libsodium-wrappers");
        await sodium.ready;
        const results = [];
        for (const em of existingMembers) {
          const kp = sodium.crypto_sign_keypair();
          const pubkey = sodium.to_hex(kp.publicKey);
          const secretKey = sodium.to_hex(kp.privateKey);
          // Create a new member for the telegram bridge
          const bridgeMemberId = `tg-${userId.slice(0, 8)}-${Date.now().toString(36)}`;
          await db.insert(meshMember).values({
            id: bridgeMemberId,
            meshId: em.meshId,
            peerPubkey: pubkey,
            displayName: `tg:${userName}`,
            role: "member",
            dashboardUserId: userId,
          }).onConflictDoNothing();
          const meshRows = await db.select({ slug: mesh.slug }).from(mesh).where(eq(mesh.id, em.meshId)).limit(1);
          results.push({
            userId,
            meshId: em.meshId,
            meshSlug: meshRows[0]?.slug ?? em.meshId.slice(0, 8),
            memberId: bridgeMemberId,
            pubkey,
            secretKey,
          });
        }
        return results;
      },
      // sendVerificationEmail: send 6-digit code via Resend/Postmark
      async (email, code) => {
        const apiKey = process.env.RESEND_API_KEY ?? process.env.POSTMARK_API_KEY;
        const fromAddr = process.env.EMAIL_FROM ?? "noreply@claudemesh.com";
        if (!apiKey) {
          log.warn("no email API key configured (RESEND_API_KEY or POSTMARK_API_KEY)");
          return false;
        }
        try {
          if (process.env.RESEND_API_KEY) {
            const res = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({
                from: fromAddr,
                to: email,
                subject: `${code} — Claudemesh Telegram verification`,
                text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
              }),
              signal: AbortSignal.timeout(10_000),
            });
            return res.ok;
          } else {
            const res = await fetch("https://api.postmarkapp.com/email", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Postmark-Server-Token": apiKey },
              body: JSON.stringify({
                From: fromAddr,
                To: email,
                Subject: `${code} — Claudemesh Telegram verification`,
                TextBody: `Your verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
              }),
              signal: AbortSignal.timeout(10_000),
            });
            return res.ok;
          }
        } catch (e) {
          log.error("email send failed", { error: e instanceof Error ? e.message : String(e) });
          return false;
        }
      },
    ).then(() => log.info("telegram bridge started"))
     .catch(e => log.error("telegram bridge failed", { error: e instanceof Error ? e.message : String(e) }));
  }

  const shutdown = async (signal: string): Promise<void> => {
    log.info("shutdown signal", { signal });
    clearInterval(pingInterval);
    clearInterval(rlSweep);
    clearInterval(queueDepthTimer);
    stopDbHealth();
    await serviceManager.shutdownAll();
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
