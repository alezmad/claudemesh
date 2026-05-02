import { create as createMesh } from "~/services/mesh/facade.js";
import { getStoredToken } from "~/services/auth/facade.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function newMesh(
  name: string,
  opts: { template?: string; description?: string; json?: boolean },
): Promise<number> {
  if (!name) {
    render.err("Usage: claudemesh create <name>");
    return EXIT.INVALID_ARGS;
  }

  if (!getStoredToken()) {
    render.info(dim("not signed in — starting login…"));
    render.blank();
    const { login } = await import("./login.js");
    const loginResult = await login();
    if (loginResult !== EXIT.SUCCESS) return loginResult;
    render.blank();
  }

  try {
    const result = await createMesh(name, {
      template: opts.template,
      description: opts.description,
    });

    if (opts.json) {
      console.log(JSON.stringify({ schema_version: "1.0", ...result }, null, 2));
      return EXIT.SUCCESS;
    }

    render.section(`created ${bold(result.slug)}`);
    render.kv([
      ["id", dim(result.id)],
      ["role", clay("owner")],
      ["local", "joined"],
    ]);
    render.blank();
    render.hint(`share with: ${bold("claudemesh share")}`);
    render.blank();

    return EXIT.SUCCESS;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("409") || msg.includes("already exists")) {
      render.err("A mesh with this name already exists.", "Try a different name.");
    } else {
      render.err(`Failed: ${msg}`);
    }
    return EXIT.INTERNAL_ERROR;
  }
}
