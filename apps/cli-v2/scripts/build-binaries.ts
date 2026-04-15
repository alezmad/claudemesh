/**
 * Cross-platform single-binary compile.
 *
 * Run:  bun run scripts/build-binaries.ts
 * Output:  dist/bin/claudemesh-{darwin,linux,windows}-{x64,arm64}{.exe}
 *
 * Each binary bundles the CLI + Bun runtime, no Node required.
 * Current caveat: native deps like libsodium-wrappers ship as JS+wasm
 * so they work. `ws` falls back to its JS polyfill when uws isn't present.
 *
 * Intended for CI — GitHub Releases publish → install.sh / Homebrew
 * pull the right tarball per platform.
 */

import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TARGETS: Array<{ name: string; target: string; ext: string }> = [
  { name: "darwin-x64", target: "bun-darwin-x64", ext: "" },
  { name: "darwin-arm64", target: "bun-darwin-arm64", ext: "" },
  { name: "linux-x64", target: "bun-linux-x64", ext: "" },
  { name: "linux-arm64", target: "bun-linux-arm64", ext: "" },
  { name: "windows-x64", target: "bun-windows-x64", ext: ".exe" },
];

mkdirSync("dist/bin", { recursive: true });

for (const { name, target, ext } of TARGETS) {
  const out = `dist/bin/claudemesh-${name}${ext}`;
  console.log(`→ ${out}`);
  const res = spawnSync(
    "bun",
    [
      "build",
      "--compile",
      "--minify",
      `--target=${target}`,
      "src/entrypoints/cli.ts",
      "--outfile",
      out,
    ],
    { stdio: "inherit" },
  );
  if (res.status !== 0) {
    console.error(`  failed: ${name}`);
    process.exit(1);
  }
}
console.log("\nBinaries built in dist/bin/");
