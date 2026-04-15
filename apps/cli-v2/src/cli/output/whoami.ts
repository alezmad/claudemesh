import type { WhoAmIResult } from "~/services/auth/facade.js";
import { bold, dim } from "~/ui/styles.js";
export function renderWhoAmI(result: WhoAmIResult): string {
  if (!result.signed_in) return "  Not signed in.";
  const lines = [
    "  Signed in as " + bold(result.user!.display_name) + " (" + result.user!.email + ")",
    "  Token source: " + result.token_source + " " + dim("(~/.claudemesh/auth.json)"),
  ];
  if (result.meshes) lines.push("  Meshes: " + result.meshes.owned + " owned, " + result.meshes.guest + " guest");
  return lines.join("\n");
}
