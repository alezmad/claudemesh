/**
 * Short-lived WS connection helper for CLI commands (peers, send, inbox, state).
 *
 * Opens a connection to one mesh, runs a callback, then closes cleanly.
 * The caller never deals with connect/close lifecycle.
 */

import { hostname } from "node:os";
import { BrokerClient } from "../ws/client";
import { loadConfig } from "../state/config";
import type { JoinedMesh } from "../state/config";

export interface ConnectOpts {
  /** Mesh slug to connect to. Auto-selects if only one mesh joined. */
  meshSlug?: string | null;
  /** Display name for this session. Defaults to hostname-pid. */
  displayName?: string;
}

export async function withMesh<T>(
  opts: ConnectOpts,
  fn: (client: BrokerClient, mesh: JoinedMesh) => Promise<T>,
): Promise<T> {
  const config = loadConfig();
  if (config.meshes.length === 0) {
    console.error("No meshes joined. Run `claudemesh join <url>` first.");
    process.exit(1);
  }

  let mesh: JoinedMesh;
  if (opts.meshSlug) {
    const found = config.meshes.find((m) => m.slug === opts.meshSlug);
    if (!found) {
      console.error(
        `Mesh "${opts.meshSlug}" not found. Joined: ${config.meshes.map((m) => m.slug).join(", ")}`,
      );
      process.exit(1);
    }
    mesh = found;
  } else if (config.meshes.length === 1) {
    mesh = config.meshes[0]!;
  } else {
    console.error(
      `Multiple meshes joined. Specify one with --mesh <slug>.\nJoined: ${config.meshes.map((m) => m.slug).join(", ")}`,
    );
    process.exit(1);
  }

  const displayName = opts.displayName ?? config.displayName ?? `${hostname()}-${process.pid}`;
  const client = new BrokerClient(mesh, { displayName });

  try {
    await client.connect();
    const result = await fn(client, mesh);
    return result;
  } finally {
    client.close();
  }
}
