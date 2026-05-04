import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

import { DAEMON_PATHS, DAEMON_TCP_HOST, DAEMON_TCP_DEFAULT_PORT } from "../paths.js";
import type { SqliteDb } from "../db/sqlite.js";
import { acceptSend, type SendRequest } from "./handlers/send.js";
import { listInbox, deleteInboxRow, flushInbox, markInboxSeen } from "../db/inbox.js";
import { listOutbox, requeueDeadOrPending, type OutboxStatus } from "../db/outbox.js";
import { randomUUID } from "node:crypto";
import { bindSseStream, type EventBus } from "../events.js";
import type { DaemonBrokerClient } from "../broker.js";
import {
  registerSession, deregisterByToken, resolveToken, listSessions, startReaper,
  type SessionInfo,
} from "../session-registry.js";
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
  /** v1.26.0: per-mesh broker map for peers/skills/profile passthrough. */
  brokers?: Map<string, DaemonBrokerClient>;
  /** v1.26.0: per-mesh JoinedMesh entries (carry pubkey + secretKey for crypto). */
  meshConfigs?: Map<string, { slug: string; pubkey: string; secretKey: string }>;
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
    brokers: opts.brokers,
    meshConfigs: opts.meshConfigs,
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
  brokers?: Map<string, DaemonBrokerClient>;
  meshConfigs?: Map<string, { slug: string; pubkey: string; secretKey: string }>;
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

    // Per-session token resolution. Layers on top of the machine-level
    // local-token auth above: callers from inside a `claudemesh launch`-
    // spawned session pass `Authorization: ClaudeMesh-Session <hex>`
    // (instead of, or in addition to, Bearer over TCP) and we resolve
    // it to a SessionInfo that downstream routes use for default-mesh
    // scoping and attribution.
    let session: SessionInfo | null = null;
    {
      const authz = req.headers.authorization ?? "";
      const sm = /^ClaudeMesh-Session\s+([0-9a-f]{64})$/i.exec(authz.trim());
      if (sm && sm[1]) session = resolveToken(sm[1].toLowerCase());
    }
    /** Pick mesh from explicit body/query first, then session default. */
    const meshFromCtx = (explicit?: string | null): string | null =>
      (explicit && explicit.trim()) ? explicit : (session?.mesh ?? null);

    // Routing.
    if (req.method === "GET" && url.pathname === "/v1/version") {
      respond(res, 200, {
        daemon_version: VERSION,
        ipc_api: "v1",
        ipc_features: ["version", "health", "send", "inbox", "events", "peers", "profile", "skills", "state", "memory", "sessions"],
        schema_version: 1,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/health") {
      // 1.31.0: include per-mesh broker WS state so callers can verify
      // functional connectivity, not just that the daemon process is
      // running. Used by `claudemesh install` post-flight to wait for
      // at least one broker to be `open` before declaring success —
      // catches dead WS / DNS / TLS / outbound-blocked-port issues at
      // install time instead of when the user's first message fails.
      const brokers: Record<string, string> = {};
      if (opts.brokers) {
        for (const [slug, client] of opts.brokers) brokers[slug] = client.status;
      }
      respond(res, 200, { ok: true, pid: process.pid, brokers });
      return;
    }

    // Session registry routes (1.29.0)
    if (req.method === "POST" && url.pathname === "/v1/sessions/register") {
      try {
        const body = await readJsonBody(req, 64 * 1024) as Record<string, unknown> | null;
        if (!body) { respond(res, 400, { error: "missing body" }); return; }
        const token = typeof body.token === "string" ? body.token : "";
        if (!/^[0-9a-f]{64}$/i.test(token)) { respond(res, 400, { error: "token must be 64 hex chars" }); return; }
        const sessionId = typeof body.session_id === "string" ? body.session_id : "";
        const mesh = typeof body.mesh === "string" ? body.mesh : "";
        const displayName = typeof body.display_name === "string" ? body.display_name : "";
        const pid = typeof body.pid === "number" ? body.pid : 0;
        if (!sessionId || !mesh || !displayName || !pid) {
          respond(res, 400, { error: "session_id, mesh, display_name, pid all required" });
          return;
        }
        const cwd = typeof body.cwd === "string" ? body.cwd : undefined;
        const role = typeof body.role === "string" ? body.role : undefined;
        const groups = Array.isArray(body.groups)
          ? body.groups.filter((g): g is string => typeof g === "string")
          : undefined;

        // 1.30.0 — optional per-session presence material. Older CLIs
        // omit this; the daemon's session-broker subsystem just won't
        // open a per-session WS for those.
        let presence: SessionInfo["presence"] | undefined;
        const rawPresence = body.presence;
        if (rawPresence && typeof rawPresence === "object") {
          const p = rawPresence as Record<string, unknown>;
          const sessionPubkey = typeof p.session_pubkey === "string" ? p.session_pubkey.toLowerCase() : "";
          const sessionSecretKey = typeof p.session_secret_key === "string" ? p.session_secret_key.toLowerCase() : "";
          const att = p.parent_attestation as Record<string, unknown> | undefined;
          if (
            /^[0-9a-f]{64}$/.test(sessionPubkey) &&
            /^[0-9a-f]{128}$/.test(sessionSecretKey) &&
            att && typeof att === "object" &&
            typeof att.session_pubkey === "string" &&
            typeof att.parent_member_pubkey === "string" &&
            typeof att.expires_at === "number" &&
            typeof att.signature === "string"
          ) {
            presence = {
              sessionPubkey,
              sessionSecretKey,
              parentAttestation: {
                sessionPubkey: (att.session_pubkey as string).toLowerCase(),
                parentMemberPubkey: (att.parent_member_pubkey as string).toLowerCase(),
                expiresAt: att.expires_at as number,
                signature: (att.signature as string).toLowerCase(),
              },
            };
          } else {
            opts.log("warn", "session_register_presence_malformed", { mesh });
          }
        }

        const stored = registerSession({
          token: token.toLowerCase(),
          sessionId, mesh, displayName, pid, cwd, role, groups,
          ...(presence ? { presence } : {}),
        });
        opts.log("info", "session_registered", {
          sessionId, mesh, pid,
          presence: presence ? "yes" : "no",
        });
        respond(res, 200, {
          ok: true,
          registered_at: stored.registeredAt,
          presence_accepted: !!presence,
        });
      } catch (e) {
        respond(res, 400, { error: String(e) });
      }
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/v1/sessions/")) {
      const tail = url.pathname.slice("/v1/sessions/".length);
      if (!/^[0-9a-f]{64}$/i.test(tail)) { respond(res, 400, { error: "invalid token" }); return; }
      const ok = deregisterByToken(tail.toLowerCase());
      respond(res, ok ? 200 : 404, { ok, token_prefix: tail.slice(0, 8) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/sessions/me") {
      if (!session) { respond(res, 401, { error: "no session token" }); return; }
      const { token, ...redacted } = session;
      respond(res, 200, { session: { ...redacted, token_prefix: token.slice(0, 8) } });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/sessions") {
      const all = listSessions().map(({ token, ...rest }) => ({ ...rest, token_prefix: token.slice(0, 8) }));
      respond(res, 200, { sessions: all });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/events") {
      if (!opts.bus) {
        respond(res, 503, { error: "event bus not initialised" });
        return;
      }
      // 1.34.10: per-session SSE demux. When the subscriber presented
      // a ClaudeMesh-Session token (the MCP server always does post-
      // 1.34.10), scope the stream to that session's pubkey + the
      // matching mesh's member pubkey. Diagnostic callers without a
      // session token (`claudemesh daemon events`) get the unfiltered
      // legacy stream. The bus itself stays single-shot; demux lives
      // entirely at the SSE bind layer (events.ts shouldDeliver).
      const filter: Record<string, string> = {};
      if (session?.presence?.sessionPubkey) filter.sessionPubkey = session.presence.sessionPubkey;
      if (session?.mesh) {
        filter.meshSlug = session.mesh;
        const meshCfg = opts.meshConfigs?.get(session.mesh);
        if (meshCfg?.pubkey) filter.memberPubkey = meshCfg.pubkey;
      }
      bindSseStream(res, opts.bus, filter);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/peers") {
      if (!opts.brokers || opts.brokers.size === 0) {
        respond(res, 503, { error: "broker not initialised" });
        return;
      }
      const filterMesh = meshFromCtx(url.searchParams.get("mesh")) ?? undefined;
      try {
        // Aggregate across all attached meshes; each peer record gets a
        // `mesh` field so the caller can scope client-side. A single
        // ?mesh=<slug> filter narrows the set server-side.
        const all: Array<Record<string, unknown> & { mesh: string }> = [];
        for (const [slug, b] of opts.brokers.entries()) {
          if (filterMesh && filterMesh !== slug) continue;
          try {
            const peers = await b.listPeers();
            for (const p of peers) all.push({ ...(p as unknown as Record<string, unknown>), mesh: slug });
          } catch (e) {
            opts.log("warn", "ipc_peers_broker_failed", { mesh: slug, err: String(e) });
          }
        }
        respond(res, 200, { peers: all });
      } catch (e) {
        respond(res, 502, { error: "broker_unreachable", detail: String(e) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/state") {
      if (!opts.brokers || opts.brokers.size === 0) {
        respond(res, 503, { error: "broker not initialised" });
        return;
      }
      const filterMesh = meshFromCtx(url.searchParams.get("mesh")) ?? undefined;
      const key = url.searchParams.get("key");
      try {
        if (key) {
          // Single key lookup. Walk attached meshes; first match wins
          // (or ?mesh=<slug> scopes the search).
          for (const [slug, b] of opts.brokers.entries()) {
            if (filterMesh && filterMesh !== slug) continue;
            const row = await b.getState(key).catch(() => null);
            if (row) { respond(res, 200, { state: { ...row, mesh: slug } }); return; }
          }
          respond(res, 404, { error: "state_not_found", key });
          return;
        }
        // No key — list all entries across attached meshes.
        const all: Array<Record<string, unknown> & { mesh: string }> = [];
        for (const [slug, b] of opts.brokers.entries()) {
          if (filterMesh && filterMesh !== slug) continue;
          const rows = await b.listState().catch(() => []);
          for (const r of rows) all.push({ ...(r as unknown as Record<string, unknown>), mesh: slug });
        }
        respond(res, 200, { entries: all });
      } catch (e) {
        respond(res, 502, { error: "broker_unreachable", detail: String(e) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/state") {
      if (!opts.brokers || opts.brokers.size === 0) {
        respond(res, 503, { error: "broker not initialised" });
        return;
      }
      try {
        const body = await readJsonBody(req, 256 * 1024) as Record<string, unknown> | null;
        if (!body || typeof body.key !== "string") {
          respond(res, 400, { error: "missing 'key' (string)" });
          return;
        }
        const requested = meshFromCtx(typeof body.mesh === "string" ? body.mesh : null);
        let chosen = requested;
        if (!chosen && opts.brokers.size === 1) chosen = opts.brokers.keys().next().value as string;
        if (!chosen) {
          respond(res, 400, { error: "mesh_required", attached: [...opts.brokers.keys()] });
          return;
        }
        const broker = opts.brokers.get(chosen);
        if (!broker) { respond(res, 404, { error: "mesh_not_attached", mesh: chosen }); return; }
        broker.setState(body.key, body.value);
        respond(res, 200, { ok: true, key: body.key, mesh: chosen });
      } catch (e) {
        respond(res, 400, { error: String(e) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/memory") {
      if (!opts.brokers || opts.brokers.size === 0) {
        respond(res, 503, { error: "broker not initialised" });
        return;
      }
      const query = url.searchParams.get("q") ?? "";
      const filterMesh = meshFromCtx(url.searchParams.get("mesh")) ?? undefined;
      try {
        const all: Array<Record<string, unknown> & { mesh: string }> = [];
        for (const [slug, b] of opts.brokers.entries()) {
          if (filterMesh && filterMesh !== slug) continue;
          const rows = await b.recall(query).catch(() => []);
          for (const r of rows) all.push({ ...(r as unknown as Record<string, unknown>), mesh: slug });
        }
        respond(res, 200, { matches: all });
      } catch (e) {
        respond(res, 502, { error: "broker_unreachable", detail: String(e) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/memory") {
      if (!opts.brokers || opts.brokers.size === 0) {
        respond(res, 503, { error: "broker not initialised" });
        return;
      }
      try {
        const body = await readJsonBody(req, 256 * 1024) as Record<string, unknown> | null;
        if (!body || typeof body.content !== "string") {
          respond(res, 400, { error: "missing 'content' (string)" });
          return;
        }
        const requested = meshFromCtx(typeof body.mesh === "string" ? body.mesh : null);
        let chosen = requested;
        if (!chosen && opts.brokers.size === 1) chosen = opts.brokers.keys().next().value as string;
        if (!chosen) {
          respond(res, 400, { error: "mesh_required", attached: [...opts.brokers.keys()] });
          return;
        }
        const broker = opts.brokers.get(chosen);
        if (!broker) { respond(res, 404, { error: "mesh_not_attached", mesh: chosen }); return; }
        const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string") as string[] : undefined;
        const id = await broker.remember(body.content, tags);
        if (!id) { respond(res, 502, { error: "remember_timeout" }); return; }
        respond(res, 200, { id, mesh: chosen });
      } catch (e) {
        respond(res, 400, { error: String(e) });
      }
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/v1/memory/")) {
      if (!opts.brokers || opts.brokers.size === 0) {
        respond(res, 503, { error: "broker not initialised" });
        return;
      }
      const id = decodeURIComponent(url.pathname.slice("/v1/memory/".length));
      if (!id) { respond(res, 400, { error: "missing memory id" }); return; }
      const requested = url.searchParams.get("mesh");
      let chosen = requested;
      if (!chosen && opts.brokers.size === 1) chosen = opts.brokers.keys().next().value as string;
      if (!chosen) {
        respond(res, 400, { error: "mesh_required", attached: [...opts.brokers.keys()] });
        return;
      }
      const broker = opts.brokers.get(chosen);
      if (!broker) { respond(res, 404, { error: "mesh_not_attached", mesh: chosen }); return; }
      broker.forget(id);
      respond(res, 200, { ok: true, id, mesh: chosen });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/skills") {
      if (!opts.brokers || opts.brokers.size === 0) {
        respond(res, 503, { error: "broker not initialised" });
        return;
      }
      const query = url.searchParams.get("query") ?? undefined;
      const filterMesh = meshFromCtx(url.searchParams.get("mesh")) ?? undefined;
      try {
        const all: Array<Record<string, unknown> & { mesh: string }> = [];
        for (const [slug, b] of opts.brokers.entries()) {
          if (filterMesh && filterMesh !== slug) continue;
          try {
            const skills = await b.listSkills(query);
            for (const s of skills) all.push({ ...(s as unknown as Record<string, unknown>), mesh: slug });
          } catch (e) {
            opts.log("warn", "ipc_skills_broker_failed", { mesh: slug, err: String(e) });
          }
        }
        respond(res, 200, { skills: all });
      } catch (e) {
        respond(res, 502, { error: "broker_unreachable", detail: String(e) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/v1/skills/")) {
      if (!opts.brokers || opts.brokers.size === 0) {
        respond(res, 503, { error: "broker not initialised" });
        return;
      }
      const name = decodeURIComponent(url.pathname.slice("/v1/skills/".length));
      if (!name) { respond(res, 400, { error: "missing skill name" }); return; }
      const filterMesh = meshFromCtx(url.searchParams.get("mesh")) ?? undefined;
      try {
        // First mesh that has the skill wins. With ?mesh=<slug>, only that
        // mesh is queried.
        for (const [slug, b] of opts.brokers.entries()) {
          if (filterMesh && filterMesh !== slug) continue;
          const skill = await b.getSkill(name).catch(() => null);
          if (skill) { respond(res, 200, { skill: { ...skill, mesh: slug } }); return; }
        }
        respond(res, 404, { error: "skill_not_found", name });
      } catch (e) {
        respond(res, 502, { error: "broker_unreachable", detail: String(e) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/profile") {
      if (!opts.brokers || opts.brokers.size === 0) {
        respond(res, 503, { error: "broker not initialised" });
        return;
      }
      try {
        const body = await readJsonBody(req, 16 * 1024) as Record<string, unknown> | null;
        if (!body) { respond(res, 400, { error: "expected JSON object" }); return; }
        // v1.26.0: profile updates apply to a specific mesh if `mesh` is
        // present in the body or query, otherwise broadcast to all attached
        // meshes (presence is per-mesh, but most users want consistent
        // presence across all of theirs).
        const requested = meshFromCtx(typeof body.mesh === "string" ? body.mesh : url.searchParams.get("mesh"));
        const targets = requested
          ? [opts.brokers.get(requested)].filter(Boolean) as DaemonBrokerClient[]
          : [...opts.brokers.values()];
        if (targets.length === 0) { respond(res, 404, { error: "mesh_not_attached", mesh: requested }); return; }
        const updates: Record<string, unknown> = {};
        for (const b of targets) {
          if (typeof body.summary === "string") b.setSummary(body.summary);
          if (body.status === "idle" || body.status === "working" || body.status === "dnd") b.setStatus(body.status);
          if (typeof body.visible === "boolean") b.setVisible(body.visible);
          const profile: { avatar?: string; title?: string; bio?: string; capabilities?: string[] } = {};
          if (typeof body.avatar === "string") profile.avatar = body.avatar;
          if (typeof body.title === "string") profile.title = body.title;
          if (typeof body.bio === "string") profile.bio = body.bio;
          if (Array.isArray(body.capabilities)) profile.capabilities = body.capabilities.filter((c) => typeof c === "string") as string[];
          if (Object.keys(profile).length > 0) b.setProfile(profile);
        }
        Object.assign(updates, body);
        respond(res, 200, { ok: true, applied: Object.keys(updates), meshes: requested ? [requested] : [...opts.brokers.keys()] });
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
      // 1.34.0: mesh filter. Falls back to session-default if header set.
      const meshFilter = meshFromCtx(url.searchParams.get("mesh")) ?? undefined;
      // 1.34.8: read-state filter. ?unread_only=true narrows to rows
      // whose seen_at is NULL — used by the welcome push so a freshly
      // launched session surfaces only what it actually missed.
      const unreadOnly = url.searchParams.get("unread_only") === "true";
      // 1.34.8: ?mark_seen=false opts out of the auto-stamp behavior. By
      // default an interactive listing flips seen_at on the rows it just
      // returned (the user "saw" them), which is what we want for the
      // CLI but not for diagnostic tooling that wants to peek without
      // affecting state. The MCP server uses mark_seen=false on the
      // welcome path; it stamps explicitly via /v1/inbox/seen instead.
      const markSeen = url.searchParams.get("mark_seen") !== "false";
      // 1.34.11: scope by recipient when the caller is an authenticated
      // session. The daemon receives every inbox row for every session
      // it hosts, so a query without scoping returns the global table —
      // session A would see B's DMs (the bug 1.34.10 fixed for the
      // live event path; this is the storage half). Scope = session
      // pubkey (DMs) + member pubkey (broadcasts/member DMs the whole
      // member should see) + NULL (legacy rows we can't attribute).
      const recipientPubkey = session?.presence?.sessionPubkey;
      const meshCfgForRecipient = session?.mesh ? opts.meshConfigs?.get(session.mesh) : undefined;
      const recipientMemberPubkey = meshCfgForRecipient?.pubkey;
      const rows = listInbox(opts.inboxDb, {
        since: Number.isFinite(since) ? since : undefined,
        topic,
        fromPubkey,
        ...(meshFilter ? { mesh: meshFilter } : {}),
        unreadOnly,
        ...(recipientPubkey ? { recipientPubkey } : {}),
        ...(recipientMemberPubkey ? { recipientMemberPubkey } : {}),
        limit: Number.isFinite(limit ?? NaN) ? limit : undefined,
      });
      let flippedCount = 0;
      if (markSeen) {
        const unreadIds = rows.filter((r) => r.seen_at == null).map((r) => r.id);
        if (unreadIds.length > 0) {
          flippedCount = markInboxSeen(opts.inboxDb, unreadIds);
        }
      }
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
          // 1.34.8: surface read-state. `null` = never seen (welcome
          // candidate). Note that if mark_seen=true (default), we just
          // stamped these rows — but the snapshot reflects the value
          // BEFORE the stamp so callers can still tell which rows were
          // unread when they asked.
          seen_at: r.seen_at ? new Date(r.seen_at).toISOString() : null,
          // 1.34.11: recipient context. Lets `--json` consumers tell
          // a session DM apart from a member-keyed broadcast, and
          // distinguishes pre-1.34.11 legacy rows (NULL) from
          // properly-scoped ones.
          recipient_pubkey: r.recipient_pubkey,
          recipient_kind: r.recipient_kind,
        })),
        // 1.34.8: how many rows just flipped from unread → seen. Useful
        // for telemetry and lets the CLI render "marked N as read".
        marked_seen: flippedCount,
      });
      return;
    }

    // 1.34.8: explicit mark-seen endpoint. Used by the MCP server after
    // it surfaces a live `<channel>` reminder for an inbox row — Claude
    // Code already saw the row inline, so welcome shouldn't re-surface
    // it on the next launch. Body: { ids: string[] }. Returns the
    // number of rows that flipped from unread → seen.
    if (req.method === "POST" && url.pathname === "/v1/inbox/seen") {
      if (!opts.inboxDb) { respond(res, 503, { error: "inbox not initialised" }); return; }
      try {
        const body = await readJsonBody(req, 64 * 1024) as Record<string, unknown> | null;
        const ids = Array.isArray(body?.ids)
          ? (body!.ids as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
        if (ids.length === 0) { respond(res, 400, { error: "missing 'ids' (string[])" }); return; }
        const flipped = markInboxSeen(opts.inboxDb, ids);
        respond(res, 200, { marked_seen: flipped });
      } catch (e) {
        respond(res, 400, { error: String(e) });
      }
      return;
    }

    // 1.34.7: inbox flush + per-row delete. The inbox is the daemon's
    // local persisted SQLite store — there's no broker-side state to
    // coordinate, so these are simple local writes.
    if (req.method === "DELETE" && url.pathname === "/v1/inbox") {
      if (!opts.inboxDb) { respond(res, 503, { error: "inbox not initialised" }); return; }
      const meshFilter = meshFromCtx(url.searchParams.get("mesh")) ?? undefined;
      const beforeRaw = url.searchParams.get("before");
      const before = beforeRaw ? Date.parse(beforeRaw) : undefined;
      const removed = flushInbox(opts.inboxDb, {
        ...(meshFilter ? { mesh: meshFilter } : {}),
        ...(Number.isFinite(before) ? { before } : {}),
      });
      respond(res, 200, { removed });
      return;
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/v1/inbox/")) {
      if (!opts.inboxDb) { respond(res, 503, { error: "inbox not initialised" }); return; }
      const id = url.pathname.slice("/v1/inbox/".length);
      if (!id) { respond(res, 400, { error: "missing id" }); return; }
      const ok = deleteInboxRow(opts.inboxDb, id);
      if (!ok) { respond(res, 404, { error: "not found", id }); return; }
      respond(res, 200, { removed: 1, id });
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
        // v1.26.0: pick the mesh. Order of preference:
        //   1. Explicit `mesh` field in body
        //   2. Single attached mesh — auto-pick
        //   3. Bail with 400 — caller must disambiguate
        if (opts.brokers && opts.brokers.size > 0 && opts.meshConfigs) {
          let chosenSlug: string | null = parsed.req.mesh ?? null;
          if (!chosenSlug && opts.brokers.size === 1) {
            chosenSlug = opts.brokers.keys().next().value as string;
          }
          if (!chosenSlug) {
            respond(res, 400, {
              error: "mesh_required",
              detail: `daemon attached to ${opts.brokers.size} meshes; pass 'mesh' in request body`,
              attached: [...opts.brokers.keys()],
            });
            return;
          }
          const broker = opts.brokers.get(chosenSlug);
          const meshCfg = opts.meshConfigs.get(chosenSlug);
          if (!broker || !meshCfg) {
            respond(res, 404, { error: "mesh_not_attached", mesh: chosenSlug });
            return;
          }
          // 1.34.0: authenticated session sends encrypt with the session
          // secret key + carry the session pubkey through to the outbox
          // row, so the drain worker can route via SessionBrokerClient
          // and the broker fan-out attributes the push to the session
          // pubkey instead of the daemon's member pubkey. Cold-path
          // sends (no session token) keep the legacy member-key flow.
          const senderSessionPubkey = session?.presence?.sessionPubkey;
          const senderSecretKey = session?.presence?.sessionSecretKey ?? meshCfg.secretKey;
          try {
            const routed = await resolveAndEncrypt(parsed.req, broker, senderSecretKey, chosenSlug);
            parsed.req.target_spec = routed.target_spec;
            parsed.req.ciphertext  = routed.ciphertext;
            parsed.req.nonce       = routed.nonce;
            parsed.req.mesh        = routed.mesh;
            if (senderSessionPubkey) {
              parsed.req.sender_session_pubkey = senderSessionPubkey;
            }
          } catch (e) {
            respond(res, 502, { error: "route_failed", detail: String(e) });
            return;
          }
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

  const mesh = typeof b.mesh === "string" ? b.mesh.trim() : undefined;

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
      mesh,
    },
  };
}

/**
 * Sprint 4: resolve a user-friendly `to` (peer name, pubkey hex, @group, *,
 * topic name, "#topicId") into a broker-format target_spec, and encrypt
 * the plaintext payload appropriately for the destination kind.
 *
 * - DM by 64-char hex pubkey: target_spec = pubkey hex, ciphertext via
 *   crypto_box (recipient pubkey + sender session secret).
 * - DM by display name: resolve via broker.listPeers, then same as above.
 * - Group / broadcast / topic: target_spec = `@<group>` / `*` / `#<topicId>`,
 *   ciphertext = base64(plaintext) [matches the cold path's pre-encryption
 *   convention until topic crypto lands].
 */
async function resolveAndEncrypt(
  req: SendRequest,
  broker: DaemonBrokerClient,
  meshSecretKey: string,
  meshSlug: string | null,
): Promise<{ target_spec: string; ciphertext: string; nonce: string; mesh: string }> {
  const { encryptDirect } = await import("~/services/crypto/box.js");
  const { randomBytes } = await import("node:crypto");
  const to = req.to.trim();

  // Topic by id ("#<topicId>") — hex-like 20+ chars.
  if (to.startsWith("#") && /^#[0-9a-z_-]{20,}$/i.test(to)) {
    const ciphertext = Buffer.from(req.message, "utf8").toString("base64");
    const nonce = randomBytes(24).toString("base64");
    return { target_spec: to, ciphertext, nonce, mesh: meshSlug ?? "" };
  }

  // Group, broadcast — pass through. (Topic-by-name resolution happens
  // when the daemon hooks topic_list later; not required for v1.25.0.)
  if (to.startsWith("@") || to === "*") {
    const ciphertext = Buffer.from(req.message, "utf8").toString("base64");
    const nonce = randomBytes(24).toString("base64");
    return { target_spec: to, ciphertext, nonce, mesh: meshSlug ?? "" };
  }

  // 64-char hex pubkey → DM directly. Encrypt with the daemon's member
  // secret: recipient decrypts using THEIR session pubkey's matching
  // secret on their session-WS, so the sender side just needs any
  // private key whose public counterpart is known to the recipient as
  // "the sender". Member key is the stable choice and is what the
  // recipient already trusts via mesh membership.
  if (/^[0-9a-f]{64}$/i.test(to)) {
    const env = await encryptDirect(req.message, to, meshSecretKey);
    return { target_spec: to, ciphertext: env.ciphertext, nonce: env.nonce, mesh: meshSlug ?? "" };
  }

  // Hex prefix (16+ chars but <64) → resolve via peer list prefix match.
  // Matches the ergonomics of `claudemesh peer list` which shows 16-char
  // prefixes, so users naturally paste prefixes back.
  const peers = await broker.listPeers().catch(() => []);
  if (/^[0-9a-f]{16,63}$/i.test(to)) {
    const matches = peers.filter((p) =>
      p.pubkey.toLowerCase().startsWith(to.toLowerCase()) ||
      (p.memberPubkey ?? "").toLowerCase().startsWith(to.toLowerCase()),
    );
    if (matches.length === 0) throw new Error(`no peer matching prefix "${to}"`);
    if (matches.length > 1) throw new Error(`prefix "${to}" is ambiguous (${matches.length} matches)`);
    const recipient = matches[0]!.pubkey;
    const env = await encryptDirect(req.message, recipient, meshSecretKey);
    return { target_spec: recipient, ciphertext: env.ciphertext, nonce: env.nonce, mesh: meshSlug ?? "" };
  }

  // Otherwise — display name.
  const match = peers.find((p) => p.displayName.toLowerCase() === to.toLowerCase());
  if (!match) throw new Error(`peer "${to}" not found`);
  const recipient = match.pubkey;
  const env = await encryptDirect(req.message, recipient, meshSecretKey);
  return { target_spec: recipient, ciphertext: env.ciphertext, nonce: env.nonce, mesh: meshSlug ?? "" };
}

function respond(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(json));
  res.end(json);
}
