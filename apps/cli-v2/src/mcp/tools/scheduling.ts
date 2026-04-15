// MCP tool family: scheduling
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "scheduling" as const;
export const TOOLS = ["schedule_reminder", "list_scheduled", "cancel_scheduled"] as const;
