/**
 * `claudemesh remember <text> [--tags tag1,tag2]` — store a memory in the mesh.
 * `claudemesh recall <query>`                      — search mesh memory.
 *
 * Useful for AI agents using bash when the MCP server isn't active.
 */

import { withMesh } from "./connect";

export interface MemoryFlags {
  mesh?: string;
  tags?: string;
  json?: boolean;
}

export async function runRemember(flags: MemoryFlags, content: string): Promise<void> {
  const tags = flags.tags
    ? flags.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    const id = await client.remember(content, tags);
    if (flags.json) {
      console.log(JSON.stringify({ id, content, tags }));
      return;
    }
    if (id) {
      console.log(`✓ Remembered (${id.slice(0, 8)})`);
    } else {
      console.error("✗ Failed to store memory");
      process.exit(1);
    }
  });
}

export async function runRecall(flags: MemoryFlags, query: string): Promise<void> {
  const useColor =
    !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[22m` : s);

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    const memories = await client.recall(query);

    if (flags.json) {
      console.log(JSON.stringify(memories, null, 2));
      return;
    }

    if (memories.length === 0) {
      console.log(dim("No memories found."));
      return;
    }

    for (const m of memories) {
      const tags = m.tags.length ? dim(` [${m.tags.join(", ")}]`) : "";
      console.log(`${bold(m.id.slice(0, 8))}${tags}`);
      console.log(`  ${m.content}`);
      console.log(dim(`  ${m.rememberedBy} · ${new Date(m.rememberedAt).toLocaleString()}`));
      console.log("");
    }
  });
}
