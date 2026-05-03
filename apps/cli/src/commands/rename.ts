import { rename as renameMesh } from "~/services/mesh/facade.js";
import { getStoredToken } from "~/services/auth/facade.js";
import { ApiError } from "~/services/api/facade.js";
import { bold, dim, green, icons } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function rename(slug: string, newName: string): Promise<number> {
  // Rename requires a web session token (~/.claudemesh/auth.json). Joining
  // a mesh via invite does NOT create that token — it only writes a per-mesh
  // apikey to config.json. Detect this case up front so the error is actionable.
  const auth = getStoredToken();
  if (!auth) {
    console.error(`  ${icons.cross} Renaming a mesh requires a claudemesh.com account session.`);
    console.error(`  ${dim("Joining via invite signs you in to the mesh, not to a web account.")}`);
    console.error(`  ${dim("Run")} ${bold("claudemesh login")} ${dim("first, then retry, or rename from the dashboard:")}`);
    console.error(`    https://claudemesh.com/dashboard`);
    return EXIT.AUTH_FAILED;
  }

  try {
    await renameMesh(slug, newName);
    console.log(`  ${green(icons.check)} Renamed "${slug}" to "${newName}"`);
    return EXIT.SUCCESS;
  } catch (err) {
    if (err instanceof ApiError) {
      // Server returns { error: "..." } for actionable messages
      // (not the owner, mesh missing, expired token). Surface the
      // body — the bare HTTP code alone hides why it failed.
      const body = err.body as { error?: string } | undefined;
      const detail = body?.error ?? err.statusText;
      console.error(`  ${icons.cross} ${detail}`);
      if (err.status === 401) return EXIT.AUTH_FAILED;
      if (err.status === 403) return EXIT.PERMISSION_DENIED;
      if (err.status === 404) return EXIT.NOT_FOUND;
      return EXIT.INTERNAL_ERROR;
    }
    console.error(`  ${icons.cross} Failed: ${err instanceof Error ? err.message : err}`);
    return EXIT.INTERNAL_ERROR;
  }
}
