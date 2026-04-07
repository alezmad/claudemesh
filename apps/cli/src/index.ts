/**
 * claudemesh-cli entry point.
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
import { runHook } from "./commands/hook";
import { runLaunch } from "./commands/launch";
import { runStatus } from "./commands/status";
import { runDoctor } from "./commands/doctor";
import { runWelcome } from "./commands/welcome";
import { VERSION } from "./version";

const HELP = `claudemesh v${VERSION} — peer mesh for Claude Code sessions

Usage:
  claudemesh <command> [args]

Commands:
  install         Register MCP server + status hooks with Claude Code
                  --no-hooks      Register MCP only, skip hooks
  uninstall       Remove MCP server and hooks
  launch [opts]   Launch Claude Code connected to a mesh
  join <url>      Join a mesh via invite URL
  list            Show joined meshes and identities
  leave <slug>    Leave a mesh
  status          Check broker reachability for each joined mesh
  doctor          Diagnose install, config, keypairs, and PATH
  mcp             Start MCP server (stdio — Claude Code only)
  --help, -h      Show this help
  --version, -v   Show version

launch options:
  --name <name>             Display name for this session
  --role <role>             Role tag (dev, lead, analyst — free-form)
  --groups <spec>           Groups to join: "g1:role,g2" (colon = role)
  --mesh <slug>             Select mesh by slug (interactive if omitted)
  --join <url>              Join a mesh before launching
  --message-mode <mode>     push (default) | inbox | off
                              push   — peer messages arrive in real time
                              inbox  — held until you call check_messages
                              off    — no messages; use tools only
  --system-prompt <text>    Set Claude's system prompt for this session
  -y, --yes                 Skip permission confirmation
  --quiet                   Skip banner and all interactive prompts
  -- <args>                 Pass remaining args directly to claude

  Full non-interactive launch:
    claudemesh launch \\
      --name Worker --mesh myteam --role analyst \\
      --groups "myteam/docs:member" \\
      --message-mode push \\
      --system-prompt "You are a documentation analyst..." \\
      -y --quiet

  Groups support hierarchy (slash-separated):
    --groups "eng/frontend:lead,eng/reviewers"
    @eng delivers to members of @eng, @eng/frontend, @eng/reviewers, etc.

Environment:
  CLAUDEMESH_BROKER_URL     Override broker URL (default: wss://ic.claudemesh.com/ws)
  CLAUDEMESH_CONFIG_DIR     Override config directory (default: ~/.claudemesh/)
  CLAUDEMESH_DISPLAY_NAME   Override display name (set automatically by launch)
  CLAUDEMESH_ROLE           Override role tag (set automatically by launch)
  CLAUDEMESH_DEBUG=1        Verbose logging
`;

const cmd = process.argv[2];
const args = process.argv.slice(3);

async function main(): Promise<void> {
  switch (cmd) {
    case "mcp":
      await startMcpServer();
      return;
    case "install":
      runInstall(args);
      return;
    case "uninstall":
      runUninstall();
      return;
    case "hook":
      await runHook(args);
      return;
    case "launch":
      await runLaunch(args);
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
    case "status":
      await runStatus();
      return;
    case "doctor":
      await runDoctor();
      return;
    case "seed-test-mesh":
      runSeedTestMesh(args);
      return;
    case "--version":
    case "-v":
    case "version":
      console.log(VERSION);
      return;
    case "--help":
    case "-h":
    case "help":
      console.log(HELP);
      return;
    case undefined:
      runWelcome();
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
