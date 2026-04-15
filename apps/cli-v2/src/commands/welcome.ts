/**
 * `claudemesh` with no args + no joined meshes → unified onboarding.
 *
 * One flow, one keystroke per decision. Collapses the old three-branch
 * picker (signup / login / join) into a linear path:
 *
 *   1. Already have an invite URL? → paste it, run the bare-URL join+launch.
 *      (no account needed — invites are self-signed capabilities)
 *   2. Else: open the browser for sign-in + mesh creation at claudemesh.com
 *      and fall back to paste-sync when the browser hand-off lands.
 *
 * The branch that used to be "register" collapses into the browser flow
 * (the web handles signup + mesh creation as one wizard there).
 */

import { createInterface } from "node:readline";
import { readConfig } from "~/services/config/facade.js";
import { renderWelcome } from "~/ui/welcome/index.js";
import { login } from "./login.js";
import { render } from "~/ui/render.js";
import { isInviteUrl, normaliseInviteUrl } from "~/utils/url.js";
import { EXIT } from "~/constants/exit-codes.js";

function prompt(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(q, (a) => { rl.close(); resolve(a.trim()); });
  });
}

export async function runWelcome(): Promise<number> {
  const config = readConfig();
  if (config.meshes.length > 0) return EXIT.SUCCESS;

  renderWelcome();

  render.info("Do you already have an invite link? (y/n) [n]");
  const hasInvite = (await prompt("  > ")).toLowerCase().startsWith("y");

  if (hasInvite) {
    render.blank();
    render.info("Paste your invite link (claudemesh.com/i/... or claudemesh://...)");
    const raw = await prompt("  > ");
    if (!raw || !isInviteUrl(raw)) {
      render.err("That doesn't look like a claudemesh invite URL.");
      render.hint("Check your email — the link starts with https://claudemesh.com/i/");
      return EXIT.INVALID_ARGS;
    }
    const normalised = normaliseInviteUrl(raw);
    render.blank();
    render.ok(`Joining via ${normalised}`);
    const { runLaunch } = await import("./launch.js");
    await runLaunch(
      {
        join: normalised,
        name: process.env.USER ?? process.env.USERNAME ?? undefined,
        yes: false,
      },
      [],
    );
    return EXIT.SUCCESS;
  }

  // No invite → browser-first sign-in + mesh creation.
  render.blank();
  render.info("Opening claudemesh.com so you can sign in and create your first mesh.");
  render.hint("After sign-in, paste the sync token back here when prompted.");
  render.blank();
  return await login();
}

export { runWelcome as _stub };
