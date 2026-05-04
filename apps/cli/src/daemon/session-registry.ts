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
 *   - reaper polls every 30 s and drops entries whose pid is dead.
 *   - hard ttl ceiling of 24 h is a leak guard for forgotten sessions.
 *
 * Persistence: in-memory only for v1. A daemon restart clears the
 * registry — every launched session needs to re-register. That's fine
 * for now because launch.ts re-registers on `ensureDaemonRunning`'s
 * success path, and most ad-hoc CLI invocations from outside a launched
 * session have no token to begin with.
 */

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
  registeredAt: number;
}

/** Lifecycle callbacks invoked synchronously after registry mutation. */
export interface RegistryHooks {
  onRegister?: (info: SessionInfo) => void;
  onDeregister?: (info: SessionInfo) => void;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const REAPER_INTERVAL_MS = 30 * 1000;

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

  const stored: SessionInfo = { ...info, registeredAt: Date.now() };
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
    try { process.kill(info.pid, 0); } catch { dead.push(token); }
  }
  for (const t of dead) deregisterByToken(t);
}

/** Test helper. */
export function _resetRegistry(): void {
  byToken.clear();
  bySessionId.clear();
  hooks.onRegister = undefined;
  hooks.onDeregister = undefined;
}
