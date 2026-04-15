import { rename as renameMesh } from "~/services/mesh/facade.js";
import { green, icons } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function rename(slug: string, newName: string): Promise<number> {
  try {
    await renameMesh(slug, newName);
    console.log(`  ${green(icons.check)} Renamed "${slug}" to "${newName}"`);
    return EXIT.SUCCESS;
  } catch (err) {
    console.error(`  ${icons.cross} Failed: ${err instanceof Error ? err.message : err}`);
    return EXIT.INTERNAL_ERROR;
  }
}
