/**
 * `claudemesh info` — show mesh overview: slug, broker URL, peer count, state count.
 *
 * Useful for AI agents to orient themselves in a mesh via bash.
 */

import { withMesh } from "./connect";
import { loadConfig } from "../state/config";

export interface InfoFlags {
  mesh?: string;
  json?: boolean;
}

export async function runInfo(flags: InfoFlags): Promise<void> {
  const useColor =
    !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[22m` : s);

  const config = loadConfig();

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client, mesh) => {
    const [brokerInfo, peers, state] = await Promise.all([
      client.meshInfo(),
      client.listPeers(),
      client.listState(),
    ]);

    const output = {
      slug: mesh.slug,
      meshId: mesh.meshId,
      memberId: mesh.memberId,
      brokerUrl: mesh.brokerUrl,
      displayName: config.displayName ?? null,
      peerCount: peers.length,
      stateCount: state.length,
      ...(brokerInfo ?? {}),
    };

    if (flags.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log(bold(mesh.slug) + dim(` · ${mesh.brokerUrl}`));
    console.log(dim(`  mesh:   ${mesh.meshId}`));
    console.log(dim(`  member: ${mesh.memberId}`));
    console.log(`  peers:  ${peers.length} connected`);
    console.log(`  state:  ${state.length} keys`);
    if (brokerInfo && typeof brokerInfo === "object") {
      for (const [k, v] of Object.entries(brokerInfo)) {
        if (["slug", "meshId", "brokerUrl"].includes(k)) continue;
        console.log(dim(`  ${k}: ${JSON.stringify(v)}`));
      }
    }
  });
}
