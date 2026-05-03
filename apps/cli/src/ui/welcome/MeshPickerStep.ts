import type { JoinedMesh } from "~/services/config/facade.js";
import { bold } from "../styles.js";

export function renderMeshPicker(meshes: JoinedMesh[]): void {
  console.log("\n  Select a mesh:\n");
  meshes.forEach((m, i) => {
    console.log("    " + bold((i + 1) + ")") + " " + m.slug);
  });
  console.log("");
}
