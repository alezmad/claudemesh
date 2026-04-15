// MCP tool family: messaging
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "messaging" as const;
export const TOOLS = ["send_message", "list_peers", "check_messages", "message_status"] as const;
