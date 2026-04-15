import { readConfig } from "~/services/config/facade.js";
import { getLastUsed } from "~/services/state/facade.js";
import type { JoinedMesh } from "~/services/config/facade.js";

export function resolveTarget(meshFlag?: string): JoinedMesh | null {
  const config = readConfig();
  if (config.meshes.length === 0) return null;
  if (meshFlag) return config.meshes.find(m => m.slug === meshFlag) ?? null;
  const last = getLastUsed();
  if (last) {
    const found = config.meshes.find(m => m.slug === last.meshSlug);
    if (found) return found;
  }
  if (config.meshes.length === 1) return config.meshes[0]!;
  return null;
}
