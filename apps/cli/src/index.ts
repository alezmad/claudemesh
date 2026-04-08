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
import { runCreate } from "./commands/create";
import { VERSION } from "./version";

const launch = defineCommand({
  meta: {
    name: "launch",
    description: "Spawn a Claude Code session with mesh connectivity and MCP tools",
  },
  args: {
    name: {
      type: "string",
      description: "Display name visible to other peers",
    },
    role: {
      type: "string",
      description: "Free-form role tag: `dev`, `lead`, `analyst`, etc",
    },
    groups: {
      type: "string",
      description: 'Groups to join as `group:role,...` — e.g. `"eng/frontend:lead,qa:member"`',
    },
    mesh: {
      type: "string",
      description: "Mesh slug (interactive picker if omitted and >1 joined)",
    },
    join: {
      type: "string",
      description: "Join a mesh via invite URL before launching",
    },
    "message-mode": {
      type: "string",
      description: '`"push"` (default) | `"inbox"` | `"off"` — how peer messages arrive',
    },
    "system-prompt": {
      type: "string",
      description: "Custom system prompt for this Claude session",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip the --dangerously-skip-permissions confirmation",
      default: false,
    },
    resume: {
      type: "string",
      alias: "r",
      description: "Resume a previous Claude Code session by ID, or pass `true` for interactive picker",
    },
    continue: {
      type: "boolean",
      alias: "c",
      description: "Continue the most recent conversation in this directory",
      default: false,
    },
    quiet: {
      type: "boolean",
      description: "Suppress banner and interactive prompts",
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
    description: "Register MCP server and status hooks with Claude Code",
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
    description: "Join a mesh via invite URL or token",
  },
  args: {
    url: {
      type: "positional",
      description: "Invite URL (`https://claudemesh.com/join/...`) or token",
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
    description: "Leave a joined mesh and remove its local keypair",
  },
  args: {
    slug: {
      type: "positional",
      description: "Mesh slug to leave (see `claudemesh list`)",
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
    create: defineCommand({
      meta: { name: "create", description: "Create a new mesh from a template" },
      args: {
        template: { type: "string", description: "Template name: `dev-team`, `research`, `ops-incident`, `simulation`, `personal`" },
        "list-templates": { type: "boolean", description: "List available templates and exit", default: false },
      },
      run({ args }) { runCreate(args); },
    }),
    install,
    uninstall: defineCommand({
      meta: { name: "uninstall", description: "Remove MCP server and hooks from Claude Code config" },
      run() { runUninstall(); },
    }),
    join,
    list: defineCommand({
      meta: { name: "list", description: "Show joined meshes, slugs, and local identities" },
      run() { runList(); },
    }),
    leave,
    peers: defineCommand({
      meta: { name: "peers", description: "List online peers with status, summary, and groups" },
      args: {
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        json: { type: "boolean", description: "Output as JSON", default: false },
      },
      async run({ args }) { await runPeers(args); },
    }),
    send: defineCommand({
      meta: { name: "send", description: "Send a message to a peer, group, or all peers" },
      args: {
        to: { type: "positional", description: "Recipient: display name, `@group`, `*` (broadcast), or pubkey hex", required: true },
        message: { type: "positional", description: "Message text", required: true },
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        priority: { type: "string", description: '`"now"` | `"next"` (default) | `"low"`' },
      },
      async run({ args }) { await runSend(args, args.to, args.message); },
    }),
    inbox: defineCommand({
      meta: { name: "inbox", description: "Drain pending inbound messages" },
      args: {
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        json: { type: "boolean", description: "Output as JSON", default: false },
        wait: { type: "string", description: "Seconds to wait for broker delivery (default: `1`)" },
      },
      async run({ args }) {
        await runInbox({ ...args, wait: args.wait ? parseInt(args.wait, 10) : undefined });
      },
    }),
    state: defineCommand({
      meta: { name: "state", description: "Get, set, or list shared key-value state in the mesh" },
      args: {
        action: { type: "positional", description: "`get <key>` | `set <key> <value>` | `list`", required: true },
        key: { type: "positional", description: "State key (required for `get` and `set`)" },
        value: { type: "positional", description: "Value to store (required for `set`)" },
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
      meta: { name: "remember", description: "Store a persistent memory visible to all peers" },
      args: {
        content: { type: "positional", description: "Text to store", required: true },
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        tags: { type: "string", description: "Comma-separated tags, e.g. `task,context`" },
        json: { type: "boolean", description: "Output as JSON", default: false },
      },
      async run({ args }) { await runRemember(args, args.content); },
    }),
    recall: defineCommand({
      meta: { name: "recall", description: "Search mesh memories by keyword or phrase" },
      args: {
        query: { type: "positional", description: "Full-text search query", required: true },
        mesh: { type: "string", description: "Mesh slug (auto-selected if only one joined)" },
        json: { type: "boolean", description: "Output as JSON", default: false },
      },
      async run({ args }) { await runRecall(args, args.query); },
    }),
    remind: defineCommand({
      meta: { name: "remind", description: "Schedule a delayed message. Also: `remind list`, `remind cancel <id>`" },
      args: {
        message: { type: "positional", description: "Message text — or `list` / `cancel <id>` to manage reminders", required: false },
        extra: { type: "positional", description: "Reminder ID for `cancel`", required: false },
        in: { type: "string", description: 'Deliver after duration: `"2h"`, `"30m"`, `"90s"`' },
        at: { type: "string", description: 'Deliver at time: `"15:00"` or ISO timestamp' },
        cron: { type: "string", description: 'Recurring cron expression: `"0 */2 * * *"` (every 2h), `"30 9 * * 1-5"` (9:30 weekdays)' },
        to: { type: "string", description: "Recipient (default: self). Name, `@group`, `*`, or pubkey" },
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
      meta: { name: "status", description: "Check broker connectivity for each joined mesh" },
      async run() { await runStatus(); },
    }),
    doctor: defineCommand({
      meta: { name: "doctor", description: "Diagnose install, config, keypairs, and PATH issues" },
      async run() { await runDoctor(); },
    }),
    mcp: defineCommand({
      meta: { name: "mcp", description: "Start MCP server on stdio (called by Claude Code, not users)" },
      async run() { await startMcpServer(); },
    }),
    "seed-test-mesh": defineCommand({
      meta: { name: "seed-test-mesh", description: "Dev: inject a mesh into local config, skip invite flow" },
      run({ rawArgs }) { runSeedTestMesh(rawArgs); },
    }),
    hook: defineCommand({
      meta: { name: "hook", description: "Internal: handle Claude Code hook events" },
      async run({ rawArgs }) { await runHook(rawArgs); },
    }),
  },
  run() {
    runWelcome();
  },
});

runMain(main);
