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
import { tryBridge } from "~/services/bridge/client.js";
import { render } from "~/ui/render.js";
import { bold, dim, green, yellow } from "~/ui/styles.js";

export interface PeersFlags {
  mesh?: string;
  /** `true`/`undefined` = full record; comma-separated string = field projection. */
  json?: boolean | string;
}

interface PeerRecord {
  pubkey: string;
  displayName: string;
  status?: string;
  summary?: string;
  groups: Array<{ name: string; role?: string }>;
  peerType?: string;
  channel?: string;
  model?: string;
  cwd?: string;
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
  // Try warm path first.
  const bridged = await tryBridge(slug, "peers");
  if (bridged && bridged.ok) {
    return bridged.result as PeerRecord[];
  }
  // Cold path — open our own WS.
  let result: PeerRecord[] = [];
  await withMesh({ meshSlug: slug }, async (client) => {
    const all = await client.listPeers();
    const selfPubkey = client.getSessionPubkey();
    result = (selfPubkey ? all.filter((p) => p.pubkey !== selfPubkey) : all) as unknown as PeerRecord[];
  });
  return result;
}

export async function runPeers(flags: PeersFlags): Promise<void> {
  const config = readConfig();
  const slugs = flags.mesh ? [flags.mesh] : config.meshes.map((m) => m.slug);

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
        const groups = p.groups.length
          ? " [" +
            p.groups
              .map((g) => `@${g.name}${g.role ? `:${g.role}` : ""}`)
              .join(", ") +
            "]"
          : "";
        const statusDot = p.status === "working" ? yellow("●") : green("●");
        const name = bold(p.displayName);
        const meta: string[] = [];
        if (p.peerType) meta.push(p.peerType);
        if (p.channel) meta.push(p.channel);
        if (p.model) meta.push(p.model);
        const metaStr = meta.length ? dim(` (${meta.join(", ")})`) : "";
        const summary = p.summary ? dim(`  — ${p.summary}`) : "";
        const pubkeyTag = dim(` · ${p.pubkey.slice(0, 16)}…`);
        render.info(`${statusDot} ${name}${groups}${metaStr}${pubkeyTag}${summary}`);
        if (p.cwd) render.info(dim(`   cwd: ${p.cwd}`));
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
