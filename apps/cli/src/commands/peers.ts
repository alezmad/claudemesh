/**
 * `claudemesh peers` — list connected peers in the mesh.
 *
 * Connects, fetches the peer list, prints it, disconnects.
 */

import { withMesh } from "./connect";

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

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client, mesh) => {
    const peers = await client.listPeers();

    if (flags.json) {
      console.log(JSON.stringify(peers, null, 2));
      return;
    }

    if (peers.length === 0) {
      console.log(dim(`No peers connected on mesh "${mesh.slug}".`));
      return;
    }

    console.log(bold(`Peers on ${mesh.slug}`) + dim(` (${peers.length})`));
    console.log("");
    for (const p of peers) {
      const groups = p.groups.length
        ? " [" + p.groups.map((g) => `@${g.name}${g.role ? `:${g.role}` : ""}`).join(", ") + "]"
        : "";
      const statusIcon = p.status === "working" ? yellow("●") : green("●");
      const name = bold(p.displayName);
      const summary = p.summary ? dim(`  ${p.summary}`) : "";
      console.log(`  ${statusIcon} ${name}${groups}${summary}`);
    }
    console.log("");
  });
}
