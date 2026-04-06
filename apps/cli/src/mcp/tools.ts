/**
 * MCP tool definitions exposed to Claude Code.
 *
 * Mirror the claude-intercom tool surface: send_message, list_peers,
 * check_messages, set_summary, set_status. Tools return "not
 * connected" errors until 15b wires the WS client.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  {
    name: "send_message",
    description:
      "Send a message to a peer in one of your joined meshes. `to` can be a peer display name (resolved via list_peers), hex pubkey, @group, `#channel`, or `*` for broadcast. `priority` controls delivery: `now` bypasses busy gates, `next` waits for idle (default), `low` is pull-only.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Peer name, pubkey, @group, or #channel",
        },
        message: { type: "string", description: "Message text" },
        priority: {
          type: "string",
          enum: ["now", "next", "low"],
          description: "Delivery priority (default: next)",
        },
      },
      required: ["to", "message"],
    },
  },
  {
    name: "list_peers",
    description:
      "List peers across all joined meshes. Shows name, mesh, status (idle/working/dnd), and current summary.",
    inputSchema: {
      type: "object",
      properties: {
        mesh_slug: {
          type: "string",
          description: "Only list peers in this mesh (optional)",
        },
      },
    },
  },
  {
    name: "check_messages",
    description:
      "Pull any undelivered messages from the broker. Normally messages arrive via push; use this to drain the queue after being offline.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_summary",
    description:
      "Set a 1–2 sentence summary of what you're working on. Visible to other peers.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "1-2 sentence summary" },
      },
      required: ["summary"],
    },
  },
  {
    name: "set_status",
    description:
      "Manually override your status. `dnd` blocks everything except `now`-priority messages.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["idle", "working", "dnd"],
          description: "Your status",
        },
      },
      required: ["status"],
    },
  },
  {
    name: "join_group",
    description:
      "Join a group with an optional role. Other peers see your group membership in list_peers.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Group name (without @)" },
        role: {
          type: "string",
          description: "Your role in the group (e.g. lead, member, observer)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "leave_group",
    description: "Leave a group.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Group name (without @)" },
      },
      required: ["name"],
    },
  },
];
