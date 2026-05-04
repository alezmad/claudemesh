import { withMesh } from "./connect.js";
import { tryRememberViaDaemon } from "~/services/bridge/daemon-route.js";
import { render } from "~/ui/render.js";
import { dim } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function remember(
  content: string,
  opts: { mesh?: string; tags?: string; json?: boolean } = {},
): Promise<number> {
  if (!content) {
    render.err("Usage: claudemesh remember <text>");
    return EXIT.INVALID_ARGS;
  }
  const tags = opts.tags?.split(",").map((t) => t.trim()).filter(Boolean);

  // Daemon path first.
  const daemonRes = await tryRememberViaDaemon(content, tags, opts.mesh);
  if (daemonRes) {
    if (opts.json) {
      console.log(JSON.stringify({ id: daemonRes.id, content, tags, mesh: daemonRes.mesh }));
      return EXIT.SUCCESS;
    }
    render.ok("remembered", dim(daemonRes.id.slice(0, 8)));
    return EXIT.SUCCESS;
  }

  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const id = await client.remember(content, tags);

    if (opts.json) {
      console.log(JSON.stringify({ id, content, tags }));
      return EXIT.SUCCESS;
    }

    if (id) {
      render.ok("remembered", dim(id.slice(0, 8)));
      return EXIT.SUCCESS;
    }
    render.err("failed to store memory");
    return EXIT.INTERNAL_ERROR;
  });
}
