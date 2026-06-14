/**
 * `claudemesh peers` — list connected peers in the mesh.
 *
 * Shows all meshes by default, or filter with --mesh.
 *
 * Warm path: dials the per-mesh bridge socket the push-pipe holds open.
 * Cold path: opens its own WS via `withMesh`. Bridge fall-through is
 * transparent — output is identical.
 *
 * `--json` accepts an optional comma-separated field list:
 *   claudemesh peers --json                       (full record)
 *   claudemesh peers --json name,pubkey,status    (projection)
 */

import { withMesh } from "./connect.js";
import { readConfig } from "~/services/config/facade.js";
import { render } from "~/ui/render.js";
import { bold, dim, green, yellow } from "~/ui/styles.js";

export interface PeersFlags {
  mesh?: string;
  /** `true`/`undefined` = full record; comma-separated string = field projection. */
  json?: boolean | string;
  /** When false (default), hide control-plane presence rows from the
   * human renderer — they're infrastructure (daemon-WS member-keyed
   * presence), not interactive peers, and confused users into thinking
   * the daemon counted as a "peer". The JSON output still includes them
   * so scripts that need a full inventory can opt in via --all (or
   * just consume JSON).
   *
   * Source of truth is the broker-side `role` field
   * (`'control-plane' | 'session' | 'service'`). Older brokers don't
   * emit `role` yet — this code falls back to treating missing role as
   * `'session'` so legacy peer rows stay visible. */
  all?: boolean;
}

/**
 * Broker-emitted peer classification, added 2026-05-04. Older brokers
 * may omit it — treat missing as 'session' so legacy meshes still
 * render their peers (and don't accidentally hide them all). The CLI
 * never emits 'control-plane' on its own; that comes from the broker.
 */
export type PeerRole = "control-plane" | "session" | "service";

interface PeerRecord {
  pubkey: string;
  /** Stable member pubkey (independent of session). When sender shares
   * this with a peer, they're talking to the same person across all
   * their open sessions. */
  memberPubkey?: string;
  /** Per-launch session identifier (uuid). Used by the renderer to
   * disambiguate sibling sessions of the same member that otherwise
   * look identical (same name, same cwd). */
  sessionId?: string;
  displayName: string;
  status?: string;
  summary?: string;
  groups: Array<{ name: string; role?: string }>;
  /** Top-level convenience alias for `profile.role`, lifted by the CLI
   * since 1.31.5 so JSON consumers (the agent-vibes claudemesh skill,
   * launched-session LLMs) see the user-supplied role string at the
   * shape's top level. Same value as `profile.role`. Distinct from
   * `peerRole` below — that's the broker's presence-class taxonomy. */
  role?: string;
  /** Broker-emitted presence classification: 'control-plane' | 'session'
   * | 'service'. Source of truth for the --all visibility filter and
   * the default-hide rule. Older brokers omit this; the CLI fills
   * missing values with 'session' so legacy peer rows stay visible.
   *
   * Renamed from `role` to avoid collision with 1.31.5's profile.role
   * lift above. Wire-level field on the broker is also `peerRole`. */
  peerRole?: PeerRole;
  peerType?: string;
  channel?: string;
  model?: string;
  cwd?: string;
  /** Peer-level profile metadata (set via `claudemesh profile`). The
   * broker passes this through verbatim; the most common field is
   * `role` ("lead", "reviewer", "human", etc.) but capabilities, bio,
   * avatar, and title also live here when set. */
  profile?: {
    role?: string;
    title?: string;
    bio?: string;
    avatar?: string;
    capabilities?: string[];
    [k: string]: unknown;
  };
  /** True when this peer is one of the caller's own member's sessions.
   * Set in the cli (not the broker) by comparing memberPubkey against
   * the caller's stable JoinedMesh.pubkey. */
  isSelf?: boolean;
  /** When isSelf is true, true if this is the exact session running
   * the command (vs a sibling session of the same member). */
  isThisSession?: boolean;
  [k: string]: unknown;
}

/** Friendly aliases — `name` is what users will type; broker calls it `displayName`. */
const FIELD_ALIAS: Record<string, string> = {
  name: "displayName",
};

function projectFields(record: PeerRecord, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const sourceKey = FIELD_ALIAS[f] ?? f;
    out[f] = (record as Record<string, unknown>)[sourceKey];
  }
  return out;
}

async function listPeersForMesh(slug: string): Promise<PeerRecord[]> {
  const config = readConfig();
  const joined = config.meshes.find((m) => m.slug === slug);
  const selfMemberPubkey = joined?.pubkey ?? null;

  // Resolve our own session pubkey via the daemon's /v1/sessions/me when
  // we're inside a launched session. Without this, isThisSession can't
  // be set on the daemon path (only on the cold path where a fresh WS
  // creates the keypair), and the renderer can't tell the user which
  // row in `peer list` is them.
  let selfSessionPubkey: string | null = null;
  try {
    const { getSessionInfo } = await import("~/services/session/resolve.js");
    const sess = await getSessionInfo();
    if (sess && sess.mesh === slug && sess.presence?.sessionPubkey) {
      selfSessionPubkey = sess.presence.sessionPubkey;
    }
  } catch { /* not in a launched session; isThisSession stays false */ }

  // Daemon path — preferred when running. Same routing pattern as send.ts:
  // ~1 ms IPC round-trip; broker WS already warm in the daemon. The
  // lifecycle helper inside tryListPeersViaDaemon auto-spawns the
  // daemon if it's down and probes it for liveness — no separate bridge
  // tier is needed any more (1.28.0).
  //
  // 1.34.15: forward `slug` to the daemon as `?mesh=<slug>` so the
  // server-side aggregator narrows to the requested mesh. Pre-1.34.15
  // we called this with no argument, so a multi-mesh daemon returned
  // peers from every attached mesh and the renderer printed "peers on
  // flexicar" with cross-mesh rows mixed in. The daemon's
  // `meshFromCtx` already does the right scoping when the slug is
  // passed; the CLI just wasn't passing it.
  try {
    const { tryListPeersViaDaemon } = await import("~/services/bridge/daemon-route.js");
    const dr = await tryListPeersViaDaemon(slug);
    if (dr !== null) {
      return dr.map((p) => annotateSelf(p as PeerRecord, selfMemberPubkey, selfSessionPubkey));
    }
  } catch { /* daemon route helper not available; fall through */ }

  // Cold path — open our own WS. Reached only when the lifecycle helper
  // could not bring the daemon up.
  let result: PeerRecord[] = [];
  await withMesh({ meshSlug: slug }, async (client) => {
    const all = (await client.listPeers()) as unknown as PeerRecord[];
    const selfSessionPubkey = client.getSessionPubkey();
    result = all.map((p) =>
      annotateSelf(p, selfMemberPubkey, selfSessionPubkey),
    );
  });
  return result;
}

/**
 * Tag each peer record with `isSelf` / `isThisSession` so the renderer
 * (and downstream code that picks targets, e.g. `claudemesh send`) can
 * tell sender's own sessions from real peers. The broker has always
 * surfaced a sender's siblings as separate rows because they're separate
 * presence rows; the cli just hadn't been making that visible.
 *
 * Also normalizes the broker's `peerRole` classification: missing
 * values (older brokers) default to 'session' so legacy peer rows stay
 * visible under the default `--all=false` filter.
 *
 * And lifts `profile.role` to a top-level `role` field — the 1.31.5
 * convenience alias for JSON consumers (skill SKILL.md, launched-session
 * LLMs, jq pipelines). Same value as profile.role; distinct from
 * peerRole (presence taxonomy).
 */
function annotateSelf(
  peer: PeerRecord,
  selfMemberPubkey: string | null,
  selfSessionPubkey: string | null,
): PeerRecord {
  const isSelf = !!(
    selfMemberPubkey &&
    peer.memberPubkey &&
    peer.memberPubkey === selfMemberPubkey
  );
  const isThisSession = !!(
    isSelf &&
    selfSessionPubkey &&
    peer.pubkey === selfSessionPubkey
  );
  const peerRole: PeerRole = peer.peerRole ?? "session";
  const profileRole = peer.profile?.role?.trim() || undefined;
  return {
    ...peer,
    ...(profileRole ? { role: profileRole } : {}),
    peerRole,
    isSelf,
    isThisSession,
  };
}

export async function runPeers(flags: PeersFlags): Promise<void> {
  const config = readConfig();

  // Mesh selection precedence:
  //   1. explicit --mesh <slug>  (always wins)
  //   2. session-token mesh      (when invoked from inside a launched session)
  //   3. all joined meshes       (default for bare shells)
  let slugs: string[];
  if (flags.mesh) {
    slugs = [flags.mesh];
  } else {
    const { getSessionInfo } = await import("~/services/session/resolve.js");
    const sess = await getSessionInfo();
    slugs = sess ? [sess.mesh] : config.meshes.map((m) => m.slug);
  }

  if (slugs.length === 0) {
    render.err("No meshes joined.");
    render.hint("claudemesh <invite-url>    # join + launch");
    process.exit(1);
  }

  // Field projection: --json a,b,c
  const fieldList: string[] | null =
    typeof flags.json === "string" && flags.json.length > 0
      ? flags.json.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
  const wantsJson = flags.json !== undefined && flags.json !== false;

  const allJson: Array<{ mesh: string; peers: unknown[] }> = [];

  for (const slug of slugs) {
    try {
      const peers = await listPeersForMesh(slug);

      // Hide control-plane rows by default — they're infrastructure
      // (daemon-WS member-keyed presence), not interactive peers, and
      // they confused users into thinking the daemon counted as a
      // separate peer. --all opts back in for debugging.
      //
      // Source of truth: broker-emitted `peerRole` field (added
      // 2026-05-04). annotateSelf() filled in 'session' for older
      // brokers that don't emit peerRole yet, so this filter is
      // backwards-compatible by construction — legacy rows show up.
      //
      // Applied to JSON too (was human-output-only): `peer list --json`
      // leaking the daemon's control-plane row is what made the daemon
      // look like an addressable peer and sent DMs into a black hole.
      const visible = flags.all
        ? peers
        : peers.filter((p) => p.peerRole !== "control-plane");

      if (wantsJson) {
        const projected = fieldList
          ? visible.map((p) => projectFields(p, fieldList))
          : visible;
        allJson.push({ mesh: slug, peers: projected });
        continue;
      }

      // Sort: this-session first, then your-other-sessions, then real
      // peers. Within each group, idle/working ahead of dnd. Inside the
      // groups, leave broker order. The point is: when you run peer
      // list, the row that's YOU is row 1.
      const sorted = visible.slice().sort((a, b) => {
        const score = (p: PeerRecord) =>
          p.isThisSession ? 0 : p.isSelf ? 1 : 2;
        return score(a) - score(b);
      });

      const hiddenControlPlane = peers.length - visible.length;
      const header = hiddenControlPlane > 0
        ? `peers on ${slug} (${sorted.length}, ${hiddenControlPlane} control-plane hidden — use --all)`
        : `peers on ${slug} (${sorted.length})`;
      render.section(header);

      if (sorted.length === 0) {
        render.info(dim("  (no peers connected)"));
        continue;
      }

      for (const p of sorted) {
        const statusDot = p.status === "working" ? yellow("●") : green("●");
        const name = bold(p.displayName);
        const meta: string[] = [];
        if (p.peerType) meta.push(p.peerType);
        if (p.channel) meta.push(p.channel);
        if (p.model) meta.push(p.model);
        const metaStr = meta.length ? dim(` (${meta.join(", ")})`) : "";
        const summary = p.summary ? dim(`  — ${p.summary}`) : "";
        const pubkeyTag = dim(` · ${p.pubkey.slice(0, 16)}…`);
        // Short sessionId tag — appears for sibling sessions of the same
        // member that would otherwise be visually identical (same name,
        // same cwd, only the truncated pubkey on the right differs).
        const sidTag = p.sessionId
          ? dim(` · sid:${p.sessionId.slice(0, 8)}`)
          : "";
        const selfTag = p.isThisSession
          ? dim(" ") + yellow("(this session)")
          : p.isSelf
            ? dim(" ") + yellow("(your other session)")
            : "";

        // Inline tags ("role:lead [@flexicar:reviewer, @oncall]") so the
        // first thing the user sees beside the name is the access /
        // affiliation context. Empty role + empty groups → omit the
        // bracket entirely (the dim summary line below carries the
        // explicit "(no role / no groups)" so JSON output is unaffected
        // and screen readers don't get spammed with literal "no").
        const inlineTags: string[] = [];
        const peerRole = p.profile?.role?.trim();
        if (peerRole) inlineTags.push(`role:${peerRole}`);
        if (p.groups.length) {
          inlineTags.push(
            ...p.groups.map((g) => `@${g.name}${g.role ? `:${g.role}` : ""}`),
          );
        }
        const tagsStr = inlineTags.length ? " [" + inlineTags.join(", ") + "]" : "";

        render.info(
          `${statusDot} ${name}${selfTag}${tagsStr}${metaStr}${pubkeyTag}${sidTag}${summary}`,
        );

        // Second line: cwd + an explicit role/groups footer when both
        // are absent. Surfacing the absence is important — the previous
        // renderer hid it, so users couldn't tell "no role set" from
        // "the cli isn't showing roles".
        if (p.cwd) render.info(dim(`   cwd: ${p.cwd}`));
        if (!peerRole && p.groups.length === 0) {
          render.info(dim("   role: (none)  groups: (none)"));
        }
      }
    } catch (e) {
      render.err(`${slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (wantsJson) {
    process.stdout.write(
      JSON.stringify(slugs.length === 1 ? allJson[0]?.peers : allJson, null, 2) + "\n",
    );
  }
}
