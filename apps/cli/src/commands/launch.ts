/**
 * `claudemesh launch` — spawn `claude` with peer mesh identity.
 *
 * Flags are defined in index.ts (citty command) — that is the source of
 * truth. This file receives already-parsed flags and rawArgs.
 *
 * Flow:
 *   1. Receive parsed flags from citty + rawArgs for -- passthrough
 *   2. If --join: run join flow first
 *   3. Load config → pick mesh (auto if 1, interactive picker if >1)
 *   4. Write per-session config to tmpdir (isolates mesh selection)
 *   5. Spawn claude with CLAUDEMESH_CONFIG_DIR + CLAUDEMESH_DISPLAY_NAME
 *   6. On exit: cleanup tmpdir
 */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, hostname, homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig, getConfigPath } from "../state/config";
import type { Config, JoinedMesh, GroupEntry } from "../state/config";
import { BrokerClient } from "../ws/client";

// Flags as parsed by citty (index.ts is the source of truth for definitions).
export interface LaunchFlags {
  name?: string;
  role?: string;
  groups?: string;
  join?: string;
  mesh?: string;
  "message-mode"?: string;
  "system-prompt"?: string;
  yes?: boolean;
  quiet?: boolean;
}

// --- Interactive mesh picker ---

async function pickMesh(meshes: JoinedMesh[]): Promise<JoinedMesh> {
  if (meshes.length === 1) return meshes[0]!;

  console.log("\n  Select mesh:");
  meshes.forEach((m, i) => {
    console.log(`    ${i + 1}) ${m.slug}`);
  });
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("  Choice [1]: ", (answer) => {
      rl.close();
      const idx = parseInt(answer || "1", 10) - 1;
      if (idx >= 0 && idx < meshes.length) {
        resolve(meshes[idx]!);
      } else {
        console.error("  Invalid choice, using first mesh.");
        resolve(meshes[0]!);
      }
    });
  });
}

// --- Group string parser ---

/** Parse "frontend:lead,reviewers:member,all" → GroupEntry[] */
function parseGroupsString(raw: string): GroupEntry[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      const idx = token.indexOf(":");
      if (idx === -1) return { name: token };
      return { name: token.slice(0, idx), role: token.slice(idx + 1) };
    });
}

// --- Interactive role/groups prompts ---

function askLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// --- Permission confirmation ---

async function confirmPermissions(): Promise<void> {
  const useColor =
    !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const bold = (s: string): string => (useColor ? `\x1b[1m${s}\x1b[22m` : s);
  const dim = (s: string): string => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const yellow = (s: string): string => (useColor ? `\x1b[33m${s}\x1b[39m` : s);

  console.log(yellow(bold("  Autonomous mode")));
  console.log("");
  console.log("  Claude will run with --dangerously-skip-permissions, bypassing");
  console.log("  ALL permission prompts — not just claudemesh tools.");
  console.log("  Peers exchange text only — no file access, no tool calls.");
  console.log("");
  console.log(dim("  Without -y: only claudemesh tools are pre-approved (via allowedTools)."));
  console.log(dim("  Use -y for autonomous agents. Omit it for shared/multi-person meshes."));
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.question(`  ${bold("Continue?")} [Y/n] `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "" || a === "y" || a === "yes") {
        resolve();
      } else {
        console.log("\n  Aborted. Run without autonomous mode:");
        console.log("    claude --dangerously-load-development-channels server:claudemesh\n");
        process.exit(0);
      }
    });
  });
}

// --- Banner ---

function printBanner(name: string, meshSlug: string, role: string | null, groups: GroupEntry[], messageMode: "push" | "inbox" | "off"): void {
  const useColor =
    !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const dim = (s: string): string => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const bold = (s: string): string => (useColor ? `\x1b[1m${s}\x1b[22m` : s);

  const roleSuffix = role ? ` (${role})` : "";
  const groupTags = groups.length
    ? " [" + groups.map((g) => `@${g.name}${g.role ? `:${g.role}` : ""}`).join(", ") + "]"
    : "";

  const rule = "─".repeat(60);
  console.log(bold(`claudemesh launch`) + dim(` — as ${name}${roleSuffix} on ${meshSlug}${groupTags} [${messageMode}]`));
  console.log(rule);
  if (messageMode === "push") {
    console.log("Peer messages arrive as <channel> reminders in real-time.");
  } else if (messageMode === "inbox") {
    console.log("Peer messages held in inbox. Use check_messages to read.");
  } else {
    console.log("Messages off. Use check_messages to poll manually.");
  }
  console.log("Peers send text only — they cannot call tools or read files.");
  console.log(dim(`Config: ${getConfigPath()}`));
  console.log(rule);
  console.log("");
}

// --- Main ---

export async function runLaunch(flags: LaunchFlags, rawArgs: string[]): Promise<void> {
  // Extract args that follow "--" — passed straight through to claude.
  const dashIdx = rawArgs.indexOf("--");
  const claudePassthrough = dashIdx >= 0 ? rawArgs.slice(dashIdx + 1) : [];

  // Normalise flags into the internal shape used below.
  const args = {
    name: flags.name ?? null,
    role: flags.role ?? null,
    groups: flags.groups ?? null,
    joinLink: flags.join ?? null,
    meshSlug: flags.mesh ?? null,
    messageMode: (["push", "inbox", "off"].includes(flags["message-mode"] ?? "")
      ? flags["message-mode"] as "push" | "inbox" | "off"
      : null),
    systemPrompt: flags["system-prompt"] ?? null,
    quiet: flags.quiet ?? false,
    skipPermConfirm: flags.yes ?? false,
    claudeArgs: claudePassthrough,
  };

  // 1. If --join, run join flow first.
  if (args.joinLink) {
    console.log("Joining mesh...");
    const invite = await parseInviteLink(args.joinLink);
    const keypair = await generateKeypair();
    const displayName = args.name ?? `${hostname()}-${process.pid}`;
    const enroll = await enrollWithBroker({
      brokerWsUrl: invite.payload.broker_url,
      inviteToken: invite.token,
      invitePayload: invite.payload,
      peerPubkey: keypair.publicKey,
      displayName,
    });
    const config = loadConfig();
    config.meshes = config.meshes.filter(
      (m) => m.slug !== invite.payload.mesh_slug,
    );
    config.meshes.push({
      meshId: invite.payload.mesh_id,
      memberId: enroll.memberId,
      slug: invite.payload.mesh_slug,
      name: invite.payload.mesh_slug,
      pubkey: keypair.publicKey,
      secretKey: keypair.secretKey,
      brokerUrl: invite.payload.broker_url,
      joinedAt: new Date().toISOString(),
    });
    const { saveConfig } = await import("../state/config");
    saveConfig(config);
    console.log(
      `✓ Joined "${invite.payload.mesh_slug}"${enroll.alreadyMember ? " (already member)" : ""}`,
    );
  }

  // 2. Load config, pick mesh.
  const config = loadConfig();
  if (config.meshes.length === 0) {
    console.error(
      "No meshes joined. Run `claudemesh join <url>` or use --join <url>.",
    );
    process.exit(1);
  }

  let mesh: JoinedMesh;
  if (args.meshSlug) {
    const found = config.meshes.find((m) => m.slug === args.meshSlug);
    if (!found) {
      console.error(
        `Mesh "${args.meshSlug}" not found. Joined: ${config.meshes.map((m) => m.slug).join(", ")}`,
      );
      process.exit(1);
    }
    mesh = found;
  } else {
    mesh = await pickMesh(config.meshes);
  }

  // 3. Session identity + role/groups.
  //    The WS client auto-generates a per-session ephemeral keypair on
  //    connect (sent in hello as sessionPubkey). We set display name via env var.
  const displayName = args.name ?? `${hostname()}-${process.pid}`;

  // Interactive wizard for role & groups (when not provided via flags and not --quiet).
  let role: string | null = args.role;
  let parsedGroups: GroupEntry[] = args.groups ? parseGroupsString(args.groups) : [];

  let messageMode: "push" | "inbox" | "off" = args.messageMode ?? "push";

  if (!args.quiet) {
    if (role === null) {
      const answer = await askLine("  Role (optional): ");
      if (answer) role = answer;
    }
    if (parsedGroups.length === 0 && args.groups === null) {
      const answer = await askLine("  Groups (comma-separated, optional): ");
      if (answer) parsedGroups = parseGroupsString(answer);
    }
    if (args.messageMode === null) {
      console.log("\n  Message mode:");
      console.log("    1) Push (real-time, peers can interrupt your work)");
      console.log("    2) Inbox (held until you check, notification only)");
      console.log("    3) Off (tools only, no messages)");
      console.log("");
      const answer = await askLine("  Choice [1]: ");
      const choice = parseInt(answer || "1", 10);
      if (choice === 2) messageMode = "inbox";
      else if (choice === 3) messageMode = "off";
      else messageMode = "push";
    }
    if (role || parsedGroups.length) console.log("");
  }

  // Clean up orphaned tmpdirs from crashed sessions (older than 1 hour)
  const tmpBase = tmpdir();
  try {
    for (const entry of readdirSync(tmpBase)) {
      if (!entry.startsWith("claudemesh-")) continue;
      const full = join(tmpBase, entry);
      const age = Date.now() - statSync(full).mtimeMs;
      if (age > 3600_000) rmSync(full, { recursive: true, force: true });
    }
  } catch { /* best effort */ }

  // Clean up stale mesh MCP entries from crashed sessions
  try {
    const claudeConfigPath = join(homedir(), ".claude.json");
    if (existsSync(claudeConfigPath)) {
      const claudeConfig = JSON.parse(readFileSync(claudeConfigPath, "utf-8"));
      const mcpServers = claudeConfig.mcpServers ?? {};
      let cleaned = 0;
      for (const key of Object.keys(mcpServers)) {
        if (!key.startsWith("mesh:")) continue;
        const meta = mcpServers[key]?._meshSession;
        if (!meta?.pid) continue;
        // Check if the PID is still alive
        try {
          process.kill(meta.pid, 0); // signal 0 = check existence
        } catch {
          // PID is dead — remove stale entry
          delete mcpServers[key];
          cleaned++;
        }
      }
      if (cleaned > 0) {
        claudeConfig.mcpServers = mcpServers;
        writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2) + "\n", "utf-8");
      }
    }
  } catch { /* best effort */ }

  // --- Fetch deployed services for native MCP entries ---
  let serviceCatalog: Array<{
    name: string;
    description: string;
    status: string;
    tools: Array<{ name: string; description: string; inputSchema: object }>;
    deployed_by: string;
  }> = [];

  try {
    const tmpClient = new BrokerClient(mesh, { displayName });
    await tmpClient.connect();
    // Wait briefly for hello_ack with service catalog
    await new Promise(r => setTimeout(r, 2000));
    serviceCatalog = tmpClient.serviceCatalog;
    tmpClient.close();
  } catch {
    // Non-fatal — launch without native service entries
    if (!args.quiet) {
      console.log("  (Could not fetch service catalog — mesh services won't be natively available)");
    }
  }

  // 4. Write session config to tmpdir (isolates mesh selection).
  const tmpDir = mkdtempSync(join(tmpdir(), "claudemesh-"));
  const sessionConfig: Config = {
    version: 1,
    meshes: [mesh],
    displayName,
    ...(role ? { role } : {}),
    ...(parsedGroups.length > 0 ? { groups: parsedGroups } : {}),
    messageMode,
  };
  writeFileSync(
    join(tmpDir, "config.json"),
    JSON.stringify(sessionConfig, null, 2) + "\n",
    "utf-8",
  );

  // 5. Banner + permission confirmation.
  if (!args.quiet) {
    printBanner(displayName, mesh.slug, role, parsedGroups, messageMode);
    // Auto-permissions confirmation — needed for autonomous peer messaging.
    if (!args.skipPermConfirm) {
      await confirmPermissions();
    }
  }

  // --- Install native MCP entries for deployed mesh services ---
  const meshMcpEntries: Array<{ key: string; entry: unknown }> = [];

  if (serviceCatalog.length > 0) {
    const claudeConfigPath = join(homedir(), ".claude.json");

    // Read-modify-write: only touch mesh:* entries in mcpServers
    let claudeConfig: Record<string, unknown> = {};
    try {
      claudeConfig = JSON.parse(readFileSync(claudeConfigPath, "utf-8"));
    } catch {
      claudeConfig = {};
    }

    const mcpServers = (claudeConfig.mcpServers ?? {}) as Record<string, unknown>;

    // Session-scoped key: mesh:<service>:<sessionId>
    const sessionTag = `${process.pid}`;

    for (const svc of serviceCatalog) {
      if (svc.status !== "running") continue;
      const entryKey = `mesh:${svc.name}:${sessionTag}`;
      const entry = {
        command: "claudemesh",
        args: ["mcp", "--service", svc.name],
        env: {
          CLAUDEMESH_CONFIG_DIR: tmpDir,
        },
        _meshSession: {
          pid: process.pid,
          meshSlug: mesh.slug,
          serviceName: svc.name,
          createdAt: new Date().toISOString(),
        },
      };
      mcpServers[entryKey] = entry;
      meshMcpEntries.push({ key: entryKey, entry });
    }

    claudeConfig.mcpServers = mcpServers;
    writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2) + "\n", "utf-8");

    if (!args.quiet && meshMcpEntries.length > 0) {
      console.log(`  ${meshMcpEntries.length} mesh service(s) registered as native MCPs:`);
      for (const { key } of meshMcpEntries) {
        const svcName = key.split(":")[1];
        const svc = serviceCatalog.find(s => s.name === svcName);
        console.log(`    ${svcName} (${svc?.tools.length ?? 0} tools)`);
      }
      console.log("");
    }
  }

  // 6. Spawn claude with ephemeral config + dev channel + auto-permissions.
  //    Strip any user-supplied --dangerously flags to avoid duplicates.
  const filtered: string[] = [];
  for (let i = 0; i < args.claudeArgs.length; i++) {
    if (args.claudeArgs[i] === "--dangerously-load-development-channels"
        || args.claudeArgs[i] === "--dangerously-skip-permissions") {
      if (args.claudeArgs[i] === "--dangerously-load-development-channels") i++;
      continue;
    }
    filtered.push(args.claudeArgs[i]!);
  }
  // --dangerously-skip-permissions is only added when the user explicitly
  // passes -y / --yes. Without it, claudemesh tools still work because
  // `claudemesh install` pre-approves them via allowedTools in settings.json.
  // This keeps permissions tight for multi-person meshes.
  const claudeArgs = [
    "--dangerously-load-development-channels",
    "server:claudemesh",
    ...(args.skipPermConfirm ? ["--dangerously-skip-permissions"] : []),
    ...(args.systemPrompt ? ["--system-prompt", args.systemPrompt] : []),
    ...filtered,
  ];

  const isWindows = process.platform === "win32";
  const child = spawn("claude", claudeArgs, {
    stdio: "inherit",
    shell: isWindows,
    env: {
      ...process.env,
      CLAUDEMESH_CONFIG_DIR: tmpDir,
      CLAUDEMESH_DISPLAY_NAME: displayName,
      MCP_TIMEOUT: process.env.MCP_TIMEOUT ?? "30000",
      MAX_MCP_OUTPUT_TOKENS: process.env.MAX_MCP_OUTPUT_TOKENS ?? "50000",
      ...(role ? { CLAUDEMESH_ROLE: role } : {}),
    },
  });

  // 7. Cleanup on exit.
  const cleanup = (): void => {
    // Remove mesh MCP entries from ~/.claude.json
    if (meshMcpEntries.length > 0) {
      try {
        const claudeConfigPath = join(homedir(), ".claude.json");
        const claudeConfig = JSON.parse(readFileSync(claudeConfigPath, "utf-8"));
        const mcpServers = claudeConfig.mcpServers ?? {};
        for (const { key } of meshMcpEntries) {
          delete mcpServers[key];
        }
        claudeConfig.mcpServers = mcpServers;
        writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2) + "\n", "utf-8");
      } catch { /* best effort */ }
    }
    // Existing tmpdir cleanup
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };

  child.on("error", (err: NodeJS.ErrnoException) => {
    cleanup();
    if (err.code === "ENOENT") {
      console.error(
        "✗ `claude` not found on PATH. Install Claude Code first.",
      );
    } else {
      console.error(`✗ failed to launch claude: ${err.message}`);
    }
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    cleanup();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  // Cleanup on parent signals too.
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
}
