import { readConfig } from "~/services/config/facade.js";
import type { JoinedMesh } from "~/services/config/facade.js";

export function listMeshes(): JoinedMesh[] {
  return readConfig().meshes;
}
