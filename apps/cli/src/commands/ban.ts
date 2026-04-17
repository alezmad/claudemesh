/**
 * `claudemesh ban <peer>`   — kick + permanently revoke member (can't reconnect)
 * `claudemesh unban <peer>` — clear revocation, peer can rejoin
 * `claudemesh bans`         — list banned members
 */

import { withMesh } from "./connect.js";
import { readConfig } from "~/services/config/facade.js";
import { render } from "~/ui/render.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function runBan(
  target: string | undefined,
  opts: { mesh?: string } = {},
): Promise<number> {
  if (!target) { render.err("Usage: claudemesh ban <peer-name-or-pubkey>"); return EXIT.INVALID_ARGS; }
  const config = readConfig();
  const meshSlug = opts.mesh ?? config.meshes[0]?.slug;
  if (!meshSlug) { render.err("No mesh joined."); return EXIT.NOT_FOUND; }

  return await withMesh({ meshSlug }, async (client) => {
    const result = await client.sendAndWait({ type: "ban", target }) as { banned?: string; error?: string; message?: string; code?: string };
    if (result?.banned) {
      render.ok(`Banned ${result.banned} from ${meshSlug}. They cannot reconnect until unbanned.`);
      render.hint(`Undo: claudemesh unban ${result.banned} --mesh ${meshSlug}`);
    } else {
      render.err(result?.message ?? result?.error ?? result?.code ?? "ban failed");
    }
    return result?.banned ? EXIT.SUCCESS : EXIT.INTERNAL_ERROR;
  });
}

export async function runUnban(
  target: string | undefined,
  opts: { mesh?: string } = {},
): Promise<number> {
  if (!target) { render.err("Usage: claudemesh unban <peer-name-or-pubkey>"); return EXIT.INVALID_ARGS; }
  const config = readConfig();
  const meshSlug = opts.mesh ?? config.meshes[0]?.slug;
  if (!meshSlug) { render.err("No mesh joined."); return EXIT.NOT_FOUND; }

  return await withMesh({ meshSlug }, async (client) => {
    const result = await client.sendAndWait({ type: "unban", target }) as { unbanned?: string; error?: string; message?: string; code?: string };
    if (result?.unbanned) {
      render.ok(`Unbanned ${result.unbanned} from ${meshSlug}. They can rejoin.`);
    } else {
      render.err(result?.message ?? result?.error ?? result?.code ?? "unban failed");
    }
    return result?.unbanned ? EXIT.SUCCESS : EXIT.INTERNAL_ERROR;
  });
}

export async function runBans(
  opts: { mesh?: string; json?: boolean } = {},
): Promise<number> {
  const config = readConfig();
  const meshSlug = opts.mesh ?? config.meshes[0]?.slug;
  if (!meshSlug) { render.err("No mesh joined."); return EXIT.NOT_FOUND; }

  return await withMesh({ meshSlug }, async (client) => {
    const result = await client.sendAndWait({ type: "list_bans" }) as { bans?: Array<{ name: string; pubkey: string; revokedAt: string }> };
    const bans = result?.bans ?? [];

    if (opts.json) {
      process.stdout.write(JSON.stringify(bans, null, 2) + "\n");
      return EXIT.SUCCESS;
    }

    if (bans.length === 0) {
      render.info("No banned members.");
      return EXIT.SUCCESS;
    }

    render.section(`banned members on ${meshSlug}`);
    for (const b of bans) {
      render.kv([[b.name, `${b.pubkey.slice(0, 16)}… · banned ${new Date(b.revokedAt).toLocaleDateString()}`]]);
    }
    return EXIT.SUCCESS;
  });
}
