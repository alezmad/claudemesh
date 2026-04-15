import { startMcpServer } from "~/mcp/server.js";

export async function runMcp(): Promise<never> {
  await startMcpServer();
  await new Promise(() => {});
  process.exit(0);
}

export { runMcp as _stub };
