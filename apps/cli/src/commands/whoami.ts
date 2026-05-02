import { whoAmI } from "~/services/auth/facade.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function whoami(opts: { json?: boolean }): Promise<number> {
  const result = await whoAmI();

  if (opts.json) {
    console.log(JSON.stringify({ schema_version: "1.0", ...result }, null, 2));
    return result.signed_in || result.local ? EXIT.SUCCESS : EXIT.AUTH_FAILED;
  }

  // Show whatever we have. Both the web session and the local mesh
  // config are independent surfaces of identity; suppress sections that
  // are empty.
  if (!result.signed_in && !result.local) {
    render.err("Not signed in", "Run `claudemesh login` to sign in or `claudemesh <invite>` to join.");
    return EXIT.AUTH_FAILED;
  }

  render.section("whoami");
  if (result.signed_in) {
    render.kv([
      ["user", `${bold(result.user!.display_name)} ${dim(`(${result.user!.email})`)}`],
      ["token", `${result.token_source} ${dim("(~/.claudemesh/auth.json)")}`],
      ...(result.meshes
        ? [["meshes", `${result.meshes.owned} owned · ${result.meshes.guest} guest`] as [string, string]]
        : []),
    ]);
  } else {
    render.kv([
      ["web", dim("not signed in · run `claudemesh login` for account features")],
    ]);
  }
  if (result.local) {
    render.blank();
    render.kv([
      ["local", `${result.local.meshes.length} mesh${result.local.meshes.length === 1 ? "" : "es"} · ${dim(result.local.config_path)}`],
    ]);
    for (const m of result.local.meshes) {
      console.log(`    ${clay("●")} ${bold(m.slug)}  ${dim(`member ${m.member_id.slice(0, 8)}…  pk ${m.pubkey_prefix}…`)}`);
    }
  }
  render.blank();

  return EXIT.SUCCESS;
}
