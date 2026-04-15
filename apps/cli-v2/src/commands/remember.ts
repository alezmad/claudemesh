import { allClients } from "~/services/broker/facade.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function remember(
  content: string,
  opts: { mesh?: string; tags?: string; json?: boolean } = {},
): Promise<number> {
  const client = allClients()[0];
  if (!client) {
    console.error("Not connected to any mesh.");
    return EXIT.NETWORK_ERROR;
  }

  const tags = opts.tags?.split(",").map((t) => t.trim()).filter(Boolean);
  const id = await client.remember(content, tags);

  if (opts.json) {
    console.log(JSON.stringify({ id, content, tags }));
    return EXIT.SUCCESS;
  }

  if (id) {
    console.log(`\u2713 Remembered (${id.slice(0, 8)})`);
    return EXIT.SUCCESS;
  }
  console.error("\u2717 Failed to store memory");
  return EXIT.INTERNAL_ERROR;
}
