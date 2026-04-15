// MCP tool family: mcp-registry-peer
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "mcp-registry-peer" as const;
export const TOOLS = ["mesh_mcp_register", "mesh_mcp_list", "mesh_tool_call", "mesh_mcp_remove"] as const;
