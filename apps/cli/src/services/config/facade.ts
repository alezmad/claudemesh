export { readConfig, getMeshConfig } from "./read.js";
export { writeConfig, ensureConfigDir, setMeshConfig, removeMeshConfig } from "./write.js";
export { emptyConfig } from "./schemas.js";
export type { Config, JoinedMesh, GroupEntry } from "./schemas.js";

import { PATHS } from "~/constants/paths.js";
export function getConfigPath(): string {
  return PATHS.CONFIG_FILE;
}
