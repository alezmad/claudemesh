import { create as createMesh } from "~/services/mesh/facade.js";
import { getStoredToken } from "~/services/auth/facade.js";
import { green, dim, icons } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function newMesh(
  name: string,
  opts: { template?: string; description?: string; json?: boolean },
): Promise<number> {
  if (!name) {
    console.error("  Usage: claudemesh mesh create <name>");
    return EXIT.INVALID_ARGS;
  }

  if (!getStoredToken()) {
    console.log(dim("  Not signed in — starting login…\n"));
    const { login } = await import("./login.js");
    const loginResult = await login();
    if (loginResult !== EXIT.SUCCESS) return loginResult;
    console.log("");
  }

  try {
    const result = await createMesh(name, {
      template: opts.template,
      description: opts.description,
    });

    if (opts.json) {
      console.log(JSON.stringify({ schema_version: "1.0", ...result }, null, 2));
    } else {
      console.log(`\n  ${green(icons.check)} Created "${result.slug}" (id: ${result.id})`);
      console.log(`  ${green(icons.check)} You're the owner`);
      console.log(`  ${green(icons.check)} Joined locally`);
      console.log(`\n  Share with: claudemesh mesh share\n`);
    }

    return EXIT.SUCCESS;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("409") || msg.includes("already exists")) {
      console.error(`  ${icons.cross} A mesh with this name already exists. Try a different name.`);
    } else {
      console.error(`  ${icons.cross} Failed: ${msg}`);
    }
    return EXIT.INTERNAL_ERROR;
  }
}
