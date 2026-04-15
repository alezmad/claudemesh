// MCP tool family: vault
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "vault" as const;
export const TOOLS = ["vault_set", "vault_list", "vault_delete"] as const;
