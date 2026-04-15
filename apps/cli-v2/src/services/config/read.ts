import { readFileSync, existsSync } from "node:fs";
import { PATHS } from "~/constants/paths.js";
import { emptyConfig } from "./schemas.js";
import type { Config, JoinedMesh } from "./schemas.js";

export function readConfig(): Config {
  if (!existsSync(PATHS.CONFIG_FILE)) return emptyConfig();
  try {
    const raw = readFileSync(PATHS.CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    if (!parsed || !Array.isArray(parsed.meshes)) return emptyConfig();
    return {
      version: 1,
      meshes: parsed.meshes,
      displayName: parsed.displayName,
      role: parsed.role,
      groups: parsed.groups,
      messageMode: parsed.messageMode,
      accountId: parsed.accountId,
    };
  } catch (e) {
    throw new Error(
      `Failed to load ${PATHS.CONFIG_FILE}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function getMeshConfig(slug: string): JoinedMesh | undefined {
  const config = readConfig();
  return config.meshes.find((m) => m.slug === slug);
}
