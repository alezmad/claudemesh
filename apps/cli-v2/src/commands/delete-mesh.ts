import { createInterface } from "node:readline";
import { readConfig } from "~/services/config/facade.js";
import { leave as leaveMesh } from "~/services/mesh/facade.js";
import { getStoredToken } from "~/services/auth/facade.js";
import { request } from "~/services/api/facade.js";
import { URLS } from "~/constants/urls.js";
import { green, red, bold, dim, yellow, icons } from "~/ui/styles.js";
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

async function isOwner(slug: string, userId: string): Promise<boolean> {
  try {
    const res = await request<{ meshes: Array<{ slug: string; is_owner: boolean }> }>({
      path: `/cli/meshes?user_id=${userId}`,
      baseUrl: BROKER_HTTP,
    });
    return res.meshes?.find(m => m.slug === slug)?.is_owner ?? false;
  } catch { return false; }
}

export async function deleteMesh(slug: string, opts: { yes?: boolean } = {}): Promise<number> {
  const config = readConfig();

  // Mesh picker if no slug given
  if (!slug) {
    if (config.meshes.length === 0) {
      console.error("  No meshes to remove.");
      return EXIT.NOT_FOUND;
    }
    console.log("\n  Select mesh to remove:\n");
    config.meshes.forEach((m, i) => {
      console.log(`    ${bold(String(i + 1) + ")")} ${m.slug} ${dim("(" + m.name + ")")}`);
    });
    console.log("");
    const choice = await prompt("  Choice: ");
    const idx = parseInt(choice, 10) - 1;
    if (idx < 0 || idx >= config.meshes.length) {
      console.log("  Cancelled.");
      return EXIT.USER_CANCELLED;
    }
    slug = config.meshes[idx]!.slug;
  }

  const auth = getStoredToken();
  const userId = auth ? getUserId(auth.session_token) : "";
  const ownerCheck = userId ? await isOwner(slug, userId) : false;

  // Ask what to do
  if (!opts.yes) {
    console.log(`\n  ${bold(slug)}\n`);

    if (ownerCheck) {
      console.log(`    ${bold("1)")} Remove from this device only ${dim("(keep on server)")}`);
      console.log(`    ${bold("2)")} ${red("Delete everywhere")} ${dim("(removes for all members)")}`);
      console.log(`    ${bold("3)")} Cancel`);
      console.log("");

      const choice = await prompt("  Choice [1]: ") || "1";

      if (choice === "3") { console.log("  Cancelled."); return EXIT.USER_CANCELLED; }

      if (choice === "2") {
        // Server-side delete — require confirmation
        console.log(`\n  ${red("Warning:")} This will delete ${bold(slug)} for all members.`);
        const confirm = await prompt(`  Type "${slug}" to confirm: `);
        if (confirm.toLowerCase() !== slug.toLowerCase()) {
          console.log("  Cancelled.");
          return EXIT.USER_CANCELLED;
        }

        try {
          await request({
            path: `/cli/mesh/${slug}`,
            method: "DELETE",
            body: { user_id: userId },
            baseUrl: BROKER_HTTP,
          });
          console.log(`  ${green(icons.check)} Deleted "${slug}" from server.`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ${icons.cross} Server delete failed: ${msg}`);
        }

        leaveMesh(slug);
        console.log(`  ${green(icons.check)} Removed from local config.`);
        return EXIT.SUCCESS;
      }

      // choice === "1" — local only, fall through
    } else {
      // Not owner — can only remove locally
      console.log(`    ${bold("1)")} Remove from this device ${dim("(you can re-add later)")}`);
      console.log(`    ${bold("2)")} Cancel`);
      if (!ownerCheck && userId) {
        console.log(dim(`\n    ${yellow(icons.warn)} Only the mesh owner can delete it from the server.`));
      }
      console.log("");

      const choice = await prompt("  Choice [1]: ") || "1";
      if (choice === "2") { console.log("  Cancelled."); return EXIT.USER_CANCELLED; }
    }
  }

  // Local-only removal
  const removed = leaveMesh(slug);
  if (removed) {
    console.log(`  ${green(icons.check)} Removed "${slug}" from this device.`);
    console.log(dim(`    Re-add anytime with: claudemesh mesh add <invite-url>`));
  } else {
    console.error(`  Mesh "${slug}" not found in local config.`);
  }
  return EXIT.SUCCESS;
}
