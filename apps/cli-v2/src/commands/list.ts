/**
 * `claudemesh mesh list` — merged view of server + local meshes.
 */

import { readConfig, getConfigPath } from "~/services/config/facade.js";
import { getStoredToken } from "~/services/auth/facade.js";
import { request } from "~/services/api/facade.js";
import { URLS } from "~/constants/urls.js";
import { bold, dim, green, yellow, red } from "~/ui/styles.js";

const BROKER_HTTP = URLS.BROKER.replace("wss://", "https://").replace("ws://", "http://").replace("/ws", "");

interface ServerMesh {
  id: string;
  slug: string;
  name: string;
  role: string;
  is_owner: boolean;
  member_count: number;
  active_peers: number;
  joined_at: string;
}

export async function runList(): Promise<void> {
  const config = readConfig();
  const auth = getStoredToken();

  // Try to fetch from server
  let serverMeshes: ServerMesh[] = [];
  if (auth) {
    try {
      let userId = "";
      try {
        const payload = JSON.parse(Buffer.from(auth.session_token.split(".")[1]!, "base64url").toString()) as { sub?: string };
        userId = payload.sub ?? "";
      } catch {}

      if (userId) {
        const res = await request<{ meshes: ServerMesh[] }>({
          path: `/cli/meshes?user_id=${userId}`,
          baseUrl: BROKER_HTTP,
        });
        serverMeshes = res.meshes ?? [];
      }
    } catch {}
  }

  // Merge: server meshes + local-only meshes
  const localSlugs = new Set(config.meshes.map(m => m.slug));
  const serverSlugs = new Set(serverMeshes.map(m => m.slug));

  const allSlugs = new Set([...localSlugs, ...serverSlugs]);

  if (allSlugs.size === 0) {
    console.log("\n  No meshes yet.\n");
    console.log("  Create one:  claudemesh mesh create <name>");
    console.log("  Join one:    claudemesh mesh add <invite-url>\n");
    return;
  }

  console.log("\n  Your meshes:\n");

  for (const slug of allSlugs) {
    const local = config.meshes.find(m => m.slug === slug);
    const server = serverMeshes.find(m => m.slug === slug);

    const name = server?.name ?? local?.name ?? slug;
    const role = server?.role ?? "member";
    const isOwner = server?.is_owner ?? false;
    const roleLabel = isOwner ? "owner" : role;
    const memberCount = server?.member_count;
    const activePeers = server?.active_peers ?? 0;

    // Status indicator
    const inLocal = localSlugs.has(slug);
    const inServer = serverSlugs.has(slug);
    let status: string;
    let icon: string;

    if (inLocal && inServer) {
      icon = green("●");
      status = activePeers > 0 ? green(`${activePeers} online`) : dim("synced");
    } else if (inLocal && !inServer) {
      icon = yellow("●");
      status = yellow("local only");
    } else {
      icon = dim("○");
      status = dim("not added locally");
    }

    const memberInfo = memberCount ? dim(`${memberCount} member${memberCount !== 1 ? "s" : ""}`) : "";
    const parts = [roleLabel, memberInfo, status].filter(Boolean);

    console.log(`    ${icon} ${bold(name)}  ${dim(slug)}`);
    console.log(`      ${parts.join("  ·  ")}`);
  }

  console.log("");
  if (serverMeshes.some(m => !localSlugs.has(m.slug))) {
    console.log(dim("    ○ = server only — run `claudemesh mesh add` to use locally"));
  }
  console.log(dim(`    Config: ${getConfigPath()}`));
  console.log("");
}
