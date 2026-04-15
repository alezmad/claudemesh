/**
 * `claudemesh status-line` — one-line renderer for Claude Code's
 * `statusLine` setting.
 *
 * Must be FAST (Claude Code polls it between every turn) — zero network
 * I/O. Reads only local config + a peer-state cache maintained by the
 * MCP server (~/.claudemesh/peer-cache.json, updated on every
 * list_peers call).
 *
 * Output format:
 *   ◇ <mesh> · <online>/<total> peers · <you>
 * or:
 *   ◇ claudemesh (not joined)
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readConfig } from "~/services/config/facade.js";
import { EXIT } from "~/constants/exit-codes.js";

interface PeerCacheEntry {
  total: number;
  online: number;
  updatedAt: string;
  you?: string;
}

type PeerCache = Record<string, PeerCacheEntry>;

export async function runStatusLine(): Promise<number> {
  try {
    const config = readConfig();
    if (config.meshes.length === 0) {
      process.stdout.write("◇ claudemesh (not joined)");
      return EXIT.SUCCESS;
    }

    const cachePath = join(homedir(), ".claudemesh", "peer-cache.json");
    let cache: PeerCache = {};
    if (existsSync(cachePath)) {
      try {
        cache = JSON.parse(readFileSync(cachePath, "utf-8")) as PeerCache;
      } catch {
        // corrupt — ignore
      }
    }

    // Pick the most-recently-used mesh if multiple.
    const pick = config.meshes[0]!;
    const entry = cache[pick.slug];

    const age = entry ? Date.now() - new Date(entry.updatedAt).getTime() : Infinity;
    const fresh = age < 60_000; // < 1 min = live

    if (entry && fresh) {
      const you = entry.you ? ` · ${entry.you}` : "";
      process.stdout.write(`◇ ${pick.slug} · ${entry.online}/${entry.total} online${you}`);
    } else if (entry) {
      process.stdout.write(`◇ ${pick.slug} · ${entry.online}/${entry.total} (stale)`);
    } else {
      process.stdout.write(`◇ ${pick.slug} · idle`);
    }
    return EXIT.SUCCESS;
  } catch {
    // Never break the status line — just print nothing.
    return EXIT.SUCCESS;
  }
}
