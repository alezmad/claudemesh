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

import { getProcessStartTime, isPidAlive } from "./process-info.js";

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

export function startReaper(): void {
  if (reaperHandle) return;
  reaperHandle = setInterval(reapDead, REAPER_INTERVAL_MS).unref?.() ?? reaperHandle;
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

  // Capture start-time at register so the reaper can detect PID reuse.
  // Caller may pre-fill info.startTime (tests do this); only probe ps
  // when the field is absent so we don't fork shell subprocesses in
  // unit tests for fake pids.
  const startTime = info.startTime ?? getProcessStartTime(info.pid) ?? undefined;
  const stored: SessionInfo = { ...info, startTime, registeredAt: Date.now() };
  byToken.set(info.token, stored);
  bySessionId.set(info.sessionId, info.token);
  try { hooks.onRegister?.(stored); } catch { /* see above */ }
  return stored;
}

export function deregisterByToken(token: string): boolean {
  const entry = byToken.get(token);
  if (!entry) return false;
  byToken.delete(token);
  if (bySessionId.get(entry.sessionId) === token) bySessionId.delete(entry.sessionId);
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

function reapDead(): void {
  const dead: string[] = [];
  for (const [token, info] of byToken.entries()) {
    if (Date.now() - info.registeredAt > TTL_MS) { dead.push(token); continue; }
    if (!isPidAlive(info.pid)) { dead.push(token); continue; }
    // PID reuse guard: process is alive, but if its start-time changed
    // since register the original is gone and the OS recycled the pid
    // for an unrelated program. Skip when we never captured a start-
    // time (best-effort fallback to bare liveness above).
    if (info.startTime !== undefined) {
      const live = getProcessStartTime(info.pid);
      if (live !== null && live !== info.startTime) { dead.push(token); continue; }
    }
  }
  for (const t of dead) deregisterByToken(t);
}

/** Test helper: run a single reaper pass synchronously. */
export function _runReaperOnce(): void {
  reapDead();
}

/** Test helper. */
export function _resetRegistry(): void {
  byToken.clear();
  bySessionId.clear();
  hooks.onRegister = undefined;
  hooks.onDeregister = undefined;
}
