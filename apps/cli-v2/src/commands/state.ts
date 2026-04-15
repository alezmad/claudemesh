/**
 * `claudemesh state get <key>`    — read a shared state value
 * `claudemesh state set <key> <value>` — write a shared state value
 * `claudemesh state list`          — list all state entries
 */

import { withMesh } from "./connect.js";

export interface StateFlags {
  mesh?: string;
  json?: boolean;
}

export async function runStateGet(flags: StateFlags, key: string): Promise<void> {
  const useColor =
    !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s);

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    const entry = await client.getState(key);
    if (!entry) {
      console.log(dim(`(not set)`));
      return;
    }
    if (flags.json) {
      console.log(JSON.stringify(entry, null, 2));
      return;
    }
    const val = typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value);
    console.log(val);
    console.log(dim(`  set by ${entry.updatedBy} at ${new Date(entry.updatedAt).toLocaleString()}`));
  });
}

export async function runStateSet(flags: StateFlags, key: string, value: string): Promise<void> {
  // Try to parse as JSON so numbers/booleans/objects work; fall back to string.
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    await client.setState(key, parsed);
    console.log(`✓ ${key} = ${JSON.stringify(parsed)}`);
  });
}

export async function runStateList(flags: StateFlags): Promise<void> {
  const useColor =
    !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[22m` : s);

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client, mesh) => {
    const entries = await client.listState();

    if (flags.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }

    if (entries.length === 0) {
      console.log(dim(`No state on mesh "${mesh.slug}".`));
      return;
    }

    for (const e of entries) {
      const val = typeof e.value === "string" ? e.value : JSON.stringify(e.value);
      console.log(`${bold(e.key)}: ${val}`);
      console.log(dim(`  ${e.updatedBy} · ${new Date(e.updatedAt).toLocaleString()}`));
    }
  });
}
