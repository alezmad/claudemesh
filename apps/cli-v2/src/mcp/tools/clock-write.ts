// MCP tool family: clock-write
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "clock-write" as const;
export const TOOLS = ["mesh_set_clock", "mesh_pause_clock", "mesh_resume_clock"] as const;
