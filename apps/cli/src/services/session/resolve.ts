/**
 * CLI-side session resolver. Reads the session token from env, asks
 * the daemon `GET /v1/sessions/me`, and caches the result for the
 * lifetime of this CLI invocation.
 *
 * Used by verbs that iterate multiple meshes client-side (peer list,
 * me, member list) so that, when invoked from inside a launched
 * session, they auto-scope to that session's workspace instead of
 * aggregating across every joined mesh.
 *
 * Returns null when:
 *   - no token in env (caller is outside a launched session, or
 *     bare `claudemesh` with no installed daemon).
 *   - token present but daemon doesn't recognize it (registry was
 *     reset by a daemon restart).
 *   - any IPC error (treat as "no scoping info, fall back to default
 *     behavior").
 */

import { ipc } from "~/daemon/ipc/client.js";
import { readSessionTokenFromEnv } from "./token.js";

export interface ResolvedSession {
  sessionId: string;
  mesh: string;
  displayName: string;
  pid: number;
  cwd?: string;
  role?: string;
  groups?: string[];
}

let cached: ResolvedSession | null | undefined = undefined;

export async function getSessionInfo(): Promise<ResolvedSession | null> {
  if (cached !== undefined) return cached;
  const tok = readSessionTokenFromEnv();
  if (!tok) { cached = null; return null; }
  try {
    const res = await ipc<{ session?: ResolvedSession }>({
      path: "/v1/sessions/me",
      timeoutMs: 1_500,
    });
    if (res.status !== 200 || !res.body.session) { cached = null; return null; }
    cached = res.body.session;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/** Test helper. */
export function _resetSessionCache(): void {
  cached = undefined;
}
