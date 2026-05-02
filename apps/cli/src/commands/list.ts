/**
 * `claudemesh mesh list` — merged view of server + local meshes.
 */

import { readConfig, getConfigPath } from "~/services/config/facade.js";
import { getStoredToken } from "~/services/auth/facade.js";
import { request } from "~/services/api/facade.js";
import { URLS } from "~/constants/urls.js";
import { bold, clay, dim, green, yellow } from "~/ui/styles.js";
import { render } from "~/ui/render.js";

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

  // Try to fetch from server. Broker authenticates via Bearer token.
  let serverMeshes: ServerMesh[] = [];
  if (auth) {
    try {
      const res = await request<{ meshes: ServerMesh[] }>({
        path: `/cli/meshes`,
        baseUrl: BROKER_HTTP,
        token: auth.session_token,
      });
      serverMeshes = res.meshes ?? [];
    } catch {}
  }

  // Merge: server meshes + local-only meshes
  const localSlugs = new Set(config.meshes.map(m => m.slug));
  const serverSlugs = new Set(serverMeshes.map(m => m.slug));

  const allSlugs = new Set([...localSlugs, ...serverSlugs]);

  if (allSlugs.size === 0) {
    render.section("no meshes yet");
    render.info(`${dim("create one:")}  ${bold("claudemesh create")} ${clay("<name>")}`);
    render.info(`${dim("join one:")}    ${bold("claudemesh")} ${clay("<invite-url>")}`);
    render.blank();
    return;
  }

  render.section(`your meshes (${allSlugs.size})`);

  for (const slug of allSlugs) {
    const local = config.meshes.find((m) => m.slug === slug);
    const server = serverMeshes.find((m) => m.slug === slug);

    const name = server?.name ?? local?.name ?? slug;
    const role = server?.role ?? "member";
    const isOwner = server?.is_owner ?? false;
    const roleLabel = isOwner ? clay("owner") : dim(role);
    const memberCount = server?.member_count;
    const activePeers = server?.active_peers ?? 0;

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

    process.stdout.write(`    ${icon} ${bold(name)}  ${dim(slug)}\n`);
    process.stdout.write(`      ${parts.join(dim("  ·  "))}\n`);
  }

  process.stdout.write("\n");
  if (serverMeshes.some((m) => !localSlugs.has(m.slug))) {
    render.hint(`${dim("○")}  = server only — run ${bold("claudemesh join")} to use locally`);
  }
  render.hint(`config: ${dim(getConfigPath())}`);
  render.blank();
}
