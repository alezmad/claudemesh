/**
 * In-memory per-token session registry kept by the daemon.
 *
 * `claudemesh launch` POSTs `/v1/sessions/register` with the token it
 * minted plus session metadata (sessionId, mesh, displayName, pid,
 * cwd, role, groups). Subsequent CLI invocations from inside that
 * session present the token via `Authorization: ClaudeMesh-Session
 * <hex>` and the daemon's IPC auth middleware resolves it here in O(1).
 *
 * Lifecycle:
 *   - register replaces any prior entry under the same `sessionId`
 *     (handles re-launch and `--resume` flows cleanly).
 *   - reaper polls every 5 s. An entry is dropped when its pid is dead
 *     OR when its captured start-time no longer matches the running
 *     process (PID reuse — original is gone, OS recycled the number).
 *   - hard ttl ceiling of 24 h is a leak guard for forgotten sessions.
 *
 * Persistence: in-memory only for v1. A daemon restart clears the
 * registry — every launched session needs to re-register. That's fine
 * for now because launch.ts re-registers on `ensureDaemonRunning`'s
 * success path, and most ad-hoc CLI invocations from outside a launched
 * session have no token to begin with.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

import { getProcessStartTime, getProcessStartTimes, isPidAlive } from "./process-info.js";

/**
 * Optional per-launch presence material. Carried opaquely through the
 * registry; the daemon's session-broker subsystem (1.30.0+) reads it to
 * open a long-lived broker WebSocket per session. Absent on older CLIs
 * — register accepts payloads without it for backward compat.
 */
export interface SessionPresence {
  /** Hex ed25519 pubkey, 64 chars. */
  sessionPubkey: string;
  /** Hex ed25519 secret key (held in-memory only; never disk). */
  sessionSecretKey: string;
  /** Parent-member-signed attestation; see signParentAttestation. */
  parentAttestation: {
    sessionPubkey: string;
    parentMemberPubkey: string;
    expiresAt: number;
    signature: string;
  };
}

export interface SessionInfo {
  token: string;
  sessionId: string;
  mesh: string;
  displayName: string;
  pid: number;
  cwd?: string;
  role?: string;
  groups?: string[];
  /** 1.30.0+: per-launch presence material. */
  presence?: SessionPresence;
  /**
   * 1.31.0+: opaque per-process start-time captured at register. The
   * reaper compares the live value against this on every sweep — a
   * mismatch means the original process exited and the pid was reused
   * by an unrelated program, so the registry entry must be dropped.
   * `undefined` when capture failed (process already dead at register
   * time, ps unavailable, etc.) — the reaper falls back to bare
   * liveness in that case.
   */
  startTime?: string;
  registeredAt: number;
}

/** Lifecycle callbacks invoked synchronously after registry mutation. */
export interface RegistryHooks {
  onRegister?: (info: SessionInfo) => void;
  onDeregister?: (info: SessionInfo) => void;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const REAPER_INTERVAL_MS = 5 * 1000;

const byToken = new Map<string, SessionInfo>();
const bySessionId = new Map<string, string>();
const hooks: RegistryHooks = {};

let reaperHandle: NodeJS.Timeout | null = null;

/** When set, registry mutations are mirrored to this file so a daemon
 *  restart can rehydrate live sessions. Holds NO secret material — the
 *  session keypair is reloaded from the per-session keypair store on
 *  rehydrate. null (default) disables persistence, which keeps unit
 *  tests from touching disk unless they opt in. */
let persistPath: string | null = null;

/** Slim, secret-free projection persisted to disk. */
export interface PersistedSession {
  token: string;
  sessionId: string;
  mesh: string;
  displayName: string;
  pid: number;
  cwd?: string;
  role?: string;
  groups?: string[];
  startTime?: string;
  registeredAt: number;
}

function toPersisted(info: SessionInfo): PersistedSession {
  // Drop `presence` (carries the session secret key) — never to disk here.
  const { presence: _presence, ...rest } = info;
  return rest;
}

/** Enable on-disk persistence of session bindings (called at daemon boot
 *  with DAEMON_PATHS.SESSIONS_FILE). Pass null to disable. */
export function setRegistryPersistence(path: string | null): void {
  persistPath = path;
}

function persist(): void {
  if (!persistPath) return;
  try {
    mkdirSync(dirname(persistPath), { recursive: true, mode: 0o700 });
    const rows = [...byToken.values()].map(toPersisted);
    const tmp = `${persistPath}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, sessions: rows }), { mode: 0o600 });
    renameSync(tmp, persistPath);
  } catch {
    // Best-effort: a persistence failure must never throttle the registry.
  }
}

/** Read persisted session bindings from disk (pure — no registration, no
 *  liveness check). Returns [] when the file is absent or unreadable.
 *  The daemon's boot rehydration validates liveness and re-registers. */
export function readPersistedSessions(path: string): PersistedSession[] {
  try {
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { sessions?: PersistedSession[] };
    return Array.isArray(parsed.sessions) ? parsed.sessions : [];
  } catch {
    return [];
  }
}

export function startReaper(): void {
  if (reaperHandle) return;
  // The sweep is async (batched ps) — wrap in `void` so setInterval
  // doesn't try to await us, and so an unexpected throw doesn't crash
  // the daemon. Errors are swallowed inside reapDead.
  reaperHandle = setInterval(() => { void reapDead(); }, REAPER_INTERVAL_MS).unref?.() ?? reaperHandle;
}

export function stopReaper(): void {
  if (reaperHandle) { clearInterval(reaperHandle); reaperHandle = null; }
}

/**
 * Wire daemon-level lifecycle hooks. Called once at daemon boot — passing
 * `{}` clears them. Idempotent across calls so tests can re-bind.
 */
export function setRegistryHooks(next: RegistryHooks): void {
  hooks.onRegister = next.onRegister;
  hooks.onDeregister = next.onDeregister;
}

export function registerSession(info: Omit<SessionInfo, "registeredAt">): SessionInfo {
  // Replace any prior entry under the same sessionId.
  const priorToken = bySessionId.get(info.sessionId);
  if (priorToken && priorToken !== info.token) {
    const prior = byToken.get(priorToken);
    if (prior) {
      byToken.delete(priorToken);
      try { hooks.onDeregister?.(prior); } catch { /* hook errors must never throttle the registry */ }
    }
  }

  // Caller may pre-fill info.startTime (tests do this for determinism).
  // For the real path we fire-and-forget an async ps probe — register
  // stays sync and microsecond-fast, and the start-time lands on the
  // entry within a few ms. Until it lands, the reaper falls back to
  // bare liveness for this entry, which is fine for the common case
  // (PID reuse is rare; the brief window without the guard is
  // tolerable).
  const stored: SessionInfo = { ...info, registeredAt: Date.now() };
  byToken.set(info.token, stored);
  bySessionId.set(info.sessionId, info.token);
  persist();
  try { hooks.onRegister?.(stored); } catch { /* see above */ }
  if (stored.startTime === undefined) {
    void captureStartTimeAsync(info.token, info.pid);
  }
  return stored;
}

async function captureStartTimeAsync(token: string, pid: number): Promise<void> {
  const lstart = await getProcessStartTime(pid);
  if (lstart === null) return;
  const entry = byToken.get(token);
  if (!entry || entry.pid !== pid) return; // entry was replaced; skip
  entry.startTime = lstart;
  persist(); // capture start-time on disk so restart can PID-reuse-guard
}

export function deregisterByToken(token: string): boolean {
  const entry = byToken.get(token);
  if (!entry) return false;
  byToken.delete(token);
  if (bySessionId.get(entry.sessionId) === token) bySessionId.delete(entry.sessionId);
  persist();
  try { hooks.onDeregister?.(entry); } catch { /* see above */ }
  return true;
}

export function resolveToken(token: string): SessionInfo | null {
  const entry = byToken.get(token);
  if (!entry) return null;
  if (Date.now() - entry.registeredAt > TTL_MS) {
    deregisterByToken(token);
    return null;
  }
  return entry;
}

export function listSessions(): SessionInfo[] {
  return [...byToken.values()];
}

async function reapDead(): Promise<void> {
  // Snapshot first; the second (async) phase calls ps and we must not
  // mutate the registry mid-iteration.
  const entries = [...byToken.entries()];

  // Phase 1 — TTL + bare liveness. Sync, microsecond-fast.
  const dead: string[] = [];
  const survivors: Array<[string, SessionInfo]> = [];
  for (const [token, info] of entries) {
    if (Date.now() - info.registeredAt > TTL_MS) { dead.push(token); continue; }
    if (!isPidAlive(info.pid)) { dead.push(token); continue; }
    survivors.push([token, info]);
  }

  // Phase 2 — PID-reuse guard for survivors that have a captured
  // start-time. Single batched ps call: O(1) forks regardless of
  // session count. Survivors without a start-time keep the bare-
  // liveness verdict from phase 1 (their captureStartTimeAsync may
  // still be in-flight from a recent register).
  const guardedPids = survivors
    .filter(([, info]) => info.startTime !== undefined)
    .map(([, info]) => info.pid);
  if (guardedPids.length > 0) {
    try {
      const live = await getProcessStartTimes(guardedPids);
      for (const [token, info] of survivors) {
        if (info.startTime === undefined) continue;
        const lstart = live.get(info.pid);
        // ps may transiently miss a pid that was alive when isPidAlive
        // ran — treat absence as "racing", let the next sweep decide.
        if (lstart === undefined) continue;
        if (lstart !== info.startTime) dead.push(token);
      }
    } catch {
      // ps failure here is non-fatal: survivors keep their phase-1
      // verdict. Logging is the daemon's responsibility — the
      // registry deliberately stays log-free.
    }
  }

  for (const t of dead) deregisterByToken(t);
}

/** Test helper: run a single reaper pass. */
export async function _runReaperOnce(): Promise<void> {
  await reapDead();
}

/** Test helper. */
export function _resetRegistry(): void {
  byToken.clear();
  bySessionId.clear();
  hooks.onRegister = undefined;
  hooks.onDeregister = undefined;
  persistPath = null;
}
