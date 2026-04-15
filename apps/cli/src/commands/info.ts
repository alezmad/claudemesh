/**
 * `claudemesh info` — show mesh overview: slug, broker URL, peer count, state count.
 *
 * Useful for AI agents to orient themselves in a mesh via bash.
 */

import { withMesh } from "./connect.js";
import { readConfig } from "~/services/config/facade.js";
import { render } from "~/ui/render.js";

export interface InfoFlags {
  mesh?: string;
  json?: boolean;
}

export async function runInfo(flags: InfoFlags): Promise<void> {
  const config = readConfig();

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
      process.stdout.write(JSON.stringify(output, null, 2) + "\n");
      return;
    }

    render.section(`${mesh.slug} · ${mesh.brokerUrl}`);
    render.kv([
      ["mesh", mesh.meshId],
      ["member", mesh.memberId],
      ["peers", `${peers.length} connected`],
      ["state", `${state.length} keys`],
    ]);
    if (brokerInfo && typeof brokerInfo === "object") {
      const extras: Array<[string, string]> = [];
      for (const [k, v] of Object.entries(brokerInfo)) {
        if (["slug", "meshId", "brokerUrl"].includes(k)) continue;
        extras.push([k, JSON.stringify(v)]);
      }
      if (extras.length) render.kv(extras);
    }
  });
}
