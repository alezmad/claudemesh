/**
 * `claudemesh peers` — list connected peers in the mesh.
 *
 * Shows all meshes by default, or filter with --mesh.
 */

import { withMesh } from "./connect.js";
import { readConfig } from "~/services/config/facade.js";

export interface PeersFlags {
  mesh?: string;
  json?: boolean;
}

export async function runPeers(flags: PeersFlags): Promise<void> {
  const useColor =
    !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[22m` : s);
  const green = (s: string) => (useColor ? `\x1b[32m${s}\x1b[39m` : s);
  const yellow = (s: string) => (useColor ? `\x1b[33m${s}\x1b[39m` : s);

  const config = readConfig();

  // If --mesh specified, show only that one. Otherwise show all.
  const slugs = flags.mesh
    ? [flags.mesh]
    : config.meshes.map(m => m.slug);

  if (slugs.length === 0) {
    console.error("No meshes joined. Run `claudemesh join <url>` first.");
    process.exit(1);
  }

  const allJson: Array<{ mesh: string; peers: unknown[] }> = [];

  for (const slug of slugs) {
    try {
      await withMesh({ meshSlug: slug }, async (client, mesh) => {
        const peers = await client.listPeers();

        if (flags.json) {
          allJson.push({ mesh: mesh.slug, peers });
          return;
        }

        console.log(bold(`Peers on ${mesh.slug}`) + dim(` (${peers.length})`));
        console.log("");

        if (peers.length === 0) {
          console.log(dim("  No peers connected."));
        } else {
          for (const p of peers) {
            const groups = p.groups.length
              ? " [" + p.groups.map((g: { name: string; role?: string }) =>
                  `@${g.name}${g.role ? `:${g.role}` : ""}`).join(", ") + "]"
              : "";
            const statusIcon = p.status === "working" ? yellow("●") : green("●");
            const name = bold(p.displayName);
            const meta: string[] = [];
            if (p.peerType) meta.push(p.peerType);
            if (p.channel) meta.push(p.channel);
            if (p.model) meta.push(p.model);
            const metaStr = meta.length ? dim(` (${meta.join(", ")})`) : "";
            const cwdStr = p.cwd ? dim(`  cwd: ${p.cwd}`) : "";
            const summary = p.summary ? dim(`  ${p.summary}`) : "";
            console.log(`  ${statusIcon} ${name}${groups}${metaStr}${summary}`);
            if (cwdStr) console.log(`    ${cwdStr}`);
          }
        }
        console.log("");
      });
    } catch (e) {
      console.error(dim(`  Could not connect to ${slug}: ${e instanceof Error ? e.message : String(e)}`));
      console.log("");
    }
  }

  if (flags.json) {
    console.log(JSON.stringify(slugs.length === 1 ? allJson[0]?.peers : allJson, null, 2));
  }
}
