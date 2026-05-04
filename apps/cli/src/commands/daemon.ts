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
      return runDaemon({
        tcpEnabled: !opts.noTcp,
        publicHealthCheck: opts.publicHealth,
        mesh: opts.mesh,
        displayName: opts.displayName,
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
  up | start                   start the daemon in the foreground
  status                       show running pid + IPC health
  version                      ipc + schema version of the running daemon
  down | stop                  stop the running daemon (SIGTERM, then wait)
  accept-host                  pin the current host fingerprint
  outbox list                  list local outbox rows (newest first)
  outbox requeue <id>          re-enqueue an aborted / dead outbox row
  install-service --mesh <s>   write launchd (macOS) / systemd-user (Linux) unit
  uninstall-service            remove the platform service unit

OPTIONS
  --mesh <slug>                attach to / target this mesh
  --name <displayName>         override CLAUDEMESH_DISPLAY_NAME
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
  // first on PATH. --mesh is now optional: omit it to attach to every
  // joined mesh (the 1.26.0 multi-mesh default); pass it to lock the
  // unit to a single mesh for testing or single-mesh hosts.
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
  try {
    const r = installService({
      binaryPath: binary,
      ...(opts.mesh ? { meshSlug: opts.mesh } : {}),
      ...(opts.displayName ? { displayName: opts.displayName } : {}),
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
