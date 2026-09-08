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

export interface SwappableLease<WS> extends LeaseConnView<WS> {
  leaseUntil: number;
  evictionTimer: ReturnType<typeof setTimeout> | null;
  lastPongAt: number;
}

/**
 * Reattach a lease onto a fresh socket (RC-C-safe ordering).
 *
 * 1. Swap `conn.ws`, mark the lease online and refresh the pong clock.
 * 2. THEN close the replaced socket via `closeOld` — which under Bun runs
 *    the old socket's `close` handler synchronously; that handler now sees
 *    `conn.ws !== closingWs` and ignores the event.
 * 3. THEN clear any grace timer (including one a mis-behaving handler may
 *    have just armed) and force the lease online again.
 *
 * Returns the previous lease state (for logging). Pure apart from the
 * injected `closeOld`, so the ordering contract is unit-testable under
 * Node even though the hazard only manifests under Bun.
 */
export function reattachLease<WS>(
  conn: SwappableLease<WS>,
  newWs: WS,
  closeOld: (oldWs: WS) => void,
  now: number = Date.now(),
): LeaseState {
  const wasState = conn.leaseState;
  const replaced = conn.ws !== newWs ? conn.ws : null;
  conn.ws = newWs;
  conn.leaseState = "online";
  conn.leaseUntil = 0;
  conn.lastPongAt = now;
  if (replaced !== null) {
    try { closeOld(replaced); } catch { /* already dead */ }
  }
  if (conn.evictionTimer) {
    clearTimeout(conn.evictionTimer);
    conn.evictionTimer = null;
  }
  conn.leaseState = "online";
  conn.leaseUntil = 0;
  return wasState;
}

// ── DB stale-sweep reconciliation (2026-09-08, Addendum 5 follow-up) ──────
//
// `sweepStalePresences` (broker.ts) flips `presence.disconnected_at` purely
// on `last_ping_at` age. That column is bumped by `heartbeat()` on every
// pong, so a live lease normally never goes stale — but the DB write can
// lag or fail while the in-memory lease is perfectly healthy, and the
// reverse can happen too: the row is flipped while a socket is still OPEN
// and its owner (the daemon) is never told. Both halves are closed here:
//   1. `liveLeasePresenceIds` = the set the sweeper must NOT flip
//      (online lease, OPEN socket, pong within the stale-pong window).
//   2. `reconcileFlippedPresences` = of the ids the sweeper DID flip, the
//      ones that still hold an online in-memory lease. The caller evicts
//      them (which closes the socket) so the client reconnects and
//      re-hellos instead of living on as a half-visible ghost.
// Offline-leased entries are left to their grace timer on purpose: the
// sweep cutoff (90 s since last ping) can land inside the grace window,
// and evicting there would shorten the grace the lease model promises.

/** Broker-side stale-pong window: 2.5x the 30 s ping cadence. */
export const STALE_PONG_THRESHOLD_MS = 75_000;

export interface LivenessConnView<WS extends { readyState: number; OPEN: number }>
  extends LeaseConnView<WS> {
  lastPongAt: number;
}

/**
 * Presence ids whose lease is online, whose socket is OPEN and whose last
 * pong is within `stalePongMs`. The DB stale sweeper must skip these — the
 * in-memory lease is the source of truth for liveness, the DB column is a
 * projection of it.
 */
export function liveLeasePresenceIds<WS extends { readyState: number; OPEN: number }>(
  conns: Iterable<[string, LivenessConnView<WS>]>,
  now: number,
  stalePongMs: number = STALE_PONG_THRESHOLD_MS,
): Set<string> {
  const keep = new Set<string>();
  for (const [pid, conn] of conns) {
    if (conn.leaseState !== "online") continue;
    if (conn.ws.readyState !== conn.ws.OPEN) continue;
    if (now - conn.lastPongAt > stalePongMs) continue;
    keep.add(pid);
  }
  return keep;
}

/**
 * Of the presence ids the DB sweeper flipped to disconnected, return those
 * that still have an ONLINE in-memory lease. Each one is a DB/memory
 * split-brain: discovery (`list_peers`, DB-backed) already hides it while
 * pushes (memory-backed) still reach it, and nothing tells the client.
 * The caller must evict them (closing the socket) so the client reconnects.
 */
export function reconcileFlippedPresences<WS>(
  flipped: Iterable<string>,
  lookup: (presenceId: string) => LeaseConnView<WS> | undefined,
): string[] {
  const out: string[] = [];
  for (const pid of flipped) {
    const conn = lookup(pid);
    if (conn?.leaseState === "online") out.push(pid);
  }
  return out;
}
