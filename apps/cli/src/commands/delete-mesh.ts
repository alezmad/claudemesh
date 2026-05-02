import { createInterface } from "node:readline";
import { readConfig } from "~/services/config/facade.js";
import { leave as leaveMesh } from "~/services/mesh/facade.js";
import { getStoredToken } from "~/services/auth/facade.js";
import { request } from "~/services/api/facade.js";
import { URLS } from "~/constants/urls.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim, red } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

const BROKER_HTTP = URLS.BROKER.replace("wss://", "https://").replace("ws://", "http://").replace("/ws", "");

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

function getUserId(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as { sub?: string };
    return payload.sub ?? "";
  } catch { return ""; }
}

async function isOwner(slug: string, auth: { session_token: string }): Promise<boolean> {
  try {
    const res = await request<{ meshes: Array<{ slug: string; is_owner: boolean }> }>({
      path: `/cli/meshes`,
      baseUrl: BROKER_HTTP,
      token: auth.session_token,
    });
    return res.meshes?.find((m) => m.slug === slug)?.is_owner ?? false;
  } catch { return false; }
}

export async function deleteMesh(slug: string, opts: { yes?: boolean } = {}): Promise<number> {
  const config = readConfig();

  if (!slug) {
    if (config.meshes.length === 0) {
      render.err("No meshes to remove.");
      return EXIT.NOT_FOUND;
    }
    render.section("select mesh to remove");
    config.meshes.forEach((m, i) => {
      process.stdout.write(`    ${bold(String(i + 1) + ")")} ${clay(m.slug)} ${dim("(" + m.name + ")")}\n`);
    });
    render.blank();
    const choice = await prompt(`  ${dim("choice:")} `);
    const idx = parseInt(choice, 10) - 1;
    if (idx < 0 || idx >= config.meshes.length) {
      render.info(dim("cancelled."));
      return EXIT.USER_CANCELLED;
    }
    slug = config.meshes[idx]!.slug;
  }

  const auth = getStoredToken();
  const userId = auth ? getUserId(auth.session_token) : "";
  const ownerCheck = auth ? await isOwner(slug, auth) : false;

  if (!opts.yes) {
    render.section(slug);

    if (ownerCheck) {
      process.stdout.write(`    ${bold("1)")} remove from this device only ${dim("(keep on server)")}\n`);
      process.stdout.write(`    ${bold("2)")} ${red("delete everywhere")} ${dim("(removes for all members)")}\n`);
      process.stdout.write(`    ${bold("3)")} cancel\n`);
      render.blank();

      const choice = await prompt(`  ${dim("choice [1]:")} `) || "1";

      if (choice === "3") { render.info(dim("cancelled.")); return EXIT.USER_CANCELLED; }

      if (choice === "2") {
        render.blank();
        render.warn(`this will delete ${bold(slug)} for all members.`);
        const confirm = await prompt(`  ${dim(`type "${slug}" to confirm:`)} `);
        if (confirm.toLowerCase() !== slug.toLowerCase()) {
          render.info(dim("cancelled."));
          return EXIT.USER_CANCELLED;
        }

        try {
          await request({
            path: `/cli/mesh/${slug}`,
            method: "DELETE",
            baseUrl: BROKER_HTTP,
            token: auth?.session_token,
            body: { user_id: userId },
          });
          render.ok(`deleted ${bold(slug)} from server.`);
        } catch (err) {
          render.err(`server delete failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        leaveMesh(slug);
        render.ok("removed from local config.");
        return EXIT.SUCCESS;
      }
    } else {
      process.stdout.write(`    ${bold("1)")} remove from this device ${dim("(you can re-add later)")}\n`);
      process.stdout.write(`    ${bold("2)")} cancel\n`);
      if (userId) {
        render.blank();
        render.warn("only the mesh owner can delete it from the server.");
      }
      render.blank();

      const choice = await prompt(`  ${dim("choice [1]:")} `) || "1";
      if (choice === "2") { render.info(dim("cancelled.")); return EXIT.USER_CANCELLED; }
    }
  }

  const removed = leaveMesh(slug);
  if (removed) {
    render.ok(`removed ${bold(slug)} from this device.`);
    render.hint(`re-add anytime with: ${bold("claudemesh")} ${clay("<invite-url>")}`);
  } else {
    render.err(`mesh "${slug}" not found in local config.`);
  }
  return EXIT.SUCCESS;
}
