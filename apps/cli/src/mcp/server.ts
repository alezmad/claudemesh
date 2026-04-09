/**
 * MCP server (stdio transport) for claudemesh-cli.
 *
 * Starts BrokerClient connections for every mesh in config on boot,
 * then routes the 5 MCP tools through them.
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
import { TOOLS } from "./tools";
import { loadConfig } from "../state/config";
import { startClients, stopAll, findClient, allClients } from "../ws/manager";
import type {
  Priority,
  PeerStatus,
  SendMessageArgs,
  SetStatusArgs,
  SetSummaryArgs,
  ListPeersArgs,
} from "./types";
import { BrokerClient } from "../ws/client";
import type { InboundPush } from "../ws/client";

/** Compute a human-readable relative time string from an ISO timestamp. */
function relativeTime(isoStr: string): string {
  const then = new Date(isoStr).getTime();
  if (isNaN(then)) return "unknown";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

function text(msg: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: msg }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Given a `to` string, pick which mesh to send from. Strategies:
 *   - If `to` looks like a pubkey hex (64 chars), use as-is.
 *   - If `to` starts with `#`, treat as channel.
 *   - If `to` is `*`, treat as broadcast.
 *   - Otherwise resolve as a display name via list_peers.
 *
 * Explicit mesh prefix `<mesh-slug>:<target>` narrows to one mesh.
 */
async function resolveClient(to: string): Promise<{
  client: BrokerClient | null;
  targetSpec: string;
  error?: string;
}> {
  const clients = allClients();
  if (clients.length === 0) {
    return { client: null, targetSpec: to, error: "no meshes joined" };
  }
  // Explicit mesh prefix: "mesh-slug:targetspec"
  let targetClients = clients;
  let target = to;
  const colonIdx = to.indexOf(":");
  if (colonIdx > 0 && colonIdx < to.length - 1) {
    const slug = to.slice(0, colonIdx);
    const rest = to.slice(colonIdx + 1);
    const match = findClient(slug);
    if (match) {
      targetClients = [match];
      target = rest;
    }
  }
  // Pubkey, channel, @group, or broadcast — pass through directly.
  if (/^[0-9a-f]{64}$/.test(target) || target.startsWith("#") || target.startsWith("@") || target === "*") {
    if (targetClients.length === 1) {
      return { client: targetClients[0]!, targetSpec: target };
    }
    return {
      client: null,
      targetSpec: target,
      error: `multiple meshes joined; prefix target with "<mesh-slug>:" (joined: ${clients.map((c) => c.meshSlug).join(", ")})`,
    };
  }
  // Name-based resolution: query each mesh's peer list for a matching displayName.
  const nameLower = target.toLowerCase();
  for (const c of targetClients) {
    const peers = await c.listPeers();
    const match = peers.find((p) => p.displayName.toLowerCase() === nameLower);
    if (match) return { client: c, targetSpec: match.pubkey };
    // Partial match: if only one peer's name contains the search string.
    const partials = peers.filter((p) =>
      p.displayName.toLowerCase().includes(nameLower),
    );
    if (partials.length === 1) {
      return { client: c, targetSpec: partials[0]!.pubkey };
    }
  }
  // Single-mesh fallback: let the broker try to resolve it.
  if (targetClients.length === 1) {
    return { client: targetClients[0]!, targetSpec: target };
  }
  return {
    client: null,
    targetSpec: target,
    error: `peer "${target}" not found in any mesh (joined: ${clients.map((c) => c.meshSlug).join(", ")})`,
  };
}

// Peer name cache to avoid calling listPeers on every incoming push
const peerNameCache = new Map<string, string>();
let peerNameCacheAge = 0;
const CACHE_TTL_MS = 30_000;

async function resolvePeerName(client: BrokerClient, pubkey: string): Promise<string> {
  const now = Date.now();
  if (now - peerNameCacheAge > CACHE_TTL_MS) {
    peerNameCache.clear();
    try {
      const peers = await client.listPeers();
      for (const p of peers) peerNameCache.set(p.pubkey, p.displayName);
    } catch { /* best effort */ }
    peerNameCacheAge = now;
  }
  return peerNameCache.get(pubkey) ?? `peer-${pubkey.slice(0, 8)}`;
}

function decryptFailedWarning(senderPubkey: string): string {
  const who = senderPubkey ? senderPubkey.slice(0, 12) + "…" : "unknown sender";
  return `⚠ message from ${who} failed to decrypt (tampered or wrong keypair)`;
}

function formatPush(p: InboundPush, meshSlug: string): string {
  const body = p.plaintext ?? decryptFailedWarning(p.senderPubkey);
  const tag = p.subtype === "reminder" ? " [REMINDER]" : "";
  return `[${meshSlug}]${tag} from ${p.senderPubkey.slice(0, 12)}… (${p.priority}, ${p.createdAt}):\n${body}`;
}

export async function startMcpServer(): Promise<void> {
  // Check for --service mode (native mesh MCP proxy)
  const serviceIdx = process.argv.indexOf("--service");
  if (serviceIdx !== -1 && process.argv[serviceIdx + 1]) {
    return startServiceProxy(process.argv[serviceIdx + 1]!);
  }

  const config = loadConfig();

  const myName = config.displayName ?? "unnamed";
  const myRole = config.role ?? process.env.CLAUDEMESH_ROLE ?? null;
  const myGroups = (config.groups ?? []).map(g => `@${g.name}${g.role ? ':' + g.role : ''}`).join(', ') || "none";
  const messageMode = config.messageMode ?? "push";

  const server = new Server(
    { name: "claudemesh", version: "0.3.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
        prompts: {},
        resources: {},
      },
      instructions: `## Identity
You are "${myName}"${myRole ? ` (${myRole})` : ""} — a peer in the claudemesh network. Your groups: ${myGroups}. You are one of several Claude Code sessions connected to the same mesh. No orchestrator exists — peers are equals. Your identity comes from your name and group roles, not from a central authority.

## Responding to messages
When you receive a <channel source="claudemesh" ...> message, RESPOND IMMEDIATELY. Pause your current task, reply via send_message, then resume. Read from_name, mesh_slug, and priority from the channel attributes. Reply by setting \`to\` to the sender's from_name (display name). Stay in character per your system prompt. Do not ignore low-priority messages — acknowledge them briefly even if you defer action.

If the channel meta contains \`subtype: reminder\`, this is a scheduled reminder you set for yourself — act on it immediately (no reply needed).

## Tools
| Tool | Description |
|------|-------------|
| send_message(to, message, priority?) | Send to peer name, @group, or * broadcast. \`to\` accepts display name, pubkey hex, @groupname, or *. |
| list_peers(mesh_slug?) | List connected peers with status, summary, groups, and roles. |
| check_messages() | Drain buffered inbound messages (auto-pushed in most cases, use as fallback). |
| set_summary(summary) | Set 1-2 sentence description of your current work, visible to all peers. |
| set_status(status) | Override status: idle, working, or dnd. |
| set_visible(visible) | Toggle visibility. Hidden peers skip list_peers and broadcasts; direct messages still arrive. |
| set_profile(avatar?, title?, bio?, capabilities?) | Set public profile: emoji avatar, short title, bio, capabilities list. |
| join_group(name, role?) | Join a @group with optional role (lead, member, observer, or any string). |
| leave_group(name) | Leave a @group. |
| set_state(key, value) | Write shared state; pushes change to all peers. |
| get_state(key) | Read a shared state value. |
| list_state() | List all state keys with values, authors, and timestamps. |
| remember(content, tags?) | Store persistent knowledge with optional tags. |
| recall(query) | Full-text search over mesh memory. |
| forget(id) | Soft-delete a memory entry. |
| share_file(path, name?, tags?) | Share a persistent file with the mesh. |
| get_file(id, save_to) | Download a shared file to a local path. |
| list_files(query?, from?) | Find files shared in the mesh. |
| file_status(id) | Check who has accessed a file. |
| delete_file(id) | Remove a shared file from the mesh. |
| vector_store(collection, text, metadata?) | Store embedding in per-mesh Qdrant collection. |
| vector_search(collection, query, limit?) | Semantic search over stored embeddings. |
| vector_delete(collection, id) | Remove an embedding. |
| list_collections() | List vector collections in this mesh. |
| graph_query(cypher) | Read-only Cypher query on per-mesh Neo4j. |
| graph_execute(cypher) | Write Cypher query (CREATE, MERGE, DELETE). |
| mesh_query(sql) | Run a SELECT query on the per-mesh shared database. |
| mesh_execute(sql) | Run DDL/DML on the per-mesh database (CREATE TABLE, INSERT, UPDATE, DELETE). |
| mesh_schema() | List tables and columns in the per-mesh shared database. |
| create_stream(name) | Create a real-time data stream in the mesh. |
| publish(stream, data) | Push data to a stream. Subscribers receive it in real-time. |
| subscribe(stream) | Subscribe to a stream. Data pushes arrive as channel notifications. |
| list_streams() | List active streams in the mesh. |
| share_context(summary, files_read?, key_findings?, tags?) | Share session understanding with peers. |
| get_context(query) | Find context from peers who explored an area. |
| list_contexts() | See what all peers currently know. |
| create_task(title, assignee?, priority?, tags?) | Create a work item. |
| claim_task(id) | Claim an unclaimed task. |
| complete_task(id, result?) | Mark task done with optional result. |
| list_tasks(status?, assignee?) | List tasks filtered by status/assignee. |
| schedule_reminder(message, in_seconds?, deliver_at?, to?) | Schedule a reminder to yourself (no \`to\`) or a delayed message to a peer/group. Delivered as a push with \`subtype: reminder\` in the channel meta. |
| list_scheduled() | List pending scheduled reminders and messages. |
| cancel_scheduled(id) | Cancel a pending scheduled item. |
| read_peer_file(peer, path) | Read a file from another peer's project (max 1MB). |
| list_peer_files(peer, path?, pattern?) | List files in a peer's shared directory. |
| mesh_mcp_register(server_name, description, tools) | Register an MCP server with the mesh. Other peers can call its tools. |
| mesh_mcp_list() | List MCP servers available in the mesh with their tools. |
| mesh_tool_call(server_name, tool_name, args?) | Call a tool on a mesh-registered MCP server (30s timeout). |
| mesh_mcp_remove(server_name) | Unregister an MCP server you registered. |

If multiple meshes are joined, prefix \`to\` with \`<mesh-slug>:\` to disambiguate (e.g. \`dev-team:Alice\`).

Multi-target: send_message accepts an array of targets for the 'to' field.
  send_message(to: ["Alice", "@backend"], message: "sprint starts")
Targets are deduplicated — each peer receives the message once.

Targeted views: when different audiences need different details about the same event,
send tailored messages instead of one generic broadcast:
  send_message(to: "@frontend", message: "Auth v2: useAuth hook changed, see src/auth/")
  send_message(to: "@backend", message: "Auth v2: new /api/auth/v2 endpoints, v1 deprecated")
  send_message(to: "@pm", message: "Auth v2 done. 3 points, no blockers.")

## Groups
Groups are routing labels. Send to @groupname to multicast to all members. Roles are metadata that peers interpret: a "lead" gathers input before synthesizing a response, a "member" contributes when asked, an "observer" watches silently. Join and leave groups dynamically with join_group/leave_group. Check list_peers to see who belongs to which groups and their roles.

## State
Shared key-value store scoped to the mesh. Use get_state/set_state for live coordination facts (deploy frozen? current sprint? PR queue). set_state pushes the change to all connected peers. Read state before asking peers questions — the answer may already be there. State is operational, not archival.

## Memory
Persistent knowledge that survives across sessions. Use remember(content, tags?) to store lessons, decisions, and incidents. Use recall(query) to search before asking peers. New peers should recall at session start to load institutional knowledge.

## File access — decision guide
Three ways to access files. Pick the right one:

1. **Local peer (same machine, [local] tag):** Read files directly via filesystem using their \`cwd\` path from list_peers. No limit, instant. This is the default for local peers.
2. **Remote peer (different machine, [remote] tag):** Use \`read_peer_file(peer, path)\` — relays through the mesh. **1 MB limit**, base64 encoded. Use \`list_peer_files\` to browse first.
3. **Persistent sharing (any peer):** Use \`share_file(path)\` — uploads to mesh storage (MinIO). **No size limit**. All peers can download anytime via \`get_file\`. Use for files that need to persist or be shared with multiple peers.

**Rule of thumb:** local peer → filesystem. Remote peer, small file → read_peer_file. Large file or needs to persist → share_file.

## Vectors
Store and search semantic embeddings. Use vector_store to index content, vector_search to find similar content.

## Graph
Build and query entity relationship graphs. Use graph_execute for writes (CREATE, MERGE), graph_query for reads (MATCH).

## Mesh Database
Per-mesh PostgreSQL database. Use mesh_execute for DDL/DML (CREATE TABLE, INSERT), mesh_query for SELECT, mesh_schema to inspect tables. Schema auto-created on first use.

## Streams
Real-time data channels. create_stream to start one, publish to push data, subscribe to receive pushes. Use for build logs, deploy status, live metrics.

## Context
Share your session understanding with peers. Use share_context after exploring a codebase area. Check get_context before re-reading files another peer already analyzed.

## Tasks
Create and claim work items. create_task to propose work, claim_task to take ownership, complete_task when done. Prevents duplicate effort.

## Priority
- "now": interrupt immediately, even if recipient is in DND (use for urgent: broken deploy, blocking issue)
- "next" (default): deliver when recipient goes idle (normal coordination)
- "low": pull-only via check_messages (FYI, non-blocking context)

## Coordination
Call list_peers at session start to understand who is online, their roles, and what they are working on. If you are a group lead, gather input from members before responding to external requests — do not answer alone. If you are a member, contribute to your lead when asked. Use @group messages for team-wide questions, direct messages for 1:1 coordination. Set a meaningful summary so peers know your current focus.

## Message Mode
Your message mode is "${messageMode}".
- push: messages arrive in real-time as channel notifications. Respond immediately.
- inbox: messages are held. You'll see "[inbox] New message from X" notifications. Call check_messages to read them.
- off: no message notifications. Use check_messages manually to poll.`,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // --- MCP Prompts: expose mesh skills as slash commands ---
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const client = allClients()[0];
    if (!client) return { prompts: [] };
    const skills = await client.listSkills();
    return {
      prompts: skills.map((s) => ({
        name: s.name,
        description: s.description,
        arguments: [],
      })),
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const { name, arguments: promptArgs } = req.params;
    const client = allClients()[0];
    if (!client) throw new Error("Not connected to any mesh");
    const skill = await client.getSkill(name);
    if (!skill) throw new Error(`Skill "${name}" not found in the mesh`);

    // Build the prompt content — include frontmatter if manifest has metadata
    let content = skill.instructions;
    const manifest = (skill as any).manifest;
    if (manifest && typeof manifest === "object") {
      const fm: string[] = ["---"];
      if (manifest.description) fm.push(`description: "${manifest.description}"`);
      if (manifest.when_to_use) fm.push(`when_to_use: "${manifest.when_to_use}"`);
      if (manifest.allowed_tools?.length) fm.push(`allowed-tools:\n${manifest.allowed_tools.map((t: string) => `  - ${t}`).join("\n")}`);
      if (manifest.model) fm.push(`model: ${manifest.model}`);
      if (manifest.context) fm.push(`context: ${manifest.context}`);
      if (manifest.agent) fm.push(`agent: ${manifest.agent}`);
      if (manifest.user_invocable === false) fm.push(`user-invocable: false`);
      if (manifest.argument_hint) fm.push(`argument-hint: "${manifest.argument_hint}"`);
      fm.push("---\n");
      if (fm.length > 3) content = fm.join("\n") + content;

      // Enforce context:fork via Agent tool instruction — Claude Code's MCP prompts
      // path doesn't support the context field natively, so we instruct the model.
      if (manifest.context === "fork") {
        const agentType = manifest.agent || "general-purpose";
        const modelHint = manifest.model ? `, model: "${manifest.model}"` : "";
        const toolsHint = manifest.allowed_tools?.length
          ? `\nOnly use these tools: ${manifest.allowed_tools.join(", ")}.`
          : "";
        content = `IMPORTANT: Execute this skill in an isolated sub-agent. Use the Agent tool with subagent_type="${agentType}"${modelHint}. Pass the full instructions below as the agent prompt.${toolsHint}\n\n` + content;
      }
    }

    return {
      description: skill.description,
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: content },
        },
      ],
    };
  });

  // --- MCP Resources: expose mesh skills as skill:// resources ---
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const client = allClients()[0];
    if (!client) return { resources: [] };
    const skills = await client.listSkills();
    return {
      resources: skills.map((s) => ({
        uri: `skill://claudemesh/${encodeURIComponent(s.name)}`,
        name: s.name,
        description: s.description,
        mimeType: "text/markdown",
      })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { uri } = req.params;
    // Parse skill://claudemesh/{name}
    const match = uri.match(/^skill:\/\/claudemesh\/(.+)$/);
    if (!match) throw new Error(`Unknown resource URI: ${uri}`);
    const name = decodeURIComponent(match[1]!);
    const client = allClients()[0];
    if (!client) throw new Error("Not connected to any mesh");
    const skill = await client.getSkill(name);
    if (!skill) throw new Error(`Skill "${name}" not found`);

    // Build full markdown with frontmatter for Claude Code's parseSkillFrontmatterFields
    const manifest = (skill as any).manifest;
    const fmLines: string[] = ["---"];
    fmLines.push(`name: ${skill.name}`);
    fmLines.push(`description: "${skill.description}"`);
    if (skill.tags.length) fmLines.push(`tags: [${skill.tags.join(", ")}]`);
    if (manifest && typeof manifest === "object") {
      if (manifest.when_to_use) fmLines.push(`when_to_use: "${manifest.when_to_use}"`);
      if (manifest.allowed_tools?.length) fmLines.push(`allowed-tools:\n${manifest.allowed_tools.map((t: string) => `  - ${t}`).join("\n")}`);
      if (manifest.model) fmLines.push(`model: ${manifest.model}`);
      if (manifest.context) fmLines.push(`context: ${manifest.context}`);
      if (manifest.agent) fmLines.push(`agent: ${manifest.agent}`);
      if (manifest.user_invocable === false) fmLines.push(`user-invocable: false`);
      if (manifest.argument_hint) fmLines.push(`argument-hint: "${manifest.argument_hint}"`);
    }
    fmLines.push("---\n");

    const fullContent = fmLines.join("\n") + skill.instructions;

    return {
      contents: [
        {
          uri,
          mimeType: "text/markdown",
          text: fullContent,
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    // Track tool call count across all connected clients
    for (const c of allClients()) {
      c.incrementToolCalls();
    }

    if (config.meshes.length === 0) {
      return text(
        "No meshes joined. Run `claudemesh join https://claudemesh.com/join/<token>` first.",
        true,
      );
    }

    switch (name) {
      case "send_message": {
        const { to, message, priority } = (args ?? {}) as SendMessageArgs;
        if (!to || !message)
          return text("send_message: `to` and `message` required", true);

        // Handle multi-target: to can be string or string[]
        const targets = Array.isArray(to) ? to : [to];
        const results: string[] = [];
        const seen = new Set<string>(); // dedup by resolved pubkey

        for (const target of targets) {
          const { client, targetSpec, error } = await resolveClient(target);
          if (!client) {
            results.push(`✗ ${target}: ${error ?? "no client resolved"}`);
            continue;
          }
          if (seen.has(targetSpec)) continue; // dedup
          seen.add(targetSpec);
          const result = await client.send(
            targetSpec,
            message,
            (priority ?? "next") as Priority,
          );
          if (!result.ok) {
            results.push(`✗ ${target}: ${result.error}`);
          } else {
            results.push(`✓ ${target} → ${result.messageId}`);
          }
        }
        return text(results.join("\n"));
      }

      case "list_peers": {
        const { mesh_slug } = (args ?? {}) as ListPeersArgs;
        const clients = mesh_slug
          ? [findClient(mesh_slug)].filter(Boolean)
          : allClients();
        if (clients.length === 0)
          return text(
            mesh_slug
              ? `list_peers: no joined mesh "${mesh_slug}"`
              : "list_peers: no joined meshes",
            true,
          );
        const sections: string[] = [];
        for (const c of clients) {
          const peers = await c!.listPeers();
          const header = `## ${c!.meshSlug} (${c!.status}, mesh ${c!.meshId.slice(0, 8)}…)`;
          if (peers.length === 0) {
            sections.push(`${header}\nNo peers connected.`);
          } else {
            const peerLines = peers.map((p) => {
              const summary = p.summary ? ` — "${p.summary}"` : "";
              const groupsStr = p.groups?.length ? ` [${p.groups.map(g => `@${g.name}${g.role ? ':' + g.role : ''}`).join(', ')}]` : "";
              const meta: string[] = [];
              if (p.peerType) meta.push(`type:${p.peerType}`);
              if (p.channel) meta.push(`channel:${p.channel}`);
              if (p.model) meta.push(`model:${p.model}`);
              const metaStr = meta.length ? ` {${meta.join(", ")}}` : "";
              const cwdStr = p.cwd ? ` cwd:${p.cwd}` : "";
              const locality = p.hostname && p.hostname === require("os").hostname() ? "local" : "remote";
              const localityTag = ` [${locality}]`;
              const profileAvatar = p.profile?.avatar ? `${p.profile.avatar} ` : "";
              const profileTitle = p.profile?.title ? ` (${p.profile.title})` : "";
              const hiddenTag = p.visible === false ? " [hidden]" : "";
              return `- ${profileAvatar}**${p.displayName}**${profileTitle} [${p.status}]${localityTag}${hiddenTag}${groupsStr}${metaStr} (${p.pubkey.slice(0, 12)}…)${cwdStr}${summary}`;
            });
            sections.push(`${header}\n${peerLines.join("\n")}`);
          }
        }
        return text(sections.join("\n\n"));
      }

      case "message_status": {
        const { id } = (args ?? {}) as { id?: string };
        if (!id) return text("message_status: `id` required", true);
        const clients = allClients();
        if (!clients.length) return text("message_status: not connected", true);
        // Try each connected mesh client — we don't know which mesh the
        // messageId belongs to, so query all and return the first hit.
        let result = null;
        for (const c of clients) {
          result = await c.messageStatus(id);
          if (result) break;
        }
        if (!result) return text(`Message ${id} not found or timed out.`);
        const recipientLines = result.recipients.map(
          (r: { name: string; pubkey: string; status: string }) =>
            `  - ${r.name} (${r.pubkey.slice(0, 12)}…): ${r.status}`,
        );
        return text(
          `Message ${id.slice(0, 12)}… → ${result.targetSpec}\n` +
          `Delivered: ${result.delivered}${result.deliveredAt ? ` at ${result.deliveredAt}` : ""}\n` +
          `Recipients:\n${recipientLines.join("\n")}`,
        );
      }

      case "check_messages": {
        const drained: string[] = [];
        for (const c of allClients()) {
          const msgs = c.drainPushBuffer();
          for (const m of msgs) drained.push(formatPush(m, c.meshSlug));
        }
        if (drained.length === 0) return text("No new messages.");
        return text(
          `${drained.length} new message(s):\n\n${drained.join("\n\n---\n\n")}`,
        );
      }

      case "set_summary": {
        const { summary } = (args ?? {}) as SetSummaryArgs;
        if (!summary) return text("set_summary: `summary` required", true);
        for (const c of allClients()) await c.setSummary(summary);
        return text(
          `Summary set: "${summary}" (visible to ${allClients().length} mesh(es)).`,
        );
      }

      case "set_status": {
        const { status } = (args ?? {}) as SetStatusArgs;
        if (!status) return text("set_status: `status` required", true);
        const s = status as PeerStatus;
        for (const c of allClients()) await c.setStatus(s);
        return text(`Status set to ${s} across ${allClients().length} mesh(es).`);
      }

      case "set_visible": {
        const { visible } = (args ?? {}) as { visible?: boolean };
        if (visible === undefined) return text("set_visible: `visible` required", true);
        for (const c of allClients()) await c.setVisible(visible);
        return text(visible ? "You are now visible to peers." : "You are now hidden. Direct messages still reach you, but you won't appear in list_peers or receive broadcasts.");
      }

      case "set_profile": {
        const { avatar, title, bio, capabilities } = (args ?? {}) as { avatar?: string; title?: string; bio?: string; capabilities?: string[] };
        const profile = { avatar, title, bio, capabilities };
        for (const c of allClients()) await c.setProfile(profile);
        const parts: string[] = [];
        if (avatar) parts.push(`Avatar: ${avatar}`);
        if (title) parts.push(`Title: ${title}`);
        if (bio) parts.push(`Bio: ${bio}`);
        if (capabilities?.length) parts.push(`Capabilities: ${capabilities.join(", ")}`);
        return text(parts.length > 0 ? `Profile updated:\n${parts.join("\n")}` : "Profile cleared.");
      }

      case "join_group": {
        const { name: groupName, role } = (args ?? {}) as { name?: string; role?: string };
        if (!groupName) return text("join_group: `name` required", true);
        for (const c of allClients()) await c.joinGroup(groupName, role);
        return text(`Joined @${groupName}${role ? ` as ${role}` : ""}`);
      }

      case "leave_group": {
        const { name: groupName } = (args ?? {}) as { name?: string };
        if (!groupName) return text("leave_group: `name` required", true);
        for (const c of allClients()) await c.leaveGroup(groupName);
        return text(`Left @${groupName}`);
      }

      // --- State ---
      case "set_state": {
        const { key, value } = (args ?? {}) as { key?: string; value?: unknown };
        if (!key) return text("set_state: `key` required", true);
        for (const c of allClients()) await c.setState(key, value);
        return text(`State set: ${key} = ${JSON.stringify(value)}`);
      }
      case "get_state": {
        const { key } = (args ?? {}) as { key?: string };
        if (!key) return text("get_state: `key` required", true);
        const client = allClients()[0];
        if (!client) return text("get_state: not connected", true);
        const result = await client.getState(key);
        if (!result) return text(`State "${key}" not found.`);
        return text(`${key} = ${JSON.stringify(result.value)} (set by ${result.updatedBy} at ${result.updatedAt})`);
      }
      case "list_state": {
        const client = allClients()[0];
        if (!client) return text("list_state: not connected", true);
        const entries = await client.listState();
        if (entries.length === 0) return text("No shared state set.");
        const lines = entries.map(e => `- **${e.key}** = ${JSON.stringify(e.value)} (by ${e.updatedBy})`);
        return text(lines.join("\n"));
      }

      // --- Memory ---
      case "remember": {
        const { content, tags } = (args ?? {}) as { content?: string; tags?: string[] };
        if (!content) return text("remember: `content` required", true);
        const client = allClients()[0];
        if (!client) return text("remember: not connected", true);
        const id = await client.remember(content, tags);
        return text(`Remembered${id ? ` (${id})` : ""}: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`);
      }
      case "recall": {
        const { query } = (args ?? {}) as { query?: string };
        if (!query) return text("recall: `query` required", true);
        const client = allClients()[0];
        if (!client) return text("recall: not connected", true);
        const memories = await client.recall(query);
        if (memories.length === 0) return text(`No memories found for "${query}".`);
        const lines = memories.map(m => `- [${m.id.slice(0, 8)}] ${m.content} (by ${m.rememberedBy}, ${m.rememberedAt})`);
        return text(`${memories.length} memor${memories.length === 1 ? 'y' : 'ies'}:\n${lines.join("\n")}`);
      }
      case "forget": {
        const { id } = (args ?? {}) as { id?: string };
        if (!id) return text("forget: `id` required", true);
        const client = allClients()[0];
        if (!client) return text("forget: not connected", true);
        await client.forget(id);
        return text(`Forgotten: ${id}`);
      }

      // --- Scheduled messages ---
      case "schedule_reminder": {
        const sArgs = (args ?? {}) as {
          message?: string;
          to?: string;
          deliver_at?: number;
          in_seconds?: number;
          cron?: string;
        };
        if (!sArgs.message) return text("schedule_reminder: `message` required", true);

        const isCron = !!sArgs.cron;

        let deliverAt: number;
        if (isCron) {
          // For cron, deliverAt is ignored by the broker — set to 0
          deliverAt = 0;
        } else if (sArgs.deliver_at) {
          deliverAt = Number(sArgs.deliver_at);
        } else if (sArgs.in_seconds) {
          deliverAt = Date.now() + Number(sArgs.in_seconds) * 1_000;
        } else {
          return text("schedule_reminder: provide `deliver_at` (ms timestamp), `in_seconds`, or `cron` expression", true);
        }

        const isSelf = !sArgs.to;
        let targetSpec: string;
        if (isSelf) {
          // Self-reminder: target own session pubkey
          targetSpec = client.getSessionPubkey() ?? "*";
        } else {
          const to = sArgs.to!;
          // Resolve display name → pubkey if not a raw spec
          if (!to.startsWith("@") && to !== "*" && !/^[0-9a-f]{64}$/i.test(to)) {
            const peers = await client.listPeers();
            const match = peers.find((p) => p.displayName.toLowerCase() === to.toLowerCase());
            if (!match) {
              const names = peers.map((p) => p.displayName).join(", ");
              return text(`schedule_reminder: peer "${to}" not found. Online: ${names || "(none)"}`, true);
            }
            targetSpec = match.pubkey;
          } else {
            targetSpec = to;
          }
        }

        const result = await client.scheduleMessage(targetSpec, sArgs.message, deliverAt, true, sArgs.cron);
        if (!result) return text("schedule_reminder: broker did not acknowledge — check connection", true);

        if (isCron) {
          const nextFire = new Date(result.deliverAt).toISOString();
          return text(
            isSelf
              ? `Recurring self-reminder scheduled (${result.scheduledId.slice(0, 8)}): "${sArgs.message.slice(0, 60)}" — cron: ${sArgs.cron}, next fire: ${nextFire}`
              : `Recurring reminder to "${sArgs.to}" scheduled (${result.scheduledId.slice(0, 8)}) — cron: ${sArgs.cron}, next fire: ${nextFire}`,
          );
        }

        const when = new Date(result.deliverAt).toISOString();
        return text(
          isSelf
            ? `Self-reminder scheduled (${result.scheduledId.slice(0, 8)}): "${sArgs.message.slice(0, 60)}" at ${when}`
            : `Reminder to "${sArgs.to}" scheduled (${result.scheduledId.slice(0, 8)}) for ${when}`,
        );
      }
      case "list_scheduled": {
        const scheduled = await client.listScheduled();
        if (scheduled.length === 0) return text("No pending scheduled messages.");
        const lines = scheduled.map((m) =>
          `- [${m.id.slice(0, 8)}] → ${m.to === client.getSessionPubkey() ? "self (reminder)" : m.to} at ${new Date(m.deliverAt).toISOString()}: "${m.message.slice(0, 60)}${m.message.length > 60 ? "…" : ""}"`,
        );
        return text(`${scheduled.length} scheduled:\n${lines.join("\n")}`);
      }
      case "cancel_scheduled": {
        const { id: schedId } = (args ?? {}) as { id?: string };
        if (!schedId) return text("cancel_scheduled: `id` required", true);
        const ok = await client.cancelScheduled(schedId);
        return text(ok ? `Cancelled: ${schedId}` : `Not found or already fired: ${schedId}`, !ok);
      }

      // --- Files ---
      case "share_file": {
        const { path: filePath, name: fileName, tags, to: fileTo } = (args ?? {}) as { path?: string; name?: string; tags?: string[]; to?: string };
        if (!filePath) return text("share_file: `path` required", true);
        const { existsSync } = await import("node:fs");
        if (!existsSync(filePath)) return text(`share_file: file not found: ${filePath}`, true);
        const client = allClients()[0];
        if (!client) return text("share_file: not connected", true);

        // If 'to' specified, do E2E encryption
        if (fileTo) {
          const { encryptFile, sealKeyForPeer } = await import("../crypto/file-crypto");
          const { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } = await import("node:fs");
          const { tmpdir } = await import("node:os");
          const { join, basename } = await import("node:path");

          // Resolve target peer pubkey
          const peers = await client.listPeers();
          const targetPeer = peers.find(p => p.pubkey === fileTo || p.displayName === fileTo);
          if (!targetPeer) {
            return text(`share_file: peer not found: ${fileTo}`, true);
          }

          // Read and encrypt file
          const plaintext = readFileSync(filePath);
          const { ciphertext, nonce, key } = await encryptFile(new Uint8Array(plaintext));

          // Seal Kf for target peer
          const sealedForTarget = await sealKeyForPeer(key, targetPeer.pubkey);

          // Seal Kf for ourselves (owner)
          const myPubkey = client.getSessionPubkey();
          const sealedForSelf = myPubkey ? await sealKeyForPeer(key, myPubkey) : null;

          const fileKeys = [
            { peerPubkey: targetPeer.pubkey, sealedKey: sealedForTarget },
            ...(sealedForSelf && myPubkey ? [{ peerPubkey: myPubkey, sealedKey: sealedForSelf }] : []),
          ];

          // Build combined buffer: nonce (24 bytes) + ciphertext
          const { ensureSodium } = await import("../crypto/keypair");
          const sodium = await ensureSodium();
          const nonceBytes = sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL);
          const combined = new Uint8Array(nonceBytes.length + ciphertext.length);
          combined.set(nonceBytes, 0);
          combined.set(ciphertext, nonceBytes.length);

          const baseName = fileName ?? basename(filePath);
          const tmpDir = mkdtempSync(join(tmpdir(), "cm-"));
          const tmpPath = join(tmpDir, baseName);
          writeFileSync(tmpPath, combined);

          try {
            const fileId = await client.uploadFile(tmpPath, client.meshId, client.meshSlug, {
              name: baseName,
              tags,
              persistent: true,
              encrypted: true,
              ownerPubkey: myPubkey ?? undefined,
              fileKeys,
            });
            return text(`Shared (E2E encrypted): ${baseName} → ${targetPeer.displayName} (${fileId})`);
          } catch (e) {
            return text(`share_file: upload failed — ${e instanceof Error ? e.message : String(e)}`, true);
          } finally {
            try { unlinkSync(tmpPath); } catch { /* ignore */ }
            try { rmdirSync(tmpDir); } catch { /* ignore */ }
          }
        }

        // Plain (unencrypted) upload — existing code
        try {
          const fileId = await client.uploadFile(filePath, client.meshId, client.meshSlug, {
            name: fileName, tags, persistent: true,
          });
          return text(`Shared: ${fileName ?? filePath} (${fileId})`);
        } catch (e) {
          return text(`share_file: upload failed — ${e instanceof Error ? e.message : String(e)}`, true);
        }
      }

      case "get_file": {
        const { id, save_to } = (args ?? {}) as { id?: string; save_to?: string };
        if (!id || !save_to) return text("get_file: `id` and `save_to` required", true);
        const client = allClients()[0];
        if (!client) return text("get_file: not connected", true);
        const result = await client.getFile(id);
        if (!result) return text(`get_file: file ${id} not found`, true);

        if (result.encrypted) {
          if (!result.sealedKey) return text("get_file: encrypted file — no decryption key available for your session", true);
          const { openSealedKey, decryptFile } = await import("../crypto/file-crypto");
          const { ensureSodium } = await import("../crypto/keypair");
          const myPubkey = client.getSessionPubkey();
          const mySecret = client.getSessionSecretKey();

          if (!myPubkey || !mySecret) {
            return text("get_file: no session keypair — cannot decrypt", true);
          }

          const kf = await openSealedKey(result.sealedKey, myPubkey, mySecret);
          if (!kf) return text("get_file: failed to open sealed key", true);

          // Download file bytes from presigned URL
          const resp = await fetch(result.url, { signal: AbortSignal.timeout(30_000) });
          if (!resp.ok) return text(`get_file: download failed (${resp.status})`, true);
          const buf = new Uint8Array(await resp.arrayBuffer());

          // Wire format: first 24 bytes = nonce, rest = ciphertext
          const sodium = await ensureSodium();
          const NONCE_BYTES = sodium.crypto_secretbox_NONCEBYTES; // 24
          const nonce = sodium.to_base64(buf.slice(0, NONCE_BYTES), sodium.base64_variants.ORIGINAL);
          const ciphertext = buf.slice(NONCE_BYTES);

          const plaintext = await decryptFile(ciphertext, nonce, kf);
          if (!plaintext) return text("get_file: decryption failed", true);

          const { writeFileSync, mkdirSync } = await import("node:fs");
          const { dirname } = await import("node:path");
          mkdirSync(dirname(save_to), { recursive: true });
          writeFileSync(save_to, plaintext);
          return text(`Downloaded and decrypted: ${result.name} → ${save_to}`);
        }

        // Unencrypted — existing download logic
        const res = await fetch(result.url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) return text(`get_file: download failed (${res.status})`, true);
        const { writeFileSync, mkdirSync } = await import("node:fs");
        const { dirname } = await import("node:path");
        mkdirSync(dirname(save_to), { recursive: true });
        writeFileSync(save_to, Buffer.from(await res.arrayBuffer()));
        return text(`Downloaded: ${result.name} → ${save_to}`);
      }

      case "list_files": {
        const { query, from } = (args ?? {}) as { query?: string; from?: string };
        const client = allClients()[0];
        if (!client) return text("list_files: not connected", true);
        const files = await client.listFiles(query, from);
        if (files.length === 0) return text("No files found.");
        const lines = files.map(f =>
          `- **${f.name}** (${f.id.slice(0, 8)}…, ${f.size} bytes) by ${f.uploadedBy}${f.tags.length ? ` [${f.tags.join(", ")}]` : ""}`
        );
        return text(lines.join("\n"));
      }

      case "file_status": {
        const { id } = (args ?? {}) as { id?: string };
        if (!id) return text("file_status: `id` required", true);
        const client = allClients()[0];
        if (!client) return text("file_status: not connected", true);
        const accesses = await client.fileStatus(id);
        if (accesses.length === 0) return text("No one has accessed this file yet.");
        const lines = accesses.map(a => `- ${a.peerName} at ${a.accessedAt}`);
        return text(`Accessed by:\n${lines.join("\n")}`);
      }

      case "delete_file": {
        const { id } = (args ?? {}) as { id?: string };
        if (!id) return text("delete_file: `id` required", true);
        const client = allClients()[0];
        if (!client) return text("delete_file: not connected", true);
        await client.deleteFile(id);
        return text(`Deleted: ${id}`);
      }

      // --- Vectors ---
      case "vector_store": {
        const { collection, text: storeText, metadata } = (args ?? {}) as { collection?: string; text?: string; metadata?: Record<string, unknown> };
        if (!collection || !storeText) return text("vector_store: `collection` and `text` required", true);
        const client = allClients()[0];
        if (!client) return text("vector_store: not connected", true);
        const id = await client.vectorStore(collection, storeText, metadata);
        return text(`Stored in ${collection}${id ? ` (${id})` : ""}`);
      }
      case "vector_search": {
        const { collection, query, limit } = (args ?? {}) as { collection?: string; query?: string; limit?: number };
        if (!collection || !query) return text("vector_search: `collection` and `query` required", true);
        const client = allClients()[0];
        if (!client) return text("vector_search: not connected", true);
        const results = await client.vectorSearch(collection, query, limit);
        if (results.length === 0) return text(`No results in ${collection} for "${query}".`);
        const lines = results.map(r => `- [${r.id.slice(0, 8)}…] (score: ${r.score.toFixed(3)}) ${r.text.slice(0, 120)}${r.text.length > 120 ? "…" : ""}`);
        return text(`${results.length} result(s) in ${collection}:\n${lines.join("\n")}`);
      }
      case "vector_delete": {
        const { collection, id } = (args ?? {}) as { collection?: string; id?: string };
        if (!collection || !id) return text("vector_delete: `collection` and `id` required", true);
        const client = allClients()[0];
        if (!client) return text("vector_delete: not connected", true);
        await client.vectorDelete(collection, id);
        return text(`Deleted ${id} from ${collection}`);
      }
      case "list_collections": {
        const client = allClients()[0];
        if (!client) return text("list_collections: not connected", true);
        const collections = await client.listCollections();
        if (collections.length === 0) return text("No vector collections.");
        return text(`Collections:\n${collections.map(c => `- ${c}`).join("\n")}`);
      }

      // --- Graph ---
      case "graph_query": {
        const { cypher } = (args ?? {}) as { cypher?: string };
        if (!cypher) return text("graph_query: `cypher` required", true);
        const client = allClients()[0];
        if (!client) return text("graph_query: not connected", true);
        const rows = await client.graphQuery(cypher);
        if (rows.length === 0) return text("No results.");
        return text(JSON.stringify(rows, null, 2));
      }
      case "graph_execute": {
        const { cypher } = (args ?? {}) as { cypher?: string };
        if (!cypher) return text("graph_execute: `cypher` required", true);
        const client = allClients()[0];
        if (!client) return text("graph_execute: not connected", true);
        const rows = await client.graphExecute(cypher);
        return text(rows.length > 0 ? JSON.stringify(rows, null, 2) : "Executed successfully.");
      }

      // --- Context ---
      case "share_context": {
        const { summary, files_read, key_findings, tags } = (args ?? {}) as { summary?: string; files_read?: string[]; key_findings?: string[]; tags?: string[] };
        if (!summary) return text("share_context: `summary` required", true);
        const client = allClients()[0];
        if (!client) return text("share_context: not connected", true);
        await client.shareContext(summary, files_read, key_findings, tags);
        return text(`Context shared: "${summary.slice(0, 80)}${summary.length > 80 ? "…" : ""}"`);
      }
      case "get_context": {
        const { query } = (args ?? {}) as { query?: string };
        if (!query) return text("get_context: `query` required", true);
        const client = allClients()[0];
        if (!client) return text("get_context: not connected", true);
        const contexts = await client.getContext(query);
        if (contexts.length === 0) return text(`No context found for "${query}".`);
        const lines = contexts.map(c => {
          const files = c.filesRead.length ? `\n  Files: ${c.filesRead.join(", ")}` : "";
          const findings = c.keyFindings.length ? `\n  Findings: ${c.keyFindings.join("; ")}` : "";
          return `- **${c.peerName}** (${c.updatedAt}): ${c.summary}${files}${findings}`;
        });
        return text(`${contexts.length} context(s):\n${lines.join("\n")}`);
      }
      case "list_contexts": {
        const client = allClients()[0];
        if (!client) return text("list_contexts: not connected", true);
        const contexts = await client.listContexts();
        if (contexts.length === 0) return text("No peer contexts shared yet.");
        const lines = contexts.map(c => `- **${c.peerName}**: ${c.summary}${c.tags.length ? ` [${c.tags.join(", ")}]` : ""}`);
        return text(`Peer contexts:\n${lines.join("\n")}`);
      }

      // --- Tasks ---
      case "create_task": {
        const { title, assignee, priority, tags } = (args ?? {}) as { title?: string; assignee?: string; priority?: string; tags?: string[] };
        if (!title) return text("create_task: `title` required", true);
        const client = allClients()[0];
        if (!client) return text("create_task: not connected", true);
        const id = await client.createTask(title, assignee, priority, tags);
        return text(`Task created${id ? ` (${id})` : ""}: "${title}"${assignee ? ` → ${assignee}` : ""}`);
      }
      case "claim_task": {
        const { id } = (args ?? {}) as { id?: string };
        if (!id) return text("claim_task: `id` required", true);
        const client = allClients()[0];
        if (!client) return text("claim_task: not connected", true);
        await client.claimTask(id);
        return text(`Claimed task: ${id}`);
      }
      case "complete_task": {
        const { id, result } = (args ?? {}) as { id?: string; result?: string };
        if (!id) return text("complete_task: `id` required", true);
        const client = allClients()[0];
        if (!client) return text("complete_task: not connected", true);
        await client.completeTask(id, result);
        return text(`Completed task: ${id}${result ? ` — ${result}` : ""}`);
      }
      case "list_tasks": {
        const { status, assignee } = (args ?? {}) as { status?: string; assignee?: string };
        const client = allClients()[0];
        if (!client) return text("list_tasks: not connected", true);
        const tasks = await client.listTasks(status, assignee);
        if (tasks.length === 0) return text("No tasks found.");
        const lines = tasks.map(t => `- [${t.id.slice(0, 8)}…] **${t.title}** (${t.status}, ${t.priority}) ${t.assignee ? `→ ${t.assignee}` : "unassigned"} (by ${t.createdBy})`);
        return text(`${tasks.length} task(s):\n${lines.join("\n")}`);
      }

      // --- Mesh Database ---
      case "mesh_query": {
        const { sql: querySql } = (args ?? {}) as { sql?: string };
        if (!querySql) return text("mesh_query: `sql` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_query: not connected", true);
        const result = await client.meshQuery(querySql);
        if (!result) return text("mesh_query: query failed or timed out", true);
        if (result.rows.length === 0) return text(`Query returned 0 rows.`);
        const header = `| ${result.columns.join(" | ")} |`;
        const sep = `| ${result.columns.map(() => "---").join(" | ")} |`;
        const rows = result.rows.map(r => `| ${result.columns.map(c => String(r[c] ?? "")).join(" | ")} |`);
        return text(`${result.rowCount} row(s):\n${header}\n${sep}\n${rows.join("\n")}`);
      }
      case "mesh_execute": {
        const { sql: execSql } = (args ?? {}) as { sql?: string };
        if (!execSql) return text("mesh_execute: `sql` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_execute: not connected", true);
        await client.meshExecute(execSql);
        return text(`Executed.`);
      }
      case "mesh_schema": {
        const client = allClients()[0];
        if (!client) return text("mesh_schema: not connected", true);
        const tables = await client.meshSchema();
        if (!tables || tables.length === 0) return text("No tables in mesh database.");
        const lines = tables.map(t => `**${t.name}**: ${t.columns.map(c => `${c.name} (${c.type}${c.nullable ? ", nullable" : ""})`).join(", ")}`);
        return text(lines.join("\n"));
      }

      // --- Streams ---
      case "create_stream": {
        const { name: streamName } = (args ?? {}) as { name?: string };
        if (!streamName) return text("create_stream: `name` required", true);
        const client = allClients()[0];
        if (!client) return text("create_stream: not connected", true);
        const streamId = await client.createStream(streamName);
        return text(`Stream created: ${streamName}${streamId ? ` (${streamId})` : ""}`);
      }
      case "publish": {
        const { stream: pubStream, data: pubData } = (args ?? {}) as { stream?: string; data?: unknown };
        if (!pubStream) return text("publish: `stream` required", true);
        const client = allClients()[0];
        if (!client) return text("publish: not connected", true);
        await client.publish(pubStream, pubData);
        return text(`Published to ${pubStream}.`);
      }
      case "subscribe": {
        const { stream: subStream } = (args ?? {}) as { stream?: string };
        if (!subStream) return text("subscribe: `stream` required", true);
        const client = allClients()[0];
        if (!client) return text("subscribe: not connected", true);
        await client.subscribe(subStream);
        return text(`Subscribed to ${subStream}. Data pushes will arrive as channel notifications.`);
      }
      case "list_streams": {
        const client = allClients()[0];
        if (!client) return text("list_streams: not connected", true);
        const streams = await client.listStreams();
        if (streams.length === 0) return text("No active streams.");
        const lines = streams.map(s => `- **${s.name}** (${s.id.slice(0, 8)}…) by ${s.createdBy}, ${s.subscriberCount} subscriber(s)`);
        return text(lines.join("\n"));
      }

      case "mesh_set_clock": {
        const { speed } = (args ?? {}) as { speed?: number };
        if (!speed || speed < 1 || speed > 100) return text("mesh_set_clock: speed must be 1-100", true);
        const client = allClients()[0];
        if (!client) return text("mesh_set_clock: not connected", true);
        const result = await client.setClock(speed);
        if (!result) return text("mesh_set_clock: timed out", true);
        return text([
          `**Clock set to x${result.speed}**`,
          `Paused: ${result.paused}`,
          `Tick: ${result.tick}`,
          `Sim time: ${result.simTime}`,
          `Started at: ${result.startedAt}`,
        ].join("\n"));
      }

      case "mesh_pause_clock": {
        const client = allClients()[0];
        if (!client) return text("mesh_pause_clock: not connected", true);
        const result = await client.pauseClock();
        if (!result) return text("mesh_pause_clock: timed out", true);
        return text([
          "**Clock paused**",
          `Speed: x${result.speed}`,
          `Tick: ${result.tick}`,
          `Sim time: ${result.simTime}`,
        ].join("\n"));
      }

      case "mesh_resume_clock": {
        const client = allClients()[0];
        if (!client) return text("mesh_resume_clock: not connected", true);
        const result = await client.resumeClock();
        if (!result) return text("mesh_resume_clock: timed out", true);
        return text([
          "**Clock resumed**",
          `Speed: x${result.speed}`,
          `Tick: ${result.tick}`,
          `Sim time: ${result.simTime}`,
        ].join("\n"));
      }

      case "mesh_clock": {
        const client = allClients()[0];
        if (!client) return text("mesh_clock: not connected", true);
        const result = await client.getClock();
        if (!result) return text("mesh_clock: timed out", true);
        const statusLabel = result.speed === 0 ? "not started" : result.paused ? "paused" : "running";
        return text([
          `**Clock status: ${statusLabel}**`,
          `Speed: x${result.speed}`,
          `Tick: ${result.tick}`,
          `Sim time: ${result.simTime}`,
          `Started at: ${result.startedAt}`,
        ].join("\n"));
      }

      case "mesh_info": {
        const client = allClients()[0];
        if (!client) return text("mesh_info: not connected", true);
        const info = await client.meshInfo();
        if (!info) return text("mesh_info: timed out", true);
        const lines = [
          `**Mesh**: ${info.mesh}`,
          `**Peers**: ${info.peers}`,
          `**Groups**: ${(info.groups as string[])?.join(", ") || "none"}`,
          `**State keys**: ${(info.stateKeys as string[])?.join(", ") || "none"}`,
          `**Memories**: ${info.memoryCount}`,
          `**Files**: ${info.fileCount}`,
          `**Tasks**: open=${(info.tasks as any)?.open ?? 0}, claimed=${(info.tasks as any)?.claimed ?? 0}, done=${(info.tasks as any)?.done ?? 0}`,
          `**Streams**: ${(info.streams as string[])?.join(", ") || "none"}`,
          `**Tables**: ${(info.tables as string[])?.join(", ") || "none"}`,
          `**Your name**: ${info.yourName}`,
          `**Your groups**: ${(info.yourGroups as any[])?.map((g: any) => `@${g.name}${g.role ? ':' + g.role : ''}`).join(", ") || "none"}`,
        ];
        return text(lines.join("\n"));
      }

      case "mesh_stats": {
        const clients = allClients();
        if (clients.length === 0) return text("mesh_stats: no joined meshes", true);
        const sections: string[] = [];
        for (const c of clients) {
          const peers = await c.listPeers();
          const header = `## ${c.meshSlug}`;
          const rows = peers.map((p) => {
            const s = p.stats;
            if (!s) return `| ${p.displayName} | - | - | - | - | - |`;
            const up = s.uptime != null ? `${Math.floor(s.uptime / 60)}m` : "-";
            return `| ${p.displayName} | ${s.messagesIn ?? 0} | ${s.messagesOut ?? 0} | ${s.toolCalls ?? 0} | ${up} | ${s.errors ?? 0} |`;
          });
          sections.push(
            `${header}\n| Peer | Msgs In | Msgs Out | Tool Calls | Uptime | Errors |\n|------|---------|----------|------------|--------|--------|\n${rows.join("\n")}`,
          );
        }
        return text(sections.join("\n\n"));
      }

      // --- Skills ---
      case "share_skill": {
        const {
          name: skillName, description: skillDesc, instructions: skillInstr, tags: skillTags,
          when_to_use, allowed_tools, model, context: skillContext, agent, user_invocable, argument_hint,
        } = (args ?? {}) as {
          name?: string; description?: string; instructions?: string; tags?: string[];
          when_to_use?: string; allowed_tools?: string[]; model?: string; context?: string;
          agent?: string; user_invocable?: boolean; argument_hint?: string;
        };
        if (!skillName || !skillDesc || !skillInstr) return text("share_skill: `name`, `description`, and `instructions` required", true);
        const client = allClients()[0];
        if (!client) return text("share_skill: not connected", true);
        // Build manifest from optional metadata fields
        const manifest: Record<string, unknown> = {};
        if (when_to_use) manifest.when_to_use = when_to_use;
        if (allowed_tools?.length) manifest.allowed_tools = allowed_tools;
        if (model) manifest.model = model;
        if (skillContext) manifest.context = skillContext;
        if (agent) manifest.agent = agent;
        if (user_invocable === false) manifest.user_invocable = false;
        if (argument_hint) manifest.argument_hint = argument_hint;
        const result = await client.shareSkill(skillName, skillDesc, skillInstr, skillTags, Object.keys(manifest).length > 0 ? manifest : undefined);
        if (!result) return text("share_skill: broker did not acknowledge", true);
        // Notify prompts changed so Claude Code refreshes slash commands
        server.notification({ method: "notifications/prompts/list_changed" });
        server.notification({ method: "notifications/resources/list_changed" });
        return text(`Skill "${skillName}" published to the mesh. It will appear as /claudemesh:${skillName} in Claude Code.`);
      }
      case "get_skill": {
        const { name: gsName } = (args ?? {}) as { name?: string };
        if (!gsName) return text("get_skill: `name` required", true);
        const client = allClients()[0];
        if (!client) return text("get_skill: not connected", true);
        const skill = await client.getSkill(gsName);
        if (!skill) return text(`Skill "${gsName}" not found in the mesh.`);
        const manifest = skill.manifest as Record<string, unknown> | null | undefined;
        const metaLines: string[] = [];
        if (manifest) {
          if (manifest.when_to_use) metaLines.push(`**When to use:** ${manifest.when_to_use}`);
          if (manifest.allowed_tools) metaLines.push(`**Allowed tools:** ${(manifest.allowed_tools as string[]).join(", ")}`);
          if (manifest.model) metaLines.push(`**Model:** ${manifest.model}`);
          if (manifest.context) metaLines.push(`**Context:** ${manifest.context}`);
          if (manifest.agent) metaLines.push(`**Agent:** ${manifest.agent}`);
        }
        return text(
          `# Skill: ${skill.name}\n\n` +
          `**Description:** ${skill.description}\n` +
          `**Author:** ${skill.author}\n` +
          `**Tags:** ${skill.tags.length ? skill.tags.join(", ") : "none"}\n` +
          `**Created:** ${skill.createdAt}\n` +
          `**Slash command:** /claudemesh:${skill.name}\n` +
          (metaLines.length ? metaLines.join("\n") + "\n" : "") +
          `\n---\n\n` +
          `## Instructions\n\n${skill.instructions}`,
        );
      }
      case "list_skills": {
        const { query: skillQuery } = (args ?? {}) as { query?: string };
        const client = allClients()[0];
        if (!client) return text("list_skills: not connected", true);
        const skills = await client.listSkills(skillQuery);
        if (skills.length === 0) return text(skillQuery ? `No skills found for "${skillQuery}".` : "No skills in the mesh yet.");
        const lines = skills.map(s =>
          `- **${s.name}**: ${s.description}${s.tags.length ? ` [${s.tags.join(", ")}]` : ""} (by ${s.author})`,
        );
        return text(`${skills.length} skill(s):\n${lines.join("\n")}`);
      }
      case "remove_skill": {
        const { name: rsName } = (args ?? {}) as { name?: string };
        if (!rsName) return text("remove_skill: `name` required", true);
        const client = allClients()[0];
        if (!client) return text("remove_skill: not connected", true);
        const removed = await client.removeSkill(rsName);
        if (removed) {
          server.notification({ method: "notifications/prompts/list_changed" });
          server.notification({ method: "notifications/resources/list_changed" });
        }
        return text(removed ? `Skill "${rsName}" removed.` : `Skill "${rsName}" not found.`, !removed);
      }

      case "ping_mesh": {
        const { priorities: pingPriorities } = (args ?? {}) as { priorities?: string[] };
        const toTest = (pingPriorities ?? ["now", "next"]) as Priority[];
        const client = allClients()[0];
        if (!client) return text("ping_mesh: not connected", true);
        const results: string[] = [];

        // Diagnostics: connection state
        results.push(`WS status: ${client.status}`);
        results.push(`Mesh: ${client.meshSlug}`);

        // Check own peer status (explains priority gating)
        const peers = await client.listPeers();
        const selfPeer = peers.find(p => p.displayName === myName);
        results.push(`Your status: ${selfPeer?.status ?? "not found in peer list"}`);
        results.push(`Peers online: ${peers.length}`);
        results.push(`Push buffer: ${client.pushHistory.length} buffered`);

        // Test send→ack latency per priority (doesn't need round-trip)
        for (const prio of toTest) {
          const sendTime = Date.now();
          // Send to a peer if one exists, otherwise broadcast
          const target = peers.find(p => p.displayName !== myName);
          const sendResult = await client.send(
            target?.pubkey ?? "*",
            `__ping__ ${prio} from ${myName} at ${new Date().toISOString()}`,
            prio,
          );
          const ackTime = Date.now();

          if (!sendResult.ok) {
            results.push(`[${prio}] SEND FAILED: ${sendResult.error}`);
          } else {
            results.push(`[${prio}] send→ack: ${ackTime - sendTime}ms (msgId: ${sendResult.messageId?.slice(0, 12)})`);
            if (prio !== "now" && selfPeer?.status === "working") {
              results.push(`  ⚠ peer status is "working" — broker holds "${prio}" until idle`);
            }
          }
        }

        // Check if notification pipeline works
        results.push("");
        results.push("Pipeline check:");
        results.push(`  onPush handlers: active`);
        results.push(`  messageMode: ${messageMode}`);
        results.push(`  server.notification: ${messageMode === "off" ? "disabled (mode=off)" : "enabled"}`);

        return text(results.join("\n"));
      }

      // --- MCP Proxy ---
      case "mesh_mcp_register": {
        const { server_name, description, tools: regTools, persistent: regPersistent } = (args ?? {}) as {
          server_name?: string;
          description?: string;
          tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
          persistent?: boolean;
        };
        if (!server_name || !description || !regTools?.length)
          return text("mesh_mcp_register: `server_name`, `description`, and `tools` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_mcp_register: not connected", true);
        const result = await client.mcpRegister(server_name, description, regTools, regPersistent);
        if (!result) return text("mesh_mcp_register: broker did not acknowledge", true);
        const persistLabel = regPersistent ? " (persistent — survives disconnect)" : "";
        return text(`Registered MCP server "${result.serverName}" with ${result.toolCount} tool(s)${persistLabel}. Other peers can now call its tools via mesh_tool_call.`);
      }
      case "mesh_mcp_list": {
        const client = allClients()[0];
        if (!client) return text("mesh_mcp_list: not connected", true);
        const servers = await client.mcpList();
        if (servers.length === 0) return text("No MCP servers registered in the mesh.");
        const lines = servers.map((s: any) => {
          const toolList = s.tools.map((t: any) => `    - **${t.name}**: ${t.description}`).join("\n");
          const status = s.online === false
            ? ` [OFFLINE${s.offlineSince ? ` since ${s.offlineSince}` : ""}]`
            : "";
          return `- **${s.name}** (hosted by ${s.hostedBy})${status}: ${s.description}\n${toolList}`;
        });
        return text(`${servers.length} MCP server(s) in mesh:\n${lines.join("\n")}`);
      }
      case "mesh_tool_call": {
        const { server_name: callServer, tool_name: callTool, args: callArgs } = (args ?? {}) as {
          server_name?: string;
          tool_name?: string;
          args?: Record<string, unknown>;
        };
        if (!callServer || !callTool)
          return text("mesh_tool_call: `server_name` and `tool_name` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_tool_call: not connected", true);
        const callResult = await client.mcpCall(callServer, callTool, callArgs ?? {});
        if (callResult.error) return text(`mesh_tool_call error: ${callResult.error}`, true);
        return text(typeof callResult.result === "string" ? callResult.result : JSON.stringify(callResult.result, null, 2));
      }
      case "mesh_mcp_remove": {
        const { server_name: rmServer } = (args ?? {}) as { server_name?: string };
        if (!rmServer) return text("mesh_mcp_remove: `server_name` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_mcp_remove: not connected", true);
        await client.mcpUnregister(rmServer);
        return text(`Unregistered MCP server "${rmServer}" from the mesh.`);
      }

      case "grant_file_access": {
        const { fileId, to: grantTo } = (args ?? {}) as { fileId?: string; to?: string };
        if (!fileId || !grantTo) return text("grant_file_access: `fileId` and `to` required", true);
        const client = allClients()[0];
        if (!client) return text("grant_file_access: not connected", true);

        const peers = await client.listPeers();
        const targetPeer = peers.find(p => p.pubkey === grantTo || p.displayName === grantTo);
        if (!targetPeer) return text(`grant_file_access: peer not found: ${grantTo}`, true);

        const result = await client.getFile(fileId);
        if (!result) return text("grant_file_access: file not found", true);
        if (!result.encrypted) return text("grant_file_access: file is not encrypted", true);
        if (!result.sealedKey) return text("grant_file_access: no key available (are you the owner?)", true);

        const { openSealedKey, sealKeyForPeer } = await import("../crypto/file-crypto");
        const myPubkey = client.getSessionPubkey();
        const mySecret = client.getSessionSecretKey();
        if (!myPubkey || !mySecret) return text("grant_file_access: no session keypair", true);

        const kf = await openSealedKey(result.sealedKey, myPubkey, mySecret);
        if (!kf) return text("grant_file_access: cannot decrypt your own key", true);

        const sealedForPeer = await sealKeyForPeer(kf, targetPeer.pubkey);
        const ok = await client.grantFileAccess(fileId, targetPeer.pubkey, sealedForPeer);

        if (!ok) return text("grant_file_access: broker did not confirm", true);
        return text(`Access granted: ${targetPeer.displayName} can now download file ${fileId}`);
      }

      // --- Peer file sharing ---
      case "read_peer_file": {
        const { peer: peerName, path: filePath } = (args ?? {}) as { peer?: string; path?: string };
        if (!peerName || !filePath) return text("read_peer_file: `peer` and `path` required", true);
        const client = allClients()[0];
        if (!client) return text("read_peer_file: not connected", true);

        // Resolve peer name to pubkey
        const peers = await client.listPeers();
        const nameLower = peerName.toLowerCase();
        let targetPubkey: string | null = null;
        // Direct pubkey?
        if (/^[0-9a-f]{64}$/.test(peerName)) {
          targetPubkey = peerName;
        } else {
          const match = peers.find(p => p.displayName.toLowerCase() === nameLower);
          if (!match) {
            const partials = peers.filter(p => p.displayName.toLowerCase().includes(nameLower));
            if (partials.length === 1) {
              targetPubkey = partials[0]!.pubkey;
            } else {
              const names = peers.map(p => p.displayName).join(", ");
              return text(`read_peer_file: peer "${peerName}" not found. Online: ${names || "(none)"}`, true);
            }
          } else {
            targetPubkey = match.pubkey;
          }
        }

        // Check if peer is local — hint AI to use filesystem directly
        const resolvedPeer = peers.find(p => p.pubkey === targetPubkey);
        const isLocal = resolvedPeer?.hostname && resolvedPeer.hostname === require("os").hostname();
        let localHint = "";
        if (isLocal && resolvedPeer?.cwd) {
          const directPath = require("path").resolve(resolvedPeer.cwd, filePath);
          localHint = `\n\n> **Hint:** This peer is LOCAL (same machine). Next time, read directly: \`${directPath}\` — faster, no size limit.\n\n`;
        }

        const result = await client.requestFile(targetPubkey, filePath);
        if (result.error) return text(`read_peer_file: ${result.error}`, true);
        if (!result.content) return text("read_peer_file: empty response from peer", true);

        // Decode base64
        try {
          const decoded = Buffer.from(result.content, "base64").toString("utf-8");
          return text(localHint + decoded);
        } catch {
          return text("read_peer_file: failed to decode file content (binary file?)", true);
        }
      }

      case "list_peer_files": {
        const { peer: peerName, path: dirPath, pattern } = (args ?? {}) as { peer?: string; path?: string; pattern?: string };
        if (!peerName) return text("list_peer_files: `peer` required", true);
        const client = allClients()[0];
        if (!client) return text("list_peer_files: not connected", true);

        // Resolve peer name to pubkey
        const peers = await client.listPeers();
        const nameLower = peerName.toLowerCase();
        let targetPubkey: string | null = null;
        if (/^[0-9a-f]{64}$/.test(peerName)) {
          targetPubkey = peerName;
        } else {
          const match = peers.find(p => p.displayName.toLowerCase() === nameLower);
          if (!match) {
            const partials = peers.filter(p => p.displayName.toLowerCase().includes(nameLower));
            if (partials.length === 1) {
              targetPubkey = partials[0]!.pubkey;
            } else {
              const names = peers.map(p => p.displayName).join(", ");
              return text(`list_peer_files: peer "${peerName}" not found. Online: ${names || "(none)"}`, true);
            }
          } else {
            targetPubkey = match.pubkey;
          }
        }

        const result = await client.requestDir(targetPubkey, dirPath ?? ".", pattern);
        if (result.error) return text(`list_peer_files: ${result.error}`, true);
        if (!result.entries || result.entries.length === 0) return text("No files found.");

        return text(result.entries.join("\n"));
      }

      // --- Webhooks ---
      case "create_webhook": {
        const { name: whName } = (args ?? {}) as { name?: string };
        if (!whName) return text("create_webhook: `name` required", true);
        const client = allClients()[0];
        if (!client) return text("create_webhook: not connected", true);
        const wh = await client.createWebhook(whName);
        if (!wh) return text("create_webhook: broker did not acknowledge — check connection", true);
        return text(`Webhook **${wh.name}** created.\n\nURL: ${wh.url}\nSecret: ${wh.secret}\n\nExternal services can POST JSON to this URL. The payload will be pushed to all connected mesh peers.`);
      }
      case "list_webhooks": {
        const client = allClients()[0];
        if (!client) return text("list_webhooks: not connected", true);
        const webhooks = await client.listWebhooks();
        if (webhooks.length === 0) return text("No active webhooks.");
        const lines = webhooks.map(w => `- **${w.name}** — ${w.url} (created ${w.createdAt})`);
        return text(`${webhooks.length} webhook(s):\n${lines.join("\n")}`);
      }
      case "delete_webhook": {
        const { name: delName } = (args ?? {}) as { name?: string };
        if (!delName) return text("delete_webhook: `name` required", true);
        const client = allClients()[0];
        if (!client) return text("delete_webhook: not connected", true);
        const ok = await client.deleteWebhook(delName);
        return text(ok ? `Webhook "${delName}" deactivated.` : `Failed to deactivate webhook "${delName}".`, !ok);
      }

      // --- Vault tools ---
      case "vault_set": {
        const { key, value, type: vType, mount_path, description } = (args ?? {}) as {
          key?: string; value?: string; type?: "env" | "file"; mount_path?: string; description?: string;
        };
        if (!key || !value) return text("vault_set: `key` and `value` required", true);
        const client = allClients()[0];
        if (!client) return text("vault_set: not connected", true);
        const entryType = vType ?? "env";

        // Read plaintext
        let plaintextBytes: Uint8Array;
        if (entryType === "file") {
          const { existsSync, readFileSync } = await import("node:fs");
          if (!existsSync(value)) return text(`vault_set: file not found: ${value}`, true);
          plaintextBytes = new Uint8Array(readFileSync(value));
        } else {
          plaintextBytes = new TextEncoder().encode(value);
        }

        // E2E encrypt: crypto_secretbox with random Kf, then seal Kf with mesh pubkey
        const { encryptFile, sealKeyForPeer } = await import("../crypto/file-crypto");
        const { ciphertext, nonce, key: kf } = await encryptFile(plaintextBytes);
        const sealedKey = await sealKeyForPeer(kf, client.getMeshPubkey());

        // Convert ciphertext to base64 for storage
        const { ensureSodium } = await import("../crypto/keypair");
        const sodium = await ensureSodium();
        const ciphertextB64 = sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL);

        const ok = await client.vaultSet(key, ciphertextB64, nonce, sealedKey, entryType, mount_path, description);
        if (!ok) return text("vault_set: broker did not acknowledge", true);
        return text(`Vault entry "${key}" stored (${entryType}, E2E encrypted).`);
      }
      case "vault_list": {
        const client = allClients()[0];
        if (!client) return text("vault_list: not connected", true);
        const entries = await client.vaultList();
        if (entries.length === 0) return text("Vault is empty.");
        const lines = entries.map((e: any) =>
          `- **${e.key}** (${e.entry_type}${e.mount_path ? ` → ${e.mount_path}` : ""})${e.description ? ` — ${e.description}` : ""} (${e.updated_at})`
        );
        return text(`${entries.length} vault entry(s):\n${lines.join("\n")}`);
      }
      case "vault_delete": {
        const { key } = (args ?? {}) as { key?: string };
        if (!key) return text("vault_delete: `key` required", true);
        const client = allClients()[0];
        if (!client) return text("vault_delete: not connected", true);
        const ok = await client.vaultDelete(key);
        return text(ok ? `Vault entry "${key}" deleted.` : `Vault entry "${key}" not found.`);
      }

      // --- Service deployment tools ---
      case "mesh_mcp_deploy": {
        const { server_name, file_id, git_url, git_branch, npx_package, env: deployEnv, runtime, memory_mb, network_allow, scope } = (args ?? {}) as {
          server_name?: string; file_id?: string; git_url?: string; git_branch?: string;
          npx_package?: string;
          env?: Record<string, string>; runtime?: string; memory_mb?: number;
          network_allow?: string[]; scope?: unknown;
        };
        if (!server_name) return text("mesh_mcp_deploy: `server_name` required", true);
        if (!file_id && !git_url && !npx_package) return text("mesh_mcp_deploy: one of `file_id`, `git_url`, or `npx_package` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_mcp_deploy: not connected", true);
        const source = npx_package
          ? { type: "npx" as const, package: npx_package }
          : file_id
            ? { type: "zip" as const, file_id }
            : { type: "git" as const, url: git_url!, branch: git_branch };

        // Resolve $vault: references in env vars — decrypt client-side
        const resolvedEnv: Record<string, string> = {};
        const vaultResolved: string[] = [];
        if (deployEnv) {
          // Collect vault keys needed
          const vaultRefs: Array<{ envKey: string; vaultKey: string; isFile: boolean; mountPath?: string }> = [];
          for (const [envKey, envVal] of Object.entries(deployEnv)) {
            if (typeof envVal === "string" && envVal.startsWith("$vault:")) {
              const parts = envVal.slice(7).split(":");
              const vaultKey = parts[0]!;
              const isFile = parts[1] === "file";
              const mountPath = isFile ? parts.slice(2).join(":") : undefined;
              vaultRefs.push({ envKey, vaultKey, isFile, mountPath });
            } else {
              resolvedEnv[envKey] = envVal;
            }
          }

          // Fetch + decrypt vault entries client-side
          if (vaultRefs.length > 0) {
            const { openSealedKey, decryptFile } = await import("../crypto/file-crypto");
            const { ensureSodium } = await import("../crypto/keypair");
            const sodium = await ensureSodium();

            const keys = vaultRefs.map(r => r.vaultKey);
            const encryptedEntries = await client.vaultGet(keys);

            for (const ref of vaultRefs) {
              const entry = encryptedEntries.find((e: any) => e.key === ref.vaultKey);
              if (!entry) return text(`mesh_mcp_deploy: vault key "${ref.vaultKey}" not found. Use vault_set first.`, true);

              // Decrypt: open sealed key with mesh keypair, then decrypt ciphertext
              const kf = await openSealedKey(entry.sealed_key, client.getMeshPubkey(), client.getMeshSecretKey());
              if (!kf) return text(`mesh_mcp_deploy: failed to decrypt vault key "${ref.vaultKey}" — wrong keypair?`, true);

              const ciphertextBytes = sodium.from_base64(entry.ciphertext, sodium.base64_variants.ORIGINAL);
              const plainBytes = await decryptFile(ciphertextBytes, entry.nonce, kf);
              if (!plainBytes) return text(`mesh_mcp_deploy: failed to decrypt vault entry "${ref.vaultKey}" — corrupted?`, true);

              if (ref.isFile && ref.mountPath) {
                // For file-type entries: the plaintext is the file content (raw bytes).
                // Encode as base64 for transport, runner writes it to mountPath.
                resolvedEnv[ref.envKey] = `__vault_file__:${ref.mountPath}:${sodium.to_base64(plainBytes, sodium.base64_variants.ORIGINAL)}`;
              } else {
                // For env-type entries: plaintext is the secret string
                resolvedEnv[ref.envKey] = new TextDecoder().decode(plainBytes);
              }
              vaultResolved.push(ref.vaultKey);
            }
          }
        }

        const config: Record<string, unknown> = {};
        if (Object.keys(resolvedEnv).length > 0 || (deployEnv && Object.keys(deployEnv).length > 0)) {
          config.env = Object.keys(resolvedEnv).length > 0 ? resolvedEnv : deployEnv;
        }
        if (runtime) config.runtime = runtime;
        if (memory_mb) config.memory_mb = memory_mb;
        if (network_allow) config.network_allow = network_allow;
        const result = await client.mcpDeploy(server_name, source, Object.keys(config).length > 0 ? config : undefined, scope);
        const toolList = result.tools?.map((t: any) => `  - ${t.name}: ${t.description}`).join("\n") ?? "  (pending)";
        let vaultNote = "";
        if (vaultResolved.length > 0) {
          vaultNote = `\n\nVault keys resolved: ${vaultResolved.join(", ")} (decrypted client-side, sent over TLS)`;
        }
        return text(`Deployed "${server_name}" (status: ${result.status}).\n\nTools:\n${toolList}\n\nDefault scope: peer (private). Use mesh_mcp_scope to share.${vaultNote}`);
      }
      case "mesh_mcp_undeploy": {
        const { server_name } = (args ?? {}) as { server_name?: string };
        if (!server_name) return text("mesh_mcp_undeploy: `server_name` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_mcp_undeploy: not connected", true);
        const ok = await client.mcpUndeploy(server_name);
        return text(ok ? `Service "${server_name}" undeployed.` : `Failed to undeploy "${server_name}".`);
      }
      case "mesh_mcp_update": {
        const { server_name } = (args ?? {}) as { server_name?: string };
        if (!server_name) return text("mesh_mcp_update: `server_name` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_mcp_update: not connected", true);
        const result = await client.mcpUpdate(server_name);
        return text(`Updated "${server_name}" (status: ${result.status}).`);
      }
      case "mesh_mcp_logs": {
        const { server_name, lines: logLines } = (args ?? {}) as { server_name?: string; lines?: number };
        if (!server_name) return text("mesh_mcp_logs: `server_name` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_mcp_logs: not connected", true);
        const logs = await client.mcpLogs(server_name, logLines);
        if (logs.length === 0) return text(`No logs for "${server_name}".`);
        return text(`Logs for "${server_name}" (${logs.length} lines):\n\`\`\`\n${logs.join("\n")}\n\`\`\``);
      }
      case "mesh_mcp_scope": {
        const { server_name, scope } = (args ?? {}) as { server_name?: string; scope?: unknown };
        if (!server_name) return text("mesh_mcp_scope: `server_name` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_mcp_scope: not connected", true);
        const result = await client.mcpScope(server_name, scope);
        if (scope !== undefined) {
          return text(`Scope for "${server_name}" updated to: ${JSON.stringify(result.scope)}`);
        }
        return text(`**${server_name}** scope: ${JSON.stringify(result.scope)}\nDeployed by: ${result.deployed_by}`);
      }
      case "mesh_mcp_schema": {
        const { server_name, tool_name } = (args ?? {}) as { server_name?: string; tool_name?: string };
        if (!server_name) return text("mesh_mcp_schema: `server_name` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_mcp_schema: not connected", true);
        const tools = await client.mcpServiceSchema(server_name, tool_name);
        if (tools.length === 0) return text(`No tools found for "${server_name}"${tool_name ? ` (tool: ${tool_name})` : ""}.`);
        const lines = tools.map((t: any) =>
          `### ${t.name}\n${t.description}\n\`\`\`json\n${JSON.stringify(t.inputSchema, null, 2)}\n\`\`\``
        );
        return text(`Tools for "${server_name}":\n\n${lines.join("\n\n")}`);
      }
      case "mesh_mcp_catalog": {
        const client = allClients()[0];
        if (!client) return text("mesh_mcp_catalog: not connected", true);
        const services = await client.mcpCatalog();
        if (services.length === 0) return text("No services deployed in the mesh.");
        const lines = services.map((s: any) => {
          const scopeStr = typeof s.scope === "string" ? s.scope : JSON.stringify(s.scope);
          return `- **${s.name}** (${s.type}, ${s.status}) — ${s.description}\n  ${s.tool_count} tools | scope: ${scopeStr} | by ${s.deployed_by} | ${s.source_type}${s.runtime ? ` (${s.runtime})` : ""}`;
        });
        return text(`${services.length} service(s) in mesh:\n\n${lines.join("\n")}`);
      }
      case "mesh_skill_deploy": {
        const { file_id, git_url, git_branch } = (args ?? {}) as { file_id?: string; git_url?: string; git_branch?: string };
        if (!file_id && !git_url) return text("mesh_skill_deploy: either `file_id` or `git_url` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_skill_deploy: not connected", true);
        const source = file_id
          ? { type: "zip" as const, file_id }
          : { type: "git" as const, url: git_url!, branch: git_branch };
        const result = await client.skillDeploy(source);
        return text(`Skill "${result.name}" deployed.\nFiles: ${result.files.join(", ")}`);
      }

      // --- URL Watch ---
      case "mesh_watch": {
        const { url, mode, extract, interval, notify_on, headers, label } = (args ?? {}) as any;
        if (!url) return text("mesh_watch: `url` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_watch: not connected", true);
        const result = await client.watch(url, { mode, extract, interval, notify_on, headers, label });
        if (result.error) return text(`mesh_watch: ${result.error}`, true);
        return text(`Watching "${label ?? url}" (${result.mode}, every ${result.interval}s)\nWatch ID: ${result.watchId}`);
      }
      case "mesh_unwatch": {
        const { watch_id } = (args ?? {}) as { watch_id?: string };
        if (!watch_id) return text("mesh_unwatch: `watch_id` required", true);
        const client = allClients()[0];
        if (!client) return text("mesh_unwatch: not connected", true);
        await client.unwatch(watch_id);
        return text(`Watch ${watch_id} stopped.`);
      }
      case "mesh_watches": {
        const client = allClients()[0];
        if (!client) return text("mesh_watches: not connected", true);
        const watches = await client.watchList();
        if (watches.length === 0) return text("No active watches.");
        const lines = watches.map((w: any) =>
          `- **${w.id}** ${w.label ? `(${w.label}) ` : ""}${w.url}\n  mode: ${w.mode} | interval: ${w.interval}s | last: ${w.lastValue?.slice(0, 30) ?? "pending"} | checked: ${w.lastCheck ?? "never"}`
        );
        return text(`${watches.length} active watch(es):\n\n${lines.join("\n")}`);
      }

      default:
        return text(`Unknown tool: ${name}`, true);
    }
  });

  // Start MCP transport IMMEDIATELY so Claude Code discovers tools/prompts/resources
  // without waiting for WS connections. Tool handlers gracefully return errors when
  // not connected. WS connects in background; push wiring happens once ready.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Connect to broker WS in background — don't block MCP startup.
  startClients(config).then(() => {
    wirePushHandlers().catch(() => {});
  }).catch(() => {
    // Connect failed — clients are in reconnecting state, push wiring still needed
    wirePushHandlers().catch(() => {});
  });

  async function wirePushHandlers() {
    // Wire WSS pushes → MCP channel notifications. Each inbound push on
    // any mesh's broker connection becomes a <channel source="claudemesh">
    // system reminder injected into Claude Code's context.
    for (const client of allClients()) {
    // Event-driven push: WS onPush fires immediately when a message arrives.
    // Claude Code's setNotificationHandler → enqueue → React useEffect pipeline
    // processes notifications instantly (no polling needed on Claude's side).
    // The old poll-based approach was an overcorrection — Claude Code source
    // confirms event-driven notification processing.
    client.onPush(async (msg) => {
      if (messageMode === "off") return;

      // System events (peer join/leave) — always push, regardless of mode.
      if (msg.subtype === "system" && msg.event) {
        const eventName = msg.event;
        const data = msg.eventData ?? {};
        let content: string;
        if (eventName === "tick") {
          const tick = data.tick ?? 0;
          const simTime = String(data.simTime ?? "").replace("T", " ").replace(/\..*/,"");
          const speed = data.speed ?? 1;
          content = `[heartbeat] tick ${tick} | sim time: ${simTime} | speed: x${speed}`;
        } else if (eventName === "peer_joined") {
          content = `[system] Peer "${data.name ?? "unknown"}" joined the mesh`;
        } else if (eventName === "peer_returned") {
          const peerName = String(data.name ?? "unknown");
          const lastSeenAt = data.lastSeenAt ? relativeTime(String(data.lastSeenAt)) : "unknown";
          const groups = Array.isArray(data.groups)
            ? (data.groups as Array<{ name: string; role?: string }>).map((g) => g.role ? `@${g.name}:${g.role}` : `@${g.name}`).join(", ")
            : "";
          const summary = data.summary ? ` Summary: "${data.summary}"` : "";
          content = `[system] Welcome back, "${peerName}"! Last seen ${lastSeenAt}.${groups ? ` Restored: ${groups}` : ""}${summary}`;
        } else if (eventName === "peer_left") {
          content = `[system] Peer "${data.name ?? "unknown"}" left the mesh`;
        } else if (eventName === "mcp_registered") {
          const tools = Array.isArray(data.tools) ? (data.tools as string[]).join(", ") : "";
          content = `[system] New MCP server available: "${data.serverName}" (hosted by ${data.hostedBy}). Tools: ${tools}. Use mesh_tool_call to invoke.`;
        } else if (eventName === "mcp_unregistered") {
          content = `[system] MCP server "${data.serverName}" removed (was hosted by ${data.hostedBy})`;
        } else if (eventName === "mcp_restored") {
          content = `[system] MCP server "${data.serverName}" is back online (hosted by ${data.hostedBy})`;
        } else if (eventName === "watch_triggered") {
          content = `[WATCH] ${data.label ?? data.url}: ${data.oldValue} → ${data.newValue}`;
        } else if (eventName === "mcp_deployed") {
          content = `[SERVICE] "${data.name}" deployed (${data.tool_count} tools) by ${data.deployed_by}`;
        } else if (eventName === "mcp_undeployed") {
          content = `[SERVICE] "${data.name}" undeployed by ${data.by}`;
        } else if (eventName === "mcp_scope_changed") {
          content = `[SERVICE] "${data.name}" scope changed to ${JSON.stringify(data.scope)} by ${data.by}`;
        } else {
          content = `[system] ${eventName}: ${JSON.stringify(data)}`;
        }
        try {
          await server.notification({
            method: "notifications/claude/channel",
            params: {
              content,
              meta: {
                kind: "system",
                event: eventName,
                mesh_slug: client.meshSlug,
                mesh_id: client.meshId,
                ...(Object.keys(data).length > 0 ? { eventData: data } : {}),
              },
            },
          });
          process.stderr.write(`[claudemesh] system: ${content}\n`);
        } catch (pushErr) {
          process.stderr.write(`[claudemesh] system push FAILED: ${pushErr}\n`);
        }
        return;
      }

      const fromPubkey = msg.senderPubkey || "";
      const fromName = fromPubkey
        ? await resolvePeerName(client, fromPubkey)
        : "unknown";

      if (messageMode === "inbox") {
        try {
          await server.notification({
            method: "notifications/claude/channel",
            params: {
              content: `[inbox] New message from ${fromName}. Use check_messages to read.`,
              meta: { kind: "inbox_notification", from_name: fromName },
            },
          });
        } catch { /* best effort */ }
        return;
      }

      // push mode — full content
      const content = msg.plaintext ?? decryptFailedWarning(fromPubkey);
      try {
        await server.notification({
          method: "notifications/claude/channel",
          params: {
            content,
            meta: {
              from_id: fromPubkey,
              from_name: fromName,
              mesh_slug: client.meshSlug,
              mesh_id: client.meshId,
              priority: msg.priority,
              sent_at: msg.createdAt,
              delivered_at: msg.receivedAt,
              kind: msg.kind,
              ...(msg.subtype ? { subtype: msg.subtype } : {}),
            },
          },
        });
        process.stderr.write(`[claudemesh] pushed: from=${fromName} content=${content.slice(0, 60)}\n`);
      } catch (pushErr) {
        process.stderr.write(`[claudemesh] push FAILED: ${pushErr}\n`);
      }
    });

    client.onStreamData(async (evt) => {
      try {
        await server.notification({
          method: "notifications/claude/channel",
          params: {
            content: `[stream:${evt.stream}] from ${evt.publishedBy}: ${JSON.stringify(evt.data)}`,
            meta: {
              kind: "stream_data",
              stream: evt.stream,
              published_by: evt.publishedBy,
            },
          },
        });
      } catch { /* best effort */ }
    });

    client.onStateChange(async (change) => {
      try {
        await server.notification({
          method: "notifications/claude/channel",
          params: {
            content: `[state] ${change.key} = ${JSON.stringify(change.value)} (set by ${change.updatedBy})`,
            meta: {
              kind: "state_change",
              key: change.key,
              updated_by: change.updatedBy,
            },
          },
        });
      } catch { /* best effort */ }
    });
    }

    // Welcome notification: give Claude immediate context on connect.
    // Delay slightly to ensure Claude Code has completed MCP initialization
    // handshake (notifications/initialized) before we push channel messages.
    setTimeout(async () => {
      const welcomeClient = allClients()[0];
      if (!welcomeClient || welcomeClient.status !== "open") return;
      try {
        const peers = await welcomeClient.listPeers();
        const peerNames = peers
          .filter(p => p.displayName !== myName)
          .map(p => p.displayName)
          .join(", ") || "none";
        await server.notification({
          method: "notifications/claude/channel",
          params: {
            content: `[system] Connected as ${myName} to mesh ${welcomeClient.meshSlug}. ${peers.length} peer(s) online: ${peerNames}. Call mesh_info for full details or set_summary to announce yourself.`,
            meta: { kind: "welcome", mesh_slug: welcomeClient.meshSlug },
          },
        });
      } catch { /* best effort */ }
    }, 2_000);
  } // end wirePushHandlers

  // Event loop keepalive: Node.js stdout to a pipe is buffered. Without
  // periodic event loop activity, stdout.write() from WS callbacks may not
  // flush until the next I/O event. This 1s interval keeps the event loop
  // ticking so channel notifications flush promptly — same pattern that made
  // claude-intercom's push delivery reliable (its 1s HTTP poll had this
  // effect as a side effect). The interval does nothing except prevent the
  // event loop from settling.
  const keepalive = setInterval(() => {
    // Intentionally empty — the interval itself keeps the event loop active.
    // Do NOT call .unref() — that would defeat the purpose.
  }, 1_000);
  void keepalive; // suppress unused warning

  const shutdown = (): void => {
    clearInterval(keepalive);
    stopAll();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

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
  const config = loadConfig();
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

  // Wait for hello_ack and service catalog
  await new Promise((r) => setTimeout(r, 1500));

  // Fetch tool schemas for this service
  let tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> = [];
  try {
    const fetched = await client.getServiceTools(serviceName);
    tools = fetched as typeof tools;
  } catch {
    // Try from catalog cache
    const cached = client.serviceCatalog.find((s) => s.name === serviceName);
    if (cached) {
      tools = cached.tools as typeof tools;
    }
  }

  if (tools.length === 0) {
    process.stderr.write(
      `[mesh:${serviceName}] no tools found — service may not be running\n`,
    );
  }

  // Build MCP server
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

    // Wait for broker reconnection if needed
    if (client.status !== "open") {
      let waited = 0;
      while (client.status !== "open" && waited < 10_000) {
        await new Promise((r) => setTimeout(r, 500));
        waited += 500;
      }
      if (client.status !== "open") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Service temporarily unavailable — broker reconnecting. Retry in a few seconds.`,
            },
          ],
          isError: true,
        };
      }
    }

    try {
      const result = await client.mcpCall(
        serviceName,
        toolName,
        args as Record<string, unknown>,
      );
      if (result.error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true,
        };
      }
      const resultText =
        typeof result.result === "string"
          ? result.result
          : JSON.stringify(result.result, null, 2);
      return {
        content: [{ type: "text" as const, text: resultText }],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Call failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Listen for service events (undeploy, update)
  client.onPush((push) => {
    if (
      push.event === "mcp_undeployed" &&
      (push.eventData as any)?.name === serviceName
    ) {
      process.stderr.write(
        `[mesh:${serviceName}] service undeployed — exiting\n`,
      );
      client.close();
      process.exit(0);
    }
    if (
      push.event === "mcp_updated" &&
      (push.eventData as any)?.name === serviceName
    ) {
      // Refresh tools
      const newTools = (push.eventData as any)?.tools;
      if (Array.isArray(newTools)) {
        tools = newTools;
        // Notify Claude Code that tools changed
        server
          .notification({
            method: "notifications/tools/list_changed",
          })
          .catch(() => {
            /* ignore notification errors */
          });
      }
    }
  });

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep event loop alive
  const keepalive = setInterval(() => {
    // Intentionally empty — prevents event loop from settling.
  }, 1_000);
  void keepalive;

  // Graceful shutdown
  const shutdown = (): void => {
    clearInterval(keepalive);
    client.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
