import { bold, dim, green, icons } from "../styles.js";
import type { JoinedMesh } from "~/services/config/facade.js";

export function renderTelegramMeshPicker(meshes: JoinedMesh[]): void {
  console.log("\n  Connect Telegram to a mesh\n");
  meshes.forEach((m, i) => console.log("    " + bold((i + 1) + ")") + " " + m.slug));
  console.log("");
}

export function renderTelegramLink(deepLink: string): void {
  console.log("  Scan or tap: " + deepLink);
  console.log("");
}

export function renderTelegramSuccess(username: string): void {
  console.log("  " + green(icons.check) + " Connected as @" + username);
}
