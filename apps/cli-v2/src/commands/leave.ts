/**
 * `claudemesh leave <slug>` — remove a mesh from local config.
 *
 * Does NOT (yet) notify the broker. In 15b+ this will send a
 * best-effort revoke request before removing the entry.
 */

import { readConfig, writeConfig } from "~/services/config/facade.js";

export function runLeave(args: string[]): void {
  const slug = args[0];
  if (!slug) {
    console.error("Usage: claudemesh leave <slug>");
    process.exit(1);
  }
  const config = readConfig();
  const before = config.meshes.length;
  config.meshes = config.meshes.filter((m) => m.slug !== slug);
  if (config.meshes.length === before) {
    console.error(`claudemesh: no joined mesh with slug "${slug}"`);
    process.exit(1);
  }
  writeConfig(config);
  console.log(`Left mesh "${slug}". Remaining: ${config.meshes.length}`);
}
