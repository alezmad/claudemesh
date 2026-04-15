import { allClients } from "~/services/broker/facade.js";
import { dim, bold } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function recall(
  query: string,
  opts: { mesh?: string; json?: boolean } = {},
): Promise<number> {
  const client = allClients()[0];
  if (!client) {
    console.error("Not connected to any mesh.");
    return EXIT.NETWORK_ERROR;
  }

  const memories = await client.recall(query);

  if (opts.json) {
    console.log(JSON.stringify(memories, null, 2));
    return EXIT.SUCCESS;
  }

  if (memories.length === 0) {
    console.log(dim("No memories found."));
    return EXIT.SUCCESS;
  }

  for (const m of memories) {
    const tags = m.tags.length ? dim(` [${m.tags.join(", ")}]`) : "";
    console.log(`${bold(m.id.slice(0, 8))}${tags}`);
    console.log(`  ${m.content}`);
    console.log(dim(`  ${m.rememberedBy} \u00B7 ${new Date(m.rememberedAt).toLocaleString()}`));
    console.log("");
  }
  return EXIT.SUCCESS;
}
