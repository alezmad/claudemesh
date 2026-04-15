// MCP tool family: tasks
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "tasks" as const;
export const TOOLS = ["create_task", "claim_task", "complete_task", "list_tasks"] as const;
