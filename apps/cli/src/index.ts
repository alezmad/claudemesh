/**
 * @claudemesh/cli entry point.
 *
 * Dispatches between two modes:
 *   - `claudemesh mcp`           → MCP server (stdio transport)
 *   - `claudemesh <subcommand>`  → CLI subcommand
 *
 * Claude Code invokes the `mcp` mode via stdio. Humans use all others.
 */

import { startMcpServer } from "./mcp/server";
import { runInstall, runUninstall } from "./commands/install";
import { runJoin } from "./commands/join";
import { runList } from "./commands/list";
import { runLeave } from "./commands/leave";
import { runSeedTestMesh } from "./commands/seed-test-mesh";

const HELP = `claudemesh — peer mesh for Claude Code sessions

Usage:
  claudemesh <command> [args]

Commands:
  install         Register claudemesh as a Claude Code MCP server
  uninstall       Remove claudemesh MCP server registration
  join <link>     Join a mesh via invite link (ic://join/...)
  list            Show all joined meshes
  leave <slug>    Leave a joined mesh
  seed-test-mesh  Dev-only: inject a mesh into config (skips invite flow)
  mcp             Start MCP server (stdio) — invoked by Claude Code
  --help, -h      Show this help

Environment:
  CLAUDEMESH_BROKER_URL    Override broker URL (default: wss://ic.claudemesh.com/ws)
  CLAUDEMESH_CONFIG_DIR    Override config directory (default: ~/.claudemesh/)
  CLAUDEMESH_DEBUG=1       Verbose logging
`;

const cmd = process.argv[2];
const args = process.argv.slice(3);

async function main(): Promise<void> {
  switch (cmd) {
    case "mcp":
      await startMcpServer();
      return;
    case "install":
      runInstall();
      return;
    case "uninstall":
      runUninstall();
      return;
    case "join":
      await runJoin(args);
      return;
    case "list":
      runList();
      return;
    case "leave":
      runLeave(args);
      return;
    case "seed-test-mesh":
      runSeedTestMesh(args);
      return;
    case "--help":
    case "-h":
    case "help":
    case undefined:
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Run `claudemesh --help` for usage.");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`claudemesh: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
