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
// CallToolRequestSchema is still imported for the mesh-service proxy mode
// further down; the main MCP server has no tools as of 1.5.0 (tool-less
// push-pipe — spec 2026-05-02 commitment #6).
import { TOOLS } from "./tools/definitions.js";
import { readConfig } from "~/services/config/facade.js";
import { BrokerClient, startClients, stopAll, findClient, allClients } from "~/services/broker/facade.js";
import { startBridgeServer, type BridgeServer } from "~/services/bridge/server.js";
import type { InboundPush } from "~/services/broker/facade.js";
import type {
  Priority,
  PeerStatus,
  SendMessageArgs,
  SetStatusArgs,
  SetSummaryArgs,
  ListPeersArgs,
} from "./types.js";

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
  // Channel, @group, or broadcast — pass through directly.
  if (target.startsWith("#") || target.startsWith("@") || target === "*") {
    if (targetClients.length === 1) {
      return { client: targetClients[0]!, targetSpec: target };
    }
    return {
      client: null,
      targetSpec: target,
      error: `multiple meshes joined; prefix target with "<mesh-slug>:" (joined: ${clients.map((c) => c.meshSlug).join(", ")})`,
    };
  }

  // Hex pubkey or hex prefix — resolve by prefix match across joined meshes.
  // Accepts anything from 8 hex chars up to the full 64-char key. A full key
  // also has to match an online peer to be worth routing; we verify by prefix
  // against each mesh's current peer list.
  if (/^[0-9a-f]{8,64}$/.test(target)) {
    const hits: Array<{ mesh: BrokerClient; pubkey: string; displayName: string }> = [];
    for (const c of targetClients) {
      const peers = await c.listPeers();
      for (const p of peers) {
        if (p.pubkey.startsWith(target)) {
          hits.push({ mesh: c, pubkey: p.pubkey, displayName: p.displayName });
        }
      }
    }
    if (hits.length === 1) {
      return { client: hits[0]!.mesh, targetSpec: hits[0]!.pubkey };
    }
    if (hits.length > 1) {
      const lines = hits
        .map((h) => `  - ${h.displayName} @ ${h.mesh.meshSlug} · pubkey ${h.pubkey.slice(0, 20)}…`)
        .join("\n");
      return {
        client: null,
        targetSpec: target,
        error: `ambiguous pubkey prefix "${target}" matches ${hits.length} peers:\n${lines}\nUse a longer prefix.`,
      };
    }
    // Full 64-char with no live match: still allow send — broker will queue it
    // for when that peer comes online. Honors the existing queue-for-offline
    // behaviour without breaking prefix semantics.
    if (target.length === 64) {
      if (targetClients.length === 1) {
        return { client: targetClients[0]!, targetSpec: target };
      }
      return {
        client: null,
        targetSpec: target,
        error: `multiple meshes joined; prefix target with "<mesh-slug>:" (joined: ${clients.map((c) => c.meshSlug).join(", ")})`,
      };
    }
    // Short prefix, no match, and not interpretable as a name — surface it.
    return {
      client: null,
      targetSpec: target,
      error: `no online peer's pubkey starts with "${target}".`,
    };
  }

  // Name-based resolution. Exclude the caller's OWN session pubkey so
  // "send to <my-own-display-name>" routes to the OTHER same-named sessions
  // (e.g. the same user's laptop on a different repo) instead of bouncing
  // on the broker's self-send check.
  const nameLower = target.toLowerCase();
  const candidates: Array<{ mesh: string; peers: Array<{ displayName: string; pubkey: string; cwd?: string }> }> = [];
  const exactMatches: Array<{ mesh: BrokerClient; pubkey: string; displayName: string; cwd?: string }> = [];
  const partialMatches: Array<{ mesh: BrokerClient; pubkey: string; displayName: string; cwd?: string }> = [];

  for (const c of targetClients) {
    const ownSession = c.getSessionPubkey();
    const peers = await c.listPeers();
    candidates.push({ mesh: c.meshSlug, peers });
    for (const p of peers) {
      if (ownSession && p.pubkey === ownSession) continue; // skip caller's own session
      const nameLow = p.displayName.toLowerCase();
      if (nameLow === nameLower) {
        exactMatches.push({ mesh: c, pubkey: p.pubkey, displayName: p.displayName, cwd: p.cwd });
      } else if (nameLow.includes(nameLower)) {
        partialMatches.push({ mesh: c, pubkey: p.pubkey, displayName: p.displayName, cwd: p.cwd });
      }
    }
  }

  if (exactMatches.length === 1) {
    return { client: exactMatches[0]!.mesh, targetSpec: exactMatches[0]!.pubkey };
  }
  if (exactMatches.length > 1) {
    const lines = exactMatches
      .map((m) => `  - ${m.displayName} · pubkey ${m.pubkey.slice(0, 16)}…${m.cwd ? ` · cwd ${m.cwd}` : ""}`)
      .join("\n");
    return {
      client: null,
      targetSpec: target,
      error:
        `"${target}" is ambiguous — ${exactMatches.length} peers share that display name:\n${lines}\n` +
        `Disambiguate by pubkey prefix (e.g. send to "${exactMatches[0]!.pubkey.slice(0, 12)}…").`,
    };
  }

  if (partialMatches.length === 1) {
    process.stderr.write(
      `[claudemesh] resolved "${target}" → "${partialMatches[0]!.displayName}" (partial match)\n`,
    );
    return { client: partialMatches[0]!.mesh, targetSpec: partialMatches[0]!.pubkey };
  }
  if (partialMatches.length > 1) {
    const lines = partialMatches
      .map((m) => `  - ${m.displayName} · pubkey ${m.pubkey.slice(0, 16)}…`)
      .join("\n");
    return {
      client: null,
      targetSpec: target,
      error: `"${target}" partially matches ${partialMatches.length} peers:\n${lines}\nBe more specific, or use a pubkey prefix.`,
    };
  }

  // No match — refuse to send rather than silently queue a message for nobody.
  const known = candidates.flatMap((c) => c.peers.map((p) => `${c.mesh}/${p.displayName}`));
  return {
    client: null,
    targetSpec: target,
    error:
      `peer "${target}" not found. ` +
      (known.length
        ? `Known peers: ${known.slice(0, 10).join(", ")}${known.length > 10 ? ", …" : ""}`
        : "No connected peers on your mesh(es). Use pubkey hex, @group, or * for broadcast."),
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

  // --mesh <slug>: bind this MCP server to a single mesh from the user's
  // joined-meshes config. Used for the per-mesh push-pipe pattern in
  // ~/.claude.json — one MCP entry per mesh, each holds one WS, push
  // notifications fan out across all meshes simultaneously.
  // Default behavior (no flag): connect to every mesh in config.
  const meshIdx = process.argv.indexOf("--mesh");
  const onlyMesh = meshIdx !== -1 ? process.argv[meshIdx + 1] : null;

  const config = readConfig();

  if (onlyMesh) {
    const available = config.meshes.map((m) => m.slug);
    const filtered = config.meshes.filter((m) => m.slug === onlyMesh);
    if (filtered.length === 0) {
      process.stderr.write(
        `[claudemesh] --mesh "${onlyMesh}" not found in config. ` +
        `Joined meshes: ${available.join(", ") || "(none)"}\n`,
      );
      process.exit(1);
    }
    config.meshes = filtered;
  }

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
When you receive a <channel source="claudemesh" ...> message, RESPOND IMMEDIATELY. Pause your current task, reply via send_message (or \`claudemesh topic post --reply-to <message_id>\` for topic threads), then resume. Stay in character per your system prompt. Do not ignore low-priority messages — acknowledge them briefly even if you defer action.

The channel attributes carry everything you need to reply — no extra lookups:
- \`from_name\` — sender display name. Use as the \`to\` arg when replying to a DM.
- \`from_pubkey\` / \`from_member_id\` — stable ids. Use \`from_member_id\` if the sender's display name might change.
- \`mesh_slug\` — pass via \`--mesh\` if your default mesh differs.
- \`priority\` — \`now\` / \`next\` / \`low\`.
- \`message_id\` — id of THIS message. To thread a reply onto it in a topic, run \`claudemesh topic post <topic> "<text>" --reply-to <message_id>\`.
- \`topic\` — set when the message arrived through a topic (vs DM). Reply in the same topic.
- \`reply_to_id\` — set when the incoming message is itself a reply. Render thread context if you re-narrate.

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
| claudemesh file share <path> [--to peer] [--tags a,b] | Share a file with the mesh, or DM it to a specific peer. Same-host fast path: when --to matches a peer on this machine, sends an absolute filepath instead of uploading (no MinIO round-trip). |
| claudemesh file get <id> [--out path] | Download a shared file by id. |
| claudemesh file list [query] | Find files shared in the mesh. |
| claudemesh file status <id> | Check who has accessed a file. |
| claudemesh file delete <id> | Remove a shared file from the mesh. |
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


  // Start MCP transport IMMEDIATELY so Claude Code discovers tools/prompts/resources
  // without waiting for WS connections. Tool handlers gracefully return errors when
  // not connected. WS connects in background; push wiring happens once ready.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Bridge servers — one Unix socket per connected mesh so CLI invocations
  // can reuse this push-pipe's warm WS instead of opening their own
  // (~5ms warm vs ~300-700ms cold). See spec 2026-05-02 commitment #3.
  const bridges: BridgeServer[] = [];

  // Connect to broker WS in background — don't block MCP startup.
  startClients(config).then(() => {
    wirePushHandlers().catch(() => {});
    // Start one bridge socket per connected mesh. Done after WS connect so
    // the BrokerClient is in a usable state when CLI requests arrive.
    for (const client of allClients()) {
      const bridge = startBridgeServer(client);
      if (bridge) bridges.push(bridge);
    }
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
                ...(Object.keys(data).length > 0 ? { eventData: JSON.stringify(data) } : {}),
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

      // Per-peer capability check — drop silently if sender lacks `dm`.
      if (fromPubkey) {
        try {
          const { isAllowed } = await import("~/commands/grants.js");
          const kindCap = msg.kind === "broadcast" ? "broadcast" : "dm";
          if (!isAllowed(client.meshSlug, fromPubkey, kindCap)) {
            process.stderr.write(`[claudemesh] dropped ${kindCap} from ${fromName} (not granted)\n`);
            return;
          }
        } catch { /* fail-open on grant-read errors — don't break delivery */ }
      }

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

      // push mode — full content. Format the content so it reads as a
      // first-class chat message even though Claude Code renders it as a
      // <channel> reminder: sender attribution + priority badge + body.
      const body = msg.plaintext ?? decryptFailedWarning(fromPubkey);
      const prioBadge = msg.priority === "now" ? "[URGENT] " : msg.priority === "low" ? "[low] " : "";
      const kindBadge = msg.kind === "broadcast" ? " (broadcast)" : "";
      const content = `${prioBadge}${fromName}${kindBadge}: ${body}`;
      // `from_id` MUST be a stable replyable id. Older clients of this
      // channel have been pasting from_id straight back into
      // `claudemesh send <id>`; if from_id is the SESSION pubkey it
      // bounces with "no connected peer" the moment the sender's
      // session restarts. Send the MEMBER pubkey (stable across
      // reconnects) as from_id, and keep the ephemeral session pubkey
      // available under from_session_pubkey for crypto-aware callers.
      const fromMemberPubkey = msg.senderMemberPubkey ?? fromPubkey;
      try {
        await server.notification({
          method: "notifications/claude/channel",
          params: {
            content,
            meta: {
              from_id: fromMemberPubkey,
              from_pubkey: fromMemberPubkey,
              from_session_pubkey: fromPubkey,
              from_name: fromName,
              ...(msg.senderMemberId ? { from_member_id: msg.senderMemberId } : {}),
              mesh_slug: client.meshSlug,
              mesh_id: client.meshId,
              priority: msg.priority,
              sent_at: msg.createdAt,
              delivered_at: msg.receivedAt,
              kind: msg.kind,
              message_id: msg.messageId,
              ...(msg.topic ? { topic: msg.topic } : {}),
              ...(msg.replyToId ? { reply_to_id: msg.replyToId } : {}),
              ...(msg.subtype ? { subtype: msg.subtype } : {}),
            },
          },
        });
        process.stderr.write(`[claudemesh] pushed: from=${fromName} content=${body.slice(0, 60)}\n`);
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
    for (const b of bridges) {
      try { b.stop(); } catch {}
    }
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
    if ((client.status as string) !== "open") {
      let waited = 0;
      while ((client.status as string) !== "open" && waited < 10_000) {
        await new Promise((r) => setTimeout(r, 500));
        waited += 500;
      }
      if ((client.status as string) !== "open") {
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
        tools = newTools as typeof tools;
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
