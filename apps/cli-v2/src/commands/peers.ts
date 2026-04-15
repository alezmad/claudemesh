/**
 * `claudemesh peers` — list connected peers in the mesh.
 *
 * Shows all meshes by default, or filter with --mesh.
 */

import { withMesh } from "./connect.js";
import { readConfig } from "~/services/config/facade.js";
import { render } from "~/ui/render.js";
import { bold, dim, green, yellow } from "~/ui/styles.js";

export interface PeersFlags {
  mesh?: string;
  json?: boolean;
}

export async function runPeers(flags: PeersFlags): Promise<void> {
  const config = readConfig();
  const slugs = flags.mesh ? [flags.mesh] : config.meshes.map((m) => m.slug);

  if (slugs.length === 0) {
    render.err("No meshes joined.");
    render.hint("claudemesh <invite-url>    # join + launch");
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

        render.section(`peers on ${mesh.slug} (${peers.length})`);

        if (peers.length === 0) {
          render.info(dim("  (no peers connected)"));
          return;
        }

        for (const p of peers) {
          const groups = p.groups.length
            ? " [" +
              p.groups
                .map((g: { name: string; role?: string }) => `@${g.name}${g.role ? `:${g.role}` : ""}`)
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
          render.info(`${statusDot} ${name}${groups}${metaStr}${summary}`);
          if (p.cwd) render.info(dim(`   cwd: ${p.cwd}`));
        }
      });
    } catch (e) {
      render.err(`${slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(slugs.length === 1 ? allJson[0]?.peers : allJson, null, 2) + "\n");
  }
}
