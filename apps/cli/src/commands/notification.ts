/**
 * `claudemesh notification list` — recent @-mentions of the viewer
 * across topics in the chosen mesh. Server-side regex match over the
 * v0.2.0 plaintext-base64 ciphertext; the v0.3.0 per-topic encryption
 * cut will move this to a notification table populated at write time.
 */

import { withRestKey } from "~/services/api/with-rest-key.js";
import { request } from "~/services/api/client.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export interface NotificationFlags {
  mesh?: string;
  json?: boolean;
  since?: string;
}

interface NotificationRow {
  id: string;
  topicId: string;
  topicName: string;
  senderName: string;
  senderPubkey: string;
  ciphertext: string;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: NotificationRow[];
  since: string;
  mentionedAs: string;
}

function decodeCiphertext(b64: string): string {
  try {
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return "[decode failed]";
  }
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

export async function runNotificationList(flags: NotificationFlags): Promise<number> {
  return withRestKey(
    { meshSlug: flags.mesh ?? null, purpose: "notifications" },
    async ({ secret }) => {
      const qs = flags.since ? `?since=${encodeURIComponent(flags.since)}` : "";
      const result = await request<NotificationsResponse>({
        path: `/api/v1/notifications${qs}`,
        token: secret,
      });

      if (flags.json) {
        const decoded = result.notifications.map((n) => ({
          ...n,
          message: decodeCiphertext(n.ciphertext),
        }));
        console.log(JSON.stringify({ ...result, notifications: decoded }, null, 2));
        return EXIT.SUCCESS;
      }

      if (result.notifications.length === 0) {
        render.info(
          dim(`no mentions of @${result.mentionedAs} since ${result.since}.`),
        );
        return EXIT.SUCCESS;
      }

      render.section(
        `mentions of @${bold(result.mentionedAs)} (${result.notifications.length})`,
      );
      for (const n of result.notifications) {
        const when = fmtRelative(n.createdAt);
        const msg = decodeCiphertext(n.ciphertext).replace(/\s+/g, " ").trim();
        const snippet = msg.length > 100 ? msg.slice(0, 97) + "…" : msg;
        process.stdout.write(
          `  ${clay("#" + n.topicName)}  ${dim(when)}  ${bold(n.senderName)}\n`,
        );
        process.stdout.write(`    ${snippet}\n`);
      }
      return EXIT.SUCCESS;
    },
  );
}
