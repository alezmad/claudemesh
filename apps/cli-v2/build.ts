import { statSync } from "node:fs";
import { gzipSync } from "node:zlib";

const MAX_GZIPPED_BYTES = 1.2 * 1024 * 1024; // 1.2 MB

const result = await Bun.build({
  entrypoints: [
    "src/entrypoints/cli.ts",
    "src/entrypoints/mcp.ts",
  ],
  outdir: "dist/entrypoints",
  target: "node",
  format: "esm",
  splitting: false,
  sourcemap: "external",
  external: [
    "libsodium-wrappers",
    "ws",
    "@modelcontextprotocol/sdk",
  ],
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

for (const output of result.outputs) {
  const raw = statSync(output.path).size;
  const gz = gzipSync(await Bun.file(output.path).arrayBuffer()).byteLength;
  const label = output.path.replace(process.cwd() + "/", "");
  console.log(`  ${label}  ${(raw / 1024).toFixed(0)} KB  (${(gz / 1024).toFixed(0)} KB gzipped)`);

  if (gz > MAX_GZIPPED_BYTES) {
    console.error(`\n  ERROR: ${label} exceeds 1.2 MB gzipped ceiling (${(gz / 1024).toFixed(0)} KB)`);
    process.exit(1);
  }
}

const { chmodSync, readFileSync, writeFileSync } = await import("node:fs");
const cliPath = "dist/entrypoints/cli.js";
const cliContent = readFileSync(cliPath, "utf-8");
if (!cliContent.startsWith("#!")) {
  writeFileSync(cliPath, "#!/usr/bin/env node\n" + cliContent);
}
chmodSync(cliPath, 0o755);

console.log("\nBuild complete.");
