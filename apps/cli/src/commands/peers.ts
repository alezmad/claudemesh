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
}

interface PeerRecord {
  pubkey: string;
  /** Stable member pubkey (independent of session). When sender shares
   * this with a peer, they're talking to the same person across all
   * their open sessions. */
  memberPubkey?: string;
  displayName: string;
  status?: string;
  summary?: string;
  groups: Array<{ name: string; role?: string }>;
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

  // Daemon path — preferred when running. Same routing pattern as send.ts:
  // ~1 ms IPC round-trip; broker WS already warm in the daemon. The
  // lifecycle helper inside tryListPeersViaDaemon auto-spawns the
  // daemon if it's down and probes it for liveness — no separate bridge
  // tier is needed any more (1.28.0).
  try {
    const { tryListPeersViaDaemon } = await import("~/services/bridge/daemon-route.js");
    const dr = await tryListPeersViaDaemon();
    if (dr !== null) {
      return dr.map((p) => annotateSelf(p as PeerRecord, selfMemberPubkey, null));
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
  return { ...peer, isSelf, isThisSession };
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

      if (wantsJson) {
        const projected = fieldList
          ? peers.map((p) => projectFields(p, fieldList))
          : peers;
        allJson.push({ mesh: slug, peers: projected });
        continue;
      }

      render.section(`peers on ${slug} (${peers.length})`);

      if (peers.length === 0) {
        render.info(dim("  (no peers connected)"));
        continue;
      }

      for (const p of peers) {
        const statusDot = p.status === "working" ? yellow("●") : green("●");
        const name = bold(p.displayName);
        const meta: string[] = [];
        if (p.peerType) meta.push(p.peerType);
        if (p.channel) meta.push(p.channel);
        if (p.model) meta.push(p.model);
        const metaStr = meta.length ? dim(` (${meta.join(", ")})`) : "";
        const summary = p.summary ? dim(`  — ${p.summary}`) : "";
        const pubkeyTag = dim(` · ${p.pubkey.slice(0, 16)}…`);
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
          `${statusDot} ${name}${selfTag}${tagsStr}${metaStr}${pubkeyTag}${summary}`,
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
