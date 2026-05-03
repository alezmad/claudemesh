import { createInterface } from "node:readline";
import { getStoredToken } from "~/services/auth/facade.js";
import { generateInvite } from "~/services/invite/generate.js";
import { readConfig } from "~/services/config/facade.js";
import { writeClipboard } from "~/services/clipboard/facade.js";
import { green, bold, dim, icons } from "~/ui/styles.js";
import { renderQrAsync } from "~/ui/qr.js";
import { EXIT } from "~/constants/exit-codes.js";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

export async function invite(
  email?: string,
  opts: { mesh?: string; expires?: string; uses?: number; role?: string; json?: boolean } = {},
): Promise<number> {
  const auth = getStoredToken();
  if (!auth) {
    console.error("  Not signed in. Run `claudemesh login` first.");
    return EXIT.AUTH_FAILED;
  }

  const config = readConfig();
  if (config.meshes.length === 0) {
    console.error("  No meshes. Create one with `claudemesh mesh create <name>`.");
    return EXIT.NOT_FOUND;
  }

  // Resolve which mesh to share
  let meshSlug = opts.mesh;
  if (!meshSlug) {
    if (config.meshes.length === 1) {
      meshSlug = config.meshes[0]!.slug;
    } else {
      // Show picker
      console.log("\n  Select mesh to share:\n");
      config.meshes.forEach((m, i) => {
        console.log(`    ${bold(String(i + 1) + ")")} ${m.slug}`);
      });
      console.log("");
      const choice = await prompt("  Choice [1]: ") || "1";
      const idx = parseInt(choice, 10) - 1;
      meshSlug = config.meshes[idx >= 0 && idx < config.meshes.length ? idx : 0]!.slug;
    }
  }

  try {
    const result = await generateInvite(meshSlug, {
      email,
      expires_in: opts.expires ?? "7d",
      max_uses: opts.uses,
      role: opts.role,
    });

    const copied = writeClipboard(result.url);

    if (opts.json) {
      console.log(JSON.stringify({ schema_version: "1.0", ...result, copied }, null, 2));
    } else {
      if (email) {
        if (result.emailed) {
          console.log(`\n  ${green(icons.check)} Invite sent to ${bold(email)}`);
          if (copied) console.log(`  ${green(icons.check)} Link also copied to clipboard`);
        } else {
          console.log(`\n  ${icons.cross} Email to ${bold(email)} was NOT sent (server did not send).`);
          console.log(`  ${dim("Share the link manually:")}`);
          console.log(`    ${result.url}`);
          if (copied) console.log(`  ${green(icons.check)} Link copied to clipboard`);
        }
      } else {
        console.log(`\n  ${green(icons.check)} Invite link${copied ? " copied to clipboard" : ""}:`);
        console.log(`    ${result.url}`);
        // Print QR for phone→laptop pairing. Small variant is ~17 lines tall.
        const qr = await renderQrAsync(result.url, { small: true });
        console.log("");
        for (const line of qr.split("\n")) console.log(`  ${line}`);
      }
      console.log(`\n  ${dim("Expires " + result.expires_at + ". Anyone with this link can join \"" + meshSlug + "\".")}\n`);
    }

    return EXIT.SUCCESS;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("403") || msg.includes("permission")) {
      console.error(`  ${icons.cross} You don't have permission to invite to "${meshSlug}".`);
      console.error(`  ${dim("Ask the mesh owner to grant you invite permissions.")}`);
    } else {
      console.error(`  ${icons.cross} Failed: ${msg}`);
    }
    return EXIT.INTERNAL_ERROR;
  }
}
