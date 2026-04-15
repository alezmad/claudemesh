// MCP tool family: mcp-registry-broker
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "mcp-registry-broker" as const;
export const TOOLS = ["mesh_mcp_deploy", "mesh_mcp_undeploy", "mesh_mcp_update", "mesh_mcp_logs", "mesh_mcp_scope", "mesh_mcp_schema", "mesh_mcp_catalog"] as const;
