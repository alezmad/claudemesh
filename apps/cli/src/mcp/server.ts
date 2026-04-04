/**
 * MCP server (stdio transport) for @claudemesh/cli.
 *
 * Starts BrokerClient connections for every mesh in config on boot,
 * then routes the 5 MCP tools through them.
 *
 * list_peers is stubbed at the CLI level — the broker's WS protocol
 * does not yet carry a list-peers request type (Step 16). Until then,
 * it returns a note.
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
 *   - If `to` looks like a pubkey hex (64 chars), try every client;
 *     caller is expected to know which mesh the pubkey lives in.
 *   - If `to` starts with `#`, treat as channel on the first mesh.
 *   - Otherwise try to match a displayName (TODO — needs list_peers).
 *
 * For now the MVP: if only one mesh is joined, use that. Otherwise
 * require the caller to prefix with `<mesh-slug>:`.
 */
function resolveClient(to: string): {
  client: BrokerClient | null;
  targetSpec: string;
  error?: string;
} {
  const clients = allClients();
  if (clients.length === 0) {
    return { client: null, targetSpec: to, error: "no meshes joined" };
  }
  // Explicit mesh prefix: "mesh-slug:targetspec"
  const colonIdx = to.indexOf(":");
  if (colonIdx > 0 && colonIdx < to.length - 1) {
    const slug = to.slice(0, colonIdx);
    const rest = to.slice(colonIdx + 1);
    const match = findClient(slug);
    if (match) return { client: match, targetSpec: rest };
  }
  // Single-mesh fast path.
  if (clients.length === 1) {
    return { client: clients[0]!, targetSpec: to };
  }
  return {
    client: null,
    targetSpec: to,
    error: `multiple meshes joined; prefix target with "<mesh-slug>:" (joined: ${clients.map((c) => c.meshSlug).join(", ")})`,
  };
}

function formatPush(p: InboundPush, meshSlug: string): string {
  const body = (() => {
    try {
      return Buffer.from(p.ciphertext, "base64").toString("utf-8");
    } catch {
      return "(invalid base64 ciphertext)";
    }
  })();
  return `[${meshSlug}] from ${p.senderPubkey.slice(0, 12)}… (${p.priority}, ${p.createdAt}):\n${body}`;
}

export async function startMcpServer(): Promise<void> {
  const config = loadConfig();

  const server = new Server(
    { name: "claudemesh", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: `You are connected to claudemesh — a peer mesh for Claude Code sessions.

Use these tools to coordinate with peers on demand. Respond promptly when you receive messages (they're like someone tapping your shoulder).

Tools: send_message, list_peers, check_messages, set_summary, set_status.

If you have multiple joined meshes, prefix the \`to\` argument of send_message with \`<mesh-slug>:\` to disambiguate. Otherwise claudemesh picks the single joined mesh.`,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    if (config.meshes.length === 0) {
      return text(
        "No meshes joined. Run `claudemesh join <invite-link>` first.",
        true,
      );
    }

    switch (name) {
      case "send_message": {
        const { to, message, priority } = (args ?? {}) as SendMessageArgs;
        if (!to || !message)
          return text("send_message: `to` and `message` required", true);
        const { client, targetSpec, error } = resolveClient(to);
        if (!client)
          return text(`send_message: ${error ?? "no client resolved"}`, true);
        const result = await client.send(
          targetSpec,
          message,
          (priority ?? "next") as Priority,
        );
        if (!result.ok)
          return text(
            `send_message failed (${client.meshSlug}): ${result.error}`,
            true,
          );
        return text(
          `Sent to ${targetSpec} via ${client.meshSlug} [${priority ?? "next"}] → ${result.messageId}`,
        );
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
        const lines = clients.map(
          (c) =>
            `- ${c!.meshSlug} (${c!.status}, mesh ${c!.meshId.slice(0, 8)}…)`,
        );
        return text(
          `Connected meshes:\n${lines.join("\n")}\n\n(list_peers WS protocol lands in Step 16; only mesh status is shown for now.)`,
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
        return text(
          `set_summary: summary recorded locally ("${summary}"). (Broker WS protocol for summaries lands in Step 16.)`,
        );
      }

      case "set_status": {
        const { status } = (args ?? {}) as SetStatusArgs;
        if (!status) return text("set_status: `status` required", true);
        const s = status as PeerStatus;
        for (const c of allClients()) await c.setStatus(s);
        return text(`Status set to ${s} across ${allClients().length} mesh(es).`);
      }

      default:
        return text(`Unknown tool: ${name}`, true);
    }
  });

  // Start broker clients for every joined mesh BEFORE MCP connects.
  await startClients(config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = (): void => {
    stopAll();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
