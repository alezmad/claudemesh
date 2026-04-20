/**
 * `claudemesh upgrade` — self-update the CLI to the latest release.
 *
 * Strategy:
 *   1. Query npm for the `latest` dist-tag (falls back to `alpha` for
 *      users who still prefer the prerelease track).
 *   2. If we're behind, run `npm i -g claudemesh-cli` via the same
 *      npm that installed us (detected from argv[1] path walk).
 *   3. Print before/after versions.
 *
 * For users who got the CLI via the `/install` shell flow (portable Node
 * in ~/.claudemesh), we call that npm directly so nothing else on the
 * system is touched.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { URLS, VERSION } from "~/constants/urls.js";
import { render } from "~/ui/render.js";
import { EXIT } from "~/constants/exit-codes.js";

async function latestVersion(): Promise<string | null> {
  try {
    const res = await fetch(URLS.NPM_REGISTRY, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { "dist-tags"?: { alpha?: string; latest?: string } };
    // Prefer the stable `latest` dist-tag; fall back to `alpha` for users
    // on prerelease builds before 1.0 shipped.
    return body["dist-tags"]?.latest ?? body["dist-tags"]?.alpha ?? null;
  } catch {
    return null;
  }
}

function findNpm(): { npm: string; prefix?: string } {
  // Portable install path (`/install.sh` puts npm in ~/.claudemesh/node/bin/npm)
  const portable = join(process.env.HOME ?? "", ".claudemesh", "node", "bin", "npm");
  if (existsSync(portable)) {
    return { npm: portable, prefix: join(process.env.HOME ?? "", ".claudemesh") };
  }
  // argv[1] → .../node_modules/claudemesh-cli/dist/entrypoints/cli.js
  // walk up to find a sibling npm binary.
  let cur = resolve(process.argv[1] ?? ".");
  for (let i = 0; i < 6; i++) {
    cur = dirname(cur);
    const candidate = join(cur, "bin", "npm");
    if (existsSync(candidate)) return { npm: candidate };
  }
  // Fallback to PATH.
  return { npm: "npm" };
}

export async function runUpgrade(opts: { check?: boolean; yes?: boolean } = {}): Promise<number> {
  render.section("claudemesh upgrade");
  render.kv([
    ["installed", VERSION],
    ["checking", "npm registry…"],
  ]);

  const latest = await latestVersion();
  if (!latest) {
    render.warn("Could not reach npm registry — skipped.");
    return EXIT.SUCCESS;
  }

  render.kv([["latest", latest]]);

  if (latest === VERSION) {
    render.blank();
    render.ok(`Already on latest (${latest}).`);
    return EXIT.SUCCESS;
  }

  if (opts.check) {
    render.blank();
    render.warn(`Update available: ${VERSION} → ${latest}`);
    render.hint("Run: claudemesh upgrade");
    return EXIT.SUCCESS;
  }

  const { npm, prefix } = findNpm();
  const args = ["install", "-g"];
  if (prefix) args.push("--prefix", prefix);
  args.push("claudemesh-cli");

  render.blank();
  render.info(`Updating ${VERSION} → ${latest}…`);
  render.hint(`${npm} ${args.join(" ")}`);
  render.blank();

  const res = spawnSync(npm, args, { stdio: "inherit" });
  if (res.status !== 0) {
    render.err(`npm exited with status ${res.status}`);
    render.hint("Try: npm i -g claudemesh-cli");
    return EXIT.INTERNAL_ERROR;
  }

  render.blank();
  render.ok(`Upgraded to ${latest}.`);
  return EXIT.SUCCESS;
}
