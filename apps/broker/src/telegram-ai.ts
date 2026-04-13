/**
 * Claude-powered natural language processing for Telegram mesh interactions.
 *
 * Uses Claude Haiku 4.5 with tool calling to interpret user intent
 * and map to mesh operations. Destructive/social actions require
 * confirmation via Telegram inline buttons.
 */

import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { log } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AiToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface AiResult {
  type: "text" | "tool_call" | "error";
  text?: string;
  toolCall?: AiToolCall;
  requiresConfirmation?: boolean;
}

// ---------------------------------------------------------------------------
// Tools definition
// ---------------------------------------------------------------------------

const TOOLS: AiTool[] = [
  {
    name: "send_message",
    description: "Send a message to a peer in the mesh. Use when the user wants to tell, ask, or communicate something to a specific person or group.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Peer name, @group, or * for broadcast" },
        message: { type: "string", description: "The message content" },
        priority: { type: "string", enum: ["now", "next", "low"], description: "Delivery priority (default: next)" },
      },
      required: ["to", "message"],
    },
  },
  {
    name: "list_peers",
    description: "List all connected peers in the mesh. Use when user asks who's online, who's available, or what everyone is doing.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "remember",
    description: "Store a memory/note in the mesh's shared knowledge. Use when user wants to save information for later.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The content to remember" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
      },
      required: ["content"],
    },
  },
  {
    name: "recall",
    description: "Search the mesh's shared memory. Use when user asks about something that was previously stored.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_state",
    description: "Read a shared state value. Use when user asks about a specific key/variable.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "State key to read" },
      },
      required: ["key"],
    },
  },
  {
    name: "set_state",
    description: "Write a shared state value. Use when user wants to set/update a key.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "State key" },
        value: { type: "string", description: "Value to set" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "create_mesh",
    description: "Create a new mesh. Use when user wants to create a new workspace/mesh.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Mesh name" },
      },
      required: ["name"],
    },
  },
  {
    name: "share_mesh",
    description: "Generate an invite link or send an invite email. Use when user wants to invite someone to the mesh.",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email to invite (optional — if omitted, generates a link)" },
      },
    },
  },
];

// Actions that need user confirmation before executing
const CONFIRM_ACTIONS = new Set([
  "send_message",
  "create_mesh",
  "share_mesh",
  "set_state",
  "remember",
]);

const SYSTEM_PROMPT = `You are the claudemesh Telegram assistant. You help users interact with their claudemesh peer network using natural language.

You have access to tools for mesh operations. When the user's intent maps to a tool, use it. When it's a general question or conversation, respond directly.

Rules:
- Be concise — Telegram messages should be short
- When sending messages to peers, preserve the user's tone and intent
- For ambiguous peer names, ask for clarification
- Never fabricate peer names or data — use list_peers to find real names
- If unsure which mesh to target, ask the user`;

// ---------------------------------------------------------------------------
// AI Engine
// ---------------------------------------------------------------------------

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Process a natural language message through Claude and return the intent.
 */
export async function processMessage(
  userMessage: string,
  context: { meshSlug?: string; userName?: string; recentPeers?: string[] },
): Promise<AiResult> {
  try {
    const anthropic = getClient();

    const contextInfo = [
      context.meshSlug ? `Current mesh: ${context.meshSlug}` : null,
      context.userName ? `User's name: ${context.userName}` : null,
      context.recentPeers?.length ? `Known peers: ${context.recentPeers.join(", ")}` : null,
    ].filter(Boolean).join(". ");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: SYSTEM_PROMPT + (contextInfo ? `\n\nContext: ${contextInfo}` : ""),
      tools: TOOLS as Anthropic.Messages.Tool[],
      messages: [{ role: "user", content: userMessage }],
    });

    // Check for tool use
    for (const block of response.content) {
      if (block.type === "tool_use") {
        return {
          type: "tool_call",
          toolCall: { name: block.name, input: block.input as Record<string, unknown> },
          requiresConfirmation: CONFIRM_ACTIONS.has(block.name),
        };
      }
      if (block.type === "text") {
        return { type: "text", text: block.text };
      }
    }

    return { type: "text", text: "I'm not sure how to help with that." };
  } catch (err) {
    log.error("telegram-ai", { error: err instanceof Error ? err.message : String(err) });
    return { type: "error", text: "AI processing failed. Try a /command instead." };
  }
}

/**
 * Format a tool call as a human-readable confirmation message for Telegram.
 */
export function formatConfirmation(toolCall: AiToolCall): string {
  const { name, input } = toolCall;

  switch (name) {
    case "send_message":
      return `📤 *Send message to ${escMd(String(input.to))}:*\n\n"${escMd(String(input.message))}"\n\nPriority: ${input.priority ?? "next"}`;

    case "create_mesh":
      return `🔧 *Create mesh:*\n\nName: ${escMd(String(input.name))}`;

    case "share_mesh":
      return input.email
        ? `📧 *Send invite to:*\n\n${escMd(String(input.email))}`
        : `🔗 *Generate invite link*`;

    case "set_state":
      return `📝 *Set state:*\n\n\`${escMd(String(input.key))}\` = \`${escMd(String(input.value))}\``;

    case "remember":
      return `💾 *Remember:*\n\n"${escMd(String(input.content))}"${input.tags ? `\nTags: ${(input.tags as string[]).join(", ")}` : ""}`;

    default:
      return `⚙️ *${name}:*\n\n${JSON.stringify(input, null, 2)}`;
  }
}

/**
 * Format a tool result as a Telegram reply.
 */
export function formatResult(toolName: string, result: unknown): string {
  switch (toolName) {
    case "send_message":
      return "✅ Message sent.";

    case "list_peers": {
      const peers = result as Array<{ displayName: string; status: string; summary?: string }>;
      if (!peers || peers.length === 0) return "No peers online.";
      return "👥 *Online peers:*\n\n" + peers.map(p => {
        const icon = p.status === "idle" ? "🟢" : p.status === "working" ? "🟡" : p.status === "dnd" ? "🔴" : "⚪";
        return `${icon} *${escMd(p.displayName)}*${p.summary ? ` — ${escMd(p.summary)}` : ""}`;
      }).join("\n");
    }

    case "recall": {
      const memories = result as Array<{ content: string; tags: string[] }>;
      if (!memories || memories.length === 0) return "No memories found.";
      return "🧠 *Memories:*\n\n" + memories.map(m =>
        `• ${escMd(m.content)}${m.tags.length ? ` _[${m.tags.join(", ")}]_` : ""}`
      ).join("\n");
    }

    case "get_state": {
      const state = result as { key: string; value: unknown } | null;
      if (!state) return "Key not found.";
      return `📊 \`${escMd(state.key)}\` = \`${escMd(String(state.value))}\``;
    }

    case "remember":
      return "💾 Remembered.";

    case "set_state":
      return "📝 State updated.";

    case "create_mesh":
      return "✅ Mesh created.";

    case "share_mesh":
      return typeof result === "string" ? `🔗 Invite: ${result}` : "✅ Invite sent.";

    default:
      return `✅ Done: ${JSON.stringify(result)}`;
  }
}

function escMd(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

export { CONFIRM_ACTIONS };
