import { writeFileSync, mkdirSync, chmodSync, openSync, closeSync, renameSync } from "node:fs";
import { platform } from "node:os";
import { PATHS } from "~/constants/paths.js";
import type { Config, JoinedMesh } from "./schemas.js";
import { readConfig } from "./read.js";

const isWindows = platform() === "win32";

export function ensureConfigDir(): void {
  mkdirSync(PATHS.CONFIG_DIR, { recursive: true });
  if (!isWindows) {
    try { chmodSync(PATHS.CONFIG_DIR, 0o700); } catch (e) {
      process.stderr.write(`warning: could not set permissions on ${PATHS.CONFIG_DIR}: ${e}\n`);
    }
  }
}

export function writeConfig(config: Config): void {
  ensureConfigDir();
  const content = JSON.stringify(config, null, 2) + "\n";
  const tmpPath = PATHS.CONFIG_FILE + ".tmp";
  if (isWindows) {
    writeFileSync(tmpPath, content, "utf-8");
  } else {
    const fd = openSync(tmpPath, "w", 0o600);
    try { writeFileSync(fd, content, "utf-8"); } finally { closeSync(fd); }
  }
  renameSync(tmpPath, PATHS.CONFIG_FILE);
}

export function setMeshConfig(slug: string, mesh: JoinedMesh): void {
  const config = readConfig();
  const idx = config.meshes.findIndex((m) => m.slug === slug);
  if (idx >= 0) {
    config.meshes[idx] = mesh;
  } else {
    config.meshes.push(mesh);
  }
  writeConfig(config);
}

export function removeMeshConfig(slug: string): boolean {
  const config = readConfig();
  const before = config.meshes.length;
  config.meshes = config.meshes.filter((m) => m.slug !== slug);
  if (config.meshes.length < before) {
    writeConfig(config);
    return true;
  }
  return false;
}
