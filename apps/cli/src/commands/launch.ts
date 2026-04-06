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
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig, getConfigPath } from "../state/config";
import type { Config, JoinedMesh } from "../state/config";

// --- Arg parsing ---

interface LaunchArgs {
  name: string | null;
  joinLink: string | null;
  meshSlug: string | null;
  quiet: boolean;
  claudeArgs: string[];
}

function parseArgs(argv: string[]): LaunchArgs {
  const result: LaunchArgs = {
    name: null,
    joinLink: null,
    meshSlug: null,
    quiet: false,
    claudeArgs: [],
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--name" && i + 1 < argv.length) {
      result.name = argv[++i]!;
    } else if (arg.startsWith("--name=")) {
      result.name = arg.slice("--name=".length);
    } else if (arg === "--join" && i + 1 < argv.length) {
      result.joinLink = argv[++i]!;
    } else if (arg.startsWith("--join=")) {
      result.joinLink = arg.slice("--join=".length);
    } else if (arg === "--mesh" && i + 1 < argv.length) {
      result.meshSlug = argv[++i]!;
    } else if (arg.startsWith("--mesh=")) {
      result.meshSlug = arg.slice("--mesh=".length);
    } else if (arg === "--quiet") {
      result.quiet = true;
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

// --- Banner ---

function printBanner(name: string, meshSlug: string): void {
  const useColor =
    !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const dim = (s: string): string => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const bold = (s: string): string => (useColor ? `\x1b[1m${s}\x1b[22m` : s);

  const rule = "─".repeat(60);
  console.log(bold(`claudemesh launch`) + dim(` — as ${name} on ${meshSlug}`));
  console.log(rule);
  console.log("Peer messages arrive as <channel> reminders in real-time.");
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

  // 3. Session identity. The WS client auto-generates a per-session
  //    ephemeral keypair on connect (sent in hello as sessionPubkey).
  //    We just set the display name via env var.
  const displayName = args.name ?? `${hostname()}-${process.pid}`;

  // 4. Write session config to tmpdir (isolates mesh selection).
  const tmpDir = mkdtempSync(join(tmpdir(), "claudemesh-"));
  const sessionConfig: Config = {
    version: 1,
    meshes: [mesh],
  };
  writeFileSync(
    join(tmpDir, "config.json"),
    JSON.stringify(sessionConfig, null, 2) + "\n",
    "utf-8",
  );

  // 5. Banner.
  if (!args.quiet) printBanner(displayName, mesh.slug);

  // 6. Spawn claude with ephemeral config + dev channel + display name.
  //    Strip any user-supplied --dangerously-load-development-channels
  //    to avoid duplicates — we always inject our own.
  const filtered: string[] = [];
  for (let i = 0; i < args.claudeArgs.length; i++) {
    if (args.claudeArgs[i] === "--dangerously-load-development-channels") {
      i++; // skip the next arg (the channel value) too
      continue;
    }
    filtered.push(args.claudeArgs[i]!);
  }
  const claudeArgs = [
    "--dangerously-load-development-channels",
    "server:claudemesh",
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
