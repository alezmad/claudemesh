import { dim, green, icons } from "../styles.js";

export function renderLaunchStart(meshSlug: string, displayName: string): void {
  console.log("");
  console.log("  " + green(icons.check) + " Launching session in " + meshSlug);
  console.log("  " + dim("Display name: " + displayName));
  console.log("");
}

export function renderLaunchComplete(): void {
  console.log("  " + green(icons.check) + " Session ended.");
}
