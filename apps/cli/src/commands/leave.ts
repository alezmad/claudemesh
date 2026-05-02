/**
 * `claudemesh leave <slug>` — remove a mesh from local config.
 *
 * Does NOT (yet) notify the broker. In 15b+ this will send a
 * best-effort revoke request before removing the entry.
 */

import { readConfig, writeConfig } from "~/services/config/facade.js";
import { render } from "~/ui/render.js";
import { bold, dim } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export function runLeave(args: string[]): number {
  const slug = args[0];
  if (!slug) {
    render.err("Usage: claudemesh leave <slug>");
    return EXIT.INVALID_ARGS;
  }
  const config = readConfig();
  const before = config.meshes.length;
  config.meshes = config.meshes.filter((m) => m.slug !== slug);
  if (config.meshes.length === before) {
    render.err(`no joined mesh with slug "${slug}"`);
    return EXIT.NOT_FOUND;
  }
  writeConfig(config);
  render.ok(`left ${bold(slug)}`, dim(`remaining: ${config.meshes.length}`));
  return EXIT.SUCCESS;
}
