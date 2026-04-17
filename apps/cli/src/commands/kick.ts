/**
 * `claudemesh kick` — disconnect peers from the mesh.
 *
 *   claudemesh kick <name>         kick one peer (can reconnect)
 *   claudemesh kick --stale 30m    kick idle peers (> 30 min no activity)
 *   claudemesh kick --all          kick everyone except yourself
 */

import { withMesh } from "./connect.js";
import { readConfig } from "~/services/config/facade.js";
import { render } from "~/ui/render.js";
import { EXIT } from "~/constants/exit-codes.js";

function parseStaleMs(input: string): number | null {
  const m = input.match(/^(\d+)(s|m|h)$/);
  if (!m) return null;
  const val = parseInt(m[1]!, 10);
  const unit = m[2]!;
  if (unit === "s") return val * 1000;
  if (unit === "m") return val * 60_000;
  if (unit === "h") return val * 3600_000;
  return null;
}

export async function runKick(
  target: string | undefined,
  opts: { mesh?: string; stale?: string; all?: boolean } = {},
): Promise<number> {
  const config = readConfig();
  const meshSlug = opts.mesh ?? config.meshes[0]?.slug;
  if (!meshSlug) { render.err("No mesh joined."); return EXIT.NOT_FOUND; }

  return await withMesh({ meshSlug }, async (client) => {
    let payload: Record<string, unknown>;

    if (opts.all) {
      payload = { type: "kick", all: true };
    } else if (opts.stale) {
      const ms = parseStaleMs(opts.stale);
      if (!ms) { render.err(`Invalid stale duration: "${opts.stale}". Use e.g. 30m, 1h, 300s.`); return EXIT.INVALID_ARGS; }
      payload = { type: "kick", stale: ms };
    } else if (target) {
      payload = { type: "kick", target };
    } else {
      render.err("Usage: claudemesh kick <peer> | --stale 30m | --all");
      return EXIT.INVALID_ARGS;
    }

    const result = await client.sendAndWait(payload) as { kicked?: string[] };
    const kicked = result?.kicked ?? [];

    if (kicked.length === 0) {
      render.info("No peers matched.");
    } else {
      render.ok(`Kicked ${kicked.length} peer(s): ${kicked.join(", ")}`);
    }
    return EXIT.SUCCESS;
  });
}
