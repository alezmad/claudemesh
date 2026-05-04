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

export interface SessionInfo {
  token: string;
  sessionId: string;
  mesh: string;
  displayName: string;
  pid: number;
  cwd?: string;
  role?: string;
  groups?: string[];
  registeredAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const REAPER_INTERVAL_MS = 30 * 1000;

const byToken = new Map<string, SessionInfo>();
const bySessionId = new Map<string, string>();

let reaperHandle: NodeJS.Timeout | null = null;

export function startReaper(): void {
  if (reaperHandle) return;
  reaperHandle = setInterval(reapDead, REAPER_INTERVAL_MS).unref?.() ?? reaperHandle;
}

export function stopReaper(): void {
  if (reaperHandle) { clearInterval(reaperHandle); reaperHandle = null; }
}

export function registerSession(info: Omit<SessionInfo, "registeredAt">): SessionInfo {
  // Replace any prior entry under the same sessionId.
  const priorToken = bySessionId.get(info.sessionId);
  if (priorToken && priorToken !== info.token) byToken.delete(priorToken);

  const stored: SessionInfo = { ...info, registeredAt: Date.now() };
  byToken.set(info.token, stored);
  bySessionId.set(info.sessionId, info.token);
  return stored;
}

export function deregisterByToken(token: string): boolean {
  const entry = byToken.get(token);
  if (!entry) return false;
  byToken.delete(token);
  if (bySessionId.get(entry.sessionId) === token) bySessionId.delete(entry.sessionId);
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
}
