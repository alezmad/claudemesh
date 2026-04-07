/**
 * `claudemesh send <to> <message>` — send a message to a peer or group.
 *
 * <to> can be:
 *   - a display name  ("Mou")
 *   - a pubkey hex    ("abc123...")
 *   - @group          ("@flexicar")
 *   - *               (broadcast to all)
 */

import { withMesh } from "./connect";
import type { Priority } from "../ws/client";

export interface SendFlags {
  mesh?: string;
  priority?: string;
}

export async function runSend(flags: SendFlags, to: string, message: string): Promise<void> {
  const priority: Priority =
    flags.priority === "now" ? "now"
    : flags.priority === "low" ? "low"
    : "next";

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    // Resolve display name → pubkey for direct messages.
    // If `to` starts with @, *, or looks like a hex pubkey, use as-is.
    let targetSpec = to;
    if (!to.startsWith("@") && to !== "*" && !/^[0-9a-f]{64}$/i.test(to)) {
      // Treat as display name — look up pubkey via list_peers.
      const peers = await client.listPeers();
      const match = peers.find(
        (p) => p.displayName.toLowerCase() === to.toLowerCase(),
      );
      if (!match) {
        const names = peers.map((p) => p.displayName).join(", ");
        console.error(`Peer "${to}" not found. Online: ${names || "(none)"}`);
        process.exit(1);
      }
      targetSpec = match.pubkey;
    }

    const result = await client.send(targetSpec, message, priority);
    if (result.ok) {
      console.log(`✓ Sent to ${to}${result.messageId ? ` (${result.messageId.slice(0, 8)})` : ""}`);
    } else {
      console.error(`✗ Send failed: ${result.error ?? "unknown error"}`);
      process.exit(1);
    }
  });
}
