import { existsSync, mkdirSync, readFileSync } from "node:fs";

import { DAEMON_PATHS } from "./paths.js";
import { acquireSingletonLock, releaseSingletonLock } from "./lock.js";
import { ensureLocalToken } from "./local-token.js";
import { startIpcServer } from "./ipc/server.js";
import { openSqlite, type SqliteDb } from "./db/sqlite.js";
import { migrateOutbox } from "./db/outbox.js";
import { migrateInbox } from "./db/inbox.js";
import { DaemonBrokerClient } from "./broker.js";
import { startDrainWorker, type DrainHandle } from "./drain.js";
import { handleBrokerPush } from "./inbound.js";
import { EventBus } from "./events.js";
import { checkFingerprint, type ClonePolicy } from "./identity.js";
import { readConfig } from "~/services/config/facade.js";

export interface RunDaemonOptions {
  /** Disable TCP loopback (UDS-only). Defaults true in container envs. */
  tcpEnabled?: boolean;
  publicHealthCheck?: boolean;
  /** Mesh slug to attach to. Required when the user has joined multiple meshes. */
  mesh?: string;
  /** Daemon's display name on the mesh. */
  displayName?: string;
  /** Behavior on host_fingerprint mismatch. Defaults 'refuse'. */
  clonePolicy?: ClonePolicy;
}

/** Detect a few common container environments to pick UDS-only by default. */
function detectContainer(): boolean {
  if (process.env.KUBERNETES_SERVICE_HOST) return true;
  if (process.env.CONTAINER === "1") return true;
  try {
    if (existsSync("/.dockerenv")) return true;
    const cg = readFileSync("/proc/1/cgroup", "utf8");
    if (/(docker|kubepods|containerd)/.test(cg)) return true;
  } catch { /* not linux or no /proc */ }
  return false;
}

export async function runDaemon(opts: RunDaemonOptions = {}): Promise<number> {
  mkdirSync(DAEMON_PATHS.DAEMON_DIR, { recursive: true, mode: 0o700 });

  const lock = acquireSingletonLock();
  if (lock.result === "already-running") {
    process.stderr.write(`daemon already running (pid ${lock.pid})\n`);
    return 1;
  }
  if (lock.result === "stale") {
    process.stderr.write(`recovered stale pid file; starting fresh\n`);
  }

  // Accidental-clone detection (spec §2.2). Default policy: refuse.
  const fpCheck = checkFingerprint();
  const policy: ClonePolicy = opts.clonePolicy ?? "refuse";
  if (fpCheck.result === "mismatch") {
    const msg = `host_fingerprint mismatch: this daemon dir was started on a different host.`;
    if (policy === "refuse") {
      process.stderr.write(`${msg}\n`);
      process.stderr.write(`  stored host_id: ${fpCheck.stored?.host_id}\n`);
      process.stderr.write(`  current host_id: ${fpCheck.current.host_id}\n`);
      process.stderr.write(`Run \`claudemesh daemon accept-host\` to write a fresh fingerprint, or\n`);
      process.stderr.write(`run \`claudemesh daemon remint\` to mint a new keypair (Sprint 7+).\n`);
      releaseSingletonLock();
      return 4;
    }
    if (policy === "warn") {
      process.stderr.write(`WARN: ${msg} (continuing per [clone] policy=warn)\n`);
    }
    // 'allow' is silent.
  }
  if (fpCheck.result === "first_run") {
    process.stdout.write(JSON.stringify({
      msg: "host_fingerprint_written", fingerprint_prefix: fpCheck.current.fingerprint.slice(0, 16), ts: new Date().toISOString(),
    }) + "\n");
  }

  const localToken = ensureLocalToken();
  const tcpEnabled = opts.tcpEnabled ?? !detectContainer();

  let outboxDb: SqliteDb;
  let inboxDb: SqliteDb;
  try {
    outboxDb = await openSqlite(DAEMON_PATHS.OUTBOX_DB);
    migrateOutbox(outboxDb);
    inboxDb = await openSqlite(DAEMON_PATHS.INBOX_DB);
    migrateInbox(inboxDb);
  } catch (err) {
    process.stderr.write(`db open failed: ${String(err)}\n`);
    releaseSingletonLock();
    return 1;
  }

  const bus = new EventBus();

  // Pick the mesh. If the user joined exactly one, use it; otherwise
  // require --mesh. Daemon CAN start with no mesh — the outbox will
  // accept rows but `dead` them after retries because the broker is
  // never reachable. Better to fail fast.
  const cfg = readConfig();
  let mesh = null as null | typeof cfg.meshes[number];
  if (opts.mesh) {
    mesh = cfg.meshes.find((m) => m.slug === opts.mesh) ?? null;
    if (!mesh) {
      process.stderr.write(`mesh not found: ${opts.mesh}\n`);
      process.stderr.write(`joined meshes: ${cfg.meshes.map((m) => m.slug).join(", ") || "(none)"}\n`);
      releaseSingletonLock();
      try { outboxDb.close(); } catch { /* ignore */ }
      return 2;
    }
  } else if (cfg.meshes.length === 1) {
    mesh = cfg.meshes[0]!;
  } else if (cfg.meshes.length === 0) {
    process.stderr.write(`no mesh joined; run \`claudemesh join <invite-url>\` first\n`);
    releaseSingletonLock();
    try { outboxDb.close(); } catch { /* ignore */ }
    return 2;
  } else {
    process.stderr.write(`multiple meshes joined; pass --mesh <slug>\n`);
    process.stderr.write(`available: ${cfg.meshes.map((m) => m.slug).join(", ")}\n`);
    releaseSingletonLock();
    try { outboxDb.close(); } catch { /* ignore */ }
    return 2;
  }

  // Connect to broker (non-fatal: connection failures get retried;
  // outbox keeps queuing during outages).
  const broker = new DaemonBrokerClient(mesh, {
    displayName: opts.displayName,
    onStatusChange: (s) => {
      process.stdout.write(JSON.stringify({
        msg: "broker_status", status: s, mesh: mesh!.slug, ts: new Date().toISOString(),
      }) + "\n");
      bus.publish("broker_status", { mesh: mesh!.slug, status: s });
    },
    onPush: (m) => {
      const sessionKeys = broker.getSessionKeys();
      void handleBrokerPush(m, {
        db: inboxDb,
        bus,
        meshSlug: mesh!.slug,
        recipientSecretKeyHex: mesh!.secretKey,
        sessionSecretKeyHex: sessionKeys?.sessionSecretKey,
      });
    },
  });
  broker.connect().catch((err) => process.stderr.write(`broker connect failed: ${String(err)}\n`));

  // Start the drain worker.
  let drain: DrainHandle | null = null;
  drain = startDrainWorker({ db: outboxDb, broker });

  const ipc = startIpcServer({
    localToken,
    tcpEnabled,
    publicHealthCheck: opts.publicHealthCheck,
    outboxDb,
    inboxDb,
    bus,
    broker,
    onPendingInserted: () => drain?.wake(),
    // Sprint 4: IPC accept-send needs these to resolve targets and
    // encrypt at accept time so the drain worker is just a forwarder.
    meshSecretKey: mesh.secretKey,
    meshSlug: mesh.slug,
  });

  try {
    await ipc.ready;
  } catch (err) {
    process.stderr.write(`ipc listen failed: ${String(err)}\n`);
    releaseSingletonLock();
    return 1;
  }

  process.stdout.write(JSON.stringify({
    msg: "daemon_started",
    pid: process.pid,
    sock: DAEMON_PATHS.SOCK_FILE,
    tcp: tcpEnabled ? `127.0.0.1:47823` : null,
    mesh: mesh.slug,
    ts: new Date().toISOString(),
  }) + "\n");

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(JSON.stringify({ msg: "daemon_shutdown", signal: sig, ts: new Date().toISOString() }) + "\n");
    if (drain) await drain.close();
    await broker.close();
    await ipc.close();
    try { outboxDb.close(); } catch { /* ignore */ }
    try { inboxDb.close(); }  catch { /* ignore */ }
    releaseSingletonLock();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Hold the event loop open until a signal arrives.
  return new Promise<number>(() => { /* never resolves; signals call process.exit */ });
}
