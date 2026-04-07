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
  const myRole = config.role ?? process.env.CLAUDEMESH_ROLE ?? null;
  const myGroups = (config.groups ?? []).map(g => `@${g.name}${g.role ? ':' + g.role : ''}`).join(', ') || "none";
  const messageMode = config.messageMode ?? "push";

  const server = new Server(
    { name: "claudemesh", version: "0.3.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: `## Identity
You are "${myName}"${myRole ? ` (${myRole})` : ""} — a peer in the claudemesh network. Your groups: ${myGroups}. You are one of several Claude Code sessions connected to the same mesh. No orchestrator exists — peers are equals. Your identity comes from your name and group roles, not from a central authority.

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
      case "schedule_reminder":
      case "send_later": {
        const sArgs = (args ?? {}) as {
          message?: string;
          to?: string;
          deliver_at?: number;
          in_seconds?: number;
        };
        if (!sArgs.message) return text(`${name}: \`message\` required`, true);
        const to = name === "schedule_reminder" ? "self" : (sArgs.to ?? "");
        if (name === "send_later" && !to) return text("send_later: `to` required", true);

        let deliverAt: number;
        if (sArgs.deliver_at) {
          deliverAt = Number(sArgs.deliver_at);
        } else if (sArgs.in_seconds) {
          deliverAt = Date.now() + Number(sArgs.in_seconds) * 1_000;
        } else {
          return text(`${name}: provide \`deliver_at\` (ms timestamp) or \`in_seconds\``, true);
        }

        // For send_later, resolve display name → pubkey if needed
        let targetSpec = to;
        if (name === "send_later" && !to.startsWith("@") && to !== "*" && !/^[0-9a-f]{64}$/i.test(to) && to !== "self") {
          const peers = await client.listPeers();
          const match = peers.find((p) => p.displayName.toLowerCase() === to.toLowerCase());
          if (!match) {
            const names = peers.map((p) => p.displayName).join(", ");
            return text(`send_later: peer "${to}" not found. Online: ${names || "(none)"}`, true);
          }
          targetSpec = match.pubkey;
        }
        if (name === "schedule_reminder") {
          // Self-reminder: use own session pubkey
          targetSpec = client.getSessionPubkey() ?? "*";
        }

        const result = await client.scheduleMessage(targetSpec, sArgs.message, deliverAt);
        if (!result) return text(`${name}: broker did not acknowledge — check connection`, true);
        const when = new Date(result.deliverAt).toISOString();
        return text(
          name === "schedule_reminder"
            ? `Reminder scheduled (${result.scheduledId.slice(0, 8)}): "${sArgs.message.slice(0, 60)}" at ${when}`
            : `Message to "${to}" scheduled (${result.scheduledId.slice(0, 8)}) for ${when}`,
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
    // Event-driven push: WS onPush fires immediately when a message arrives.
    // Claude Code's setNotificationHandler → enqueue → React useEffect pipeline
    // processes notifications instantly (no polling needed on Claude's side).
    // The old poll-based approach was an overcorrection — Claude Code source
    // confirms event-driven notification processing.
    client.onPush(async (msg) => {
      if (messageMode === "off") return;

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
  // Triggers Claude to call mesh_info/list_peers without user input.
  setTimeout(async () => {
    const client = allClients()[0];
    if (!client || client.status !== "open") return;
    try {
      const peers = await client.listPeers();
      const peerNames = peers
        .filter(p => p.displayName !== myName)
        .map(p => p.displayName)
        .join(", ") || "none";
      await server.notification({
        method: "notifications/claude/channel",
        params: {
          content: `[system] Connected as ${myName} to mesh ${client.meshSlug}. ${peers.length} peer(s) online: ${peerNames}. Call mesh_info for full details or set_summary to announce yourself.`,
          meta: { kind: "welcome", mesh_slug: client.meshSlug },
        },
      });
    } catch { /* best effort */ }
  }, 3_000); // 3s delay: let WS connect + hello_ack complete first

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
