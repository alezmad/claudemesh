/**
 * Short-lived WS connection helper for CLI commands (peers, send, inbox, state).
 *
 * Opens a connection to one mesh, runs a callback, then closes cleanly.
 * The caller never deals with connect/close lifecycle.
 */

import { hostname } from "node:os";
import { createInterface } from "node:readline";
import { BrokerClient } from "~/services/broker/facade.js";
import { readConfig } from "~/services/config/facade.js";
import type { JoinedMesh } from "~/services/config/facade.js";

export interface ConnectOpts {
  /** Mesh slug to connect to. Auto-selects if only one mesh joined. */
  meshSlug?: string | null;
  /** Display name for this session. Defaults to hostname-pid. */
  displayName?: string;
  /** Connect to all meshes and run fn for each. */
  all?: boolean;
}

async function pickMesh(meshes: JoinedMesh[]): Promise<JoinedMesh> {
  console.log("\n  Select mesh:");
  meshes.forEach((m, i) => {
    console.log(`    ${i + 1}) ${m.slug}`);
  });
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("  Choice [1]: ", (answer) => {
      rl.close();
      const idx = parseInt(answer || "1", 10) - 1;
      if (idx >= 0 && idx < meshes.length) {
        resolve(meshes[idx]!);
      } else {
        console.error("  Invalid choice, using first mesh.");
        resolve(meshes[0]!);
      }
    });
  });
}

export async function withMesh<T>(
  opts: ConnectOpts,
  fn: (client: BrokerClient, mesh: JoinedMesh) => Promise<T>,
): Promise<T> {
  const config = readConfig();
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
    mesh = await pickMesh(config.meshes);
  }

  const displayName = opts.displayName ?? config.displayName ?? `${hostname()}-${process.pid}`;
  const client = new BrokerClient(mesh, { displayName, quiet: true });

  try {
    await client.connect();
    const result = await fn(client, mesh);
    return result;
  } catch (e) {
    // Terminal close from the broker (banned / kicked). Give the user
    // a clear message instead of the low-level ws error.
    if (client.terminalClose) {
      const { code, reason } = client.terminalClose;
      if (code === 4002) {
        console.error(`\n  ✘ ${reason}\n`);
      } else if (code === 4001) {
        console.error(`\n  ✘ Kicked from this mesh. Run \`claudemesh\` to rejoin.\n`);
      } else {
        console.error(`\n  ✘ Broker closed connection: ${reason}\n`);
      }
      process.exit(1);
    }
    throw e;
  } finally {
    client.close();
  }
}
