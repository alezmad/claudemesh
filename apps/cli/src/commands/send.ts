/**
 * `claudemesh send <to> <message>` — send a message to a peer or group.
 *
 * <to> can be:
 *   - a display name  ("Mou")
 *   - a pubkey hex    ("abc123...")
 *   - @group          ("@flexicar")
 *   - *               (broadcast to all)
 *
 * Warm path: dials the per-mesh bridge socket the push-pipe holds open
 * (~5ms). Cold path: opens its own WS via `withMesh` (~300-700ms).
 */

import { withMesh } from "./connect.js";
import { readConfig } from "~/services/config/facade.js";
import { tryBridge } from "~/services/bridge/client.js";
import type { Priority } from "~/services/broker/facade.js";
import { render } from "~/ui/render.js";
import { dim } from "~/ui/styles.js";

export interface SendFlags {
  mesh?: string;
  priority?: string;
  json?: boolean;
}

export async function runSend(flags: SendFlags, to: string, message: string): Promise<void> {
  if (!to || !message) {
    render.err("Usage: claudemesh send <to> <message>");
    process.exit(1);
  }

  const priority: Priority =
    flags.priority === "now" ? "now"
    : flags.priority === "low" ? "low"
    : "next";

  // Resolve which mesh to use. With --mesh, target it directly.
  // Without, use first joined mesh — same default as withMesh.
  const config = readConfig();
  const meshSlug =
    flags.mesh ??
    (config.meshes.length === 1 ? config.meshes[0]!.slug : null);

  // Warm path — only when mesh is unambiguous.
  if (meshSlug) {
    const bridged = await tryBridge(meshSlug, "send", { to, message, priority });
    if (bridged !== null) {
      if (bridged.ok) {
        const r = bridged.result as { messageId?: string };
        if (flags.json) {
          console.log(JSON.stringify({ ok: true, messageId: r.messageId, target: to }));
        } else {
          render.ok(`sent to ${to}`, r.messageId ? dim(r.messageId.slice(0, 8)) : undefined);
        }
        return;
      }
      // Bridge reachable but op failed — surface error, don't fall through.
      if (flags.json) {
        console.log(JSON.stringify({ ok: false, error: bridged.error }));
      } else {
        render.err(`send failed: ${bridged.error}`);
      }
      process.exit(1);
    }
    // bridged === null → bridge unreachable, fall through to cold path
  }

  // Cold path
  await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    let targetSpec = to;
    if (to.startsWith("#") && !/^#[0-9a-z_-]{20,}$/i.test(to)) {
      // Topic by name → resolve to "#<topicId>" via topicList. The broker
      // wire format is "#<topicId>"; users type "#<name>" for ergonomics.
      const name = to.slice(1);
      const topics = await client.topicList();
      const match = topics.find((t) => t.name === name);
      if (!match) {
        const names = topics.map((t) => "#" + t.name).join(", ");
        render.err(`Topic "${to}" not found.`, `topics: ${names || "(none)"}`);
        process.exit(1);
      }
      targetSpec = "#" + match.id;
    } else if (!to.startsWith("@") && !to.startsWith("#") && to !== "*" && !/^[0-9a-f]{64}$/i.test(to)) {
      const peers = await client.listPeers();
      const match = peers.find(
        (p) => p.displayName.toLowerCase() === to.toLowerCase(),
      );
      if (!match) {
        const names = peers.map((p) => p.displayName).join(", ");
        render.err(`Peer "${to}" not found.`, `online: ${names || "(none)"}`);
        process.exit(1);
      }
      targetSpec = match.pubkey;
    }

    const result = await client.send(targetSpec, message, priority);
    if (result.ok) {
      if (flags.json) {
        console.log(JSON.stringify({ ok: true, messageId: result.messageId, target: to }));
      } else {
        render.ok(`sent to ${to}`, result.messageId ? dim(result.messageId.slice(0, 8)) : undefined);
      }
    } else {
      if (flags.json) {
        console.log(JSON.stringify({ ok: false, error: result.error ?? "unknown" }));
      } else {
        render.err(`send failed: ${result.error ?? "unknown error"}`);
      }
      process.exit(1);
    }
  });
}
