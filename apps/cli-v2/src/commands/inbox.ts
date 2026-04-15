/**
 * `claudemesh inbox` — read pending peer messages.
 *
 * Connects, waits briefly for push delivery, drains the buffer, prints.
 * Works best when message-mode is "inbox" or "off" (messages held at broker).
 */

import { withMesh } from "./connect.js";
import type { InboundPush } from "~/services/broker/facade.js";

export interface InboxFlags {
  mesh?: string;
  json?: boolean;
  wait?: number;
}

function formatMessage(msg: InboundPush, useColor: boolean): string {
  const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[22m` : s);

  const text = msg.plaintext ?? `[encrypted: ${msg.ciphertext.slice(0, 32)}…]`;
  const from = msg.senderPubkey.slice(0, 8);
  const time = new Date(msg.createdAt).toLocaleTimeString();
  const kindTag = msg.kind === "direct" ? "→ direct" : msg.kind;

  return `  ${bold(from)} ${dim(`[${kindTag}] ${time}`)}\n  ${text}`;
}

export async function runInbox(flags: InboxFlags): Promise<void> {
  const useColor =
    !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[22m` : s);

  const waitMs = (flags.wait ?? 1) * 1000;

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client, mesh) => {
    // Wait briefly for broker to push any held messages.
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));

    const messages = client.drainPushBuffer();

    if (flags.json) {
      console.log(JSON.stringify(messages, null, 2));
      return;
    }

    if (messages.length === 0) {
      console.log(dim(`No messages on mesh "${mesh.slug}".`));
      return;
    }

    console.log(bold(`Inbox — ${mesh.slug}`) + dim(` (${messages.length} message${messages.length === 1 ? "" : "s"})`));
    console.log("");
    for (const msg of messages) {
      console.log(formatMessage(msg, useColor));
      console.log("");
    }
  });
}
