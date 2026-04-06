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
import type { BrokerClient, InboundPush } from "../ws/client";

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
  return `[${meshSlug}] from ${p.senderPubkey.slice(0, 12)}… (${p.priority}, ${p.createdAt}):\n${body}`;
}

export async function startMcpServer(): Promise<void> {
  const config = loadConfig();

  const myName = config.displayName ?? "unnamed";
  const myGroups = (config.groups ?? []).map(g => `@${g.name}${g.role ? ':' + g.role : ''}`).join(', ') || "none";

  const server = new Server(
    { name: "claudemesh", version: "0.3.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: `## Identity
You are "${myName}" — a peer in the claudemesh network. Your groups: ${myGroups}. You are one of several Claude Code sessions connected to the same mesh. No orchestrator exists — peers are equals. Your identity comes from your name and group roles, not from a central authority.

## Responding to messages
When you receive a <channel source="claudemesh" ...> message, RESPOND IMMEDIATELY. Pause your current task, reply via send_message, then resume. Read from_name, mesh_slug, and priority from the channel attributes. Reply by setting \`to\` to the sender's from_name (display name). Stay in character per your system prompt. Do not ignore low-priority messages — acknowledge them briefly even if you defer action.

## Tools
| Tool | Description |
|------|-------------|
| send_message(to, message, priority?) | Send to peer name, @group, or * broadcast. \`to\` accepts display name, pubkey hex, @groupname, or *. |
| list_peers(mesh_slug?) | List connected peers with status, summary, groups, and roles. |
| check_messages() | Drain buffered inbound messages (auto-pushed in most cases, use as fallback). |
| set_summary(summary) | Set 1-2 sentence description of your current work, visible to all peers. |
| set_status(status) | Override status: idle, working, or dnd. |
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

## Files
share_file for persistent references, send_message(file:) for ephemeral attachments.
Tags on shared files make them searchable. Use list_files to find what peers shared.

## Priority
- "now": interrupt immediately, even if recipient is in DND (use for urgent: broken deploy, blocking issue)
- "next" (default): deliver when recipient goes idle (normal coordination)
- "low": pull-only via check_messages (FYI, non-blocking context)

## Coordination
Call list_peers at session start to understand who is online, their roles, and what they are working on. If you are a group lead, gather input from members before responding to external requests — do not answer alone. If you are a member, contribute to your lead when asked. Use @group messages for team-wide questions, direct messages for 1:1 coordination. Set a meaningful summary so peers know your current focus.`,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
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
              return `- **${p.displayName}** [${p.status}]${groupsStr} (${p.pubkey.slice(0, 12)}…)${summary}`;
            });
            sections.push(`${header}\n${peerLines.join("\n")}`);
          }
        }
        return text(sections.join("\n\n"));
      }

      case "message_status": {
        const { id } = (args ?? {}) as { id?: string };
        if (!id) return text("message_status: `id` required", true);
        const client = allClients()[0];
        if (!client) return text("message_status: not connected", true);
        const result = await client.messageStatus(id);
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

      // --- Files ---
      case "share_file": {
        const { path: filePath, name: fileName, tags } = (args ?? {}) as { path?: string; name?: string; tags?: string[] };
        if (!filePath) return text("share_file: `path` required", true);
        const { existsSync } = await import("node:fs");
        if (!existsSync(filePath)) return text(`share_file: file not found: ${filePath}`, true);
        const client = allClients()[0];
        if (!client) return text("share_file: not connected", true);
        const fileId = await client.uploadFile(filePath, client.meshId, client.meshSlug, {
          name: fileName, tags, persistent: true,
        });
        if (!fileId) return text("share_file: upload failed", true);
        return text(`Shared: ${fileName ?? filePath} (${fileId})`);
      }

      case "get_file": {
        const { id, save_to } = (args ?? {}) as { id?: string; save_to?: string };
        if (!id || !save_to) return text("get_file: `id` and `save_to` required", true);
        const client = allClients()[0];
        if (!client) return text("get_file: not connected", true);
        const result = await client.getFile(id);
        if (!result) return text(`get_file: file ${id} not found`, true);
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

      default:
        return text(`Unknown tool: ${name}`, true);
    }
  });

  // Start broker clients for every joined mesh BEFORE MCP connects.
  await startClients(config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Wire WSS pushes → MCP channel notifications. Each inbound push on
  // any mesh's broker connection becomes a <channel source="claudemesh">
  // system reminder injected into Claude Code's context.
  for (const client of allClients()) {
    client.onPush(async (msg) => {
      const fromPubkey = msg.senderPubkey || "";
      // Resolve sender's display name from the cached peer list.
      const fromName = fromPubkey
        ? await resolvePeerName(client, fromPubkey)
        : "unknown";
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
            },
          },
        });
      } catch {
        /* channel push is best-effort; check_messages is the fallback */
      }
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

  const shutdown = (): void => {
    stopAll();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
