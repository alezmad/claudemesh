import { existsSync, readFileSync } from "node:fs";
import { PATHS } from "~/constants/paths.js";
import type { CheckResult } from "./types.js";

export function checkMcpRegistered(): CheckResult {
  try {
    if (!existsSync(PATHS.CLAUDE_JSON)) {
      return { name: "mcp-registered", ok: false, message: "~/.claude.json not found" };
    }
    const raw = readFileSync(PATHS.CLAUDE_JSON, "utf-8");
    const config = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    if (config.mcpServers && "claudemesh" in config.mcpServers) {
      return { name: "mcp-registered", ok: true, message: "MCP server registered" };
    }
    return { name: "mcp-registered", ok: false, message: "claudemesh not in mcpServers" };
  } catch {
    return { name: "mcp-registered", ok: false, message: "Could not read ~/.claude.json" };
  }
}
