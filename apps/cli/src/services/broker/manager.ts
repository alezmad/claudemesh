import { BrokerClient } from "./ws-client.js";
import type { Config, JoinedMesh } from "~/services/config/facade.js";

const clients = new Map<string, BrokerClient>();
let configDisplayName: string | undefined;
let configGroups: Config["groups"] = [];

export async function ensureClient(mesh: JoinedMesh): Promise<BrokerClient> {
  const existing = clients.get(mesh.meshId);
  if (existing) return existing;
  const isDebug = process.env.CLAUDEMESH_DEBUG === "1" || process.env.CLAUDEMESH_DEBUG === "true";
  const client = new BrokerClient(mesh, { debug: isDebug, displayName: configDisplayName });
  clients.set(mesh.meshId, client);
  try {
    await client.connect();
    for (const g of configGroups ?? []) {
      try { await client.joinGroup(g.name, g.role); } catch {}
    }
  } catch (err) {
    process.stderr.write(`[claudemesh] broker connect failed for ${mesh.slug}: ${err instanceof Error ? err.message : err} (will retry)\n`);
  }
  return client;
}

export async function startClients(config: Config): Promise<void> {
  configDisplayName = config.displayName;
  configGroups = config.groups ?? [];
  await Promise.allSettled(config.meshes.map(ensureClient));
}

export function findClient(needle: string): BrokerClient | null {
  const byId = clients.get(needle);
  if (byId) return byId;
  for (const c of clients.values()) {
    if (c.meshSlug === needle) return c;
  }
  return null;
}

export function allClients(): BrokerClient[] {
  return [...clients.values()];
}

export function stopAll(): void {
  for (const c of clients.values()) c.close();
  clients.clear();
}
