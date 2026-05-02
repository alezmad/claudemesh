import { withMesh } from "./connect.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function recall(
  query: string,
  opts: { mesh?: string; json?: boolean } = {},
): Promise<number> {
  if (!query) {
    render.err("Usage: claudemesh recall <query>");
    return EXIT.INVALID_ARGS;
  }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const memories = await client.recall(query);

    if (opts.json) {
      console.log(JSON.stringify(memories, null, 2));
      return EXIT.SUCCESS;
    }

    if (memories.length === 0) {
      render.info(dim("no memories found."));
      return EXIT.SUCCESS;
    }

    render.section(`memories (${memories.length})`);
    for (const m of memories) {
      const tags = m.tags.length ? dim(` [${m.tags.map((t) => clay(t)).join(dim(", "))}]`) : "";
      process.stdout.write(`  ${bold(m.id.slice(0, 8))}${tags}\n`);
      process.stdout.write(`    ${m.content}\n`);
      process.stdout.write(`    ${dim(m.rememberedBy + "  ·  " + new Date(m.rememberedAt).toLocaleString())}\n\n`);
    }
    return EXIT.SUCCESS;
  });
}
