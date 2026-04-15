// MCP tool family: sql
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "sql" as const;
export const TOOLS = ["mesh_query", "mesh_execute", "mesh_schema"] as const;
