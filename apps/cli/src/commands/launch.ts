/**
 * `claudemesh launch` — spawn `claude` with peer mesh identity.
 *
 * Flow:
 *   1. Parse --name, --join, --mesh, --quiet flags
 *   2. If --join: run join flow first (accepts token or URL)
 *   3. Load config → pick mesh (auto if 1, interactive picker if >1)
 *   4. Write per-session config to tmpdir (isolates mesh selection)
 *   5. Spawn claude with CLAUDEMESH_CONFIG_DIR + CLAUDEMESH_DISPLAY_NAME
 *   6. On exit: cleanup tmpdir
 */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig, getConfigPath } from "../state/config";
import type { Config, JoinedMesh, GroupEntry } from "../state/config";

// --- Arg parsing ---

interface LaunchArgs {
  name: string | null;
  role: string | null;
  groups: string | null; // comma-separated, e.g. "frontend:lead,reviewers:member"
  joinLink: string | null;
  meshSlug: string | null;
  messageMode: "push" | "inbox" | "off" | null;
  quiet: boolean;
  skipPermConfirm: boolean;
  claudeArgs: string[];
}

function parseArgs(argv: string[]): LaunchArgs {
  const result: LaunchArgs = {
    name: null,
    role: null,
    groups: null,
    joinLink: null,
    meshSlug: null,
    messageMode: null,
    quiet: false,
    skipPermConfirm: false,
    claudeArgs: [],
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--name" && i + 1 < argv.length) {
      result.name = argv[++i]!;
    } else if (arg.startsWith("--name=")) {
      result.name = arg.slice("--name=".length);
    } else if (arg === "--role" && i + 1 < argv.length) {
      result.role = argv[++i]!;
    } else if (arg.startsWith("--role=")) {
      result.role = arg.slice("--role=".length);
    } else if (arg === "--groups" && i + 1 < argv.length) {
      result.groups = argv[++i]!;
    } else if (arg.startsWith("--groups=")) {
      result.groups = arg.slice("--groups=".length);
    } else if (arg === "--join" && i + 1 < argv.length) {
      result.joinLink = argv[++i]!;
    } else if (arg.startsWith("--join=")) {
      result.joinLink = arg.slice("--join=".length);
    } else if (arg === "--mesh" && i + 1 < argv.length) {
      result.meshSlug = argv[++i]!;
    } else if (arg.startsWith("--mesh=")) {
      result.meshSlug = arg.slice("--mesh=".length);
    } else if (arg === "--inbox") {
      result.messageMode = "inbox";
    } else if (arg === "--no-messages") {
      result.messageMode = "off";
    } else if (arg === "--quiet") {
      result.quiet = true;
    } else if (arg === "-y" || arg === "--yes") {
      result.skipPermConfirm = true;
    } else if (arg === "--") {
      result.claudeArgs.push(...argv.slice(i + 1));
      break;
    } else {
      result.claudeArgs.push(arg);
    }
    i++;
  }
  return result;
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
  console.log("  Claude will send and receive peer messages without asking");
  console.log("  you first. Peers exchange text only — no file access,");
  console.log("  no tool calls, no code execution.");
  console.log("");
  console.log(dim("  Same as: claude --dangerously-skip-permissions"));
  console.log(dim("  Skip this prompt: claudemesh launch -y"));
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

export async function runLaunch(extraArgs: string[]): Promise<void> {
  const args = parseArgs(extraArgs);

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

  // 4. Write session config to tmpdir (isolates mesh selection).
  const tmpDir = mkdtempSync(join(tmpdir(), "claudemesh-"));
  const sessionConfig: Config = {
    version: 1,
    meshes: [mesh],
    displayName,
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
  const claudeArgs = [
    "--dangerously-load-development-channels",
    "server:claudemesh",
    "--dangerously-skip-permissions",
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
    },
  });

  // 7. Cleanup on exit.
  const cleanup = (): void => {
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
