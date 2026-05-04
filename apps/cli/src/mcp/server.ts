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
import { existsSync } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";

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

function daemonGet(path: string): Promise<DaemonGetResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { socketPath: DAEMON_PATHS.SOCK_FILE, path, method: "GET", timeout: 5_000 },
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

// ── daemon SSE subscription ────────────────────────────────────────────

interface DaemonEvent { kind: string; ts: string; data: Record<string, any> }

function subscribeEvents(onEvent: (e: DaemonEvent) => void): { close: () => void } {
  let active = true;
  let req: ReturnType<typeof httpRequest> | null = null;

  const connect = (): void => {
    if (!active) return;
    req = httpRequest({
      socketPath: DAEMON_PATHS.SOCK_FILE,
      path: "/v1/events",
      method: "GET",
      headers: { Accept: "text/event-stream" },
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
    { capabilities: { tools: {}, prompts: {}, resources: {} } },
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

  // Subscribe to daemon events; translate to channel notifications.
  const sub = subscribeEvents(async (ev) => {
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
      } catch (err) {
        process.stderr.write(`[claudemesh-mcp] channel emit failed: ${err}\n`);
      }
    } else if (ev.kind === "peer_join" || ev.kind === "peer_leave" || ev.kind === "system") {
      const d = ev.data;
      const eventName = String(d.event ?? ev.kind);
      let content: string;
      if (ev.kind === "peer_join") {
        content = `[system] Peer "${String(d.name ?? "unknown")}" joined the mesh`;
      } else if (ev.kind === "peer_leave") {
        content = `[system] Peer "${String(d.name ?? "unknown")}" left the mesh`;
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
            },
          },
        });
      } catch { /* best effort */ }
    }
  });

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
