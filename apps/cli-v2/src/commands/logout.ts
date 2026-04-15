import { logout as doLogout } from "~/services/auth/facade.js";
import { green, yellow, icons } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function logout(): Promise<number> {
  try {
    const { revoked } = await doLogout();

    if (revoked) {
      console.log(`  ${green(icons.check)} Revoked session on claudemesh.com`);
    } else {
      console.log(`  ${yellow(icons.warn)} Could not revoke session on claudemesh.com.`);
      console.log(`    Revoke manually at https://claudemesh.com/dashboard/settings/sessions`);
    }
    console.log(`  ${green(icons.check)} Removed local credentials.`);

    return EXIT.SUCCESS;
  } catch (err) {
    console.error(`  ${icons.cross} Logout failed: ${err instanceof Error ? err.message : err}`);
    return EXIT.AUTH_FAILED;
  }
}
