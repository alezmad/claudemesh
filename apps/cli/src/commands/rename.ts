/**
 * `claudemesh rename <old-slug> <new-slug>` — change a mesh's identifier.
 *
 * v0.7.0 collapse: slug IS the identifier — there is no separate
 * "display name". Pre-launch we collapsed the model so users only ever
 * deal with one identifier per mesh. The mesh.name column on the DB is
 * kept for now (avoids touching ~25 reader sites) but is always synced
 * to slug; a follow-up migration drops it.
 */

import { reslug as reslugMesh } from "~/services/mesh/facade.js";
import { getStoredToken } from "~/services/auth/facade.js";
import { ApiError } from "~/services/api/facade.js";
import { readConfig, setMeshConfig, removeMeshConfig } from "~/services/config/facade.js";
import { bold, dim, green, icons } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

export async function rename(oldSlug: string, newSlug: string): Promise<number> {
  if (!oldSlug || !newSlug) {
    console.error(`  ${icons.cross} Usage: ${bold("claudemesh rename")} <old-slug> <new-slug>`);
    return EXIT.INVALID_ARGS;
  }
  if (!SLUG_RE.test(newSlug)) {
    console.error(`  ${icons.cross} Invalid slug: must be 2-32 chars, lowercase alnum + hyphens, start with alnum`);
    return EXIT.INVALID_ARGS;
  }
  if (oldSlug === newSlug) {
    console.error(`  ${icons.cross} Old and new slug are the same.`);
    return EXIT.INVALID_ARGS;
  }

  const auth = getStoredToken();
  if (!auth) {
    console.error(`  ${icons.cross} Renaming a mesh requires a claudemesh.com account session.`);
    console.error(`  ${dim("Run")} ${bold("claudemesh login")} ${dim("first.")}`);
    return EXIT.AUTH_FAILED;
  }

  const cfg = readConfig();
  const collision = cfg.meshes.find((m) => m.slug === newSlug && m.slug !== oldSlug);
  if (collision) {
    console.error(`  ${icons.cross} Slug "${newSlug}" already used locally by another joined mesh.`);
    console.error(`  ${dim("Pick a different slug, or leave the other mesh first.")}`);
    return EXIT.ALREADY_EXISTS;
  }

  try {
    const updated = await reslugMesh(oldSlug, newSlug);
    const local = cfg.meshes.find((m) => m.slug === oldSlug);
    if (local) {
      removeMeshConfig(oldSlug);
      setMeshConfig(updated.slug, { ...local, slug: updated.slug, name: updated.slug });
    }
    console.log(`  ${green(icons.check)} Renamed: "${oldSlug}" → "${updated.slug}"`);
    console.log(`  ${dim("Other peers will pick up the new identifier after they run")} ${bold("claudemesh sync")}`);
    return EXIT.SUCCESS;
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | undefined;
      console.error(`  ${icons.cross} ${body?.error ?? err.statusText}`);
      if (err.status === 401) return EXIT.AUTH_FAILED;
      if (err.status === 403) return EXIT.PERMISSION_DENIED;
      if (err.status === 404) return EXIT.NOT_FOUND;
      if (err.status === 409) return EXIT.ALREADY_EXISTS;
      if (err.status === 400) return EXIT.INVALID_ARGS;
      return EXIT.INTERNAL_ERROR;
    }
    console.error(`  ${icons.cross} Failed: ${err instanceof Error ? err.message : err}`);
    return EXIT.INTERNAL_ERROR;
  }
}
