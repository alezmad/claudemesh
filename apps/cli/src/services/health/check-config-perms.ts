import { existsSync, statSync } from "node:fs";
import { PATHS } from "~/constants/paths.js";
import type { CheckResult } from "./types.js";

export function checkConfigPerms(): CheckResult {
  const configFile = PATHS.CONFIG_FILE;
  if (!existsSync(configFile)) {
    return { name: "config-perms", ok: true, message: "No config file yet (first run)" };
  }
  try {
    const mode = statSync(configFile).mode & 0o777;
    if (mode <= 0o600) {
      return { name: "config-perms", ok: true, message: `config.json mode ${mode.toString(8)}` };
    }
    return { name: "config-perms", ok: false, message: `config.json mode ${mode.toString(8)} — should be 600` };
  } catch {
    return { name: "config-perms", ok: false, message: "Could not stat config.json" };
  }
}
