/**
 * MCP server (stdio transport) for claudemesh-cli.
 *
 * As of 1.24.0 / daemon v1.0, the MCP server is a thin daemon-SSE
 * translator. It does NOT hold a broker WebSocket, decrypt messages, or
 * track mesh state — those are the daemon's job. MCP just:
 *
 *   1. probes ~/.claudemesh/daemon/daemon.sock at boot;
 *   2. fails loudly if the daemon isn't running (no fallback);
 *   3. subscribes to /v1/events SSE and translates each event into a
 *      Claude Code `notifications/claude/channel` notification;
 *   4. surfaces mesh-published skills as MCP prompts and resources by
 *      querying /v1/skills over IPC.
 *
 * The mesh-service proxy mode (claudemesh-cli --service <name>) lives at
 * the bottom of this file and is unrelated — it acts as a sub-MCP-server
 * for one deployed mesh-MCP service. Untouched by this rewrite.
 *
 * Spec: .artifacts/specs/2026-05-03-daemon-spec-v0.9.0.md plus the
 * 1.24.0 daemon-required addendum.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, appendFileSync } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { join } from "node:path";

import { DAEMON_PATHS } from "~/daemon/paths.js";
import { VERSION } from "~/constants/urls.js";
import { readConfig } from "~/services/config/facade.js";
import { BrokerClient } from "~/services/broker/facade.js";

// ── daemon probe ───────────────────────────────────────────────────────

const DAEMON_BOOT_RETRIES = 4;
const DAEMON_BOOT_RETRY_MS = 500;

async function daemonReady(): Promise<boolean> {
  for (let i = 0; i < DAEMON_BOOT_RETRIES; i++) {
    if (existsSync(DAEMON_PATHS.SOCK_FILE)) return true;
    await new Promise((r) => setTimeout(r, DAEMON_BOOT_RETRY_MS));
  }
  return false;
}

function bailNoDaemon(): never {
  process.stderr.write(
    "[claudemesh] daemon is not running.\n" +
    "  Start it:               claudemesh daemon up --mesh <slug>\n" +
    "  Or install as service:  claudemesh daemon install-service --mesh <slug>\n" +
    "  Diagnose:               claudemesh doctor\n" +
    "\n" +
    "  As of 1.24.0 the daemon is required for in-Claude-Code use of\n" +
    "  claudemesh. The CLI itself (claudemesh send/peer/inbox/...) still\n" +
    "  works without a daemon.\n",
  );
  process.exit(1);
}

// ── daemon IPC client (UDS) ────────────────────────────────────────────

interface DaemonGetResult { status: number; body: any }

function daemonGet(path: string, opts: { sessionToken?: string | null } = {}): Promise<DaemonGetResult> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    // 1.34.2+: when the launched process gave us a session token, forward
    // it on every IPC. Routes like `/v1/sessions/me` 401 without it, and
    // routes like `/v1/peers` use it for default-mesh scoping.
    if (opts.sessionToken) headers.Authorization = `ClaudeMesh-Session ${opts.sessionToken}`;
    const req = httpRequest(
      { socketPath: DAEMON_PATHS.SOCK_FILE, path, method: "GET", timeout: 5_000, headers },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: any = null;
          try { body = JSON.parse(text); } catch { body = text; }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("daemon_ipc_timeout")));
    req.end();
  });
}

/** 1.34.8: best-effort POST /v1/inbox/seen so the MCP can stamp rows it
 *  just surfaced via a `<channel>` reminder. Failures are swallowed —
 *  read-state is a UX optimization, not a correctness gate. */
function daemonMarkSeen(ids: string[], sessionToken?: string | null): Promise<void> {
  return new Promise((resolve) => {
    if (ids.length === 0) { resolve(); return; }
    const body = JSON.stringify({ ids });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
    };
    if (sessionToken) headers.Authorization = `ClaudeMesh-Session ${sessionToken}`;
    const req = httpRequest(
      { socketPath: DAEMON_PATHS.SOCK_FILE, path: "/v1/inbox/seen", method: "POST", timeout: 3_000, headers },
      (res: IncomingMessage) => { res.on("data", () => { /* drain */ }); res.on("end", () => resolve()); },
    );
    req.on("error", () => resolve());
    req.on("timeout", () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

// ── daemon SSE subscription ────────────────────────────────────────────

interface DaemonEvent { kind: string; ts: string; data: Record<string, any> }

function subscribeEvents(onEvent: (e: DaemonEvent) => void, opts: { sessionToken?: string | null } = {}): { close: () => void } {
  let active = true;
  let req: ReturnType<typeof httpRequest> | null = null;

  const connect = (): void => {
    if (!active) return;
    // 1.34.13: forward the session token on the SSE subscription so the
    // daemon's `/v1/events` route can scope the stream to this session
    // via the SseFilterOptions demux added in 1.34.10. Without this
    // header, `session` resolves to null in the IPC handler, the filter
    // is empty, and every MCP receives every event — manifests as
    // session A rendering DMs that arrived on B's session-WS. The
    // launch helper sets CLAUDEMESH_IPC_TOKEN_FILE in the child env;
    // readSessionTokenFromEnv() picks it up at MCP boot time.
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (opts.sessionToken) headers.Authorization = `ClaudeMesh-Session ${opts.sessionToken}`;
    req = httpRequest({
      socketPath: DAEMON_PATHS.SOCK_FILE,
      path: "/v1/events",
      method: "GET",
      headers,
    });
    let buffer = "";
    req.on("response", (res: IncomingMessage) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!block.trim()) continue;
          let kind = "message";
          let dataLine = "";
          for (const line of block.split("\n")) {
            if (line.startsWith(":")) continue;
            if (line.startsWith("event:")) kind = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
          }
          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine) as Record<string, unknown>;
            onEvent({ kind, ts: String(parsed.ts ?? ""), data: parsed });
          } catch { /* malformed event; skip */ }
        }
      });
      res.on("end", () => {
        if (active) {
          process.stderr.write("[claudemesh-mcp] sse stream ended; reconnecting in 1s\n");
          setTimeout(connect, 1_000);
        }
      });
      res.on("error", (err) => process.stderr.write(`[claudemesh-mcp] sse error: ${err.message}\n`));
    });
    req.on("error", (err) => {
      process.stderr.write(`[claudemesh-mcp] sse connect error: ${err.message}\n`);
      if (active) setTimeout(connect, 2_000);
    });
    req.end();
  };

  connect();
  return {
    close: () => { active = false; try { req?.destroy(); } catch { /* ignore */ } },
  };
}

// ── main MCP server (push-pipe + skills) ──────────────────────────────

export async function startMcpServer(): Promise<void> {
  // Mesh-service proxy mode: separate code path for proxying a deployed
  // mesh MCP service into Claude Code. Unrelated to the daemon push-pipe.
  const serviceIdx = process.argv.indexOf("--service");
  if (serviceIdx !== -1 && process.argv[serviceIdx + 1]) {
    return startServiceProxy(process.argv[serviceIdx + 1]!);
  }

  const ok = await daemonReady();
  if (!ok) bailNoDaemon();

  const server = new Server(
    { name: "claudemesh", version: VERSION },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
        // 1.34.1 — declare the experimental `claude/channel` capability.
        // Claude Code v2.1.x gates `notifications/claude/channel` on this
        // exact key: its `xJ_(serverName, capabilities, pluginSource)` check
        // returns {action:"skip", kind:"capability"} when
        // `capabilities.experimental?.["claude/channel"]` is missing, and
        // the notification handler is never registered → every channel
        // emit lands on the floor, regardless of the
        // `--dangerously-load-development-channels server:claudemesh` flag.
        // This was the silent regression: pre-2.1.x clients didn't gate on
        // this key, so the same MCP wire shape "worked" until Claude Code
        // tightened the check. Verified by reading the binary at the
        // offsets near `notifications/claude/channel` in the strings dump.
        experimental: { "claude/channel": {} },
      },
    },
  );

  // Tools: empty. The CLI is the API; the model invokes it via Bash.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

  // Prompts: mesh-published skills surfaced as `/skill-name` slash commands.
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    try {
      const { status, body } = await daemonGet("/v1/skills");
      if (status !== 200) return { prompts: [] };
      const skills = (body?.skills as Array<{ name: string; description: string }> | undefined) ?? [];
      return { prompts: skills.map((s) => ({ name: s.name, description: s.description, arguments: [] })) };
    } catch { return { prompts: [] }; }
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const name = req.params.name;
    const { status, body } = await daemonGet(`/v1/skills/${encodeURIComponent(name)}`);
    if (status === 404) throw new Error(`Skill "${name}" not found in the mesh`);
    if (status !== 200) throw new Error(`daemon returned ${status} fetching skill`);
    const skill = body.skill as { name: string; description: string; instructions: string; manifest?: any };
    let content = skill.instructions;
    const m = skill.manifest;
    if (m && typeof m === "object") {
      const fm: string[] = ["---"];
      if (m.description) fm.push(`description: "${m.description}"`);
      if (m.when_to_use) fm.push(`when_to_use: "${m.when_to_use}"`);
      if (Array.isArray(m.allowed_tools) && m.allowed_tools.length) {
        fm.push(`allowed-tools:\n${m.allowed_tools.map((t: string) => `  - ${t}`).join("\n")}`);
      }
      if (m.model) fm.push(`model: ${m.model}`);
      if (m.context) fm.push(`context: ${m.context}`);
      if (m.agent) fm.push(`agent: ${m.agent}`);
      if (m.user_invocable === false) fm.push(`user-invocable: false`);
      if (m.argument_hint) fm.push(`argument-hint: "${m.argument_hint}"`);
      fm.push("---\n");
      if (fm.length > 3) content = fm.join("\n") + content;
      if (m.context === "fork") {
        const agentType = m.agent || "general-purpose";
        const modelHint = m.model ? `, model: "${m.model}"` : "";
        const toolsHint = m.allowed_tools?.length
          ? `\nOnly use these tools: ${m.allowed_tools.join(", ")}.`
          : "";
        content = `IMPORTANT: Execute this skill in an isolated sub-agent. Use the Agent tool with subagent_type="${agentType}"${modelHint}. Pass the full instructions below as the agent prompt.${toolsHint}\n\n` + content;
      }
    }
    return {
      description: skill.description,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: content } }],
    };
  });

  // Resources: mesh skills as `skill://claudemesh/<name>` URIs.
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      const { body } = await daemonGet("/v1/skills");
      const skills = (body?.skills as Array<{ name: string; description: string }> | undefined) ?? [];
      return {
        resources: skills.map((s) => ({
          uri: `skill://claudemesh/${encodeURIComponent(s.name)}`,
          name: s.name,
          description: s.description,
          mimeType: "text/markdown",
        })),
      };
    } catch { return { resources: [] }; }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const m = uri.match(/^skill:\/\/claudemesh\/(.+)$/);
    if (!m) throw new Error(`Unknown resource URI: ${uri}`);
    const name = decodeURIComponent(m[1]!);
    const { status, body } = await daemonGet(`/v1/skills/${encodeURIComponent(name)}`);
    if (status === 404) throw new Error(`Skill "${name}" not found`);
    if (status !== 200) throw new Error(`daemon returned ${status} fetching skill`);
    const skill = body.skill as {
      name: string; description: string; instructions: string;
      tags?: string[]; manifest?: any;
    };
    const fm: string[] = ["---"];
    fm.push(`name: ${skill.name}`);
    fm.push(`description: "${skill.description}"`);
    if (skill.tags?.length) fm.push(`tags: [${skill.tags.join(", ")}]`);
    const mf = skill.manifest;
    if (mf && typeof mf === "object") {
      if (mf.when_to_use) fm.push(`when_to_use: "${mf.when_to_use}"`);
      if (Array.isArray(mf.allowed_tools) && mf.allowed_tools.length) {
        fm.push(`allowed-tools:\n${mf.allowed_tools.map((t: string) => `  - ${t}`).join("\n")}`);
      }
      if (mf.model) fm.push(`model: ${mf.model}`);
      if (mf.context) fm.push(`context: ${mf.context}`);
    }
    fm.push("---\n");
    return { contents: [{ uri, mimeType: "text/markdown", text: fm.join("\n") + skill.instructions }] };
  });

  // 1.34.1: every channel emit (and SSE event arrival) writes to a
  // per-pid log file under ~/.claudemesh/daemon/. Stderr from a Claude
  // Code-spawned MCP server isn't surfaced anywhere visible to the
  // user; without an on-disk trace we can't tell whether the SSE
  // delivered the event, whether the bus reached the MCP, or whether
  // server.notification rejected. The file path is stable across MCP
  // restarts so users can `tail -f` to watch live.
  const mcpLogPath = join(DAEMON_PATHS.DAEMON_DIR, `mcp-${process.pid}.log`);
  const mcpLog = (msg: string, meta?: Record<string, unknown>): void => {
    const line = JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, msg, ...meta }) + "\n";
    try { appendFileSync(mcpLogPath, line); } catch { /* logging must never crash */ }
  };
  mcpLog("mcp_started", { version: VERSION });

  // 1.34.8: forward session token on /v1/inbox/seen so the daemon can
  // resolve mesh scoping if it ever needs to. We read it once here and
  // capture it in the closure since the MCP runs for the lifetime of
  // the session; the env var doesn't rotate mid-process.
  const { readSessionTokenFromEnv } = await import("~/services/session/token.js");
  const sessionTokenForSeen = readSessionTokenFromEnv();

  // Subscribe to daemon events; translate to channel notifications.
  // 1.34.13: pass the session token so the daemon scopes the SSE
  // stream via SseFilterOptions. Re-uses the same token already read
  // for /v1/inbox/seen above.
  const sub = subscribeEvents(async (ev) => {
    mcpLog("sse_event_received", { kind: ev.kind });
    if (ev.kind === "message") {
      const d = ev.data;
      const fromName = String(d.sender_name ?? "unknown");
      const fromMember = String(d.sender_member_pubkey ?? d.sender_pubkey ?? "");
      const body = String(d.body ?? "(decrypt failed)");
      const priority = String(d.priority ?? "next");
      const prioBadge = priority === "now" ? "[URGENT] " : priority === "low" ? "[low] " : "";
      const topicTag = d.topic ? ` (#${d.topic})` : "";
      const content = `${prioBadge}${fromName}${topicTag}: ${body}`;
      try {
        await server.notification({
          method: "notifications/claude/channel",
          params: {
            content,
            meta: {
              from_id: fromMember,
              from_pubkey: fromMember,
              from_session_pubkey: String(d.sender_pubkey ?? ""),
              from_name: fromName,
              mesh_slug: String(d.mesh ?? ""),
              priority,
              message_id: String(d.broker_message_id ?? d.id ?? ""),
              client_message_id: String(d.client_message_id ?? ""),
              ...(d.topic ? { topic: String(d.topic) } : {}),
              ...(d.reply_to_id ? { reply_to_id: String(d.reply_to_id) } : {}),
              ...(d.subtype ? { subtype: String(d.subtype) } : {}),
            },
          },
        });
        mcpLog("channel_emitted", { content_preview: content.slice(0, 80), mesh: String(d.mesh ?? "") });
        // 1.34.8: this row was just surfaced inline as a channel
        // reminder; mark it seen so the next launch's welcome doesn't
        // re-surface it as "unread." Best-effort: a failure here just
        // means the welcome will list one extra row, not data loss.
        const inboxRowId = String(d.id ?? "");
        if (inboxRowId) {
          void daemonMarkSeen([inboxRowId], sessionTokenForSeen).catch(() => { /* swallow */ });
        }
      } catch (err) {
        mcpLog("channel_emit_failed", { err: String(err) });
        process.stderr.write(`[claudemesh-mcp] channel emit failed: ${err}\n`);
      }
    } else if (ev.kind === "peer_join" || ev.kind === "peer_leave" || ev.kind === "system") {
      const d = ev.data;
      const eventName = String(d.event ?? ev.kind);
      // 1.34.9: enrich peer_join/leave with the context the broker
      // already ships (name, pubkey prefix, groups, returning summary).
      // Pre-1.34.9 we surfaced just the displayName, which is ambiguous
      // when two sessions share a name (e.g. two `agutierrez` peers in
      // different cwds). Pubkey prefix disambiguates; groups hint at
      // role (e.g. "[ops, devs]"). cwd / role aren't in the broker
      // event yet, so they're skipped — adding them broker-side is a
      // separate ship.
      const renderPeerLine = (verb: string): string => {
        const name = String(d.name ?? "unknown");
        const pubkey = String(d.pubkey ?? "");
        const pubkeyTag = pubkey ? ` (${pubkey.slice(0, 8)})` : "";
        const groups = Array.isArray(d.groups) ? d.groups : [];
        const groupNames = groups
          .map((g) => (typeof g === "object" && g !== null && "name" in g ? String((g as { name: unknown }).name) : typeof g === "string" ? g : ""))
          .filter(Boolean);
        const groupsTag = groupNames.length > 0 ? ` [${groupNames.join(", ")}]` : "";
        const lastSeen = typeof d.lastSeenAt === "string" ? d.lastSeenAt : null;
        const summary = typeof d.summary === "string" && d.summary.trim() ? d.summary.trim() : null;
        const returningTail = lastSeen
          ? ` — last seen ${new Date(lastSeen).toLocaleTimeString()}${summary ? ` · "${summary.slice(0, 80)}"` : ""}`
          : "";
        return `[system] Peer "${name}"${pubkeyTag}${groupsTag} ${verb} the mesh${returningTail}`;
      };
      let content: string;
      if (ev.kind === "peer_join") {
        content = renderPeerLine(eventName === "peer_returned" ? "returned to" : "joined");
      } else if (ev.kind === "peer_leave") {
        content = renderPeerLine("left");
      } else {
        content = `[system] ${eventName}: ${JSON.stringify(d).slice(0, 240)}`;
      }
      try {
        await server.notification({
          method: "notifications/claude/channel",
          params: {
            content,
            meta: {
              kind: "system",
              event: eventName,
              mesh_slug: String(d.mesh ?? ""),
              ...(typeof d.name === "string" ? { peer_name: d.name } : {}),
              ...(typeof d.pubkey === "string" ? { peer_pubkey: d.pubkey } : {}),
              ...(Array.isArray(d.groups) ? { peer_groups: JSON.stringify(d.groups) } : {}),
              ...(typeof d.lastSeenAt === "string" ? { peer_last_seen_at: d.lastSeenAt } : {}),
              ...(typeof d.summary === "string" ? { peer_summary: d.summary } : {}),
            },
          },
        });
      } catch { /* best effort */ }
    }
  }, { sessionToken: sessionTokenForSeen });

  // 1.34.6 — Welcome: single emit on oninitialized + 3s grace.
  //
  // The earlier "timing race" theory was wrong. Reading Claude Code's
  // binary at the `notifications/claude/channel` Zod schema:
  //
  //     IJ_ = y.object({
  //       method: y.literal("notifications/claude/channel"),
  //       params: y.object({
  //         content: y.string(),
  //         meta: y.record(y.string(), y.string()).optional()
  //       })
  //     })
  //
  // `meta` MUST be a record of string-to-string. Pre-1.34.6 the
  // welcome shipped numbers (`peer_count`, `unread_count`) and arrays
  // (`peer_names`, `latest_message_ids`) — Zod rejected the entire
  // notification before it ever reached the channel handler.
  //
  // Live peer DMs always survived because their meta values all went
  // through `String(...)`. The welcome was the only notification
  // shape with non-string meta — uniquely affected, schema-rejected,
  // silently dropped.
  //
  // 1.34.6 fixes the meta values (see `emitMeshWelcome`) so the
  // notification passes validation; the dual-lane retry from 1.34.5
  // is no longer necessary and would now surface a duplicate. Back to
  // a single emit, with a 3s grace after `oninitialized` — enough for
  // the React effect that registers the channel handler to run, but
  // tight enough to feel like a launch handshake.
  const WELCOME_GRACE_MS = 3_000;
  let welcomeSent = false;
  server.oninitialized = () => {
    mcpLog("server_initialized");
    if (welcomeSent) return;
    welcomeSent = true;
    setTimeout(() => { void emitMeshWelcome(server, mcpLog); }, WELCOME_GRACE_MS);
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep event loop active so SSE callbacks flush stdout promptly.
  const keepalive = setInterval(() => { /* tick */ }, 1_000);
  void keepalive;

  const shutdown = (): void => {
    clearInterval(keepalive);
    sub.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

/**
 * Mesh-connected welcome. Runs once 5s after the MCP transport is up,
 * regardless of inbox state. The point isn't just to summarize unread —
 * an empty welcome still confirms to the user that the mesh pipe is
 * live, names the session, says how many peers are visible, and lists
 * the canonical CLI commands so the model can use them mid-turn.
 *
 * Composes from up to three best-effort daemon queries:
 *   - `/v1/sessions/me`  → display name + session pubkey + mesh
 *     (requires session token; absent on bare `claudemesh mcp`)
 *   - `/v1/peers?mesh=…` → live peer count, filtered to non-control-plane
 *   - `/v1/inbox?…`      → recent message count + up to 3 previews
 *
 * Each query degrades silently — a missing field becomes "unknown" or
 * is omitted. The welcome ALWAYS emits unless the IPC socket is
 * unreachable; that's the design contract: "you launched into the
 * mesh, here's what you've got."
 */
async function emitMeshWelcome(
  server: import("@modelcontextprotocol/sdk/server/index.js").Server,
  mcpLog: (msg: string, meta?: Record<string, unknown>) => void,
): Promise<void> {
  const { readSessionTokenFromEnv } = await import("~/services/session/token.js");
  const sessionToken = readSessionTokenFromEnv();

  // 1) Self identity. Token-less path (bare `claudemesh mcp` outside a
  // launch) just leaves these undefined; the welcome still goes out.
  let selfDisplayName: string | undefined;
  let selfSessionPubkey: string | undefined;
  let selfMeshSlug: string | undefined;
  let selfRole: string | undefined;
  if (sessionToken) {
    try {
      const { status, body } = await daemonGet("/v1/sessions/me", { sessionToken });
      if (status === 200 && body?.session) {
        selfDisplayName    = body.session.displayName;
        selfMeshSlug       = body.session.mesh;
        selfRole           = body.session.role;
        selfSessionPubkey  = body.session.presence?.sessionPubkey;
      }
    } catch (e) { mcpLog("welcome_self_lookup_failed", { err: String(e) }); }
  }

  // 2) Live peer count. Match the same filter the launch banner uses
  // (`channel !== "claudemesh-daemon"`) so the welcome's number agrees
  // with the "N peers online" line that just printed in the terminal.
  // We also fall back to `peerRole !== "control-plane"` for newer
  // brokers that emit the role taxonomy. Excluding self uses both
  // session pubkey AND session id (older brokers may not surface
  // peerRole, so name-only matching would fail).
  let peerCount = -1;
  let peerNames: string[] = [];
  try {
    const path = selfMeshSlug ? `/v1/peers?mesh=${encodeURIComponent(selfMeshSlug)}` : "/v1/peers";
    const { status, body } = await daemonGet(path, { sessionToken });
    if (status === 200 && Array.isArray(body?.peers)) {
      const peers = body.peers as Array<Record<string, unknown>>;
      const real = peers.filter((p) => {
        const channel = String(p.channel ?? "");
        const peerRole = String(p.peerRole ?? "");
        const isInfra = channel === "claudemesh-daemon" || peerRole === "control-plane";
        if (isInfra) return false;
        if (selfSessionPubkey && p.pubkey === selfSessionPubkey) return false;
        return true;
      });
      peerCount = real.length;
      peerNames = real
        .map((p) => String(p.displayName ?? "unknown"))
        .filter((n, i, arr) => arr.indexOf(n) === i)
        .slice(0, 5);
      mcpLog("welcome_peers_resolved", { total: peers.length, real: real.length });
    } else {
      mcpLog("welcome_peers_status", { status });
    }
  } catch (e) { mcpLog("welcome_peers_lookup_failed", { err: String(e) }); }

  // 3) Unread inbox. 1.34.8 replaced the "last 24h" window with the
  // proper read-state filter — `?unread_only=true` returns rows whose
  // `seen_at` is NULL. The list call uses `mark_seen=false` so the
  // welcome doesn't auto-stamp; we stamp explicitly via /v1/inbox/seen
  // *after* we know the channel notification went out (otherwise a
  // schema rejection would silently mark rows seen that the user
  // never actually saw — the original 1.34.6 bug shape).
  const inboxPath = selfMeshSlug
    ? `/v1/inbox?mesh=${encodeURIComponent(selfMeshSlug)}&unread_only=true&mark_seen=false&limit=50`
    : `/v1/inbox?unread_only=true&mark_seen=false&limit=50`;
  let inboxItems: Array<Record<string, unknown>> = [];
  try {
    const { status, body } = await daemonGet(inboxPath, { sessionToken });
    if (status === 200 && Array.isArray(body?.items)) {
      inboxItems = body.items as Array<Record<string, unknown>>;
    }
  } catch (e) { mcpLog("welcome_inbox_lookup_failed", { err: String(e) }); }

  // Compose the body. Markdown-friendly so it renders cleanly in the
  // Claude Code channel reminder block.
  const lines: string[] = [];
  const idTag = selfDisplayName
    ? `${selfDisplayName}${selfSessionPubkey ? ` (${selfSessionPubkey.slice(0, 8)})` : ""}${selfRole ? ` [${selfRole}]` : ""}`
    : "session";
  const meshTag = selfMeshSlug ? ` on mesh \`${selfMeshSlug}\`` : "";
  lines.push(`🌐 [welcome] claudemesh connected — you are **${idTag}**${meshTag}.`);

  if (peerCount === 0) {
    lines.push(`👥 No other peers online right now.`);
  } else if (peerCount > 0) {
    const namesPreview = peerNames.join(", ");
    const more = peerCount > peerNames.length ? ` …and ${peerCount - peerNames.length} more` : "";
    lines.push(`👥 ${peerCount} peer${peerCount === 1 ? "" : "s"} online: ${namesPreview}${more}`);
  } else {
    lines.push(`👥 Peer list unavailable (daemon query failed).`);
  }

  if (inboxItems.length === 0) {
    lines.push(`📥 No unread messages.`);
  } else {
    lines.push(`📥 ${inboxItems.length} unread message${inboxItems.length === 1 ? "" : "s"}:`);
    for (const it of inboxItems.slice(0, 3)) {
      const sender = String(it.sender_name ?? "unknown");
      const senderPub = String(it.sender_pubkey ?? "").slice(0, 8);
      const tag = sender !== senderPub ? `${sender} (${senderPub})` : senderPub;
      const bodyText = (typeof it.body === "string" ? it.body : "(encrypted)").slice(0, 60);
      const time = it.received_at ? new Date(String(it.received_at)).toLocaleTimeString() : "";
      lines.push(`  ${tag} ${time}: ${bodyText}`);
    }
    if (inboxItems.length > 3) lines.push(`  …and ${inboxItems.length - 3} more`);
  }

  // CLI hints — what the model should call when the user asks. Listed
  // here as a one-liner so the welcome stays compact.
  lines.push(`💡 Use: \`claudemesh peer list\` · \`claudemesh send <peer> <msg>\` · \`claudemesh inbox\``);
  // Skill pointer — the `claudemesh` skill in the user's Claude install
  // documents every CLI verb, JSON shapes, channel attributes, and
  // common patterns. If the model isn't already loaded with it, this is
  // the cue to read it once before acting on the mesh.
  lines.push(`📚 Read the \`claudemesh\` skill (SKILL.md) for full CLI / channel / inbox reference if not yet in context.`);

  const content = lines.join("\n");
  try {
    // Claude Code's `notifications/claude/channel` schema is
    // `meta: y.record(y.string(), y.string())` — string values only.
    // Pre-1.34.6 we sent numbers / arrays in `peer_count`, `unread_count`,
    // `peer_names`, `latest_message_ids`; Zod silently rejected the
    // whole notification before it reached the channel handler. Live
    // peer DMs survived because their meta values all went through
    // `String(...)`. Coerce everything here too — arrays stringify as
    // JSON so downstream consumers can re-parse if they want, and the
    // counts become digit strings (parseable on the receiving side).
    await server.notification({
      method: "notifications/claude/channel",
      params: {
        content,
        meta: {
          kind: "welcome",
          self_display_name: selfDisplayName ?? "",
          self_session_pubkey: selfSessionPubkey ?? "",
          self_role: selfRole ?? "",
          mesh_slug: selfMeshSlug ?? "",
          peer_count: peerCount >= 0 ? String(peerCount) : "",
          peer_names: JSON.stringify(peerNames),
          unread_count: String(inboxItems.length),
          latest_message_ids: JSON.stringify(
            inboxItems.slice(0, 10).map((it) => String(it.id ?? "")),
          ),
        },
      },
    });
    mcpLog("welcome_emitted", {
      mesh: selfMeshSlug ?? "",
      peer_count: peerCount,
      unread_count: inboxItems.length,
    });
    // 1.34.8: stamp the rows we just surfaced. Done AFTER the
    // notification succeeds so a Zod-rejected welcome (the 1.34.6 bug
    // shape) doesn't silently mark rows seen that the user never
    // actually saw. Best-effort.
    if (inboxItems.length > 0) {
      const ids = inboxItems.map((it) => String(it.id ?? "")).filter(Boolean);
      if (ids.length > 0) {
        void daemonMarkSeen(ids, sessionToken).catch(() => { /* swallow */ });
      }
    }
  } catch (err) {
    mcpLog("welcome_emit_failed", { err: String(err) });
  }
}

// ── mesh-service proxy mode (unchanged from prior versions) ────────────

/**
 * Mesh service proxy — a thin MCP server that proxies ONE deployed service.
 *
 * Spawned by Claude Code as a native MCP entry. Connects to the broker,
 * fetches tool schemas for the named service, and routes tool calls.
 *
 * If the broker WS drops, the proxy waits for reconnection (up to 10s)
 * before failing tool calls. If the proxy process itself crashes, Claude
 * Code will not auto-restart it.
 */
async function startServiceProxy(serviceName: string): Promise<void> {
  const config = readConfig();
  if (config.meshes.length === 0) {
    process.stderr.write(`[mesh:${serviceName}] no meshes joined\n`);
    process.exit(1);
  }

  const mesh = config.meshes[0]!;
  const client = new BrokerClient(mesh, {
    displayName: config.displayName ?? `proxy:${serviceName}`,
  });

  try {
    await client.connect();
  } catch (e) {
    process.stderr.write(
      `[mesh:${serviceName}] broker connect failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
  }

  // Wait for hello_ack and service catalog.
  await new Promise((r) => setTimeout(r, 1500));

  let tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];
  try {
    const fetched = await client.getServiceTools(serviceName);
    tools = fetched as typeof tools;
  } catch {
    const cached = client.serviceCatalog.find((s) => s.name === serviceName);
    if (cached) tools = cached.tools as typeof tools;
  }

  if (tools.length === 0) {
    process.stderr.write(`[mesh:${serviceName}] no tools found — service may not be running\n`);
  }

  const server = new Server(
    { name: `mesh:${serviceName}`, version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: `[mesh:${serviceName}] ${t.description}`,
      inputSchema: t.inputSchema as any,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const toolName = req.params.name;
    const args = req.params.arguments ?? {};

    if ((client.status as string) !== "open") {
      let waited = 0;
      while ((client.status as string) !== "open" && waited < 10_000) {
        await new Promise((r) => setTimeout(r, 500));
        waited += 500;
      }
      if ((client.status as string) !== "open") {
        return {
          content: [{ type: "text" as const, text: "Service temporarily unavailable — broker reconnecting. Retry in a few seconds." }],
          isError: true,
        };
      }
    }

    try {
      const result = await client.mcpCall(serviceName, toolName, args as Record<string, unknown>);
      if (result.error) {
        return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
      }
      const resultText = typeof result.result === "string"
        ? result.result
        : JSON.stringify(result.result, null, 2);
      return { content: [{ type: "text" as const, text: resultText }] };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Call failed: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  });

  client.onPush((push) => {
    if (push.event === "mcp_undeployed" && (push.eventData as any)?.name === serviceName) {
      process.stderr.write(`[mesh:${serviceName}] service undeployed — exiting\n`);
      client.close();
      process.exit(0);
    }
    if (push.event === "mcp_updated" && (push.eventData as any)?.name === serviceName) {
      const newTools = (push.eventData as any)?.tools;
      if (Array.isArray(newTools)) {
        tools = newTools as typeof tools;
        server.notification({ method: "notifications/tools/list_changed" }).catch(() => { /* ignore */ });
      }
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const keepalive = setInterval(() => { /* tick */ }, 1_000);
  void keepalive;

  const shutdown = (): void => {
    clearInterval(keepalive);
    client.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
