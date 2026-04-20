/**
 * `claudemesh disconnect` — soft disconnect (session reset, auto-reconnects).
 * `claudemesh kick`       — hard kick (session ends, no auto-reconnect).
 *
 *   claudemesh disconnect <peer>          # nudge, reconnects in seconds
 *   claudemesh kick <peer>                # stop session, user runs claudemesh to rejoin
 *   claudemesh kick --stale 30m           # kick peers idle > 30m
 *   claudemesh kick --all                 # kick everyone except yourself
 *
 * Ban (permanent, revokes membership) is in ban.ts.
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

function buildPayload(
  kind: "disconnect" | "kick",
  target: string | undefined,
  opts: { stale?: string; all?: boolean },
): Record<string, unknown> | { error: string } {
  if (opts.all) return { type: kind, all: true };
  if (opts.stale) {
    const ms = parseStaleMs(opts.stale);
    if (!ms) return { error: `Invalid stale duration: "${opts.stale}". Use e.g. 30m, 1h, 300s.` };
    return { type: kind, stale: ms };
  }
  if (target) return { type: kind, target };
  return { error: `Usage: claudemesh ${kind} <peer> | --stale 30m | --all` };
}

export async function runDisconnect(
  target: string | undefined,
  opts: { mesh?: string; stale?: string; all?: boolean } = {},
): Promise<number> {
  const config = readConfig();
  const meshSlug = opts.mesh ?? config.meshes[0]?.slug;
  if (!meshSlug) { render.err("No mesh joined."); return EXIT.NOT_FOUND; }

  const built = buildPayload("disconnect", target, opts);
  if ("error" in built) { render.err(String(built.error)); return EXIT.INVALID_ARGS; }

  return await withMesh({ meshSlug }, async (client) => {
    const result = await client.sendAndWait(built as Record<string, unknown>) as { affected?: string[]; kicked?: string[] };
    const peers = result?.affected ?? result?.kicked ?? [];
    if (peers.length === 0) render.info("No peers matched.");
    else {
      render.ok(`Disconnected ${peers.length} peer(s): ${peers.join(", ")}`);
      render.hint("They will auto-reconnect within seconds. For a session-ending kick, use `claudemesh kick`.");
    }
    return EXIT.SUCCESS;
  });
}

export async function runKick(
  target: string | undefined,
  opts: { mesh?: string; stale?: string; all?: boolean } = {},
): Promise<number> {
  const config = readConfig();
  const meshSlug = opts.mesh ?? config.meshes[0]?.slug;
  if (!meshSlug) { render.err("No mesh joined."); return EXIT.NOT_FOUND; }

  const built = buildPayload("kick", target, opts);
  if ("error" in built) { render.err(String(built.error)); return EXIT.INVALID_ARGS; }

  return await withMesh({ meshSlug }, async (client) => {
    const result = await client.sendAndWait(built as Record<string, unknown>) as { affected?: string[]; kicked?: string[] };
    const peers = result?.affected ?? result?.kicked ?? [];
    if (peers.length === 0) render.info("No peers matched.");
    else {
      render.ok(`Kicked ${peers.length} peer(s): ${peers.join(", ")}`);
      render.hint("Their Claude Code session ended. They can rejoin anytime by running `claudemesh`.");
    }
    return EXIT.SUCCESS;
  });
}
