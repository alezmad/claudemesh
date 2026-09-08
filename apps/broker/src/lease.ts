/**
 * Pure lease-lifecycle helpers for the broker's WS presence handling.
 *
 * Extracted from `index.ts` after the 2026-09-08 daemon-restart blackout
 * (spec: .artifacts/specs/2026-09-08-daemon-restart-mesh-blackout.md,
 * Addendum 5) so the decision logic is unit-testable without booting the
 * broker. Every function here is synchronous and side-effect free; the
 * caller (index.ts) applies the returned decision.
 *
 * Root cause these guard against (RC-A): the `ws.on("close")` handler used
 * to check `conn.ws !== ws` BEFORE an `await savePeerState()` and mutate
 * the lease AFTER it. Under DB latency the close of the *dead* daemon's
 * socket resumed after the *new* daemon had already reattached, and put a
 * healthy lease into grace (or evicted it outright). The new socket then
 * lived on as a zombie — OPEN on both ends, no presence. The decision must
 * be taken synchronously against the current state, which is what
 * `decideCloseAction` encodes.
 */

export type LeaseState = "online" | "offline";

/** Minimal structural view of a PeerConn the helpers need. */
export interface LeaseConnView<WS> {
  ws: WS;
  leaseState: LeaseState;
}

export type CloseAction =
  /** No connections entry for this presence — already evicted. */
  | "no_conn"
  /** The closing socket is not the lease's current socket (a reattach
   *  already swapped in a fresh one). Nothing to do. */
  | "ignore_replaced"
  /** Lease was online → enter the grace window. */
  | "enter_grace"
  /** Lease was already offline (second close in grace, odd state) → evict now. */
  | "evict_now";

/**
 * Decide what a socket-close event means for a lease. MUST be evaluated
 * synchronously at the moment the close event fires — never after an
 * await — so the `conn.ws === ws` identity check and the lease-state read
 * see the same instant.
 */
export function decideCloseAction<WS>(
  conn: LeaseConnView<WS> | undefined,
  closingWs: WS,
): CloseAction {
  if (!conn) return "no_conn";
  if (conn.ws !== closingWs) return "ignore_replaced";
  return conn.leaseState === "online" ? "enter_grace" : "evict_now";
}

/**
 * Should the grace-expiry timer actually evict? A reattach that landed
 * after the timer was scheduled but whose clearTimeout raced the firing
 * leaves the lease `online` — evicting then would kill a live session.
 */
export function shouldEvictOnGraceExpiry<WS>(conn: LeaseConnView<WS> | undefined): boolean {
  if (!conn) return false;
  return conn.leaseState === "offline";
}

export type PresenceRole = "control-plane" | "session" | "service";

export interface DedupConnView {
  meshId: string;
  sessionId: string;
  peerRole: PresenceRole;
}

/**
 * Session-id dedup, scoped by role.
 *
 * The launch wrapper's member-level `hello` and the daemon's `session_hello`
 * for the same Claude Code session both carry the same `sessionId` (the
 * Claude session UUID). Before this fix each path kicked the other's
 * presence ("hello dedup" ↔ "session_hello dedup"), producing a chain of
 * evictions + forced WS closes on every relaunch (Addendum 2). A
 * control-plane presence and a session presence for one session must
 * coexist; only presences of the SAME role dedup each other.
 */
export function dedupTargets<K>(
  connections: Iterable<[K, DedupConnView]>,
  hello: { meshId: string; sessionId: string },
  role: PresenceRole,
): K[] {
  const out: K[] = [];
  for (const [pid, c] of connections) {
    if (c.meshId !== hello.meshId) continue;
    if (c.sessionId !== hello.sessionId) continue;
    if (c.peerRole !== role) continue;
    out.push(pid);
  }
  return out;
}

export interface ZombieSocketView {
  readyState: number;
  OPEN: number;
}

/**
 * Zombie sweeper selection: sockets that are OPEN, have been connected for
 * at least `minAgeMs`, and are not referenced by any live lease. Such a
 * socket cannot receive pushes (no presence → sendToPeer never finds it)
 * and cannot be discovered, yet the client thinks it is connected because
 * the `ws` library answers its pings. Closing it forces the client to
 * reconnect and re-hello, which recreates the presence (self-heal).
 *
 * `minAgeMs` leaves room for a socket that is mid-hello.
 */
export function findZombieSockets<WS extends ZombieSocketView>(
  clients: Iterable<WS>,
  liveSockets: Set<WS>,
  openedAt: (ws: WS) => number | undefined,
  now: number,
  minAgeMs: number,
): WS[] {
  const out: WS[] = [];
  for (const ws of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (liveSockets.has(ws)) continue;
    const t = openedAt(ws);
    // Unknown open time = accepted before this code path existed; treat
    // as old enough (the sweeper runs every 30s, so it has had time).
    if (t !== undefined && now - t < minAgeMs) continue;
    out.push(ws);
  }
  return out;
}

/** Close codes the broker uses when it is the one ending a socket. */
export const CLOSE_CODE_PRESENCE_EVICTED = 4004;
export const CLOSE_CODE_NO_PRESENCE = 4005;
