// MCP tool family: mesh-meta
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "mesh-meta" as const;
export const TOOLS = ["mesh_info", "mesh_stats", "mesh_clock", "ping_mesh"] as const;
