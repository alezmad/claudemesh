import { whoAmI } from "~/services/auth/facade.js";
import { render } from "~/ui/render.js";
import { bold, dim } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function whoami(opts: { json?: boolean }): Promise<number> {
  const result = await whoAmI();

  if (opts.json) {
    console.log(JSON.stringify({ schema_version: "1.0", ...result }, null, 2));
    return EXIT.SUCCESS;
  }

  if (!result.signed_in) {
    render.err("Not signed in", "Run `claudemesh login` to sign in.");
    return EXIT.AUTH_FAILED;
  }

  render.section("whoami");
  render.kv([
    ["user", `${bold(result.user!.display_name)} ${dim(`(${result.user!.email})`)}`],
    ["token", `${result.token_source} ${dim("(~/.claudemesh/auth.json)")}`],
    ...(result.meshes
      ? [["meshes", `${result.meshes.owned} owned · ${result.meshes.guest} guest`] as [string, string]]
      : []),
  ]);
  render.blank();

  return EXIT.SUCCESS;
}
