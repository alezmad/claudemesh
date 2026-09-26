/**
 * Direct-message target resolution — one source of truth for every
 * caller of the daemon's /v1/send (CLI, MCP tools, scripts).
 *
 * Spec 2026-09-26 §3. The noisy failure it prevents: a DM addressed to a
 * MEMBER pubkey is claimed by any connection of that member — the daemon's
 * member-WS then shows it to EVERY session of that member, and each of
 * them reacts. So a member key is resolved to its single live session, or
 * refused when there are several (unless the caller asked for --fanout).
 * Names and prefixes must match exactly one addressable peer.
 */

export interface RosterPeer {
  pubkey: string;
  memberPubkey?: string;
  displayName: string;
  /** Broker classification; `peerRole` on some IPC shapes. */
  role?: string;
  peerRole?: string;
}

export type ResolveResult =
  | { ok: true; pubkey: string; note?: "member_to_session" | "member_fanout" | "offline_member_or_session" }
  | { ok: false; code: "not_found" | "ambiguous" | "member_target_ambiguous"; detail: string; candidates: Array<{ pubkey: string; displayName: string }> };

function isControlPlane(p: RosterPeer): boolean {
  return (p.role ?? p.peerRole) === "control-plane";
}

function uniqByPubkey(peers: RosterPeer[]): RosterPeer[] {
  const seen = new Map<string, RosterPeer>();
  for (const p of peers) if (!seen.has(p.pubkey.toLowerCase())) seen.set(p.pubkey.toLowerCase(), p);
  return [...seen.values()];
}

const cand = (ps: RosterPeer[]) => ps.map((p) => ({ pubkey: p.pubkey, displayName: p.displayName }));

export function resolveDirectTarget(
  toRaw: string,
  roster: RosterPeer[],
  opts: { fanout?: boolean } = {},
): ResolveResult {
  const to = toRaw.trim().toLowerCase();
  const peers = roster.filter((p) => p.pubkey && !isControlPlane(p));

  if (/^[0-9a-f]{64}$/.test(to)) {
    if (peers.some((p) => p.pubkey.toLowerCase() === to)) return { ok: true, pubkey: to };
    const sessions = uniqByPubkey(peers.filter((p) => (p.memberPubkey ?? "").toLowerCase() === to));
    if (sessions.length === 1) return { ok: true, pubkey: sessions[0]!.pubkey.toLowerCase(), note: "member_to_session" };
    if (sessions.length > 1) {
      if (opts.fanout) return { ok: true, pubkey: to, note: "member_fanout" };
      return {
        ok: false,
        code: "member_target_ambiguous",
        detail: `${to.slice(0, 16)}… is a member key with ${sessions.length} live sessions — pick one session pubkey, or pass --fanout to reach all of them`,
        candidates: cand(sessions),
      };
    }
    // Unknown to the live roster: an offline peer. Keep store-and-forward.
    return { ok: true, pubkey: to, note: "offline_member_or_session" };
  }

  if (/^[0-9a-f]{4,63}$/.test(to)) {
    const bySession = uniqByPubkey(peers.filter((p) => p.pubkey.toLowerCase().startsWith(to)));
    const matches = bySession.length > 0
      ? bySession
      : uniqByPubkey(peers.filter((p) => (p.memberPubkey ?? "").toLowerCase().startsWith(to)));
    if (matches.length === 1) return { ok: true, pubkey: matches[0]!.pubkey.toLowerCase() };
    if (matches.length === 0) return { ok: false, code: "not_found", detail: `no peer matching prefix "${toRaw}"`, candidates: [] };
    return { ok: false, code: "ambiguous", detail: `prefix "${toRaw}" matches ${matches.length} peers`, candidates: cand(matches) };
  }

  const byName = uniqByPubkey(peers.filter((p) => p.displayName.toLowerCase() === to));
  if (byName.length === 1) return { ok: true, pubkey: byName[0]!.pubkey.toLowerCase() };
  if (byName.length === 0) return { ok: false, code: "not_found", detail: `peer "${toRaw}" not found`, candidates: [] };
  return { ok: false, code: "ambiguous", detail: `name "${toRaw}" matches ${byName.length} sessions — use a session pubkey`, candidates: cand(byName) };
}
