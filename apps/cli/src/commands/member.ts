/**
 * `claudemesh member list` — every (non-revoked) member of the chosen
 * mesh, decorated with online state. Distinct from `peer list`: peers
 * shows live WS sessions, members shows roster.
 */

import { withRestKey } from "~/services/api/with-rest-key.js";
import { request } from "~/services/api/client.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim, green, red, yellow } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export interface MemberFlags {
  mesh?: string;
  json?: boolean;
  /** Show only online members. */
  online?: boolean;
}

interface MemberRow {
  memberId: string;
  pubkey: string;
  displayName: string;
  role: string;
  isHuman: boolean;
  joinedAt: string;
  online: boolean;
  status: string;
  summary: string | null;
}

function statusGlyph(m: MemberRow): string {
  if (!m.online) return dim("○");
  if (m.status === "dnd") return red("●");
  if (m.status === "working") return yellow("●");
  return green("●");
}

export async function runMemberList(flags: MemberFlags): Promise<number> {
  return withRestKey(
    { meshSlug: flags.mesh ?? null, purpose: "members" },
    async ({ secret, meshSlug }) => {
      const result = await request<{ members: MemberRow[] }>({
        path: "/api/v1/members",
        token: secret,
      });

      const filtered = flags.online
        ? result.members.filter((m) => m.online)
        : result.members;

      if (flags.json) {
        console.log(JSON.stringify({ members: filtered }, null, 2));
        return EXIT.SUCCESS;
      }

      if (filtered.length === 0) {
        render.info(
          dim(flags.online ? `no online members in ${meshSlug}.` : `no members in ${meshSlug}.`),
        );
        return EXIT.SUCCESS;
      }

      const onlineCount = result.members.filter((m) => m.online).length;
      render.section(
        `${clay(meshSlug)} members (${onlineCount}/${result.members.length} online)`,
      );
      for (const m of filtered) {
        const tag = m.isHuman ? dim("human") : dim("bot");
        const summary = m.summary ? ` — ${dim(m.summary)}` : "";
        process.stdout.write(
          `  ${statusGlyph(m)} ${bold(m.displayName)}  ${tag}  ${dim(m.role)}  ${dim(m.pubkey.slice(0, 8))}${summary}\n`,
        );
      }
      return EXIT.SUCCESS;
    },
  );
}
