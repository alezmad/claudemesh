/**
 * claudemesh-cli entry point.
 *
 * Uses citty to define commands and flags. --help is generated from
 * the command definitions — the flag list here IS the documentation.
 *
 * Dispatches between two modes:
 *   - `claudemesh mcp`           → MCP server (stdio transport)
 *   - `claudemesh <subcommand>`  → CLI subcommand
 */

import { defineCommand, runMain } from "citty";
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

const launch = defineCommand({
  meta: {
    name: "launch",
    description: "Launch Claude Code connected to a mesh with real-time peer messaging",
  },
  args: {
    name: {
      type: "string",
      description: "Display name for this session",
    },
    role: {
      type: "string",
      description: "Role tag (dev, lead, analyst — free-form)",
    },
    groups: {
      type: "string",
      description: 'Groups to join: "group:role,group2" — colon sets role. Hierarchy via slash: "eng/frontend:lead"',
    },
    mesh: {
      type: "string",
      description: "Select mesh by slug (interactive picker if omitted and >1 joined)",
    },
    join: {
      type: "string",
      description: "Join a mesh via invite URL before launching",
    },
    "message-mode": {
      type: "string",
      description: "push (default) | inbox | off — controls how peer messages are delivered",
    },
    "system-prompt": {
      type: "string",
      description: "Set Claude's system prompt for this session",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip permission confirmation",
      default: false,
    },
    quiet: {
      type: "boolean",
      description: "Skip banner and all interactive prompts",
      default: false,
    },
  },
  run({ args, rawArgs }) {
    // Forward to the existing launch runner, preserving -- passthrough to claude.
    return runLaunch(args, rawArgs);
  },
});

const install = defineCommand({
  meta: {
    name: "install",
    description: "Register MCP server + status hooks with Claude Code",
  },
  args: {
    "no-hooks": {
      type: "boolean",
      description: "Register MCP server only, skip hooks",
      default: false,
    },
  },
  run({ rawArgs }) {
    runInstall(rawArgs);
  },
});

const join = defineCommand({
  meta: {
    name: "join",
    description: "Join a mesh via invite URL",
  },
  args: {
    url: {
      type: "positional",
      description: "Invite URL (https://claudemesh.com/join/...)",
      required: true,
    },
  },
  run({ args }) {
    return runJoin([args.url]);
  },
});

const leave = defineCommand({
  meta: {
    name: "leave",
    description: "Leave a joined mesh",
  },
  args: {
    slug: {
      type: "positional",
      description: "Mesh slug to leave",
      required: true,
    },
  },
  run({ args }) {
    runLeave([args.slug]);
  },
});

const main = defineCommand({
  meta: {
    name: "claudemesh",
    version: VERSION,
    description: "Peer mesh for Claude Code sessions",
  },
  subCommands: {
    launch,
    install,
    uninstall: defineCommand({
      meta: { name: "uninstall", description: "Remove MCP server and hooks" },
      run() { runUninstall(); },
    }),
    join,
    list: defineCommand({
      meta: { name: "list", description: "Show joined meshes and identities" },
      run() { runList(); },
    }),
    leave,
    status: defineCommand({
      meta: { name: "status", description: "Check broker reachability for each joined mesh" },
      async run() { await runStatus(); },
    }),
    doctor: defineCommand({
      meta: { name: "doctor", description: "Diagnose install, config, keypairs, and PATH" },
      async run() { await runDoctor(); },
    }),
    mcp: defineCommand({
      meta: { name: "mcp", description: "Start MCP server (stdio — invoked by Claude Code, not users)" },
      async run() { await startMcpServer(); },
    }),
    "seed-test-mesh": defineCommand({
      meta: { name: "seed-test-mesh", description: "Dev only: inject a mesh into config (skips invite flow)" },
      run({ rawArgs }) { runSeedTestMesh(rawArgs); },
    }),
    hook: defineCommand({
      meta: { name: "hook", description: "Internal hook handler (invoked by Claude Code hooks)" },
      async run({ rawArgs }) { await runHook(rawArgs); },
    }),
  },
  run() {
    runWelcome();
  },
});

runMain(main);
