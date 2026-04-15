import { whoAmI } from "~/services/auth/facade.js";
import { dim, icons } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function whoami(opts: { json?: boolean }): Promise<number> {
  const result = await whoAmI();

  if (opts.json) {
    console.log(JSON.stringify({ schema_version: "1.0", ...result }, null, 2));
    return EXIT.SUCCESS;
  }

  if (!result.signed_in) {
    console.log(`  Not signed in. Run \`claudemesh login\` to sign in.`);
    return EXIT.AUTH_FAILED;
  }

  console.log(`\n  Signed in as ${result.user!.display_name} (${result.user!.email})`);
  console.log(`  Token source: ${result.token_source} ${dim("(~/.claudemesh/auth.json)")}`);
  if (result.meshes) {
    console.log(`  Meshes: ${result.meshes.owned} owned, ${result.meshes.guest} guest`);
  }
  console.log();

  return EXIT.SUCCESS;
}
