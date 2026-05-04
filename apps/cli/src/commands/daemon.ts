import { spawn } from "node:child_process";
import { existsSync, openSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { runDaemon } from "~/daemon/run.js";
import { ipc, IpcError } from "~/daemon/ipc/client.js";
import { readRunningPid } from "~/daemon/lock.js";
import { DAEMON_PATHS } from "~/daemon/paths.js";

export interface DaemonOptions {
  json?: boolean;
  noTcp?: boolean;
  publicHealth?: boolean;
  mesh?: string;
  displayName?: string;
  /** 1.34.12: keep the daemon attached to the current shell instead
   *  of double-forking. Default behavior changed in 1.34.12 — `up`
   *  now detaches by default and writes JSON logs to
   *  ~/.claudemesh/daemon/daemon.log. Pass `--foreground` to get the
   *  pre-1.34.12 behavior (logs streaming to stdout, blocks the
   *  terminal until Ctrl-C). install-service and `claudemesh launch`'s
   *  auto-spawn path always pass --foreground because their parents
   *  (launchd / the launch helper) own the lifecycle. */
  foreground?: boolean;
  /** outbox-list status filter, set from boolean flags --failed/--pending/etc. */
  outboxStatus?: "pending" | "inflight" | "done" | "dead" | "aborted";
  /** outbox requeue: optional id to mint a fresh client_message_id with. */
  newClientId?: string;
}

export async function runDaemonCommand(
  sub: string | undefined,
  opts: DaemonOptions,
  rest: string[] = [],
): Promise<number> {
  switch (sub) {
    case undefined:
      return printDaemonUsage();

    case "up":
    case "start":
      // 1.34.10: `--mesh` and `--name` deprecated.
      //   --mesh: daemon attaches to every joined mesh automatically;
      //     pinning at start time blocks new meshes from being picked up.
      //   --name: overrides the daemon-WS display name GLOBALLY across
      //     every mesh, but each mesh has its own per-mesh display name
      //     in config.json (set at `claudemesh join` time). Passing one
      //     name flattens that out. Sessions advertise their own
      //     CLAUDEMESH_DISPLAY_NAME at `claudemesh launch` time anyway,
      //     and the daemon-WS presence is hidden from peer lists since
      //     1.32, so the daemon's display name isn't user-visible.
      if (opts.mesh) {
        process.stderr.write(
          `[claudemesh] --mesh on \`daemon up\` is deprecated; the daemon attaches to every joined mesh automatically. ` +
          `Ignoring --mesh ${opts.mesh}.\n`,
        );
      }
      if (opts.displayName) {
        process.stderr.write(
          `[claudemesh] --name on \`daemon up\` is deprecated; per-mesh display names live in config.json (set at join time), ` +
          `and session display names come from \`claudemesh launch --name\`. Ignoring --name ${opts.displayName}.\n`,
        );
      }
      // 1.34.12: detach by default. The pre-1.34.12 behavior streamed
      // JSON logs to the controlling terminal and blocked the shell —
      // fine for debugging, surprising for users who just want the
      // daemon "up." `--foreground` opts back into the old behavior;
      // launchd / systemd-user units always pass it because the unit
      // manager owns lifecycle and stdio redirection.
      if (!opts.foreground) {
        return spawnDetachedDaemon(opts);
      }
      return runDaemon({
        tcpEnabled: !opts.noTcp,
        publicHealthCheck: opts.publicHealth,
      });

    case "help":
    case "--help":
    case "-h":
      return printDaemonUsage();

    case "status":
      return runStatus(opts);

    case "version":
      return runVersion(opts);

    case "down":
    case "stop":
      return runStop(opts);

    case "accept-host":
      return runAcceptHost(opts);

    case "outbox":
      return runOutbox(rest, opts);

    case "install-service":
      return runInstallService(opts);

    case "uninstall-service":
      return runUninstallService(opts);

    default:
      process.stderr.write(`unknown daemon subcommand: ${sub}\n\n`);
      printDaemonUsage(process.stderr);
      return 2;
  }
}

function printDaemonUsage(stream: NodeJS.WritableStream = process.stdout): number {
  stream.write(`claudemesh daemon — long-lived peer mesh runtime (v0.9.0)

USAGE
  claudemesh daemon <command> [options]

COMMANDS
  up | start                   start the daemon (detached by default)
  status                       show running pid + IPC health
  version                      ipc + schema version of the running daemon
  down | stop                  stop the running daemon (SIGTERM, then wait)
  accept-host                  pin the current host fingerprint
  outbox list                  list local outbox rows (newest first)
  outbox requeue <id>          re-enqueue an aborted / dead outbox row
  install-service              write launchd (macOS) / systemd-user (Linux) unit
  uninstall-service            remove the platform service unit

OPTIONS
  --foreground                 keep daemon attached to terminal, JSON logs to stdout (1.34.12+)
  --no-tcp                     disable the loopback TCP listener (UDS only)
  --public-health              expose /v1/health unauthenticated on TCP
  --json                       machine-readable output where supported

OUTBOX FLAGS (for 'daemon outbox list')
  --pending --inflight --done --failed --aborted   filter by status

OUTBOX FLAGS (for 'daemon outbox requeue')
  --new-client-id <id>         mint the new row with this client_message_id

See ${"https://claudemesh.com/docs"} for the full daemon spec.
`);
  return 0;
}

interface OutboxRowResp {
  id: string;
  client_message_id: string;
  status: string;
  attempts: number;
  enqueued_at: string;
  next_attempt_at: string;
  delivered_at: string | null;
  broker_message_id: string | null;
  last_error: string | null;
  aborted_at: string | null;
  aborted_by: string | null;
  superseded_by: string | null;
  payload_bytes: number;
}

async function runOutbox(rest: string[], opts: DaemonOptions): Promise<number> {
  const sub = rest[0];
  switch (sub) {
    case undefined:
    case "list": {
      const status = opts.outboxStatus;
      const path = `/v1/outbox${status ? `?status=${status}` : ""}`;
      try {
        const res = await ipc<{ items: OutboxRowResp[] }>({ path });
        if (opts.json) {
          process.stdout.write(JSON.stringify(res.body) + "\n");
          return 0;
        }
        if (!res.body.items?.length) {
          process.stdout.write("(empty)\n");
          return 0;
        }
        for (const r of res.body.items) {
          const tag = r.status.padEnd(8);
          const bm = r.broker_message_id ? ` → ${r.broker_message_id}` : "";
          const err = r.last_error ? ` last_error="${r.last_error.slice(0, 60)}"` : "";
          process.stdout.write(`${tag} ${r.id}  cid=${r.client_message_id}  attempts=${r.attempts}${bm}${err}\n`);
        }
        return 0;
      } catch (err) {
        process.stderr.write(`daemon unreachable: ${String(err)}\n`);
        return 1;
      }
    }

    case "requeue": {
      const id = rest[1];
      if (!id) { process.stderr.write("usage: claudemesh daemon outbox requeue <id> [--new-client-id <id>]\n"); return 2; }
      const newClientMessageId = opts.newClientId;
      try {
        const res = await ipc<{
          aborted_row_id: string; new_row_id: string; new_client_message_id: string; error?: string;
        }>({
          method: "POST",
          path: "/v1/outbox/requeue",
          body: { id, new_client_message_id: newClientMessageId },
        });
        if (res.status === 200) {
          if (opts.json) process.stdout.write(JSON.stringify(res.body) + "\n");
          else process.stdout.write(
            `requeued: aborted ${res.body.aborted_row_id} → new ${res.body.new_row_id} ` +
            `(client_message_id=${res.body.new_client_message_id})\n`,
          );
          return 0;
        }
        process.stderr.write(`requeue failed (${res.status}): ${res.body.error ?? "unknown"}\n`);
        return 1;
      } catch (err) {
        process.stderr.write(`daemon unreachable: ${String(err)}\n`);
        return 1;
      }
    }

    default:
      process.stderr.write(`unknown outbox subcommand: ${sub}\n`);
      process.stderr.write(`usage: claudemesh daemon outbox [list|requeue <id>]\n`);
      return 2;
  }
}

async function runInstallService(opts: DaemonOptions): Promise<number> {
  const { installService, detectPlatform } = await import("~/daemon/service-install.js");
  const platform = detectPlatform();
  if (!platform) {
    process.stderr.write(`unsupported platform: ${process.platform}\n`);
    return 2;
  }
  // Resolve the binary path. Prefer the running argv[0] when it's an
  // installed claudemesh binary; fall back to whichever `claudemesh` is
  // first on PATH.
  // 1.34.10: install-service no longer bakes --mesh into the unit. The
  // daemon attaches to every joined mesh by default, and pinning the
  // unit to one slug at install time was the source of the "joined a
  // new mesh but my service ignores it" footgun. If the user passes
  // --mesh anyway, we warn + ignore.
  let binary = process.argv[1] ?? "";
  if (!binary || /\.ts$/.test(binary) || /node_modules|src\/entrypoints/.test(binary)) {
    try {
      const { execSync } = await import("node:child_process");
      binary = execSync("which claudemesh", { encoding: "utf8" }).trim();
    } catch {
      process.stderr.write(`couldn't resolve a 'claudemesh' binary on PATH; install via npm/homebrew first\n`);
      return 1;
    }
  }
  if (opts.mesh) {
    process.stderr.write(
      `[claudemesh] --mesh on \`daemon install-service\` is deprecated and ignored; the daemon attaches to every joined mesh.\n`,
    );
  }
  if (opts.displayName) {
    process.stderr.write(
      `[claudemesh] --name on \`daemon install-service\` is deprecated and ignored; per-mesh names live in config.json, session names come from \`claudemesh launch --name\`.\n`,
    );
  }
  try {
    const r = installService({
      binaryPath: binary,
    });
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: true, ...r }) + "\n");
    } else {
      process.stdout.write(`installed ${r.platform} service unit: ${r.unitPath}\n`);
      process.stdout.write(`bring it up now: ${r.bootCommand}\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`install-service failed: ${String(err)}\n`);
    return 1;
  }
}

async function runUninstallService(opts: DaemonOptions): Promise<number> {
  const { uninstallService } = await import("~/daemon/service-install.js");
  const r = uninstallService();
  if (opts.json) process.stdout.write(JSON.stringify(r) + "\n");
  else if (r.removed.length === 0) process.stdout.write("no service unit installed\n");
  else process.stdout.write(`removed: ${r.removed.join(", ")}\n`);
  return 0;
}

async function runAcceptHost(opts: DaemonOptions): Promise<number> {
  const { acceptCurrentHost } = await import("~/daemon/identity.js");
  const fp = acceptCurrentHost();
  if (opts.json) process.stdout.write(JSON.stringify({ ok: true, fingerprint_prefix: fp.fingerprint.slice(0, 16) }) + "\n");
  else process.stdout.write(`host fingerprint accepted: ${fp.fingerprint.slice(0, 16)}…\n`);
  return 0;
}

async function runStatus(opts: DaemonOptions): Promise<number> {
  const pid = readRunningPid();
  if (!pid) {
    if (opts.json) process.stdout.write(JSON.stringify({ running: false }) + "\n");
    else process.stdout.write("daemon: not running\n");
    return 1;
  }
  try {
    const res = await ipc<{ ok: boolean; pid: number }>({ path: "/v1/health" });
    if (opts.json) {
      process.stdout.write(JSON.stringify({ running: true, pid, health: res.body }) + "\n");
    } else {
      process.stdout.write(`daemon: running (pid ${pid})\n`);
      process.stdout.write(`socket: ${DAEMON_PATHS.SOCK_FILE}\n`);
    }
    return 0;
  } catch (err) {
    if (opts.json) process.stdout.write(JSON.stringify({ running: true, pid, ipc_error: String(err) }) + "\n");
    else process.stdout.write(`daemon: pid ${pid} alive but IPC unreachable (${String(err)})\n`);
    return 1;
  }
}

async function runVersion(opts: DaemonOptions): Promise<number> {
  try {
    const res = await ipc<Record<string, unknown>>({ path: "/v1/version" });
    if (opts.json) process.stdout.write(JSON.stringify(res.body) + "\n");
    else {
      const v = res.body as { daemon_version?: string; ipc_api?: string; schema_version?: number };
      process.stdout.write(`daemon ${v.daemon_version ?? "unknown"} (ipc ${v.ipc_api ?? "?"}, schema ${v.schema_version ?? "?"})\n`);
    }
    return 0;
  } catch (err) {
    if (err instanceof IpcError) {
      process.stderr.write(`${err.message}\n`);
      return err.status === 401 ? 3 : 1;
    }
    process.stderr.write(`daemon unreachable: ${String(err)}\n`);
    return 1;
  }
}

async function runStop(opts: DaemonOptions): Promise<number> {
  const pid = readRunningPid();
  if (!pid) {
    if (opts.json) process.stdout.write(JSON.stringify({ stopped: false, reason: "not_running" }) + "\n");
    else process.stdout.write("daemon: not running\n");
    return 0;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    process.stderr.write(`failed to signal pid ${pid}: ${String(err)}\n`);
    return 1;
  }
  // Brief wait for the daemon to release its lock cleanly.
  for (let i = 0; i < 50; i++) {
    await new Promise<void>((r) => setTimeout(r, 100));
    if (!readRunningPid()) {
      if (opts.json) process.stdout.write(JSON.stringify({ stopped: true, pid }) + "\n");
      else process.stdout.write(`daemon: stopped (was pid ${pid})\n`);
      return 0;
    }
  }
  if (opts.json) process.stdout.write(JSON.stringify({ stopped: false, pid, reason: "shutdown_timeout" }) + "\n");
  else process.stdout.write(`daemon: signaled but did not exit within 5s (pid ${pid})\n`);
  return 1;
}

/**
 * 1.34.12: spawn the daemon as a detached background process. Re-execs
 * the same `claudemesh` binary with `daemon up --foreground` (so the
 * child runs the long-lived loop), redirects stdout/stderr to
 * ~/.claudemesh/daemon/daemon.log, and `unref()`s so the parent shell
 * can exit cleanly.
 *
 * The parent waits up to ~3s for the UDS socket to appear before
 * declaring success — that's the same liveness check `claudemesh launch`
 * uses, and it catches the "child crashed during boot" case (config
 * read failed, port bind failed, etc.) with an actionable error
 * pointing at the log file rather than silent loss.
 */
async function spawnDetachedDaemon(opts: DaemonOptions): Promise<number> {
  // Ensure the log directory exists before opening the FDs.
  mkdirSync(DAEMON_PATHS.DAEMON_DIR, { recursive: true, mode: 0o700 });
  const logPath = join(DAEMON_PATHS.DAEMON_DIR, "daemon.log");

  // The CLI binary path. process.argv[1] is the entrypoint script the
  // node runtime is currently executing — for an installed CLI that's
  // .../bin/claudemesh, for `bun run` dev that's the local dist file.
  // Either way it's the right thing to re-exec.
  const binary = process.argv[1] ?? "claudemesh";
  const args = ["daemon", "up", "--foreground"];
  if (opts.noTcp) args.push("--no-tcp");
  if (opts.publicHealth) args.push("--public-health");

  const out = openSync(logPath, "a");
  const err = openSync(logPath, "a");
  const child = spawn(process.execPath, [binary, ...args], {
    detached: true,
    stdio: ["ignore", out, err],
    env: process.env,
  });
  // Decouple the child from the parent's process group so closing the
  // shell doesn't SIGHUP the daemon.
  child.unref();

  // Wait for the socket to appear — the daemon's IPC listener binds
  // ~immediately after the broker WS handshake starts, so socket
  // existence is a reliable "the daemon is alive enough to accept
  // requests" signal.
  const sockPath = DAEMON_PATHS.SOCK_FILE;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3_000) {
    if (existsSync(sockPath)) {
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: true, detached: true, pid: child.pid, log: logPath }) + "\n");
      } else {
        process.stdout.write(`  ✔ daemon started (pid ${child.pid})\n`);
        process.stdout.write(`  → log:  ${logPath}\n`);
        process.stdout.write(`  → stop: claudemesh daemon down\n`);
      }
      return 0;
    }
    await new Promise<void>((r) => setTimeout(r, 100));
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: false, detached: true, pid: child.pid, reason: "socket_not_appeared", log: logPath }) + "\n");
  } else {
    process.stderr.write(`  ✘ daemon spawn timeout: socket did not appear within 3s\n`);
    process.stderr.write(`  → check log:  ${logPath}\n`);
    process.stderr.write(`  → run foreground for live output: claudemesh daemon up --foreground\n`);
  }
  return 1;
}
