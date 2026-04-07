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
import { runPeers } from "./commands/peers";
import { runSend } from "./commands/send";
import { runInbox } from "./commands/inbox";
import { runStateGet, runStateSet, runStateList } from "./commands/state";
import { runRemember, runRecall } from "./commands/memory";
import { runInfo } from "./commands/info";
import { runRemind } from "./commands/remind";
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
    peers: defineCommand({
      meta: { name: "peers", description: "List connected peers in the mesh" },
      args: {
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        json: { type: "boolean", description: "Output as JSON", default: false },
      },
      async run({ args }) { await runPeers(args); },
    }),
    send: defineCommand({
      meta: { name: "send", description: "Send a message to a peer, group, or broadcast" },
      args: {
        to: { type: "positional", description: "Recipient: display name, @group, pubkey, or *", required: true },
        message: { type: "positional", description: "Message text", required: true },
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        priority: { type: "string", description: "now | next (default) | low" },
      },
      async run({ args }) { await runSend(args, args.to, args.message); },
    }),
    inbox: defineCommand({
      meta: { name: "inbox", description: "Read pending peer messages" },
      args: {
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        json: { type: "boolean", description: "Output as JSON", default: false },
        wait: { type: "string", description: "Seconds to wait for broker delivery (default: 1)" },
      },
      async run({ args }) {
        await runInbox({ ...args, wait: args.wait ? parseInt(args.wait, 10) : undefined });
      },
    }),
    state: defineCommand({
      meta: { name: "state", description: "Read or write shared mesh state" },
      args: {
        action: { type: "positional", description: "get | set | list", required: true },
        key: { type: "positional", description: "State key (required for get/set)" },
        value: { type: "positional", description: "Value to set (required for set)" },
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        json: { type: "boolean", description: "Output as JSON", default: false },
      },
      async run({ args }) {
        if (args.action === "list") {
          await runStateList(args);
        } else if (args.action === "get") {
          if (!args.key) { console.error("Usage: claudemesh state get <key>"); process.exit(1); }
          await runStateGet(args, args.key);
        } else if (args.action === "set") {
          if (!args.key || !args.value) { console.error("Usage: claudemesh state set <key> <value>"); process.exit(1); }
          await runStateSet(args, args.key, args.value);
        } else {
          console.error(`Unknown action "${args.action}". Use: get, set, list`);
          process.exit(1);
        }
      },
    }),
    info: defineCommand({
      meta: { name: "info", description: "Show mesh overview: slug, broker, peer count, state keys" },
      args: {
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        json: { type: "boolean", description: "Output as JSON", default: false },
      },
      async run({ args }) { await runInfo(args); },
    }),
    remember: defineCommand({
      meta: { name: "remember", description: "Store a memory in the mesh (accessible to all peers)" },
      args: {
        content: { type: "positional", description: "Text to remember", required: true },
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        tags: { type: "string", description: "Comma-separated tags (e.g. task,context)" },
        json: { type: "boolean", description: "Output as JSON", default: false },
      },
      async run({ args }) { await runRemember(args, args.content); },
    }),
    recall: defineCommand({
      meta: { name: "recall", description: "Search mesh memory by keyword or phrase" },
      args: {
        query: { type: "positional", description: "Search query", required: true },
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        json: { type: "boolean", description: "Output as JSON", default: false },
      },
      async run({ args }) { await runRecall(args, args.query); },
    }),
    remind: defineCommand({
      meta: { name: "remind", description: "Schedule a reminder or delayed message via the broker" },
      args: {
        message: { type: "positional", description: "Message text, or: list | cancel <id>", required: false },
        extra: { type: "positional", description: "Additional positional args", required: false },
        in: { type: "string", description: 'Deliver after duration: "2h", "30m", "90s"' },
        at: { type: "string", description: 'Deliver at time: "15:00" or ISO timestamp' },
        to: { type: "string", description: "Recipient (default: self). Name, @group, pubkey, or *" },
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        json: { type: "boolean", description: "Output as JSON", default: false },
      },
      async run({ args, rawArgs }) {
        // Collect positional args from rawArgs (before any flags)
        const positionals = rawArgs.filter((a) => !a.startsWith("-"));
        await runRemind(args, positionals);
      },
    }),
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
