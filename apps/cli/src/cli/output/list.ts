import type { JoinedMesh } from "~/services/config/facade.js";
import { bold, dim } from "~/ui/styles.js";
export function renderMeshList(meshes: JoinedMesh[]): string {
  if (meshes.length === 0) return "  No meshes joined.";
  return meshes.map((m, i) => "  " + bold((i + 1) + ")") + " " + m.slug + " " + dim("(" + m.meshId.slice(0, 8) + "\u2026)")).join("\n");
}
