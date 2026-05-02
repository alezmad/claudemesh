/**
 * `claudemesh state get <key>`    — read a shared state value
 * `claudemesh state set <key> <value>` — write a shared state value
 * `claudemesh state list`          — list all state entries
 */

import { withMesh } from "./connect.js";
import { render } from "~/ui/render.js";
import { bold, dim } from "~/ui/styles.js";

export interface StateFlags {
  mesh?: string;
  json?: boolean;
}

export async function runStateGet(flags: StateFlags, key: string): Promise<void> {
  await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    const entry = await client.getState(key);
    if (!entry) {
      render.info(dim("(not set)"));
      return;
    }
    if (flags.json) {
      console.log(JSON.stringify(entry, null, 2));
      return;
    }
    const val = typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value);
    render.info(val);
    render.info(dim(`  set by ${entry.updatedBy} at ${new Date(entry.updatedAt).toLocaleString()}`));
  });
}

export async function runStateSet(flags: StateFlags, key: string, value: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    await client.setState(key, parsed);
    render.ok(`${bold(key)} = ${JSON.stringify(parsed)}`);
  });
}

export async function runStateList(flags: StateFlags): Promise<void> {
  await withMesh({ meshSlug: flags.mesh ?? null }, async (client, mesh) => {
    const entries = await client.listState();

    if (flags.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }

    if (entries.length === 0) {
      render.info(dim(`No state on mesh "${mesh.slug}".`));
      return;
    }

    render.section(`state (${entries.length})`);
    for (const e of entries) {
      const val = typeof e.value === "string" ? e.value : JSON.stringify(e.value);
      process.stdout.write(`  ${bold(e.key)}: ${val}\n`);
      process.stdout.write(`    ${dim(e.updatedBy + "  ·  " + new Date(e.updatedAt).toLocaleString())}\n`);
    }
  });
}
