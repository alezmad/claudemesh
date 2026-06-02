import { existsSync, mkdirSync, readFileSync } from "node:fs";

import { DAEMON_PATHS } from "./paths.js";
import { acquireSingletonLock, releaseSingletonLock } from "./lock.js";
import { ensureLocalToken } from "./local-token.js";
import { startIpcServer } from "./ipc/server.js";
import { setRegistryHooks, startReaper, registerSession, readPersistedSessions, setRegistryPersistence, type SessionInfo } from "./session-registry.js";
import { openSqlite, type SqliteDb } from "./db/sqlite.js";
import { migrateOutbox } from "./db/outbox.js";
import { migrateInbox } from "./db/inbox.js";
import { DaemonBrokerClient } from "./broker.js";
import { SessionBrokerClient } from "./session-broker.js";
import { startDrainWorker, type DrainHandle } from "./drain.js";
import { startInboxPruner, type InboxPrunerHandle } from "./inbox-pruner.js";
import { handleBrokerPush } from "./inbound.js";
import { EventBus } from "./events.js";
import { checkFingerprint, type ClonePolicy } from "./identity.js";
import { readConfig } from "~/services/config/facade.js";
import { VERSION } from "~/constants/urls.js";

export interface RunDaemonOptions {
  /** Disable TCP loopback (UDS-only). Defaults true in container envs. */
  tcpEnabled?: boolean;
  publicHealthCheck?: boolean;
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

  // 1.34.10: the daemon is universal — attaches to every mesh listed
  // in config.json. Single-mesh isolation is handled by simply joining
  // only one mesh in that environment (containers, etc.). No --mesh
  // flag, no per-mesh service unit; one daemon, every mesh.
  const cfg = readConfig();
  if (cfg.meshes.length === 0) {
    process.stderr.write(`no mesh joined; run \`claudemesh join <invite-url>\` first\n`);
    releaseSingletonLock();
    try { outboxDb.close(); } catch { /* ignore */ }
    return 2;
  }
  const meshes = cfg.meshes;

  // 1.34.9 — declared upfront so the daemon-WS onPush closure can
  // reach into the per-session map for the isOwnPubkey filter (drops
  // peer_joined / peer_left events for our own session pubkeys before
  // they surface as `[system] Peer "<self>" joined`). Populated below
  // by setRegistryHooks; empty until the first session registers, but
  // that's fine — the closure walks it lazily.
  const sessionBrokers = new Map<string, SessionBrokerClient>();
  const sessionBrokersByPubkey = new Map<string, SessionBrokerClient>();

  // Spin up one broker per mesh. Connection failures are non-fatal:
  // the outbox keeps queuing per-mesh and reconnect logic in
  // DaemonBrokerClient handles reattach.
  const brokers = new Map<string, DaemonBrokerClient>();
  const meshConfigs = new Map<string, typeof cfg.meshes[number]>();
  for (const mesh of meshes) {
    meshConfigs.set(mesh.slug, mesh);
    // 1.34.10: no global displayName override anymore. Each mesh's
    // hello uses its own per-mesh display name from config.json (set
    // at `claudemesh join` time). Sessions advertise their own name
    // via `claudemesh launch --name`.
    const broker: DaemonBrokerClient = new DaemonBrokerClient(mesh, {
      onStatusChange: (s) => {
        process.stdout.write(JSON.stringify({
          msg: "broker_status", status: s, mesh: mesh.slug, ts: new Date().toISOString(),
        }) + "\n");
        bus.publish("broker_status", { mesh: mesh.slug, status: s });
      },
      onPush: (m) => {
        // Daemon-WS is member-keyed, not session-keyed. Session-targeted
        // DMs land on the per-session WS (SessionBrokerClient) since
        // 1.32.1 and decrypt with the session secret there. Anything that
        // arrives here can only be member-keyed (broadcasts, member DMs,
        // system events) — pass member secret only.
        // 1.34.9: drop self-echoes — broker fan-out paths mirror an
        // outbound back to the SAME daemon's member-WS even when the
        // send originated on a session-WS (because both connections
        // belong to the same member from the broker's view). Filter on
        // senderMemberPubkey alone: anything attributed to OUR member is
        // either our own send echoing back or, theoretically, a peer
        // send from a different connection that happens to share our
        // pubkey — but two-different-clients-same-pubkey is impossible
        // by construction (member pubkeys are stable + unique per
        // identity). Sibling-session DMs don't fan to our member-WS;
        // they fan session-to-session. So this is safe.
        const senderMemberPk = String((m as Record<string, unknown>).senderMemberPubkey ?? "").toLowerCase();
        const ownMember = mesh.pubkey.toLowerCase();
        if (senderMemberPk && senderMemberPk === ownMember) {
          return;
        }
        void handleBrokerPush(m, {
          db: inboxDb,
          bus,
          meshSlug: mesh.slug,
          recipientSecretKeyHex: mesh.secretKey,
          // v2 agentic-comms (M1): client_ack closes the at-least-once
          // loop. Broker holds the row claimed (not delivered) until ack.
          ackClientMessage: (cmid, bmid) => broker.sendClientAck(cmid, bmid),
          // 1.34.9: drop self-join system events. Member pubkey + every
          // live session pubkey on this daemon all count as "us".
          isOwnPubkey: (pubkey) => {
            const lower = pubkey.toLowerCase();
            if (lower === ownMember) return true;
            return sessionBrokersByPubkey.has(lower);
          },
          // 1.34.10: tag the bus event with our member pubkey so the
          // SSE demux only fans this row to MCPs whose subscriber
          // matches (member-keyed broadcasts / DMs).
          recipientPubkey: mesh.pubkey,
          recipientKind: "member",
        });
      },
    });
    broker.connect().catch((err) => process.stderr.write(`broker connect failed for ${mesh.slug}: ${String(err)}\n`));
    brokers.set(mesh.slug, broker);
  }

  // 1.30.0 — per-session broker presence. Always on. Older CLIs that
  // don't include `presence` material in the register body just won't
  // get a session WS; the daemon's own member-keyed broker still
  // covers them.
  //
  // The two index maps (sessionBrokers by token, sessionBrokersByPubkey
  // by session pubkey) are declared earlier in this function so the
  // daemon-WS onPush closure can reference them for the isOwnPubkey
  // self-join filter.

  // Start the drain worker. With multi-mesh, drain dispatches each
  // outbox row to its mesh's broker via the `mesh` column.
  // 1.34.0: drain also accepts a session-pubkey lookup so rows
  // written by authenticated sessions route via the matching session-WS
  // (broker fan-out then attributes the push to the session pubkey).
  let drain: DrainHandle | null = null;
  drain = startDrainWorker({
    db: outboxDb,
    brokers,
    getSessionBrokerByPubkey: (pubkey) => sessionBrokersByPubkey.get(pubkey),
  });

  // 1.34.8 — TTL prune for inbox.db. Runs hourly with a 30-day default
  // retention. Without this the inbox grows unbounded; even on a moderate
  // mesh that's tens of thousands of rows over a few weeks. Prune is a
  // single DELETE; failures are non-fatal and the next interval retries.
  const inboxPruner: InboxPrunerHandle = startInboxPruner({ db: inboxDb });
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
        // 1.34.0: keep both indices in sync.
        if (sessionBrokersByPubkey.get(prior.sessionPubkey) === prior) {
          sessionBrokersByPubkey.delete(prior.sessionPubkey);
        }
        prior.close().catch(() => { /* ignore */ });
      }
      // Also drop any stale WS holding this session pubkey under a
      // DIFFERENT token. With UUID-anchored persistent keypairs a relaunch
      // reuses the pubkey, so without this the old SessionBrokerClient
      // would linger connected (the broker then sees two presences for one
      // pubkey — the same-name ghost that stole queued DMs). Dedup by
      // pubkey closes it before the new WS opens.
      const priorByPubkey = sessionBrokersByPubkey.get(info.presence.sessionPubkey);
      if (priorByPubkey && priorByPubkey !== prior) {
        for (const [tok, c] of sessionBrokers) {
          if (c === priorByPubkey) { sessionBrokers.delete(tok); break; }
        }
        sessionBrokersByPubkey.delete(info.presence.sessionPubkey);
        priorByPubkey.close().catch(() => { /* ignore */ });
      }
      // 1.32.1 — wire push delivery. Messages targeted at the launched
      // session's pubkey land on THIS WS, not on the member-keyed one,
      // so without this forward they'd silently disappear (the bug that
      // kept inbox.db at zero rows since 1.30.0). Decrypt prefers the
      // session secret key; member key remains the fallback for legacy
      // member-targeted traffic that happens to fan out here.
      const sessionSecretKeyHex = info.presence.sessionSecretKey;
      // Capture the pubkey for the onPush closure below — TS can't
      // narrow `info.presence` inside the async arrow even though we
      // guard `if (!info.presence) return` earlier.
      const sessionPubkeyHex = info.presence.sessionPubkey;
      const client: SessionBrokerClient = new SessionBrokerClient({
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
            // v2 agentic-comms (M1): close the at-least-once loop.
            ackClientMessage: (cmid, bmid) => client.sendClientAck(cmid, bmid),
            // 1.34.10: tag the bus event with this session's pubkey so
            // the SSE demux only delivers to the MCP serving THIS
            // session — not its siblings on the same daemon. Without
            // this, A's MCP also rendered DMs intended for B because
            // the bus was a single shared stream.
            recipientPubkey: sessionPubkeyHex,
            recipientKind: "session",
          });
        },
      });
      sessionBrokers.set(info.token, client);
      sessionBrokersByPubkey.set(info.presence.sessionPubkey, client);
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
      // 1.34.0: drop the pubkey index iff this client still owns it
      // (a re-register may have already swapped the entry).
      if (sessionBrokersByPubkey.get(client.sessionPubkey) === client) {
        sessionBrokersByPubkey.delete(client.sessionPubkey);
      }
      client.close().catch(() => { /* ignore */ });
    },
  });

  startReaper();

  // Rehydrate persisted session bindings (1.36.0). A daemon restart used
  // to wipe the in-memory registry, so every live session lost its mesh
  // context and CLI commands fell back to an arbitrary default mesh — a
  // live peer then looked "disconnected" though nothing had moved. We now
  // reload each persisted binding, validate the pid is still alive (with
  // a start-time PID-reuse guard), reload its keypair from the per-session
  // store, re-sign a fresh parent attestation, and re-register it — which
  // fires onRegister and reconnects its SessionBrokerClient on the broker.
  try {
    const persisted = readPersistedSessions(DAEMON_PATHS.SESSIONS_FILE);
    if (persisted.length > 0) {
      const { loadOrCreateSessionKeypair } = await import("~/services/session/keypair-store.js");
      const { signParentAttestation } = await import("~/services/broker/session-hello-sig.js");
      const { isPidAlive, getProcessStartTimes } = await import("./process-info.js");
      const liveStartTimes = await getProcessStartTimes(persisted.map((p) => p.pid)).catch(() => new Map<number, string>());
      let revived = 0;
      for (const s of persisted) {
        if (!isPidAlive(s.pid)) continue;
        if (s.startTime !== undefined) {
          const live = liveStartTimes.get(s.pid);
          if (live !== undefined && live !== s.startTime) continue; // PID reused
        }
        const meshConfig = meshConfigs.get(s.mesh);
        if (!meshConfig) continue; // mesh no longer joined
        try {
          const kp = await loadOrCreateSessionKeypair(meshConfig.slug, s.sessionId);
          const att = await signParentAttestation({
            parentMemberPubkey: meshConfig.pubkey,
            parentSecretKey: meshConfig.secretKey,
            sessionPubkey: kp.publicKey,
          });
          registerSession({
            token: s.token,
            sessionId: s.sessionId,
            mesh: s.mesh,
            displayName: s.displayName,
            pid: s.pid,
            ...(s.cwd ? { cwd: s.cwd } : {}),
            ...(s.role ? { role: s.role } : {}),
            ...(s.groups ? { groups: s.groups } : {}),
            ...(s.startTime ? { startTime: s.startTime } : {}),
            presence: {
              sessionPubkey: kp.publicKey,
              sessionSecretKey: kp.secretKey,
              parentAttestation: {
                sessionPubkey: att.sessionPubkey,
                parentMemberPubkey: att.parentMemberPubkey,
                expiresAt: att.expiresAt,
                signature: att.signature,
              },
            },
          });
          revived++;
        } catch (err) {
          process.stderr.write(JSON.stringify({
            level: "warn", msg: "session_rehydrate_failed",
            token: s.token.slice(0, 8), mesh: s.mesh, err: String(err),
            ts: new Date().toISOString(),
          }) + "\n");
        }
      }
      process.stderr.write(JSON.stringify({
        level: "info", msg: "sessions_rehydrated",
        revived, persisted: persisted.length, ts: new Date().toISOString(),
      }) + "\n");
    }
  } catch (err) {
    process.stderr.write(JSON.stringify({
      level: "warn", msg: "session_rehydrate_scan_failed", err: String(err),
      ts: new Date().toISOString(),
    }) + "\n");
  }
  // Enable ongoing persistence now that rehydration has read the old file.
  setRegistryPersistence(DAEMON_PATHS.SESSIONS_FILE);

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
    // 1.34.10: stamp the version so users can tell whether the
    // running daemon picked up a recent CLI ship. Read off the same
    // VERSION constant the IPC `/v1/version` endpoint serves.
    version: VERSION,
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
    inboxPruner.stop();
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
