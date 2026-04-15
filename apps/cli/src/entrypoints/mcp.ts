import { startMcpServer } from "~/mcp/server.js";

startMcpServer().catch((err) => {
  process.stderr.write(`MCP server error: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
