/**
 * `claudemesh me` — cross-mesh workspace overview for the caller's user.
 *
 * Calls GET /v1/me/workspace which aggregates over every mesh the
 * authenticated user belongs to: peer count, online count, topic count,
 * unread @-mention count per mesh + global totals.
 *
 * Auth: mints a temporary read-scoped REST apikey on whichever mesh
 * the user has joined first (any mesh works — the endpoint resolves
 * to the issuing user, not the apikey's mesh).
 *
 * v0.4.0 substrate. Future verbs (`me topics`, `me notifications`,
 * `me activity`, `me search`) layer on top of similar aggregating
 * endpoints once they ship.
 */

import { withRestKey } from "~/services/api/with-rest-key.js";
import { request } from "~/services/api/client.js";
import { render } from "~/ui/render.js";
import { bold, clay, cyan, dim, green, yellow } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

interface WorkspaceMesh {
  meshId: string;
  slug: string;
  name: string;
  memberId: string;
  myRole: string;
  joinedAt: string;
  peers: number;
  online: number;
  topics: number;
  unreadMentions: number;
}

interface WorkspaceResponse {
  userId: string;
  meshes: WorkspaceMesh[];
  totals: {
    meshes: number;
    peers: number;
    online: number;
    topics: number;
    unreadMentions: number;
  };
}

export interface MeFlags {
  mesh?: string;
  json?: boolean;
}

export async function runMe(flags: MeFlags): Promise<number> {
  return withRestKey(
    {
      meshSlug: flags.mesh ?? null,
      purpose: "workspace-overview",
      capabilities: ["read"],
    },
    async ({ secret }) => {
      const ws = await request<WorkspaceResponse>({
        path: "/api/v1/me/workspace",
        token: secret,
      });

      if (flags.json) {
        console.log(JSON.stringify(ws, null, 2));
        return EXIT.SUCCESS;
      }

      render.section(
        `${clay("workspace")} — ${bold(ws.userId.slice(0, 8))}  ${dim(
          `· ${ws.totals.meshes} mesh${ws.totals.meshes === 1 ? "" : "es"}`,
        )}`,
      );

      const totalsLine = [
        `${green(String(ws.totals.online))}/${ws.totals.peers} online`,
        `${ws.totals.topics} topic${ws.totals.topics === 1 ? "" : "s"}`,
        ws.totals.unreadMentions > 0
          ? yellow(`${ws.totals.unreadMentions} unread @you`)
          : dim("0 unread @you"),
      ].join(dim(" · "));
      process.stdout.write("  " + totalsLine + "\n\n");

      if (ws.meshes.length === 0) {
        process.stdout.write(
          dim("  no meshes joined — run `claudemesh new` or accept an invite\n"),
        );
        return EXIT.SUCCESS;
      }

      const slugWidth = Math.max(...ws.meshes.map((m) => m.slug.length), 8);
      for (const m of ws.meshes) {
        const slug = cyan(m.slug.padEnd(slugWidth));
        const peers = `${m.online}/${m.peers}`;
        const role = dim(m.myRole);
        const unread =
          m.unreadMentions > 0
            ? "  " + yellow(`${m.unreadMentions} @you`)
            : "";
        process.stdout.write(
          `  ${slug}  ${peers.padStart(5)} online  ${dim(
            String(m.topics).padStart(2) + " topics",
          )}  ${role}${unread}\n`,
        );
      }
      return EXIT.SUCCESS;
    },
  );
}
