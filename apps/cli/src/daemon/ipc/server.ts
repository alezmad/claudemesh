import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

import { DAEMON_PATHS, DAEMON_TCP_HOST, DAEMON_TCP_DEFAULT_PORT } from "../paths.js";
import type { SqliteDb } from "../db/sqlite.js";
import { acceptSend, type SendRequest } from "./handlers/send.js";
import { listInbox } from "../db/inbox.js";
import { listOutbox, requeueDeadOrPending, type OutboxStatus } from "../db/outbox.js";
import { randomUUID } from "node:crypto";
import { bindSseStream, type EventBus } from "../events.js";
import type { DaemonBrokerClient } from "../broker.js";
import { VERSION } from "~/constants/urls.js";

/**
 * Per spec §3.3:
 *   - UDS reaches via filesystem perms (0600): no bearer required.
 *   - TCP loopback + SSE require `Authorization: Bearer <local_token>`.
 *   - Token in query string returns 400 + security log.
 *   - Host header must be localhost / 127.0.0.1 / [::1] / empty.
 *   - All endpoints auth-required by default; `/v1/health` opt-in public.
 *
 * v0.9.0 surface: /v1/version, /v1/health (auth-required), more added later.
 */
export interface IpcServerOptions {
  localToken: string;
  /** Bind a TCP loopback listener too (default true; container default is UDS-only). */
  tcpEnabled?: boolean;
  /** Override the default TCP port. */
  tcpPort?: number;
  /** Make /v1/health reachable without a token (k8s probe scenario). */
  publicHealthCheck?: boolean;
  /** Optional logger. Falls back to console.error for warnings/security events. */
  log?: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
  /** Outbox database handle for /v1/send. */
  outboxDb?: SqliteDb;
  /** Inbox database handle for /v1/inbox. */
  inboxDb?: SqliteDb;
  /** Event bus backing /v1/events SSE stream. */
  bus?: EventBus;
  /** Broker client (for peers/profile passthrough). */
  broker?: DaemonBrokerClient;
  /** Notify when a new outbox row was inserted (drains can wake). */
  onPendingInserted?: () => void;
}

export interface IpcServerHandle {
  uds: Server;
  tcp: Server | null;
  /** Resolves once both listeners are live. */
  ready: Promise<void>;
  close: () => Promise<void>;
}

export function startIpcServer(opts: IpcServerOptions): IpcServerHandle {
  const log = opts.log ?? defaultLogger;

  const handler = makeHandler({
    localToken: opts.localToken,
    publicHealthCheck: !!opts.publicHealthCheck,
    log,
    outboxDb: opts.outboxDb,
    inboxDb: opts.inboxDb,
    bus: opts.bus,
    broker: opts.broker,
    onPendingInserted: opts.onPendingInserted,
  });

  // --- UDS listener -------------------------------------------------------
  if (existsSync(DAEMON_PATHS.SOCK_FILE)) {
    // Possible stale socket from a previous crashed daemon. We hold the
    // singleton lock by the time we reach here, so it's safe to remove.
    try { unlinkSync(DAEMON_PATHS.SOCK_FILE); } catch { /* ignore */ }
  }
  const uds = createServer(handler);
  const udsReady = new Promise<void>((resolve, reject) => {
    uds.once("error", reject);
    uds.listen(DAEMON_PATHS.SOCK_FILE, () => {
      // Restrict the socket file itself; node creates it 0755 by default.
      try { chmodSync(DAEMON_PATHS.SOCK_FILE, 0o600); }
      catch (err) { log("warn", "uds_chmod_failed", { err: String(err) }); }
      resolve();
    });
  });

  // --- TCP listener (optional, off in container defaults) ----------------
  let tcp: Server | null = null;
  let tcpReady: Promise<void> = Promise.resolve();
  if (opts.tcpEnabled !== false) {
    tcp = createServer(handler);
    tcpReady = new Promise<void>((resolve, reject) => {
      tcp!.once("error", reject);
      tcp!.listen(opts.tcpPort ?? DAEMON_TCP_DEFAULT_PORT, DAEMON_TCP_HOST, () => resolve());
    });
  }

  return {
    uds,
    tcp,
    ready: Promise.all([udsReady, tcpReady]).then(() => undefined),
    close: async () => {
      await Promise.allSettled([
        new Promise<void>((res) => uds.close(() => res())),
        tcp ? new Promise<void>((res) => tcp!.close(() => res())) : Promise.resolve(),
      ]);
      try { unlinkSync(DAEMON_PATHS.SOCK_FILE); } catch { /* ignore */ }
    },
  };
}

function defaultLogger(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() });
  if (level === "info") process.stdout.write(line + "\n");
  else process.stderr.write(line + "\n");
}

function makeHandler(opts: {
  localToken: string;
  publicHealthCheck: boolean;
  log: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
  outboxDb?: SqliteDb;
  inboxDb?: SqliteDb;
  bus?: EventBus;
  broker?: DaemonBrokerClient;
  onPendingInserted?: () => void;
}) {
  const tokenBytes = Buffer.from(opts.localToken, "utf8");

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://daemon.local");

    // Token in query string → security event + 400.
    if (url.searchParams.has("token")) {
      opts.log("warn", "ipc_token_in_query_string_rejected", { path: url.pathname });
      respond(res, 400, { error: "token must be in Authorization header, not query string" });
      return;
    }

    // Host header check — only the loopback names allowed.
    const host = (req.headers.host ?? "").toLowerCase().split(":")[0]?.trim() ?? "";
    if (host && host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]" && host !== "::1") {
      respond(res, 403, { error: "forbidden host" });
      return;
    }

    // Origin allowlist — empty by default (no browsers should hit this).
    if (req.headers.origin) {
      respond(res, 403, { error: "forbidden origin" });
      return;
    }

    // Authentication. UDS connections (over unix socket) skip the bearer
    // check because filesystem perms gate access; TCP requires it.
    const isUds = (req.socket as { remoteAddress?: string }).remoteAddress === undefined;
    const isPublicHealth = opts.publicHealthCheck && url.pathname === "/v1/health";
    if (!isUds && !isPublicHealth) {
      const authz = req.headers.authorization ?? "";
      const m = /^Bearer\s+(.+)$/.exec(authz.trim());
      if (!m || !m[1]) {
        respond(res, 401, { error: "missing bearer token" });
        return;
      }
      const provided = Buffer.from(m[1], "utf8");
      if (provided.length !== tokenBytes.length || !timingSafeEqual(provided, tokenBytes)) {
        opts.log("warn", "ipc_bearer_mismatch", { path: url.pathname });
        respond(res, 401, { error: "invalid bearer token" });
        return;
      }
    }

    // Routing.
    if (req.method === "GET" && url.pathname === "/v1/version") {
      respond(res, 200, {
        daemon_version: VERSION,
        ipc_api: "v1",
        ipc_features: ["version", "health", "send", "inbox", "events", "peers", "profile", "skills"],
        schema_version: 1,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/health") {
      respond(res, 200, { ok: true, pid: process.pid });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/events") {
      if (!opts.bus) {
        respond(res, 503, { error: "event bus not initialised" });
        return;
      }
      bindSseStream(res, opts.bus);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/peers") {
      if (!opts.broker) { respond(res, 503, { error: "broker not initialised" }); return; }
      try {
        const peers = await opts.broker.listPeers();
        respond(res, 200, { peers });
      } catch (e) {
        respond(res, 502, { error: "broker_unreachable", detail: String(e) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/skills") {
      if (!opts.broker) { respond(res, 503, { error: "broker not initialised" }); return; }
      const query = url.searchParams.get("query") ?? undefined;
      try {
        const skills = await opts.broker.listSkills(query);
        respond(res, 200, { skills });
      } catch (e) {
        respond(res, 502, { error: "broker_unreachable", detail: String(e) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/v1/skills/")) {
      if (!opts.broker) { respond(res, 503, { error: "broker not initialised" }); return; }
      const name = decodeURIComponent(url.pathname.slice("/v1/skills/".length));
      if (!name) { respond(res, 400, { error: "missing skill name" }); return; }
      try {
        const skill = await opts.broker.getSkill(name);
        if (!skill) { respond(res, 404, { error: "skill_not_found", name }); return; }
        respond(res, 200, { skill });
      } catch (e) {
        respond(res, 502, { error: "broker_unreachable", detail: String(e) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/profile") {
      if (!opts.broker) { respond(res, 503, { error: "broker not initialised" }); return; }
      try {
        const body = await readJsonBody(req, 16 * 1024) as Record<string, unknown> | null;
        if (!body) { respond(res, 400, { error: "expected JSON object" }); return; }
        const updates: Record<string, unknown> = {};
        if (typeof body.summary === "string") opts.broker.setSummary(body.summary);
        if (body.status === "idle" || body.status === "working" || body.status === "dnd") opts.broker.setStatus(body.status);
        if (typeof body.visible === "boolean") opts.broker.setVisible(body.visible);
        const profile: { avatar?: string; title?: string; bio?: string; capabilities?: string[] } = {};
        if (typeof body.avatar === "string") profile.avatar = body.avatar;
        if (typeof body.title === "string") profile.title = body.title;
        if (typeof body.bio === "string") profile.bio = body.bio;
        if (Array.isArray(body.capabilities)) profile.capabilities = body.capabilities.filter((c) => typeof c === "string") as string[];
        if (Object.keys(profile).length > 0) opts.broker.setProfile(profile);
        Object.assign(updates, body);
        respond(res, 200, { ok: true, applied: Object.keys(updates) });
      } catch (e) {
        respond(res, 400, { error: String(e) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/inbox") {
      if (!opts.inboxDb) {
        respond(res, 503, { error: "inbox not initialised" });
        return;
      }
      const sinceRaw = url.searchParams.get("since");
      const since = sinceRaw ? Date.parse(sinceRaw) : undefined;
      const topic = url.searchParams.get("topic") ?? undefined;
      const fromPubkey = url.searchParams.get("from") ?? undefined;
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
      const rows = listInbox(opts.inboxDb, {
        since: Number.isFinite(since) ? since : undefined,
        topic,
        fromPubkey,
        limit: Number.isFinite(limit ?? NaN) ? limit : undefined,
      });
      respond(res, 200, {
        items: rows.map((r) => ({
          id: r.id,
          client_message_id: r.client_message_id,
          broker_message_id: r.broker_message_id,
          mesh: r.mesh,
          topic: r.topic,
          sender_pubkey: r.sender_pubkey,
          sender_name: r.sender_name,
          body: r.body,
          received_at: new Date(r.received_at).toISOString(),
          reply_to_id: r.reply_to_id,
        })),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/outbox") {
      if (!opts.outboxDb) { respond(res, 503, { error: "outbox not initialised" }); return; }
      const statusParam = url.searchParams.get("status") ?? undefined;
      const allowed: OutboxStatus[] = ["pending","inflight","done","dead","aborted"];
      const status = (statusParam && (allowed as string[]).includes(statusParam))
        ? statusParam as OutboxStatus
        : undefined;
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
      const rows = listOutbox(opts.outboxDb, {
        status,
        limit: Number.isFinite(limit ?? NaN) ? limit : undefined,
      });
      respond(res, 200, {
        items: rows.map((r) => ({
          id: r.id,
          client_message_id: r.client_message_id,
          status: r.status,
          attempts: r.attempts,
          enqueued_at: new Date(r.enqueued_at).toISOString(),
          next_attempt_at: new Date(r.next_attempt_at).toISOString(),
          delivered_at: r.delivered_at ? new Date(r.delivered_at).toISOString() : null,
          broker_message_id: r.broker_message_id,
          last_error: r.last_error,
          aborted_at: r.aborted_at ? new Date(r.aborted_at).toISOString() : null,
          aborted_by: r.aborted_by,
          superseded_by: r.superseded_by,
          payload_bytes: r.payload?.byteLength ?? 0,
        })),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/outbox/requeue") {
      if (!opts.outboxDb) { respond(res, 503, { error: "outbox not initialised" }); return; }
      try {
        const body = await readJsonBody(req, 4 * 1024) as Record<string, unknown> | null;
        if (!body || typeof body.id !== "string") { respond(res, 400, { error: "missing 'id'" }); return; }
        const newId = typeof body.new_client_message_id === "string" && body.new_client_message_id.trim()
          ? body.new_client_message_id.trim()
          : randomUUID();
        const result = requeueDeadOrPending(opts.outboxDb, {
          id: body.id,
          newClientMessageId: newId,
          newRowId: randomUUID(),
          now: Date.now(),
          abortedBy: typeof body.aborted_by === "string" ? body.aborted_by : "operator",
        });
        if (!result) {
          respond(res, 409, { error: "row not found, already aborted, or already done" });
          return;
        }
        respond(res, 200, {
          aborted_row_id: result.abortedRowId,
          new_row_id: result.newRowId,
          new_client_message_id: result.newClientMessageId,
        });
        opts.onPendingInserted?.();
      } catch (e) {
        respond(res, 400, { error: String(e) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/send") {
      if (!opts.outboxDb) {
        respond(res, 503, { error: "outbox not initialised" });
        return;
      }
      try {
        const body = await readJsonBody(req, 256 * 1024);
        const parsed = parseSendRequest(body, req.headers["idempotency-key"]);
        if ("error" in parsed) {
          respond(res, 400, { error: parsed.error });
          return;
        }
        const outcome = acceptSend(parsed.req, { db: opts.outboxDb });
        switch (outcome.kind) {
          case "accepted_pending":
            respond(res, outcome.status, {
              client_message_id: outcome.client_message_id,
              status: "queued",
            });
            opts.onPendingInserted?.();
            return;
          case "accepted_inflight":
            respond(res, outcome.status, {
              client_message_id: outcome.client_message_id,
              status: "inflight",
            });
            return;
          case "accepted_done":
            respond(res, outcome.status, {
              client_message_id: outcome.client_message_id,
              broker_message_id: outcome.broker_message_id,
              duplicate: true,
            });
            return;
          case "conflict":
            respond(res, outcome.status, {
              error: "idempotency_key_reused",
              conflict: outcome.reason,
              daemon_fingerprint_prefix: outcome.daemon_fingerprint_prefix,
              broker_message_id: outcome.broker_message_id ?? null,
            });
            return;
        }
      } catch (err) {
        opts.log("error", "ipc_send_failed", { err: String(err) });
        respond(res, 500, { error: "internal" });
        return;
      }
    }

    respond(res, 404, { error: "not found" });
  };
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) throw new Error("payload_too_large");
    chunks.push(buf);
  }
  if (total === 0) return null;
  const text = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(text); }
  catch { throw new Error("invalid_json"); }
}

interface ParsedSend { req: SendRequest }
interface ParseError  { error: string }

function parseSendRequest(body: unknown, idempotencyHeader: string | string[] | undefined): ParsedSend | ParseError {
  if (!body || typeof body !== "object") return { error: "expected JSON object" };
  const b = body as Record<string, unknown>;

  const to = typeof b.to === "string" ? b.to.trim() : "";
  const message = typeof b.message === "string" ? b.message : "";
  if (!to) return { error: "missing 'to'" };
  if (!message) return { error: "missing 'message'" };

  const priority = b.priority;
  if (priority !== undefined && priority !== "now" && priority !== "next" && priority !== "low") {
    return { error: "priority must be 'now' | 'next' | 'low'" };
  }

  const meta = b.meta;
  if (meta !== undefined && meta !== null && (typeof meta !== "object" || Array.isArray(meta))) {
    return { error: "'meta' must be an object" };
  }

  // Resolve destination_kind / destination_ref from the `to` shape.
  // For v0.9.0 we accept three forms:
  //   "@<topic>"        → topic
  //   "*"               → broadcast (modeled as topic *)
  //   anything else     → dm to peer name|pubkey (resolution happens later)
  let destination_kind: SendRequest["destination_kind"];
  let destination_ref: string;
  if (to.startsWith("@")) {
    destination_kind = "topic";
    destination_ref = to.slice(1);
  } else if (to === "*") {
    destination_kind = "topic";
    destination_ref = "*";
  } else {
    destination_kind = "dm";
    destination_ref = to;
  }

  const headerId = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader;
  const client_message_id = typeof b.client_message_id === "string" && b.client_message_id.trim()
    ? b.client_message_id.trim()
    : (typeof headerId === "string" && headerId.trim() ? headerId.trim() : undefined);

  const reply_to_id = typeof b.reply_to_id === "string" ? b.reply_to_id : undefined;

  return {
    req: {
      to,
      message,
      priority: priority as SendRequest["priority"] | undefined,
      meta: (meta as Record<string, unknown> | undefined) ?? undefined,
      reply_to_id,
      client_message_id,
      destination_kind,
      destination_ref,
    },
  };
}

function respond(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(json));
  res.end(json);
}
