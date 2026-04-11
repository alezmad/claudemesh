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

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, hostname, homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig, getConfigPath } from "../state/config";
import type { Config, JoinedMesh, GroupEntry } from "../state/config";
import { startCallbackListener, openBrowser, generatePairingCode } from "../auth";
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
  resume?: string;
  continue?: boolean;
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

import {
  bold as tBold, dim as tDim, green as tGreen, orange as tOrange,
  boldOrange, HIDE_CURSOR, SHOW_CURSOR,
} from "../tui/colors";
import {
  enterFullScreen, exitFullScreen, writeCentered, termSize,
  drawTopBar, drawBottomBar, menuSelect, textInput, confirmPrompt,
} from "../tui/screen";
import { createSpinner, FRAME_HEIGHT } from "../tui/spinner";

interface LaunchWizardResult {
  mesh: JoinedMesh;
  role: string | null;
  groups: GroupEntry[];
  messageMode: "push" | "inbox" | "off";
  skipPermissions: boolean;
}

/**
 * Full-screen launch wizard — spinning logo + interactive config.
 * Mesh selection, role, groups, message mode, permissions — all in one TUI.
 * Falls back to plain text on non-TTY.
 */
async function runLaunchWizard(opts: {
  displayName: string;
  meshes: JoinedMesh[];
  selectedMesh: JoinedMesh | null;
  existingRole: string | null;
  existingGroups: GroupEntry[];
  existingMessageMode: "push" | "inbox" | "off" | null;
  skipPermConfirm: boolean;
}): Promise<LaunchWizardResult> {
  if (!process.stdout.isTTY) {
    return {
      mesh: opts.selectedMesh ?? opts.meshes[0]!,
      role: opts.existingRole,
      groups: opts.existingGroups,
      messageMode: opts.existingMessageMode ?? "push",
      skipPermissions: opts.skipPermConfirm,
    };
  }

  const { rows } = termSize();
  enterFullScreen();
  drawTopBar();

  // Spinning logo centered in upper portion
  const logoTop = Math.floor((rows - FRAME_HEIGHT - 16) / 2);
  const brandRow = logoTop + FRAME_HEIGHT + 1;
  const subtitleRow = brandRow + 1;
  const formRow = subtitleRow + 2;

  writeCentered(brandRow, boldOrange("claudemesh"));
  writeCentered(subtitleRow, tDim("peer mesh for Claude Code"));

  const spinner = createSpinner({
    render(lines) {
      for (let i = 0; i < lines.length; i++) {
        writeCentered(logoTop + i, lines[i]!);
      }
    },
    interval: 70,
  });
  spinner.start();

  // Show detected info
  let row = formRow;
  writeCentered(row, `Directory ${tGreen("✓")} ${process.cwd()}`);
  row++;
  writeCentered(row, `Name      ${tGreen("✓")} ${opts.displayName}`);
  row += 2;

  // Mesh selection
  let mesh: JoinedMesh;
  if (opts.selectedMesh) {
    mesh = opts.selectedMesh;
    writeCentered(row, `Mesh      ${tGreen("✓")} ${mesh.slug}`);
    row++;
  } else if (opts.meshes.length === 1) {
    mesh = opts.meshes[0]!;
    writeCentered(row, `Mesh      ${tGreen("✓")} ${mesh.slug}`);
    row++;
  } else {
    spinner.stop();
    const choice = await menuSelect({
      title: "Select mesh",
      items: opts.meshes.map(m => m.slug),
      row,
    });
    mesh = opts.meshes[choice]!;
    // Redraw as confirmed
    for (let i = 0; i < opts.meshes.length + 1; i++) {
      writeCentered(row + i, " ");
    }
    writeCentered(row, `Mesh      ${tGreen("✓")} ${mesh.slug}`);
    spinner.start();
    row++;
  }

  row++;

  // Interactive fields
  let role = opts.existingRole;
  let groups = opts.existingGroups;
  let messageMode = opts.existingMessageMode ?? "push" as "push" | "inbox" | "off";

  // Role input
  if (role === null) {
    spinner.stop();
    const answer = await textInput({ label: "Role", row, placeholder: "optional — press Enter to skip" });
    if (answer) role = answer;
    spinner.start();
    row++;
  } else {
    writeCentered(row, `Role      ${tGreen("✓")} ${role}`);
    row++;
  }

  // Groups input
  if (groups.length === 0) {
    spinner.stop();
    const answer = await textInput({ label: "Groups", row, placeholder: "comma-separated, optional" });
    if (answer) groups = parseGroupsString(answer);
    spinner.start();
    row++;
  } else {
    const tags = groups.map(g => `@${g.name}${g.role ? `:${g.role}` : ""}`).join(", ");
    writeCentered(row, `Groups    ${tGreen("✓")} ${tags}`);
    row++;
  }

  // Message mode selection
  if (opts.existingMessageMode === null) {
    row++;
    spinner.stop();
    const choice = await menuSelect({
      title: "Message mode",
      items: [
        "Push (real-time, peers can interrupt)",
        "Inbox (held until you check)",
        "Off (tools only, no messages)",
      ],
      row,
    });
    messageMode = (["push", "inbox", "off"] as const)[choice];
    spinner.start();
    row += 5;
  } else {
    writeCentered(row, `Messages  ${tGreen("✓")} ${messageMode}`);
    row++;
  }

  // Permissions confirmation
  let skipPermissions = opts.skipPermConfirm;
  if (!skipPermissions) {
    row++;
    spinner.stop();
    writeCentered(row, tDim("Claude will run with --dangerously-skip-permissions,"));
    writeCentered(row + 1, tDim("bypassing ALL permission prompts — not just claudemesh."));
    row += 3;
    const confirmed = await confirmPrompt({
      message: boldOrange("Autonomous mode?"),
      row,
      defaultYes: true,
    });
    if (!confirmed) {
      exitFullScreen();
      console.log("  Run without autonomous mode:");
      console.log("    claude --dangerously-load-development-channels server:claudemesh\n");
      process.exit(0);
    }
    skipPermissions = true;
    spinner.start();
  }

  // Final animation
  row += 2;
  writeCentered(row, tDim("Launching Claude Code..."));

  await new Promise(r => setTimeout(r, 800));
  spinner.stop();
  exitFullScreen();

  return { mesh, role, groups, messageMode, skipPermissions };
}

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
    resume: flags.resume ?? null,
    continueSession: flags.continue ?? false,
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
  let justSynced = false;

  if (config.meshes.length === 0 && !args.joinLink) {
    const useColor = !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
    const bold = (s: string): string => (useColor ? `\x1b[1m${s}\x1b[22m` : s);
    const dim = (s: string): string => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
    const green = (s: string): string => (useColor ? `\x1b[32m${s}\x1b[39m` : s);

    const code = generatePairingCode();
    const listener = await startCallbackListener();
    const url = `https://claudemesh.com/cli-auth?port=${listener.port}&code=${code}&action=sync`;

    console.log(`\n  ${bold("Welcome to claudemesh!")} No meshes found.`);
    console.log(`  Opening browser to sign in...\n`);

    const opened = await openBrowser(url);
    if (!opened) {
      console.log(`  Couldn't open browser automatically.`);
    }
    console.log(`  ${dim(`Visit: ${url}`)}`);
    console.log(`  ${dim(`Or join with invite: claudemesh launch --join <url>`)}\n`);

    // Race: localhost callback vs manual paste vs timeout
    const manualPromise = new Promise<string>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("  Paste sync token (or wait for browser): ", (answer) => {
        rl.close();
        if (answer.trim()) resolve(answer.trim());
      });
    });

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 15 * 60_000);
    });

    const syncToken = await Promise.race([
      listener.token,
      manualPromise,
      timeoutPromise,
    ]);

    listener.close();

    if (!syncToken) {
      console.error("\n  Timed out waiting for sign-in.");
      process.exit(1);
    }

    // Generate keypair and sync with broker
    const { generateKeypair } = await import("../crypto/keypair");
    const keypair = await generateKeypair();
    const displayNameForSync = args.name ?? `${hostname()}-${process.pid}`;

    const { syncWithBroker } = await import("../auth/sync-with-broker");
    const result = await syncWithBroker(syncToken, keypair.publicKey, displayNameForSync);

    // Write all meshes to config
    const { saveConfig } = await import("../state/config");
    for (const m of result.meshes) {
      config.meshes.push({
        meshId: m.mesh_id,
        memberId: m.member_id,
        slug: m.slug,
        name: m.slug,
        pubkey: keypair.publicKey,
        secretKey: keypair.secretKey,
        brokerUrl: m.broker_url,
        joinedAt: new Date().toISOString(),
      });
    }
    config.accountId = result.account_id;
    saveConfig(config);
    justSynced = true;

    console.log(`\n  ${green("✓")} Synced ${result.meshes.length} mesh(es): ${result.meshes.map(m => m.slug).join(", ")}\n`);
  }

  if (config.meshes.length === 0) {
    console.error("No meshes joined. Run `claudemesh join <url>` or use --join <url>.");
    process.exit(1);
  }

  // Resolve mesh — by flag, auto (if 1), or defer to wizard (if >1)
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
  } else if (config.meshes.length === 1) {
    mesh = config.meshes[0]!;
  } else {
    // Multiple meshes — wizard will handle selection
    mesh = null as unknown as JoinedMesh; // set by wizard below
  }

  // 3. Session identity + role/groups via TUI wizard.
  const displayName = args.name ?? `${hostname()}-${process.pid}`;

  let role: string | null = args.role;
  let parsedGroups: GroupEntry[] = args.groups ? parseGroupsString(args.groups) : [];
  let messageMode: "push" | "inbox" | "off" = args.messageMode ?? "push";

  if (!args.quiet && !justSynced) {
    const wizardResult = await runLaunchWizard({
      displayName,
      meshes: config.meshes,
      selectedMesh: mesh ?? null,
      existingRole: args.role,
      existingGroups: parsedGroups,
      existingMessageMode: args.messageMode ?? null,
      skipPermConfirm: args.skipPermConfirm,
    });
    mesh = wizardResult.mesh;
    role = wizardResult.role;
    parsedGroups = wizardResult.groups;
    messageMode = wizardResult.messageMode;
    args.skipPermConfirm = wizardResult.skipPermissions;
  } else if (!mesh) {
    // Quiet mode + multiple meshes — fall back to old picker
    mesh = await pickMesh(config.meshes);
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

  // 5. Print summary banner (wizard already handled all interactive config).
  if (!args.quiet) {
    printBanner(displayName, mesh.slug, role, parsedGroups, messageMode);
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
  // Session identity: --resume reuses existing session, otherwise generate new.
  // When resuming, Claude Code reuses the session ID so the mesh peer identity persists.
  const isResume = args.resume !== null || args.continueSession;
  const claudeSessionId = isResume ? undefined : randomUUID();

  const claudeArgs = [
    "--dangerously-load-development-channels",
    "server:claudemesh",
    ...(claudeSessionId ? ["--session-id", claudeSessionId] : []),
    ...(args.resume ? ["--resume", args.resume] : []),
    ...(args.continueSession ? ["--continue"] : []),
    ...(args.skipPermConfirm ? ["--dangerously-skip-permissions"] : []),
    ...(args.systemPrompt ? ["--system-prompt", args.systemPrompt] : []),
    ...filtered,
  ];

  // Resolve the full path to `claude` — when launched from a non-interactive
  // shell (e.g. nvm node shebang), ~/.local/bin may not be in PATH.
  const isWindows = process.platform === "win32";
  let claudeBin = "claude";
  if (!isWindows) {
    const candidates = [
      join(homedir(), ".local", "bin", "claude"),
      "/usr/local/bin/claude",
      join(homedir(), ".claude", "bin", "claude"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) { claudeBin = c; break; }
    }
  }

  // 7. Define cleanup — runs on every exit path via process.on('exit').
  //    Synchronous-only (rmSync + writeFileSync) so it works inside the
  //    'exit' event, which does not allow async work.
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
    // Ephemeral config dir
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  };

  // Register cleanup on every exit path — including normal exit, uncaught
  // throws, and fatal signals. process.on('exit') fires synchronously, which
  // is what the rmSync + writeFileSync above need.
  process.on("exit", cleanup);

  // 8. Hard-reset the TTY before handing control to claude.
  //
  // Every interactive element in the pre-launch flow — the full-screen
  // wizard (tui/screen.ts), the permission confirmation, the callback-
  // listener paste prompt, the mesh picker — attaches listeners to
  // process.stdin, toggles raw mode, hides the cursor, and sometimes
  // enters the alt-screen. Those helpers do best-effort cleanup in their
  // own finally blocks, but any leak — an orphaned 'data' listener, a
  // still-raw TTY, a pending render paint — means the parent node process
  // keeps competing with claude's Ink TUI for the same keystrokes and
  // stdout frames. Symptoms: dropped keystrokes at the claude prompt, or
  // the wizard visibly repainting on top of claude after launch.
  //
  // Defensive reset here is cheap and guarantees a clean TTY regardless
  // of what the wizard helpers did or didn't restore.
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch { /* not a TTY under some parents */ }
  }
  process.stdin.removeAllListeners("data");
  process.stdin.removeAllListeners("keypress");
  process.stdin.removeAllListeners("readable");
  process.stdin.pause();
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?25h");   // show cursor
    process.stdout.write("\x1b[?1049l"); // exit alt-screen if any wizard step entered it
  }

  // 9. Block-and-wait on claude with spawnSync.
  //
  // Why spawnSync instead of spawn + child.on('exit'):
  //   - spawn keeps the parent node event loop running alongside claude.
  //     Any stray listener, setImmediate, or async wizard tail-end can
  //     still fire during claude's lifetime, stealing input or painting
  //     over claude's TUI.
  //   - spawnSync blocks the parent event loop completely until claude
  //     exits. No listeners fire. Nothing paints. The parent is effectively
  //     suspended, and claude has exclusive ownership of the TTY.
  //
  // Signal forwarding: claude inherits the TTY process group via
  // stdio: "inherit". When the user hits Ctrl-C, the terminal sends
  // SIGINT to the whole group. Claude handles it (Ink unmounts, exits
  // cleanly); spawnSync returns with result.signal='SIGINT'. We re-raise
  // the same signal on the parent so it dies the same way.
  const result = spawnSync(claudeBin, claudeArgs, {
    stdio: "inherit",
    shell: isWindows,
    env: {
      ...process.env,
      CLAUDEMESH_CONFIG_DIR: tmpDir,
      CLAUDEMESH_DISPLAY_NAME: displayName,
      ...(claudeSessionId ? { CLAUDEMESH_SESSION_ID: claudeSessionId } : {}),
      MCP_TIMEOUT: process.env.MCP_TIMEOUT ?? "30000",
      MAX_MCP_OUTPUT_TOKENS: process.env.MAX_MCP_OUTPUT_TOKENS ?? "50000",
      ...(role ? { CLAUDEMESH_ROLE: role } : {}),
    },
  });

  // 10. Handle the result. Cleanup runs automatically via process.on('exit').
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      console.error("✗ `claude` not found on PATH. Install Claude Code first.");
    } else {
      console.error(`✗ failed to launch claude: ${err.message}`);
    }
    process.exit(1);
  }

  if (result.signal) {
    // Re-raise the same signal so the parent dies the same way the child did.
    process.kill(process.pid, result.signal);
    return;
  }

  process.exit(result.status ?? 0);
}
