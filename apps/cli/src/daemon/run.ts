import { existsSync, mkdirSync, readFileSync } from "node:fs";

import { DAEMON_PATHS } from "./paths.js";
import { acquireSingletonLock, releaseSingletonLock } from "./lock.js";
import { ensureLocalToken } from "./local-token.js";
import { startIpcServer } from "./ipc/server.js";
import { setRegistryHooks, startReaper, type SessionInfo } from "./session-registry.js";
import { openSqlite, type SqliteDb } from "./db/sqlite.js";
import { migrateOutbox } from "./db/outbox.js";
import { migrateInbox } from "./db/inbox.js";
import { DaemonBrokerClient } from "./broker.js";
import { SessionBrokerClient } from "./session-broker.js";
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

  // 1.26.0 — multi-mesh by default. With --mesh <slug>, the daemon
  // scopes to one mesh (legacy mode). Without it, attaches to every
  // joined mesh simultaneously so ambient mode (raw `claude`) works
  // for all meshes with one daemon process.
  const cfg = readConfig();
  let meshes: Array<typeof cfg.meshes[number]>;
  if (opts.mesh) {
    const found = cfg.meshes.find((m) => m.slug === opts.mesh);
    if (!found) {
      process.stderr.write(`mesh not found: ${opts.mesh}\n`);
      process.stderr.write(`joined meshes: ${cfg.meshes.map((m) => m.slug).join(", ") || "(none)"}\n`);
      releaseSingletonLock();
      try { outboxDb.close(); } catch { /* ignore */ }
      return 2;
    }
    meshes = [found];
  } else if (cfg.meshes.length === 0) {
    process.stderr.write(`no mesh joined; run \`claudemesh join <invite-url>\` first\n`);
    releaseSingletonLock();
    try { outboxDb.close(); } catch { /* ignore */ }
    return 2;
  } else {
    meshes = cfg.meshes;
  }

  // Spin up one broker per mesh. Connection failures are non-fatal:
  // the outbox keeps queuing per-mesh and reconnect logic in
  // DaemonBrokerClient handles reattach.
  const brokers = new Map<string, DaemonBrokerClient>();
  const meshConfigs = new Map<string, typeof cfg.meshes[number]>();
  for (const mesh of meshes) {
    meshConfigs.set(mesh.slug, mesh);
    const broker = new DaemonBrokerClient(mesh, {
      displayName: opts.displayName,
      onStatusChange: (s) => {
        process.stdout.write(JSON.stringify({
          msg: "broker_status", status: s, mesh: mesh.slug, ts: new Date().toISOString(),
        }) + "\n");
        bus.publish("broker_status", { mesh: mesh.slug, status: s });
      },
      onPush: (m) => {
        const sessionKeys = broker.getSessionKeys();
        void handleBrokerPush(m, {
          db: inboxDb,
          bus,
          meshSlug: mesh.slug,
          recipientSecretKeyHex: mesh.secretKey,
          sessionSecretKeyHex: sessionKeys?.sessionSecretKey,
        });
      },
    });
    broker.connect().catch((err) => process.stderr.write(`broker connect failed for ${mesh.slug}: ${String(err)}\n`));
    brokers.set(mesh.slug, broker);
  }

  // Start the drain worker. With multi-mesh, drain dispatches each
  // outbox row to its mesh's broker via the `mesh` column.
  let drain: DrainHandle | null = null;
  drain = startDrainWorker({ db: outboxDb, brokers });

  // 1.30.0 — per-session broker presence. Always on. Older CLIs that
  // don't include `presence` material in the register body just won't
  // get a session WS; the daemon's own member-keyed broker still
  // covers them.
  const sessionBrokers = new Map<string, SessionBrokerClient>();
  setRegistryHooks({
    onRegister: (info) => {
      if (!info.presence) return;
      const meshConfig = meshConfigs.get(info.mesh);
      if (!meshConfig) {
        process.stderr.write(JSON.stringify({
          level: "warn", msg: "session_broker_no_mesh_config", mesh: info.mesh,
          ts: new Date().toISOString(),
        }) + "\n");
        return;
      }
      // Drop any pre-existing session WS under this token (re-register).
      const prior = sessionBrokers.get(info.token);
      if (prior) {
        sessionBrokers.delete(info.token);
        prior.close().catch(() => { /* ignore */ });
      }
      // 1.32.1 — wire push delivery. Messages targeted at the launched
      // session's pubkey land on THIS WS, not on the member-keyed one,
      // so without this forward they'd silently disappear (the bug that
      // kept inbox.db at zero rows since 1.30.0). Decrypt prefers the
      // session secret key; member key remains the fallback for legacy
      // member-targeted traffic that happens to fan out here.
      const sessionSecretKeyHex = info.presence.sessionSecretKey;
      const client = new SessionBrokerClient({
        mesh: meshConfig,
        sessionPubkey: info.presence.sessionPubkey,
        sessionSecretKey: info.presence.sessionSecretKey,
        parentAttestation: info.presence.parentAttestation,
        sessionId: info.sessionId,
        displayName: info.displayName,
        ...(info.role ? { role: info.role } : {}),
        ...(info.cwd ? { cwd: info.cwd } : {}),
        pid: info.pid,
        onPush: (m) => {
          void handleBrokerPush(m, {
            db: inboxDb,
            bus,
            meshSlug: meshConfig.slug,
            recipientSecretKeyHex: meshConfig.secretKey,
            sessionSecretKeyHex,
          });
        },
      });
      sessionBrokers.set(info.token, client);
      client.connect().catch((err) =>
        process.stderr.write(JSON.stringify({
          level: "warn", msg: "session_broker_connect_failed",
          mesh: info.mesh, err: String(err), ts: new Date().toISOString(),
        }) + "\n"),
      );
    },
    onDeregister: (info: SessionInfo) => {
      const client = sessionBrokers.get(info.token);
      if (!client) return;
      sessionBrokers.delete(info.token);
      client.close().catch(() => { /* ignore */ });
    },
  });

  startReaper();

  const ipc = startIpcServer({
    localToken,
    tcpEnabled,
    publicHealthCheck: opts.publicHealthCheck,
    outboxDb,
    inboxDb,
    bus,
    brokers,
    meshConfigs,
    onPendingInserted: () => drain?.wake(),
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
    meshes: meshes.map((m) => m.slug),
    ts: new Date().toISOString(),
  }) + "\n");

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(JSON.stringify({ msg: "daemon_shutdown", signal: sig, ts: new Date().toISOString() }) + "\n");
    if (drain) await drain.close();
    for (const b of brokers.values()) {
      try { await b.close(); } catch { /* ignore */ }
    }
    for (const b of sessionBrokers.values()) {
      try { await b.close(); } catch { /* ignore */ }
    }
    sessionBrokers.clear();
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
