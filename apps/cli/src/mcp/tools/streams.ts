// MCP tool family: streams
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "streams" as const;
export const TOOLS = ["create_stream", "publish", "subscribe", "list_streams"] as const;
