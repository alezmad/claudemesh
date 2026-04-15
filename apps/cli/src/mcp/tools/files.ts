// MCP tool family: files
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "files" as const;
export const TOOLS = ["share_file", "get_file", "list_files", "file_status", "delete_file", "grant_file_access", "read_peer_file", "list_peer_files"] as const;
