/**
 * MCP server (stdio transport) for @claudemesh/cli.
 *
 * Invoked by Claude Code as a stdio subprocess. Exposes the 5 tools
 * in tools.ts. In this 15a scaffold, all tools return a "not
 * connected" response; 15b will wire them to a live WS broker
 * connection.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./tools";
import { loadConfig } from "../state/config";

const NOT_CONNECTED = {
  content: [
    {
      type: "text" as const,
      text: "claudemesh: not yet connected to broker. Run `claudemesh join <invite-link>` to join a mesh, then restart your Claude Code session. (Broker client wiring lands in Step 15b — scaffold only for now.)",
    },
  ],
  isError: true,
};

const INSTRUCTIONS = `You are connected to a claudemesh — a peer-to-peer network of other Claude Code sessions.

Use these tools to coordinate with peers on demand. Each mesh is a trust boundary; messages are E2E-encrypted and routed through a shared broker.

Available tools:
- send_message: send a direct or channel message
- list_peers: see who else is in your meshes and their status
- check_messages: pull undelivered messages (normally pushed automatically)
- set_summary: describe what you're working on (visible to peers)
- set_status: manually override your presence (idle/working/dnd)

When you receive an inbound message (channel notification), respond promptly — like answering a knock on the door. The sender is waiting on you.`;

export async function startMcpServer(): Promise<void> {
  // Load config so we know which meshes the user has joined.
  const config = loadConfig();

  const server = new Server(
    { name: "claudemesh", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    // Stubs: all tools return "not connected" until 15b.
    if (config.meshes.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `claudemesh: no meshes joined yet. Run \`claudemesh join <invite-link>\` to join one.`,
          },
        ],
        isError: true,
      };
    }
    switch (name) {
      case "send_message":
      case "list_peers":
      case "check_messages":
      case "set_summary":
      case "set_status":
        return NOT_CONNECTED;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
