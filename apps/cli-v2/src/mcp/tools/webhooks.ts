// MCP tool family: webhooks
// Handlers in mcp/server.ts; this file defines the family for the spec's folder structure.
export const FAMILY = "webhooks" as const;
export const TOOLS = ["create_webhook", "list_webhooks", "delete_webhook"] as const;
