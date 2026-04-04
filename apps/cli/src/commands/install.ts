/**
 * `claudemesh install` — print Claude Code MCP registration instructions.
 *
 * In the v1 flow, users copy-paste a `claude mcp add ...` command.
 * Later we'll auto-write the MCP entry to ~/.claude.json and hooks
 * to ~/.claude/settings.json (mirroring claude-intercom's installer).
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export function runInstall(): void {
  // Resolve the path to this package's own index.ts so the generated
  // command points at the right binary even when installed globally.
  const here = fileURLToPath(import.meta.url);
  const entry = resolve(dirname(here), "..", "index.ts");

  console.log("claudemesh — MCP registration");
  console.log("------------------------------");
  console.log("");
  console.log("Register the MCP server with Claude Code:");
  console.log("");
  console.log(`  claude mcp add claudemesh --scope user -- bun ${entry} mcp`);
  console.log("");
  console.log("Or if installed globally:");
  console.log("");
  console.log(`  claude mcp add claudemesh --scope user -- claudemesh mcp`);
  console.log("");
  console.log(
    "After registering, restart Claude Code. Then join a mesh with:",
  );
  console.log("");
  console.log("  claudemesh join <invite-link>");
  console.log("");
  console.log("(Auto-install of hooks + MCP entry will ship in a later step.)");
}
