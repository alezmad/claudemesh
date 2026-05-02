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
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { env } from "./env";
import { db } from "./db";
import { invite as inviteTable, mesh, meshMember, messageQueue, presence, scheduledMessage as scheduledMessageTable, meshWebhook, peerState, meshTopic } from "@turbostarter/db/schema/mesh";
import { user } from "@turbostarter/db/schema/auth";
import { handleCliSync, type CliSyncRequest } from "./cli-sync";
import { generateId } from "@turbostarter/shared/utils";
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
  createTopic,
  listTopics,
  findTopicByName,
  joinTopic,
  leaveTopic,
  topicMembers,
  topicHistory,
  markTopicRead,
  appendTopicMessage,
  createApiKey,
  listApiKeys,
  revokeApiKey,
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
import { canonicalInvite, canonicalInviteV2, claimInviteV2Core as _claimInviteV2Core, sealRootKeyToRecipient, verifyHelloSignature, verifyInviteV2 } from "./crypto";
// Alias for in-module callers; the public re-export below surfaces the
// same symbol without colliding with tests that import from index.ts.
const claimInviteV2Core = _claimInviteV2Core;
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
  sessionId: string;
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

/**
 * Per-member send rate limit. Protects the mesh from a runaway peer
 * dumping messages. Burst of 10, refill 60/min — generous for
 * conversational use, tight enough that a loop bug surfaces in seconds.
 *
 * NOTE: TokenBucket signature is `(capacity, refillPerMinute)`, so the
 * args ARE (burst, per-minute). Swept periodically below so old keys
 * don't leak.
 */
const sendRateLimit = new TokenBucket(10, 60);

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
    // Liveness: is the process responding? Coolify uses this to decide
    // if the container is alive. Stays 200 even on DB glitches so a
    // transient DB blip doesn't kill the container.
    writeJson(res, 200, {
      status: "ok",
      db: isDbHealthy() ? "up" : "down",
      ...buildInfo(),
    });
    return;
  }

  if (req.method === "GET" && req.url === "/health/ready") {
    // Readiness: should we accept traffic? Used as the deploy gate —
    // if this fails, the new container isn't promoted and the old one
    // keeps serving. Checks: DB is healthy, migrations table has the
    // expected newest migration, no pending fatal errors at boot.
    (async () => {
      try {
        const dbOk = isDbHealthy();
        if (!dbOk) {
          writeJson(res, 503, { status: "not_ready", reason: "db_down" });
          return;
        }
        // Verify the newest local migration is present in the drizzle
        // tracking table. If the deploy shipped new migrations that
        // didn't apply, this fails closed → Coolify rejects the deploy.
        const expectedMigration = process.env.EXPECTED_MIGRATION ?? null;
        if (expectedMigration) {
          const rows = await db.execute<{ hash: string }>(sql`
            SELECT hash FROM drizzle.__drizzle_migrations
            WHERE hash = ${expectedMigration}
            LIMIT 1
          `);
          const arr = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          if (arr.length === 0) {
            writeJson(res, 503, {
              status: "not_ready",
              reason: "migration_missing",
              expected: expectedMigration,
            });
            return;
          }
        }
        writeJson(res, 200, { status: "ready", ...buildInfo() });
      } catch (e) {
        writeJson(res, 503, {
          status: "not_ready",
          reason: "readiness_check_error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
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

  // v2 invite claim: POST /invites/:code/claim
  // Body: { recipient_x25519_pubkey: "<base64url, 32 bytes>" }
  // On success, returns a sealed copy of the mesh root_key the recipient
  // alone can unseal. See .artifacts/specs/2026-04-10-anthropic-vision-meshes-invites.md
  const claimMatch = req.method === "POST" && req.url?.match(/^\/invites\/([^/]+)\/claim$/);
  if (claimMatch) {
    handleInviteClaimV2Post(req, res, claimMatch[1]!, started);
    return;
  }

  if (req.method === "POST" && req.url === "/upload") {
    handleUploadPost(req, res, started);
    return;
  }

  // File download proxy: streams from MinIO so clients don't need internal URLs.
  // GET /download/{fileId}?mesh={meshId}
  // Auth: Bearer token + mesh membership. Previously wide open — anyone
  // who knew a fileId could exfiltrate.
  if (req.method === "GET" && req.url?.startsWith("/download/")) {
    (async () => {
      const auth = await requireCliAuth(req, res);
      if (!auth) return;
      const parts = req.url!.split("?");
      const fileId = parts[0]!.replace("/download/", "");
      const params = new URLSearchParams(parts[1] ?? "");
      const meshId = params.get("mesh");
      if (!fileId || !meshId) {
        writeJson(res, 400, { error: "fileId and ?mesh= required" });
        log.info("download", { route: "GET /download", status: 400, latency_ms: Date.now() - started });
        return;
      }
      // Membership check: the authenticated user must have a live member
      // row in the requested mesh.
      try {
        const [m] = await db
          .select({ id: meshMember.id })
          .from(meshMember)
          .where(and(eq(meshMember.meshId, meshId), eq(meshMember.userId, auth.userId), isNull(meshMember.revokedAt)))
          .limit(1);
        if (!m) {
          writeJson(res, 403, { error: "not a member of this mesh" });
          return;
        }
      } catch (e) {
        writeJson(res, 500, { error: "membership check failed" });
        log.error("download-auth", { err: e instanceof Error ? e.message : String(e) });
        return;
      }
      try {
        const file = await getFile(meshId, fileId);
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
      } catch (e) {
        writeJson(res, 500, { error: "download failed" });
        log.error("download error", { file_id: fileId, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return;
  }

  // CLI sync: browser OAuth → broker creates members
  if (req.method === "POST" && req.url === "/cli-sync") {
    handleCliSyncPost(req, res, started);
    return;
  }

  // --- CLI device-code auth ---

  if (req.method === "POST" && req.url === "/cli/device-code") {
    handleDeviceCodeNew(req, res, started);
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/cli/device-code/")) {
    const code = req.url.slice("/cli/device-code/".length).split("?")[0]!;
    handleDeviceCodePoll(code, res, started);
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/cli/device-code/") && req.url?.endsWith("/approve")) {
    const code = req.url.slice("/cli/device-code/".length).replace("/approve", "");
    handleDeviceCodeApprove(req, code, res, started);
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/cli/sessions")) {
    handleCliSessionsList(req, res, started);
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/cli/meshes")) {
    handleCliMeshesList(req, res, started);
    return;
  }

  if (req.method === "POST" && req.url === "/cli/token") {
    handleCliTokenGenerate(req, res, started);
    return;
  }

  if (req.method === "POST" && req.url === "/cli/session/revoke") {
    handleCliSessionRevoke(req, res, started);
    return;
  }

  if (req.method === "POST" && req.url === "/cli/mesh/create") {
    handleCliMeshCreate(req, res, started);
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/cli/mesh/") && req.url?.endsWith("/invite")) {
    const slug = req.url.slice("/cli/mesh/".length).replace("/invite", "");
    handleCliMeshInvite(req, slug, res, started);
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/cli/mesh/") && req.url?.endsWith("/grants")) {
    const slug = req.url.slice("/cli/mesh/".length).replace("/grants", "");
    handleCliMeshGrants(req, slug, res, started);
    return;
  }

  if (req.method === "DELETE" && req.url?.startsWith("/cli/mesh/")) {
    const slug = req.url.slice("/cli/mesh/".length);
    handleMeshDelete(req, slug, res, started);
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/cli/mesh/") && req.url?.endsWith("/permissions")) {
    const slug = req.url.slice("/cli/mesh/".length).replace("/permissions", "");
    handlePermissionsGet(slug, res, started);
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/cli/mesh/") && req.url?.endsWith("/permissions")) {
    const slug = req.url.slice("/cli/mesh/".length).replace("/permissions", "");
    handlePermissionsSet(req, slug, res, started);
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

// ----------------------------------------------------------------------------
// v2 invite claim — POST /invites/:code/claim
// ----------------------------------------------------------------------------
// The v2 protocol moves the mesh root_key out of the invite URL. Invite
// URLs are short opaque codes; on claim the broker verifies the signed
// capability (stored server-side) and seals the root_key to a recipient-
// provided x25519 pubkey so only that recipient can unseal it.
//
// capabilityV2 is stored as JSON on the invite row:
//   { "canonical": "v=2|mesh_id|invite_id|expires_at|role|owner_pubkey",
//     "signature": "<hex ed25519 detached signature>" }
// The broker recomputes the canonical bytes from the invite row and
// verifies the signature against mesh.ownerPubkey.
//
// v1 rows (version === 1 OR capabilityV2 === null) are still accepted:
// the broker computes the v2 canonical on the fly from the row, but
// skips signature verification since there is no v2 signature on file.
// This lets v2 clients claim legacy invites during the deprecation window.

// NOTE: canonical `claimInviteV2Core` + `InviteClaimV2Result` live in
// `./crypto.ts`. Re-exported here for backward-compat imports and
// tests that pulled from index.ts. The previous duplicate in this
// file had diverged from the crypto.ts copy and was deleted on
// 2026-04-15 (Codex review finding).
export { type InviteClaimV2Result } from "./crypto";
export { claimInviteV2Core };

function handleInviteClaimV2Post(
  req: IncomingMessage,
  res: ServerResponse,
  code: string,
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
      writeJson(res, 413, { error: "payload too large" });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", async () => {
    if (aborted) return;
    try {
      const raw = Buffer.concat(chunks).toString();
      let payload: { recipient_x25519_pubkey?: string; display_name?: string };
      try {
        payload = JSON.parse(raw);
      } catch {
        writeJson(res, 400, { error: "malformed" });
        return;
      }
      if (
        !payload.recipient_x25519_pubkey ||
        typeof payload.recipient_x25519_pubkey !== "string"
      ) {
        writeJson(res, 400, { error: "malformed" });
        return;
      }
      // Feature-flag: the v2 claim flow inserts a member row with
      // peerPubkey=<x25519 base64url>, but hello requires ed25519 hex.
      // Result: claimed invites can never complete the WS handshake.
      // Keep the endpoint behind an env flag until the two-step binding
      // (send x25519 for seal, bind ed25519 on first hello) lands. Spec:
      // .artifacts/specs/2026-04-15-invite-v2-cli-migration.md.
      if (process.env.BROKER_INVITE_V2_ENABLED !== "1") {
        writeJson(res, 501, {
          error: "invite_v2_disabled",
          detail: "v2 claim flow is behind BROKER_INVITE_V2_ENABLED=1 until the ed25519 binding step ships",
        });
        return;
      }
      const result = await claimInviteV2Core({
        code,
        recipientX25519PubkeyBase64url: payload.recipient_x25519_pubkey,
        displayName: payload.display_name,
      });
      writeJson(res, result.status, result.body);
      log.info("invite claim v2", {
        route: "POST /invites/:code/claim",
        code,
        status: result.status,
        ok: result.ok,
        latency_ms: Date.now() - started,
      });
    } catch (e) {
      writeJson(res, 500, {
        error: e instanceof Error ? e.message : String(e),
      });
      log.error("invite claim v2 handler error", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

async function handleUploadPost(
  req: IncomingMessage,
  res: ServerResponse,
  started: number,
): Promise<void> {
  const auth = await requireCliAuth(req, res);
  if (!auth) return;

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

  // Verify the caller is actually a member of the mesh they claim, AND
  // that the X-Member-Id they sent belongs to them. Previously we trusted
  // both headers blindly — anyone could upload as anyone.
  try {
    const [m] = await db
      .select({ id: meshMember.id, userId: meshMember.userId, revokedAt: meshMember.revokedAt })
      .from(meshMember)
      .where(eq(meshMember.id, memberId))
      .limit(1);
    if (!m || m.revokedAt || m.userId !== auth.userId) {
      writeJson(res, 403, { ok: false, error: "member does not belong to authenticated user" });
      return;
    }
  } catch (e) {
    writeJson(res, 500, { ok: false, error: "auth check failed" });
    log.error("upload-auth", { err: e instanceof Error ? e.message : String(e) });
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

/**
 * Resolve a topic identifier — accepts either a topic id directly OR a
 * topic name within the given mesh. Returns the topic id, or null if no
 * matching topic exists. Used by every topic_* WS handler so callers can
 * reference topics by human-readable name without an extra round trip.
 */
async function resolveTopicId(meshId: string, idOrName: string): Promise<string | null> {
  // ULID-ish ids are 25-26 chars of base32; names are usually shorter and
  // human-readable. Try as id first (cheap PK lookup), fall back to name.
  if (idOrName.length >= 20 && /^[a-z0-9_-]+$/i.test(idOrName)) {
    const byId = await db
      .select({ id: meshTopic.id })
      .from(meshTopic)
      .where(and(eq(meshTopic.id, idOrName), eq(meshTopic.meshId, meshId)));
    if (byId[0]) return byId[0].id;
  }
  const byName = await findTopicByName(meshId, idOrName);
  return byName?.id ?? null;
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
): Promise<{
  presenceId: string;
  memberDisplayName: string;
  memberProfile?: unknown;
  meshPolicy?: Record<string, unknown>;
  restored?: boolean;
  lastSummary?: string;
  lastSeenAt?: string;
  restoredGroups?: Array<{ name: string; role?: string }>;
  restoredStats?: unknown;
} | null> {
  // Validate sessionPubkey shape — it becomes a routable identity in
  // listPeers/drainForMember, so arbitrary strings let a client claim
  // nonsense pubkeys. Required-if-present: empty is allowed (falls back
  // to memberPubkey), but if present must be 64 lower-case hex.
  if (hello.sessionPubkey != null && hello.sessionPubkey !== "") {
    if (typeof hello.sessionPubkey !== "string" || !/^[0-9a-f]{64}$/.test(hello.sessionPubkey)) {
      metrics.connectionsRejected.inc({ reason: "bad_session_pubkey" });
      sendError(ws, "bad_session_pubkey", "sessionPubkey must be 64 lowercase hex chars");
      ws.close(1008, "bad_session_pubkey");
      return null;
    }
  }

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
    // Distinguish "revoked" from "never a member" so banned users get
    // a clear message ("contact admin") instead of generic unauthorized.
    const [revokedRow] = await db
      .select({ displayName: meshMember.displayName, revokedAt: meshMember.revokedAt })
      .from(meshMember)
      .where(and(eq(meshMember.meshId, hello.meshId), eq(meshMember.peerPubkey, hello.pubkey)))
      .limit(1);
    if (revokedRow?.revokedAt) {
      metrics.connectionsRejected.inc({ reason: "revoked" });
      const [m] = await db.select({ slug: mesh.slug, name: mesh.name }).from(mesh).where(eq(mesh.id, hello.meshId)).limit(1);
      const meshLabel = m?.name || m?.slug || hello.meshId;
      sendError(
        ws,
        "revoked",
        `You've been removed from "${meshLabel}". Contact the mesh owner to rejoin.`,
      );
      ws.close(4002, "banned");
      log.info("hello rejected: revoked", { mesh_id: hello.meshId, display_name: revokedRow.displayName });
      return null;
    }
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
  // Session-id dedup: if this session_id already has an active presence,
  // disconnect the ghost. Happens when a client reconnects after a
  // network blip or broker restart before the 90s stale sweeper runs.
  // One Claude Code instance = one session_id = one presence, always.
  for (const [oldPid, oldConn] of connections) {
    if (oldConn.meshId === hello.meshId && oldConn.sessionId === hello.sessionId) {
      log.info("hello dedup", { old_presence: oldPid, session_id: hello.sessionId });
      try { oldConn.ws.close(1000, "session_replaced"); } catch { /* already dead */ }
      connections.delete(oldPid);
      void disconnectPresence(oldPid);
    }
  }

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
    sessionId: hello.sessionId,
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
  // Per-member rate limit (60/min, burst 10). Runaway peer → graceful ack
  // failure instead of queue explosion. Uses member (not session) key so a
  // peer can't dodge by reconnecting.
  if (!sendRateLimit.take(conn.memberId)) {
    metrics.messagesRejectedTotal.inc({ reason: "rate_limit" });
    const errAck: WSServerMessage = {
      type: "ack",
      id: msg.id ?? "",
      messageId: "",
      queued: false,
      error: "rate_limit: max 60 msg/min (burst 10) — slow down",
    };
    conn.ws.send(JSON.stringify(errAck));
    return;
  }

  // Size cap — ws.maxPayload catches giants at the frame level, but we also
  // reject verbose nonce+ciphertext combinations above env.MAX_MESSAGE_BYTES
  // so clients get a clear error instead of a silent socket kill.
  const approxBytes =
    (msg.ciphertext?.length ?? 0) + (msg.nonce?.length ?? 0) + (msg.targetSpec?.length ?? 0);
  if (approxBytes > env.MAX_MESSAGE_BYTES) {
    metrics.messagesRejectedTotal.inc({ reason: "too_large" });
    const errAck: WSServerMessage = {
      type: "ack",
      id: msg.id ?? "",
      messageId: "",
      queued: false,
      error: `payload too large: ${approxBytes} bytes > MAX_MESSAGE_BYTES=${env.MAX_MESSAGE_BYTES}`,
    };
    conn.ws.send(JSON.stringify(errAck));
    return;
  }

  // Pre-flight: for direct sends (not @group, not #topic, not *), verify
  // at least one matching connected peer exists BEFORE queueing. Prevents
  // silent drops when a user sends to a typo, their own pubkey with no
  // other session, or a peer who has disconnected. The CLI's
  // resolveClient already guards name-based targets; this catches
  // raw-pubkey and CLI-bypassing clients.
  const isGroupTargetEarly = msg.targetSpec.startsWith("@");
  const isTopicTargetEarly = msg.targetSpec.startsWith("#");
  const isBroadcastEarly =
    msg.targetSpec === "*" ||
    (isGroupTargetEarly && msg.targetSpec === "@all");
  const isDirectEarly =
    !isGroupTargetEarly &&
    !isTopicTargetEarly &&
    !isBroadcastEarly &&
    msg.targetSpec !== "*";
  if (isDirectEarly) {
    // Identify candidate recipient connections — anyone in the mesh whose
    // member or session pubkey matches the target. Then check grants to
    // see if at least one of them has granted the sender `dm`. Without
    // this check, blocked DMs get queued and sit in the DB forever
    // (multicast marks delivered on queue; direct relies on drain-or-push).
    const candidateMemberIds: string[] = [];
    for (const [, peer] of connections) {
      if (peer.meshId !== conn.meshId) continue;
      if (peer.ws === conn.ws) continue;
      if (peer.memberPubkey === msg.targetSpec || peer.sessionPubkey === msg.targetSpec) {
        candidateMemberIds.push(peer.memberId);
      }
    }
    if (candidateMemberIds.length === 0) {
      metrics.messagesRejectedTotal.inc({ reason: "no_recipient" });
      const errAck: WSServerMessage = {
        type: "ack",
        id: msg.id ?? "",
        messageId: "",
        queued: false,
        error: `no connected peer for target (not online, or targetSpec is your own key without another session)`,
      };
      conn.ws.send(JSON.stringify(errAck));
      return;
    }

    // Load grants for the candidate recipient members and pick the first
    // that allows `dm` from the sender's stable memberPubkey. If none
    // allow it, reject pre-queue so the DB stays clean.
    const DEFAULT_CAPS_DM = ["read", "dm", "broadcast", "state-read"] as const;
    const grantRows = await db
      .select({ id: meshMember.id, peerGrants: meshMember.peerGrants })
      .from(meshMember)
      .where(and(eq(meshMember.meshId, conn.meshId), inArray(meshMember.id, candidateMemberIds)));
    const senderKey = conn.memberPubkey;
    const anyAllows = grantRows.some((row) => {
      const grants = (row.peerGrants as Record<string, string[]>) ?? {};
      const entry = grants[senderKey];
      if (entry === undefined) return (DEFAULT_CAPS_DM as readonly string[]).includes("dm");
      return entry.includes("dm");
    });
    if (!anyAllows) {
      metrics.messagesDroppedByGrantTotal?.inc?.({ cap: "dm" });
      const errAck: WSServerMessage = {
        type: "ack",
        id: msg.id ?? "",
        messageId: "",
        queued: false,
        error: "blocked by recipient grants (sender lacks dm capability)",
      };
      conn.ws.send(JSON.stringify(errAck));
      return;
    }
  }

  const messageId = await queueMessage({
    meshId: conn.meshId,
    senderMemberId: conn.memberId,
    senderSessionPubkey: conn.sessionPubkey ?? undefined,
    targetSpec: msg.targetSpec,
    priority: msg.priority,
    nonce: msg.nonce,
    ciphertext: msg.ciphertext,
  });

  // Topic-tagged messages (targetSpec starts with `#<topicId>`) get
  // persisted to topic_message in addition to the ephemeral queue, so
  // humans (and opting-in agents) can fetch history on reconnect.
  // Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md
  if (msg.targetSpec.startsWith("#")) {
    const topicId = msg.targetSpec.slice(1);
    void appendTopicMessage({
      topicId,
      senderMemberId: conn.memberId,
      senderSessionPubkey: conn.sessionPubkey ?? undefined,
      nonce: msg.nonce,
      ciphertext: msg.ciphertext,
    }).catch((e) =>
      log.warn("appendTopicMessage failed", { topic_id: topicId, err: String(e) }),
    );
  }

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

  // Per-peer grant enforcement — load recipient grant maps once per send.
  // See .artifacts/specs/2026-04-15-per-peer-capabilities.md.
  //
  // We look up grants by BOTH the sender's stable member pubkey AND their
  // ephemeral session pubkey, because CLI clients historically wrote grant
  // entries keyed on session pubkey (from listPeers which preferred
  // session key). Member key is preferred; session is a fall-through for
  // compatibility with older clients until they migrate.
  const DEFAULT_CAPS = ["read", "dm", "broadcast", "state-read"] as const;
  const capNeeded: "dm" | "broadcast" = isMulticast ? "broadcast" : "dm";
  const senderMemberKey = conn.memberPubkey;
  const senderSessionKey = conn.sessionPubkey ?? null;
  const grantRows = await db
    .select({ id: meshMember.id, peerGrants: meshMember.peerGrants })
    .from(meshMember)
    .where(eq(meshMember.meshId, conn.meshId));
  const grantsByMemberId = new Map<string, Record<string, string[]>>(
    grantRows.map((r) => [r.id, (r.peerGrants as Record<string, string[]>) ?? {}]),
  );
  function allowed(recipientMemberId: string): boolean {
    const grants = grantsByMemberId.get(recipientMemberId);
    if (!grants) return (DEFAULT_CAPS as readonly string[]).includes(capNeeded);
    const memberEntry = grants[senderMemberKey];
    if (memberEntry !== undefined) return memberEntry.includes(capNeeded);
    if (senderSessionKey) {
      const sessionEntry = grants[senderSessionKey];
      if (sessionEntry !== undefined) return sessionEntry.includes(capNeeded);
    }
    return (DEFAULT_CAPS as readonly string[]).includes(capNeeded);
  }

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

    // Per-peer capability check — silent drop if recipient hasn't granted
    // `capNeeded` to this sender (Signal block semantics: sender sees
    // delivered, recipient sees nothing).
    if (!allowed(peer.memberId)) {
      metrics.messagesDroppedByGrantTotal?.inc?.({ cap: capNeeded });
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
            // Don't spam the user's own other sessions about themselves —
            // multiple Claude Code instances from one laptop all share the
            // same memberPubkey, so they're the same human identity.
            if (peer.memberPubkey === joinedConn.memberPubkey) continue;
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
                memberPubkey: p.memberPubkey,
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

        // ── Topics (v0.2.0) ─────────────────────────────────────────
        case "topic_create": {
          const tc = msg as Extract<WSClientMessage, { type: "topic_create" }>;
          const result = await createTopic({
            meshId: conn.meshId,
            name: tc.name,
            description: tc.description,
            visibility: tc.visibility,
            createdByMemberId: conn.memberId,
          });
          // Auto-subscribe the creator.
          await joinTopic({ topicId: result.id, memberId: conn.memberId, role: "lead" });
          const resp: WSServerMessage = {
            type: "topic_created",
            topic: {
              id: result.id,
              name: tc.name,
              visibility: tc.visibility ?? "public",
            },
            created: result.created,
            ...(_reqId ? { _reqId } : {}),
          };
          conn.ws.send(JSON.stringify(resp));
          log.info("ws topic_create", { presence_id: presenceId, topic: tc.name, created: result.created });
          break;
        }

        case "topic_list": {
          const topics = await listTopics(conn.meshId);
          const resp: WSServerMessage = {
            type: "topic_list_response",
            topics: topics.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              visibility: t.visibility,
              memberCount: t.memberCount,
              createdAt: t.createdAt.toISOString(),
            })),
            ...(_reqId ? { _reqId } : {}),
          };
          conn.ws.send(JSON.stringify(resp));
          break;
        }

        case "topic_join": {
          const tj = msg as Extract<WSClientMessage, { type: "topic_join" }>;
          const topicId = await resolveTopicId(conn.meshId, tj.topic);
          if (!topicId) { sendError(ws, "topic_not_found", `topic "${tj.topic}" not found`, _reqId); break; }
          await joinTopic({ topicId, memberId: conn.memberId, role: tj.role });
          log.info("ws topic_join", { presence_id: presenceId, topic: topicId });
          break;
        }

        case "topic_leave": {
          const tl = msg as Extract<WSClientMessage, { type: "topic_leave" }>;
          const topicId = await resolveTopicId(conn.meshId, tl.topic);
          if (!topicId) { sendError(ws, "topic_not_found", `topic "${tl.topic}" not found`, _reqId); break; }
          await leaveTopic({ topicId, memberId: conn.memberId });
          log.info("ws topic_leave", { presence_id: presenceId, topic: topicId });
          break;
        }

        case "topic_members": {
          const tm = msg as Extract<WSClientMessage, { type: "topic_members" }>;
          const topicId = await resolveTopicId(conn.meshId, tm.topic);
          if (!topicId) { sendError(ws, "topic_not_found", `topic "${tm.topic}" not found`, _reqId); break; }
          const members = await topicMembers(topicId);
          const resp: WSServerMessage = {
            type: "topic_members_response",
            topic: tm.topic,
            members: members.map((m) => ({
              memberId: m.memberId,
              pubkey: m.pubkey,
              displayName: m.displayName,
              role: m.role,
              joinedAt: m.joinedAt.toISOString(),
              lastReadAt: m.lastReadAt?.toISOString() ?? null,
            })),
            ...(_reqId ? { _reqId } : {}),
          };
          conn.ws.send(JSON.stringify(resp));
          break;
        }

        case "topic_history": {
          const th = msg as Extract<WSClientMessage, { type: "topic_history" }>;
          const topicId = await resolveTopicId(conn.meshId, th.topic);
          if (!topicId) { sendError(ws, "topic_not_found", `topic "${th.topic}" not found`, _reqId); break; }
          const history = await topicHistory({
            topicId,
            limit: th.limit,
            beforeId: th.beforeId,
          });
          const resp: WSServerMessage = {
            type: "topic_history_response",
            topic: th.topic,
            messages: history.map((h) => ({
              id: h.id,
              senderPubkey: h.senderPubkey,
              nonce: h.nonce,
              ciphertext: h.ciphertext,
              createdAt: h.createdAt.toISOString(),
            })),
            ...(_reqId ? { _reqId } : {}),
          };
          conn.ws.send(JSON.stringify(resp));
          break;
        }

        case "topic_mark_read": {
          const tr = msg as Extract<WSClientMessage, { type: "topic_mark_read" }>;
          const topicId = await resolveTopicId(conn.meshId, tr.topic);
          if (!topicId) { sendError(ws, "topic_not_found", `topic "${tr.topic}" not found`, _reqId); break; }
          await markTopicRead({ topicId, memberId: conn.memberId });
          break;
        }

        // ── API keys (v0.2.0) ───────────────────────────────────────
        // TODO: gate to admin members only. For now any authed peer can
        // issue keys for their mesh — matches existing `share` invite
        // semantics; tighter ACL lands with the broader admin role work.
        case "apikey_create": {
          const ac = msg as Extract<WSClientMessage, { type: "apikey_create" }>;
          if (!ac.label || !ac.capabilities?.length) {
            sendError(ws, "invalid_args", "label and at least one capability required", _reqId);
            break;
          }
          const result = await createApiKey({
            meshId: conn.meshId,
            label: ac.label,
            capabilities: ac.capabilities,
            topicScopes: ac.topicScopes ?? null,
            issuedByMemberId: conn.memberId,
            expiresAt: ac.expiresAt ? new Date(ac.expiresAt) : undefined,
          });
          const resp: WSServerMessage = {
            type: "apikey_created",
            id: result.id,
            secret: result.secret,
            label: result.label,
            prefix: result.prefix,
            capabilities: result.capabilities,
            topicScopes: result.topicScopes,
            createdAt: result.createdAt.toISOString(),
            ...(_reqId ? { _reqId } : {}),
          };
          conn.ws.send(JSON.stringify(resp));
          log.info("ws apikey_create", { presence_id: presenceId, label: ac.label, key_id: result.id });
          break;
        }

        case "apikey_list": {
          const keys = await listApiKeys(conn.meshId);
          const resp: WSServerMessage = {
            type: "apikey_list_response",
            keys: keys.map((k) => ({
              id: k.id,
              label: k.label,
              prefix: k.prefix,
              capabilities: k.capabilities,
              topicScopes: k.topicScopes,
              createdAt: k.createdAt.toISOString(),
              lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
              revokedAt: k.revokedAt?.toISOString() ?? null,
              expiresAt: k.expiresAt?.toISOString() ?? null,
            })),
            ...(_reqId ? { _reqId } : {}),
          };
          conn.ws.send(JSON.stringify(resp));
          break;
        }

        case "apikey_revoke": {
          const ar = msg as Extract<WSClientMessage, { type: "apikey_revoke" }>;
          if (!ar.id) { sendError(ws, "invalid_args", "id required", _reqId); break; }
          await revokeApiKey({ meshId: conn.meshId, id: ar.id });
          log.info("ws apikey_revoke", { presence_id: presenceId, key_id: ar.id });
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

        // --- Kick / Ban / Unban ---

        case "disconnect":
        case "kick": {
          // disconnect: soft — WS closes with 1000, CLI auto-reconnects.
          // kick:       hard — WS closes with 4001, CLI exits (no reconnect).
          // Same target semantics (<name> | --stale <ms> | --all). Only
          // the close code differs.
          const isKick = msg.type === "kick";
          const km = msg as { type: "kick" | "disconnect"; target?: string; stale?: number; all?: boolean; _reqId?: string };
          const closeCode = isKick ? 4001 : 1000;
          const closeReason = isKick ? "kicked" : "disconnected";
          const ackType = isKick ? "kick_ack" : "disconnect_ack";

          // Authz: only owner or admin.
          const [kickMesh] = await db.select({ ownerUserId: mesh.ownerUserId }).from(mesh).where(eq(mesh.id, conn.meshId)).limit(1);
          const [kickMember] = await db.select({ role: meshMember.role, userId: meshMember.userId }).from(meshMember).where(eq(meshMember.id, conn.memberId)).limit(1);
          if (!kickMesh || (kickMesh.ownerUserId !== kickMember?.userId && kickMember?.role !== "admin")) {
            sendError(ws, "forbidden", `only owner or admin can ${closeReason}`, undefined, km._reqId);
            break;
          }

          const affected: string[] = [];
          const now = Date.now();

          if (km.all) {
            for (const [pid, peer] of connections) {
              if (peer.meshId !== conn.meshId || pid === presenceId) continue;
              try { peer.ws.close(closeCode, closeReason); } catch {}
              connections.delete(pid);
              void disconnectPresence(pid);
              affected.push(peer.displayName || pid);
            }
          } else if (km.stale && typeof km.stale === "number") {
            const cutoff = now - km.stale;
            for (const [pid, peer] of connections) {
              if (peer.meshId !== conn.meshId || pid === presenceId) continue;
              const [pres] = await db.select({ lastPingAt: presence.lastPingAt }).from(presence).where(eq(presence.id, pid)).limit(1);
              if (pres && pres.lastPingAt && pres.lastPingAt.getTime() < cutoff) {
                try { peer.ws.close(closeCode, `${closeReason}_stale`); } catch {}
                connections.delete(pid);
                void disconnectPresence(pid);
                affected.push(peer.displayName || pid);
              }
            }
          } else if (km.target) {
            for (const [pid, peer] of connections) {
              if (peer.meshId !== conn.meshId) continue;
              if (peer.displayName === km.target || peer.memberPubkey === km.target || peer.memberPubkey.startsWith(km.target)) {
                try { peer.ws.close(closeCode, closeReason); } catch {}
                connections.delete(pid);
                void disconnectPresence(pid);
                affected.push(peer.displayName || pid);
              }
            }
          }

          conn.ws.send(JSON.stringify({ type: ackType, kicked: affected, affected, _reqId: km._reqId }));
          log.info(`ws ${closeReason}`, { presence_id: presenceId, count: affected.length, target: km.target ?? km.stale ?? "all" });
          break;
        }

        case "ban": {
          const bm = msg as { type: "ban"; target: string; _reqId?: string };
          if (!bm.target) { sendError(ws, "invalid", "target required", undefined, bm._reqId); break; }

          // Authz: only owner or admin
          const [banMesh] = await db.select({ ownerUserId: mesh.ownerUserId }).from(mesh).where(eq(mesh.id, conn.meshId)).limit(1);
          const [banMember] = await db.select({ role: meshMember.role, userId: meshMember.userId }).from(meshMember).where(eq(meshMember.id, conn.memberId)).limit(1);
          if (!banMesh || (banMesh.ownerUserId !== banMember?.userId && banMember?.role !== "admin")) {
            sendError(ws, "forbidden", "only owner or admin can ban", undefined, bm._reqId);
            break;
          }

          // Find member by name or pubkey
          const [targetMember] = await db.select({ id: meshMember.id, displayName: meshMember.displayName, peerPubkey: meshMember.peerPubkey })
            .from(meshMember)
            .where(and(
              eq(meshMember.meshId, conn.meshId),
              isNull(meshMember.revokedAt),
              sql`(${meshMember.displayName} = ${bm.target} OR ${meshMember.peerPubkey} = ${bm.target} OR LEFT(${meshMember.peerPubkey}, ${bm.target.length}) = ${bm.target})`,
            ))
            .limit(1);

          if (!targetMember) { sendError(ws, "not_found", `peer "${bm.target}" not found`, undefined, bm._reqId); break; }
          if (targetMember.id === conn.memberId) { sendError(ws, "invalid", "cannot ban yourself", undefined, bm._reqId); break; }

          // Revoke member
          await db.update(meshMember).set({ revokedAt: new Date() }).where(eq(meshMember.id, targetMember.id));

          // Kick all their connections
          for (const [pid, peer] of connections) {
            if (peer.meshId === conn.meshId && peer.memberPubkey === targetMember.peerPubkey) {
              try { peer.ws.close(4002, "banned"); } catch {}
              connections.delete(pid);
              void disconnectPresence(pid);
            }
          }

          void audit(conn.meshId, "member_banned", conn.memberId, conn.displayName, { target: targetMember.displayName, targetPubkey: targetMember.peerPubkey });
          conn.ws.send(JSON.stringify({ type: "ban_ack", banned: targetMember.displayName, _reqId: bm._reqId }));
          log.info("ws ban", { presence_id: presenceId, banned: targetMember.displayName, banned_member_id: targetMember.id });
          break;
        }

        case "unban": {
          const ubm = msg as { type: "unban"; target: string; _reqId?: string };
          if (!ubm.target) { sendError(ws, "invalid", "target required", undefined, ubm._reqId); break; }

          // Authz
          const [unbanMesh] = await db.select({ ownerUserId: mesh.ownerUserId }).from(mesh).where(eq(mesh.id, conn.meshId)).limit(1);
          const [unbanMember] = await db.select({ role: meshMember.role, userId: meshMember.userId }).from(meshMember).where(eq(meshMember.id, conn.memberId)).limit(1);
          if (!unbanMesh || (unbanMesh.ownerUserId !== unbanMember?.userId && unbanMember?.role !== "admin")) {
            sendError(ws, "forbidden", "only owner or admin can unban", undefined, ubm._reqId);
            break;
          }

          // Find revoked member
          const [revokedMember] = await db.select({ id: meshMember.id, displayName: meshMember.displayName })
            .from(meshMember)
            .where(and(
              eq(meshMember.meshId, conn.meshId),
              sql`${meshMember.revokedAt} IS NOT NULL`,
              sql`(${meshMember.displayName} = ${ubm.target} OR ${meshMember.peerPubkey} = ${ubm.target})`,
            ))
            .limit(1);

          if (!revokedMember) { sendError(ws, "not_found", `no banned peer "${ubm.target}"`, undefined, ubm._reqId); break; }

          await db.update(meshMember).set({ revokedAt: null }).where(eq(meshMember.id, revokedMember.id));
          void audit(conn.meshId, "member_unbanned", conn.memberId, conn.displayName, { target: revokedMember.displayName });
          conn.ws.send(JSON.stringify({ type: "unban_ack", unbanned: revokedMember.displayName, _reqId: ubm._reqId }));
          log.info("ws unban", { presence_id: presenceId, unbanned: revokedMember.displayName });
          break;
        }

        case "list_bans": {
          const lbm = msg as { type: "list_bans"; _reqId?: string };
          const banned = await db.select({
            name: meshMember.displayName,
            pubkey: meshMember.peerPubkey,
            revokedAt: meshMember.revokedAt,
          }).from(meshMember).where(and(
            eq(meshMember.meshId, conn.meshId),
            sql`${meshMember.revokedAt} IS NOT NULL`,
          ));
          conn.ws.send(JSON.stringify({
            type: "list_bans_result",
            bans: banned.map((b) => ({ name: b.name, pubkey: b.pubkey, revokedAt: b.revokedAt?.toISOString() })),
            _reqId: lbm._reqId,
          }));
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
          const brokerPublicUrl = process.env.BROKER_PUBLIC_URL ?? "https://ic.claudemesh.com";
          const webhookUrl = `${brokerPublicUrl.replace(/\/$/, "")}/hook/${conn.meshId}/${webhookSecret}`;
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
          const brokerPublicUrlList = process.env.BROKER_PUBLIC_URL ?? "https://ic.claudemesh.com";
          sendToPeer(presenceId, {
            type: "webhook_list",
            webhooks: whRows.map((r) => ({
              name: r.name,
              url: `${brokerPublicUrlList.replace(/\/$/, "")}/hook/${conn.meshId}/${r.secret}`,
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
          // Don't tell the user's own other sessions they "left" when one
          // of their Claude Code instances closes. Same pubkey = same user.
          if (peer.memberPubkey === conn.memberPubkey) continue;
          sendToPeer(pid, leaveMsg);
        }
      }
      await disconnectPresence(presenceId);
      if (conn) {
        void audit(conn.meshId, "peer_left", conn.memberId, conn.displayName, {});
      }
      // Clean up URL watches owned by this peer — the interval was
      // happily fetching forever after the peer disconnected.
      for (const [watchId, watch] of urlWatches) {
        if (watch.presenceId === presenceId) {
          clearInterval(watch.timer);
          urlWatches.delete(watchId);
        }
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

async function main(): Promise<void> {
  // Auto-migrate via the filename-tracked runner (mesh.__cmh_migrations).
  // The legacy BROKER_SKIP_MIGRATE=1 escape hatch is preserved as a
  // break-glass for ops; under normal operation the runner is fast (<1s
  // when up-to-date) and idempotent so the flag should stay unset.
  if (process.env.BROKER_SKIP_MIGRATE !== "1") {
    const { runMigrationsOnStartup } = await import("./migrate");
    await runMigrationsOnStartup();
  } else {
    console.log("[migrate] skipped (BROKER_SKIP_MIGRATE=1)");
  }

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
  const rlSweep = setInterval(() => {
    hookRateLimit.sweep();
    sendRateLimit.sweep();
  }, 5 * 60_000);
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
          meshSlug: mesh.slug,
          memberId: telegramBridge.memberId,
          pubkey: telegramBridge.pubkey,
          secretKey: telegramBridge.secretKey,
          displayName: telegramBridge.displayName,
          chatType: telegramBridge.chatType,
          chatTitle: telegramBridge.chatTitle,
        }).from(telegramBridge)
          .leftJoin(mesh, eq(telegramBridge.meshId, mesh.id))
          .where(eq(telegramBridge.active, true));
        return rows.map(r => ({ ...r, meshSlug: r.meshSlug ?? undefined, chatId: Number(r.chatId) }));
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
      process.env.BROKER_WS_URL ?? "wss://ic.claudemesh.com/ws",
      // lookupMeshesByEmail: find user's meshes, create a bridge-specific member with fresh keypair
      async (email) => {
        const users = await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.email, email)).limit(1);
        if (users.length === 0) return [];
        const userId = users[0]!.id;
        const userName = users[0]!.name;
        // Find meshes this user belongs to:
        // 1. Via dashboardUserId on existing members
        // 2. Via userId (auth FK) on existing members
        const meshIds = new Set<string>();
        const byDashboard = await db.select({ meshId: meshMember.meshId })
          .from(meshMember).where(and(eq(meshMember.dashboardUserId, userId), isNull(meshMember.revokedAt)));
        for (const m of byDashboard) meshIds.add(m.meshId);
        const byUserId = await db.select({ meshId: meshMember.meshId })
          .from(meshMember).where(and(eq(meshMember.userId, userId), isNull(meshMember.revokedAt)));
        for (const m of byUserId) meshIds.add(m.meshId);
        // No fallback — user must be an explicit member of a mesh
        if (meshIds.size === 0) return [];
        const existingMembers = Array.from(meshIds).map(meshId => ({ meshId }));

        // For each mesh, create a new bridge member with a fresh keypair
        const sodiumMod = await import("libsodium-wrappers");
        await sodiumMod.default.ready;
        const sodium = sodiumMod.default;
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

// ---------------------------------------------------------------------------
// CLI device-code auth handlers
// ---------------------------------------------------------------------------

import { deviceCode as deviceCodeTable, cliSession as cliSessionTable } from "@turbostarter/db/schema/mesh";

function generateShortCode(len: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function signCliJwt(payload: Record<string, unknown>): Promise<string> {
  const secret = env.CLI_SYNC_SECRET;
  if (!secret) throw new Error("CLI_SYNC_SECRET not configured");
  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${headerB64}.${payloadB64}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify the caller holds a valid CLI session token and return the
 * authenticated user_id. Used by every authenticated /cli/... route
 * to replace the former pattern of trusting body.user_id blindly.
 *
 * Returns null (and writes 401) on missing/invalid/revoked tokens.
 * Callers must `return` immediately after a null response.
 *
 * Backwards compatibility (30-day window):
 * Pre-alpha.36 CLIs sent `user_id` in the JSON body and no bearer
 * token. To avoid breaking them overnight we accept a legacy fallback
 * when BROKER_LEGACY_AUTH=1 is set in the environment: if no bearer is
 * present, read the body's `user_id` and treat it as authenticated
 * (same lax model the broker had before). A Deprecation header is
 * attached and the event is logged so operators can count usage.
 * Remove the shim after 2026-05-15 or when `broker_legacy_auth_hits`
 * metric is near zero.
 *
 * Security note: the legacy path is OFF by default. Enable only as a
 * deliberate rollout choice.
 */
async function requireCliAuth(
  req: IncomingMessage,
  res: ServerResponse,
  legacyBody?: { user_id?: unknown } | null,
): Promise<{ userId: string; sessionId: string | null } | null> {
  const header = req.headers["authorization"];
  if (header && typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      writeJson(res, 401, { error: "empty_bearer_token" });
      return null;
    }
    try {
      const hash = await hashToken(token);
      const [session] = await db
        .select({ id: cliSessionTable.id, userId: cliSessionTable.userId, revokedAt: cliSessionTable.revokedAt })
        .from(cliSessionTable)
        .where(eq(cliSessionTable.tokenHash, hash))
        .limit(1);
      if (!session || session.revokedAt) {
        writeJson(res, 401, { error: "invalid_or_revoked_token" });
        return null;
      }
      db.update(cliSessionTable)
        .set({ lastSeenAt: new Date() })
        .where(eq(cliSessionTable.id, session.id))
        .catch(() => { /* non-fatal */ });
      return { userId: session.userId, sessionId: session.id };
    } catch (e) {
      log.error("auth", { err: e instanceof Error ? e.message : String(e) });
      writeJson(res, 500, { error: "auth_check_failed" });
      return null;
    }
  }

  // Legacy fallback (off by default). Only triggers when no bearer was
  // supplied AND the operator explicitly opted in.
  if (process.env.BROKER_LEGACY_AUTH === "1") {
    const legacyUserId =
      legacyBody && typeof legacyBody.user_id === "string" ? legacyBody.user_id : null;
    if (legacyUserId) {
      res.setHeader(
        "Deprecation",
        'version="legacy-body-userid"; sunset="2026-05-15"',
      );
      res.setHeader(
        "Warning",
        '299 - "body.user_id auth is deprecated; send Authorization: Bearer <session_token>"',
      );
      metrics.brokerLegacyAuthHitsTotal?.inc?.();
      log.warn("legacy auth accepted", {
        route: req.url,
        user_id: legacyUserId,
      });
      return { userId: legacyUserId, sessionId: null };
    }
  }

  writeJson(res, 401, { error: "missing_bearer_token" });
  return null;
}

/** POST /cli/device-code — create a new device code. */
async function handleDeviceCodeNew(req: IncomingMessage, res: ServerResponse, started: number): Promise<void> {
  let body: { hostname?: string; platform?: string; arch?: string } = {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString()) as typeof body;
  } catch {}

  const dc = generateShortCode(16);
  const uc = generateShortCode(4) + "-" + generateShortCode(4);
  const sid = "clm_sess_" + generateShortCode(32);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";

  try {
    await db.insert(deviceCodeTable).values({
      deviceCode: dc,
      userCode: uc,
      sessionId: sid,
      hostname: body.hostname,
      platform: body.platform,
      arch: body.arch,
      ipAddress: clientIp,
      expiresAt,
    });

    const baseUrl = process.env.APP_URL || "https://claudemesh.com";

    writeJson(res, 200, {
      device_code: dc,
      user_code: uc,
      session_id: sid,
      expires_at: expiresAt.toISOString(),
      verification_url: `${baseUrl}/cli-auth`,
      token_url: `${baseUrl}/token`,
    });
    log.info("device-code", { route: "POST /cli/device-code", user_code: uc, session_id: sid, latency_ms: Date.now() - started });
  } catch (e) {
    log.error("device-code", { error: e instanceof Error ? e.message : String(e) });
    writeJson(res, 500, { error: "Failed to create device code" });
  }
}

/** GET /cli/device-code/:code — poll device code status. */
async function handleDeviceCodePoll(code: string, res: ServerResponse, started: number): Promise<void> {
  try {
    const [entry] = await db.select().from(deviceCodeTable).where(eq(deviceCodeTable.deviceCode, code)).limit(1);

    if (!entry) {
      writeJson(res, 200, { status: "expired" });
      return;
    }

    if (new Date() > entry.expiresAt && entry.status === "pending") {
      await db.update(deviceCodeTable).set({ status: "expired" }).where(eq(deviceCodeTable.id, entry.id));
      writeJson(res, 200, { status: "expired" });
      return;
    }

    if (entry.status === "approved" && entry.sessionToken && entry.userId) {
      // Mark as consumed so it can't be polled again
      await db.update(deviceCodeTable).set({ status: "consumed" }).where(eq(deviceCodeTable.id, entry.id));

      // Look up user info
      const [u] = await db.select().from(user).where(eq(user.id, entry.userId)).limit(1);

      writeJson(res, 200, {
        status: "approved",
        session_token: entry.sessionToken,
        user: {
          id: entry.userId,
          display_name: u?.name ?? u?.email ?? "User",
          email: u?.email ?? "",
        },
      });
      log.info("device-code-poll", { route: "GET /cli/device-code/:code", status: "approved", latency_ms: Date.now() - started });
      return;
    }

    writeJson(res, 200, { status: entry.status });
  } catch (e) {
    log.error("device-code-poll", { error: e instanceof Error ? e.message : String(e) });
    writeJson(res, 500, { error: "Failed to poll device code" });
  }
}

/** POST /cli/device-code/:code/approve — approve from browser (requires sync token). */
async function handleDeviceCodeApprove(req: IncomingMessage, code: string, res: ServerResponse, started: number): Promise<void> {
  let body: { user_id: string; email: string; name?: string };
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString()) as typeof body;
  } catch {
    writeJson(res, 400, { error: "Invalid body" });
    return;
  }

  if (!body.user_id || !body.email) {
    writeJson(res, 400, { error: "user_id and email required" });
    return;
  }

  try {
    // Find by session_id first (URL param), fall back to user_code (legacy)
    let [entry] = await db.select().from(deviceCodeTable)
      .where(and(eq(deviceCodeTable.sessionId, code), eq(deviceCodeTable.status, "pending")))
      .limit(1);
    if (!entry) {
      [entry] = await db.select().from(deviceCodeTable)
        .where(and(eq(deviceCodeTable.userCode, code), eq(deviceCodeTable.status, "pending")))
        .limit(1);
    }

    if (!entry) {
      writeJson(res, 404, { error: "Code not found or expired" });
      return;
    }

    if (new Date() > entry.expiresAt) {
      await db.update(deviceCodeTable).set({ status: "expired" }).where(eq(deviceCodeTable.id, entry.id));
      writeJson(res, 410, { error: "Code expired" });
      return;
    }

    // Sign a CLI session JWT (30 days)
    const now = Math.floor(Date.now() / 1000);
    const token = await signCliJwt({
      sub: body.user_id,
      email: body.email,
      name: body.name,
      type: "cli-session",
      jti: crypto.randomUUID(),
      iat: now,
      exp: now + 30 * 24 * 60 * 60,
    });

    // Update device code as approved
    await db.update(deviceCodeTable).set({
      status: "approved",
      userId: body.user_id,
      sessionToken: token,
      approvedAt: new Date(),
    }).where(eq(deviceCodeTable.id, entry.id));

    // Create CLI session record
    await db.insert(cliSessionTable).values({
      userId: body.user_id,
      deviceCodeId: entry.id,
      hostname: entry.hostname,
      platform: entry.platform,
      arch: entry.arch,
      tokenHash: await hashToken(token),
    });

    writeJson(res, 200, { ok: true });
    log.info("device-code-approve", {
      route: "POST /cli/device-code/:code/approve",
      user_id: body.user_id,
      hostname: entry.hostname,
      platform: entry.platform,
      latency_ms: Date.now() - started,
    });
  } catch (e) {
    log.error("device-code-approve", { error: e instanceof Error ? e.message : String(e) });
    writeJson(res, 500, { error: "Failed to approve device code" });
  }
}

/** GET /cli/sessions?user_id=... — list CLI sessions for a user. */
/** GET /cli/meshes?user_id=... — list all meshes for a user with member counts. */
async function handleCliMeshesList(req: IncomingMessage, res: ServerResponse, started: number): Promise<void> {
  // Legacy fallback for pre-alpha.36 clients that put user_id in query.
  // requireCliAuth reads it off a body; we synthesize one for GET.
  const url = new URL(req.url!, "http://localhost");
  const legacyBody = { user_id: url.searchParams.get("user_id") ?? undefined };
  const auth = await requireCliAuth(req, res, legacyBody);
  if (!auth) return;
  const userId = auth.userId;

  try {
    // Find meshes via two paths:
    // 1. member.user_id matches (explicitly linked)
    // 2. mesh.owner_user_id matches (owner, even if member row has no user_id)
    const memberMeshes = await db.select({
      memberId: meshMember.id,
      meshId: meshMember.meshId,
      role: meshMember.role,
      joinedAt: meshMember.joinedAt,
    }).from(meshMember).where(
      and(eq(meshMember.userId, userId), isNull(meshMember.revokedAt))
    );

    const ownedMeshes = await db.select({
      id: mesh.id,
      slug: mesh.slug,
      name: mesh.name,
    }).from(mesh).where(
      and(eq(mesh.ownerUserId, userId), isNull(mesh.archivedAt))
    );

    // Merge: deduplicate by meshId
    const seen = new Set<string>();
    const allMeshIds: Array<{ meshId: string; role: string; joinedAt: Date; fromMember: boolean }> = [];

    for (const m of memberMeshes) {
      seen.add(m.meshId);
      allMeshIds.push({ meshId: m.meshId, role: m.role, joinedAt: m.joinedAt, fromMember: true });
    }
    for (const m of ownedMeshes) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        allMeshIds.push({ meshId: m.id, role: "admin", joinedAt: new Date(), fromMember: false });
      }
    }

    const meshes = await Promise.all(allMeshIds.map(async (m) => {
      const [meshRow] = await db.select().from(mesh).where(eq(mesh.id, m.meshId)).limit(1);
      if (!meshRow || meshRow.archivedAt) return null;

      const memberCount = await db.select({ id: meshMember.id }).from(meshMember)
        .where(and(eq(meshMember.meshId, m.meshId), isNull(meshMember.revokedAt)));

      let activeConns = 0;
      for (const c of connections.values()) { if (c.meshId === m.meshId) activeConns++; }

      return {
        id: meshRow.id,
        slug: meshRow.slug,
        name: meshRow.name,
        role: m.role,
        is_owner: meshRow.ownerUserId === userId,
        member_count: memberCount.length,
        active_peers: activeConns,
        joined_at: m.joinedAt.toISOString(),
        broker_url: `wss://${req.headers.host ?? "ic.claudemesh.com"}/ws`,
      };
    }));

    writeJson(res, 200, { meshes: meshes.filter(Boolean) });
    log.info("cli-meshes", { route: "GET /cli/meshes", user_id: userId, count: meshes.length, latency_ms: Date.now() - started });
  } catch (e) {
    log.error("cli-meshes", { error: e instanceof Error ? e.message : String(e) });
    writeJson(res, 500, { error: "Failed to list meshes" });
  }
}

async function handleCliSessionsList(req: IncomingMessage, res: ServerResponse, started: number): Promise<void> {
  const url = new URL(req.url!, "http://localhost");
  const userId = url.searchParams.get("user_id");

  if (!userId) {
    writeJson(res, 400, { error: "user_id required" });
    return;
  }

  try {
    const sessions = await db.select().from(cliSessionTable)
      .where(and(eq(cliSessionTable.userId, userId), isNull(cliSessionTable.revokedAt)))
      .orderBy(cliSessionTable.createdAt);

    writeJson(res, 200, {
      sessions: sessions.map(s => ({
        id: s.id,
        hostname: s.hostname,
        platform: s.platform,
        arch: s.arch,
        last_seen_at: s.lastSeenAt?.toISOString(),
        created_at: s.createdAt.toISOString(),
      })),
    });
    log.info("cli-sessions", { route: "GET /cli/sessions", user_id: userId, count: sessions.length, latency_ms: Date.now() - started });
  } catch (e) {
    log.error("cli-sessions", { error: e instanceof Error ? e.message : String(e) });
    writeJson(res, 500, { error: "Failed to list sessions" });
  }
}

/** POST /cli/token — generate a CLI token for paste-based auth. */
async function handleCliTokenGenerate(req: IncomingMessage, res: ServerResponse, started: number): Promise<void> {
  let body: { user_id: string; email: string; name?: string; hostname?: string; platform?: string; arch?: string };
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString()) as typeof body;
  } catch {
    writeJson(res, 400, { error: "Invalid body" });
    return;
  }

  if (!body.user_id || !body.email) {
    writeJson(res, 400, { error: "user_id and email required" });
    return;
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const token = await signCliJwt({
      sub: body.user_id,
      email: body.email,
      name: body.name,
      type: "cli-token",
      jti: crypto.randomUUID(),
      iat: now,
      exp: now + 30 * 24 * 60 * 60,
    });

    // Record session
    await db.insert(cliSessionTable).values({
      userId: body.user_id,
      hostname: body.hostname ?? "paste-token",
      platform: body.platform ?? "unknown",
      arch: body.arch ?? "unknown",
      tokenHash: await hashToken(token),
    });

    writeJson(res, 200, { token });
    log.info("cli-token", { route: "POST /cli/token", user_id: body.user_id, latency_ms: Date.now() - started });
  } catch (e) {
    log.error("cli-token", { error: e instanceof Error ? e.message : String(e) });
    writeJson(res, 500, { error: "Failed to generate token" });
  }
}

/** POST /cli/session/revoke — revoke a CLI session by token. */
async function handleCliSessionRevoke(req: IncomingMessage, res: ServerResponse, started: number): Promise<void> {
  let body: { token?: string };
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString()) as typeof body;
  } catch {
    writeJson(res, 400, { error: "Invalid body" });
    return;
  }

  if (!body.token) {
    writeJson(res, 400, { error: "token required" });
    return;
  }

  try {
    const hash = await hashToken(body.token);
    const [session] = await db.select().from(cliSessionTable)
      .where(and(eq(cliSessionTable.tokenHash, hash), isNull(cliSessionTable.revokedAt)))
      .limit(1);

    if (!session) {
      // Token not in DB — might be an old token from before device-code tracking.
      // Still return ok since the local token will be cleared.
      writeJson(res, 200, { ok: true, found: false });
      return;
    }

    await db.update(cliSessionTable)
      .set({ revokedAt: new Date() })
      .where(eq(cliSessionTable.id, session.id));

    writeJson(res, 200, { ok: true, found: true });
    log.info("cli-session-revoke", { route: "POST /cli/session/revoke", session_id: session.id, user_id: session.userId, latency_ms: Date.now() - started });
  } catch (e) {
    log.error("cli-session-revoke", { error: e instanceof Error ? e.message : String(e) });
    writeJson(res, 500, { error: "Failed to revoke session" });
  }
}

// ---------------------------------------------------------------------------
// Mesh management + permissions handlers
// ---------------------------------------------------------------------------

import { checkPermission, getPermissions, setPermissions } from "./permissions";
import { meshPermission } from "@turbostarter/db/schema/mesh";

/** POST /cli/mesh/create — create a new mesh via CLI. */
/** POST /cli/mesh/:slug/grants — set per-peer grants for the caller's membership.
 *
 * Body: { user_id: string, grants: Record<peer_pubkey_hex, string[]> }
 * Merges the map into the caller's mesh_member.peer_grants. Empty array
 * for a specific peer = blocked. Explicit null = reset to defaults.
 */
async function handleCliMeshGrants(req: IncomingMessage, slug: string, res: ServerResponse, started: number): Promise<void> {
  let body: { grants: Record<string, string[] | null>; user_id?: string };
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString()) as typeof body;
  } catch {
    writeJson(res, 400, { error: "Invalid body" });
    return;
  }

  const auth = await requireCliAuth(req, res, body);
  if (!auth) return;
  if (!body.grants) {
    writeJson(res, 400, { error: "grants required" });
    return;
  }
  try {
    const [m] = await db.select().from(mesh).where(eq(mesh.slug, slug)).limit(1);
    if (!m) { writeJson(res, 404, { error: "Mesh not found" }); return; }
    // Find the caller's member row.
    const [member] = await db.select().from(meshMember)
      .where(and(eq(meshMember.meshId, m.id), eq(meshMember.userId, auth.userId), isNull(meshMember.revokedAt)))
      .limit(1);
    if (!member) {
      writeJson(res, 403, { error: "Not a member of this mesh" });
      return;
    }
    const current = (member.peerGrants as Record<string, string[]>) ?? {};
    const merged = { ...current };
    for (const [pk, caps] of Object.entries(body.grants)) {
      if (caps === null) delete merged[pk];
      else merged[pk] = caps;
    }
    await db.update(meshMember).set({ peerGrants: merged }).where(eq(meshMember.id, member.id));
    writeJson(res, 200, { ok: true, grants: merged });
    log.info("mesh-grants", { route: "POST /cli/mesh/:slug/grants", slug, member_id: member.id, latency_ms: Date.now() - started });
  } catch (e) {
    log.error("mesh-grants", { error: e instanceof Error ? e.message : String(e) });
    writeJson(res, 500, { error: "Failed to update grants" });
  }
}

/** POST /cli/mesh/:slug/invite — generate an invite for a mesh. */
async function handleCliMeshInvite(req: IncomingMessage, slug: string, res: ServerResponse, started: number): Promise<void> {
  let body: { email?: string; expires_in?: string; role?: string; user_id?: string };
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString()) as typeof body;
  } catch {
    writeJson(res, 400, { error: "Invalid body" });
    return;
  }

  const auth = await requireCliAuth(req, res, body);
  if (!auth) return;

  try {
    const [m] = await db.select().from(mesh).where(eq(mesh.slug, slug)).limit(1);
    if (!m) { writeJson(res, 404, { error: "Mesh not found" }); return; }
    if (m.ownerUserId !== auth.userId) {
      writeJson(res, 403, { error: "Only the owner can invite (for now)" });
      return;
    }

    const sodiumMod = await import("libsodium-wrappers");
    const s = sodiumMod.default;
    await s.ready;

    // Self-heal: CLI-created meshes before this fix lack owner keys. Generate + persist.
    let ownerPubkey = m.ownerPubkey;
    let ownerSecretKey = m.ownerSecretKey;
    let rootKey = m.rootKey;
    if (!ownerPubkey || !ownerSecretKey || !rootKey) {
      const kp = s.crypto_sign_keypair();
      ownerPubkey = s.to_hex(kp.publicKey);
      ownerSecretKey = s.to_hex(kp.privateKey);
      rootKey = s.to_base64(s.randombytes_buf(32), s.base64_variants.URLSAFE_NO_PADDING);
      await db.execute(sql`UPDATE mesh.mesh SET owner_pubkey = ${ownerPubkey}, owner_secret_key = ${ownerSecretKey}, root_key = ${rootKey} WHERE id = ${m.id}`);
    }

    const role = (body.role === "admin" ? "admin" : "member") as "admin" | "member";
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const expiresAtSec = Math.floor(expiresAt.getTime() / 1000);
    const brokerUrl = process.env.BROKER_URL || "wss://ic.claudemesh.com/ws";

    const payloadCore = {
      v: 1 as const,
      mesh_id: m.id,
      mesh_slug: m.slug,
      broker_url: brokerUrl,
      expires_at: expiresAtSec,
      mesh_root_key: rootKey,
      role,
      owner_pubkey: ownerPubkey,
    };
    const canonical = canonicalInvite(payloadCore);
    const signature = s.to_hex(s.crypto_sign_detached(s.from_string(canonical), s.from_hex(ownerSecretKey)));
    const token = Buffer.from(JSON.stringify({ ...payloadCore, signature }), "utf-8").toString("base64url");

    // Short code with collision retry
    let code = generateShortCode(8);
    let inviteId = "";
    for (let i = 0; i < 3; i++) {
      try {
        const rows = await db.insert(inviteTable).values({
          meshId: m.id,
          token,
          tokenBytes: canonical,
          code,
          maxUses: 1,
          role,
          expiresAt,
          createdBy: auth.userId,
          version: 2,
        }).returning({ id: inviteTable.id });
        inviteId = rows[0]!.id;
        break;
      } catch (e) {
        if (e instanceof Error && e.message.includes("invite_code_unique_idx")) {
          code = generateShortCode(8);
          continue;
        }
        throw e;
      }
    }
    if (!inviteId) throw new Error("Could not allocate unique invite code");

    // v2 capability backfill
    const canonicalV2 = canonicalInviteV2({ mesh_id: m.id, invite_id: inviteId, expires_at: expiresAtSec, role, owner_pubkey: ownerPubkey });
    const signatureV2 = s.to_hex(s.crypto_sign_detached(s.from_string(canonicalV2), s.from_hex(ownerSecretKey)));
    await db.update(inviteTable).set({ capabilityV2: JSON.stringify({ canonical: canonicalV2, signature: signatureV2 }) }).where(eq(inviteTable.id, inviteId));

    const baseUrl = process.env.APP_URL || "https://claudemesh.com";
    const url = `${baseUrl}/i/${code}`;

    // If an email was provided, send the invite link via Postmark/Resend.
    let emailed = false;
    if (body.email) {
      const apiKey = process.env.POSTMARK_API_KEY ?? process.env.RESEND_API_KEY;
      const fromAddr = process.env.EMAIL_FROM ?? "noreply@claudemesh.com";
      if (apiKey) {
        try {
          const { render } = await import("@react-email/render");
          const { MeshInvitation } = await import("./emails/mesh-invitation");
          const React = await import("react");
          const subject = `You're invited to join "${m.name}" on claudemesh`;
          const element = React.createElement(MeshInvitation, { meshName: m.name, inviteUrl: url, token, expiresAt: expiresAt.toISOString(), appBaseUrl: baseUrl });
          const html = await render(element);
          const text = await render(element, { plainText: true });
          const res = process.env.POSTMARK_API_KEY
            ? await fetch("https://api.postmarkapp.com/email", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Postmark-Server-Token": apiKey },
                body: JSON.stringify({ From: fromAddr, To: body.email, Subject: subject, HtmlBody: html, TextBody: text, MessageStream: "outbound" }),
                signal: AbortSignal.timeout(10_000),
              })
            : await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({ from: fromAddr, to: body.email, subject, html, text }),
                signal: AbortSignal.timeout(10_000),
              });
          emailed = res.ok;
          if (!res.ok) log.warn("invite email send failed", { status: res.status, body: await res.text().catch(() => "") });
        } catch (e) {
          log.error("invite email send error", { error: e instanceof Error ? e.message : String(e) });
        }
      } else {
        log.warn("invite email requested but no POSTMARK_API_KEY/RESEND_API_KEY configured");
      }
    }

    writeJson(res, 200, { url, code, expires_at: expiresAt.toISOString(), emailed });
    log.info("mesh-invite", { route: "POST /cli/mesh/:slug/invite", slug, code, email: body.email, emailed, latency_ms: Date.now() - started });
  } catch (e) {
    log.error("mesh-invite", { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
    writeJson(res, 500, { error: "Failed to create invite" });
  }
}

async function handleCliMeshCreate(req: IncomingMessage, res: ServerResponse, started: number): Promise<void> {
  // Parse body first so the legacy auth fallback can read user_id from it.
  let body: { name: string; pubkey?: string; slug?: string; template?: string; description?: string; user_id?: string };
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString()) as typeof body;
  } catch {
    writeJson(res, 400, { error: "Invalid body" });
    return;
  }

  const auth = await requireCliAuth(req, res, body);
  if (!auth) return;

  if (!body.name) {
    writeJson(res, 400, { error: "name required" });
    return;
  }

  try {
    let slug = body.slug ?? body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    // Auto-increment slug if taken
    let baseSlug = slug;
    let suffix = 2;
    while (true) {
      const [existing] = await db.select().from(mesh).where(eq(mesh.slug, slug)).limit(1);
      if (!existing || existing.archivedAt) break;
      slug = `${baseSlug}-${suffix}`;
      suffix++;
      if (suffix > 100) {
        writeJson(res, 409, { error: "Too many meshes with this name" });
        return;
      }
    }

    const meshId = generateId();

    // Generate owner signing keypair + root key so invites can be issued later.
    const sodiumMod = await import("libsodium-wrappers");
    const s = sodiumMod.default;
    await s.ready;
    const kp = s.crypto_sign_keypair();
    const ownerPubkey = s.to_hex(kp.publicKey);
    const ownerSecretKey = s.to_hex(kp.privateKey);
    const rootKey = s.to_base64(s.randombytes_buf(32), s.base64_variants.URLSAFE_NO_PADDING);

    // Create mesh — use raw SQL to avoid Drizzle default-column issues
    await db.execute(sql`
      INSERT INTO mesh.mesh (id, name, slug, owner_user_id, owner_pubkey, owner_secret_key, root_key)
      VALUES (${meshId}, ${body.name}, ${slug}, ${auth.userId}, ${ownerPubkey}, ${ownerSecretKey}, ${rootKey})
    `);

    // Create owner member.
    // Reject "pending" — older CLIs sent no pubkey and the broker stored the
    // literal string, which then made every subsequent hello fail the pubkey
    // membership check silently. If the caller didn't send a pubkey, refuse
    // the create rather than store a poison row.
    if (!body.pubkey || !/^[0-9a-f]{64}$/i.test(body.pubkey)) {
      writeJson(res, 400, { error: "pubkey required (64 hex chars)" });
      return;
    }
    const memberId = generateId();
    await db.execute(sql`
      INSERT INTO mesh.member (id, mesh_id, user_id, peer_pubkey, display_name, role)
      VALUES (${memberId}, ${meshId}, ${auth.userId}, ${body.pubkey}, ${body.name + "-owner"}, ${"admin"})
    `);

    // Auto-create the conventional #general topic + subscribe the owner.
    // Idempotent via unique (mesh_id, name) — re-running is a no-op.
    const generalTopicId = generateId();
    await db.execute(sql`
      INSERT INTO mesh.topic (id, mesh_id, name, description, visibility, created_by_member_id)
      VALUES (${generalTopicId}, ${meshId}, ${"general"}, ${"Default mesh-wide channel. Every member can read and post."}, ${"public"}, ${memberId})
      ON CONFLICT (mesh_id, name) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO mesh.topic_member (topic_id, member_id, role)
      SELECT t.id, ${memberId}, ${"lead"}
      FROM mesh.topic t
      WHERE t.mesh_id = ${meshId} AND t.name = ${"general"}
      ON CONFLICT (topic_id, member_id) DO NOTHING
    `);

    writeJson(res, 200, { id: meshId, slug, name: body.name, member_id: memberId });
    log.info("mesh-create", { route: "POST /cli/mesh/create", slug, user_id: auth.userId, latency_ms: Date.now() - started });
  } catch (e) {
    log.error("mesh-create", { error: e instanceof Error ? e.message : String(e) });
    writeJson(res, 500, { error: "Failed to create mesh" });
  }
}

/** DELETE /cli/mesh/:slug — delete a mesh (owner only). */
async function handleMeshDelete(req: IncomingMessage, slug: string, res: ServerResponse, started: number): Promise<void> {
  // Parse body up front for legacy auth fallback.
  let body: { user_id?: string } = {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    if (raw) body = JSON.parse(raw) as typeof body;
  } catch { /* empty body is OK for DELETE with bearer auth */ }
  const auth = await requireCliAuth(req, res, body);
  if (!auth) return;

  try {
    const [m] = await db.select().from(mesh).where(eq(mesh.slug, slug)).limit(1);
    if (!m) { writeJson(res, 404, { error: "Mesh not found" }); return; }

    if (m.ownerUserId !== auth.userId) {
      writeJson(res, 403, { error: "Only the mesh owner can delete it" });
      return;
    }

    await db.update(mesh).set({ archivedAt: new Date() }).where(eq(mesh.id, m.id));

    writeJson(res, 200, { ok: true, deleted: slug });
    log.info("mesh-delete", { route: "DELETE /cli/mesh/:slug", slug, user_id: auth.userId, latency_ms: Date.now() - started });
  } catch (e) {
    log.error("mesh-delete", { error: e instanceof Error ? e.message : String(e) });
    writeJson(res, 500, { error: "Failed to delete mesh" });
  }
}

/** GET /cli/mesh/:slug/permissions — get all member permissions for a mesh. */
async function handlePermissionsGet(slug: string, res: ServerResponse, started: number): Promise<void> {
  try {
    const [m] = await db.select().from(mesh).where(eq(mesh.slug, slug)).limit(1);
    if (!m) { writeJson(res, 404, { error: "Mesh not found" }); return; }

    const members = await db.select().from(meshMember).where(eq(meshMember.meshId, m.id));

    const result = await Promise.all(members.map(async (member) => ({
      member_id: member.id,
      display_name: member.displayName,
      role: member.role,
      is_owner: m.ownerUserId ? member.userId === m.ownerUserId : false,
      permissions: await getPermissions(m.id, member.id),
    })));

    writeJson(res, 200, { mesh: slug, members: result });
    log.info("permissions-get", { route: "GET /cli/mesh/:slug/permissions", slug, count: result.length, latency_ms: Date.now() - started });
  } catch (e) {
    log.error("permissions-get", { error: e instanceof Error ? e.message : String(e) });
    writeJson(res, 500, { error: "Failed to get permissions" });
  }
}

/** POST /cli/mesh/:slug/permissions — set permissions for a member. */
async function handlePermissionsSet(req: IncomingMessage, slug: string, res: ServerResponse, started: number): Promise<void> {
  let body: { requester_id: string; member_id: string; permissions: Record<string, boolean> };
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString()) as typeof body;
  } catch {
    writeJson(res, 400, { error: "Invalid body" });
    return;
  }

  if (!body.requester_id || !body.member_id || !body.permissions) {
    writeJson(res, 400, { error: "requester_id, member_id, and permissions required" });
    return;
  }

  try {
    const [m] = await db.select().from(mesh).where(eq(mesh.slug, slug)).limit(1);
    if (!m) { writeJson(res, 404, { error: "Mesh not found" }); return; }

    // Find requester's member record
    const [requester] = await db.select().from(meshMember)
      .where(and(eq(meshMember.meshId, m.id), eq(meshMember.userId, body.requester_id)))
      .limit(1);

    if (!requester) { writeJson(res, 403, { error: "Not a member of this mesh" }); return; }

    // Check if requester can manage permissions
    const canManage = await checkPermission(m.id, requester.id, "canManagePermissions");
    if (!canManage) {
      writeJson(res, 403, { error: "You don't have permission to manage permissions" });
      return;
    }

    // Apply permission updates
    await setPermissions(m.id, body.member_id, body.permissions as any);

    writeJson(res, 200, { ok: true });
    log.info("permissions-set", {
      route: "POST /cli/mesh/:slug/permissions",
      slug,
      requester: body.requester_id,
      target: body.member_id,
      latency_ms: Date.now() - started,
    });
  } catch (e) {
    log.error("permissions-set", { error: e instanceof Error ? e.message : String(e) });
    writeJson(res, 500, { error: "Failed to set permissions" });
  }
}

// ---------------------------------------------------------------------------

// Skip starting the HTTP/WS server when running under vitest — tests import
// claimInviteV2Core() directly and must not bind ports on module load.
if (!process.env.VITEST) {
  main().catch((e) => {
    console.error("fatal:", e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
