// MCP tool family: state
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "state" as const;
export const TOOLS = ["set_state", "get_state", "list_state"] as const;
