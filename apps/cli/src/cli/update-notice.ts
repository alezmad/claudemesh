import { checkForUpdate } from "~/services/update/facade.js";
import { dim, yellow } from "~/ui/styles.js";
export async function showUpdateNotice(currentVersion: string): Promise<void> {
  try {
    const info = await checkForUpdate(currentVersion);
    if (info.updateAvailable) {
      console.error(yellow("  Update available: " + info.current + " \u2192 " + info.latest));
      console.error(dim("  Run: npm i -g claudemesh-cli"));
    }
  } catch {}
}
