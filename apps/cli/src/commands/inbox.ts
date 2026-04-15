/**
 * `claudemesh inbox` — read pending peer messages.
 *
 * Connects, waits briefly for push delivery, drains the buffer, prints.
 * Works best when message-mode is "inbox" or "off" (messages held at broker).
 */

import { withMesh } from "./connect.js";
import type { InboundPush } from "~/services/broker/facade.js";
import { render } from "~/ui/render.js";
import { bold, dim } from "~/ui/styles.js";

export interface InboxFlags {
  mesh?: string;
  json?: boolean;
  wait?: number;
}

function formatMessage(msg: InboundPush): string {
  const text = msg.plaintext ?? `[encrypted: ${msg.ciphertext.slice(0, 32)}…]`;
  const from = msg.senderPubkey.slice(0, 8);
  const time = new Date(msg.createdAt).toLocaleTimeString();
  const kindTag = msg.kind === "direct" ? "→ direct" : msg.kind;
  return `  ${bold(from)} ${dim(`[${kindTag}] ${time}`)}\n  ${text}`;
}

export async function runInbox(flags: InboxFlags): Promise<void> {
  const waitMs = (flags.wait ?? 1) * 1000;

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client, mesh) => {
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    const messages = client.drainPushBuffer();

    if (flags.json) {
      process.stdout.write(JSON.stringify(messages, null, 2) + "\n");
      return;
    }

    if (messages.length === 0) {
      render.info(dim(`No messages on mesh "${mesh.slug}".`));
      return;
    }

    render.section(`inbox — ${mesh.slug} (${messages.length} message${messages.length === 1 ? "" : "s"})`);
    for (const msg of messages) {
      process.stdout.write(formatMessage(msg) + "\n\n");
    }
  });
}
