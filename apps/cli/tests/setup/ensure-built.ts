// vitest globalSetup — guarantees `dist/entrypoints/cli.js` exists
// before any golden test spawns the built CLI. Without this, running
// `npx vitest run` in a clean checkout (or after `pnpm run clean`)
// surfaces as opaque `MODULE_NOT_FOUND` failures inside golden tests.

import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_PKG_DIR = join(HERE, "..", "..");
const CLI_ENTRY = join(CLI_PKG_DIR, "dist", "entrypoints", "cli.js");
const BUILD_SCRIPT = join(CLI_PKG_DIR, "build.ts");
const PKG_JSON = join(CLI_PKG_DIR, "package.json");

// Vitest's worker doesn't always inherit the user's shell PATH (no
// `.zshrc`/`config.fish` is sourced), so a bun install at `~/.bun/bin`
// is invisible to spawnSync. Layer the well-known install locations
// in so the build command can find them.
const EXTRA_PATHS = [
  join(homedir(), ".bun", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

function augmentedEnv(): NodeJS.ProcessEnv {
  const current = process.env.PATH ?? "";
  const augmented = [...EXTRA_PATHS, current].filter(Boolean).join(delimiter);
  return { ...process.env, PATH: augmented };
}

function isDistFresh(): boolean {
  if (!existsSync(CLI_ENTRY)) return false;
  // If the build script or package.json (which contributes the
  // injected version constant) is newer than dist, rebuild.
  try {
    const distMtime = statSync(CLI_ENTRY).mtimeMs;
    if (statSync(BUILD_SCRIPT).mtimeMs > distMtime) return false;
    if (statSync(PKG_JSON).mtimeMs > distMtime) return false;
  } catch {
    return false;
  }
  return true;
}

export default async function setup(): Promise<void> {
  if (isDistFresh()) return;

  // Try `bun build.ts` first (the canonical path). If bun is missing,
  // fall back to `pnpm run build` which delegates to the same script.
  const tries: Array<{ cmd: string; args: string[] }> = [
    { cmd: "bun", args: ["build.ts"] },
    { cmd: "pnpm", args: ["run", "build"] },
  ];

  const env = augmentedEnv();
  for (const { cmd, args } of tries) {
    const r = spawnSync(cmd, args, { cwd: CLI_PKG_DIR, stdio: "inherit", env });
    if (r.status === 0 && existsSync(CLI_ENTRY)) return;
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT")
      continue;
  }

  throw new Error(
    `vitest globalSetup: failed to build the CLI. ` +
      `Tried \`bun build.ts\` and \`pnpm run build\`. ` +
      `Install bun (https://bun.sh) or run \`pnpm run build\` manually before testing.`,
  );
}
