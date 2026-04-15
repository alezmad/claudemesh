import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "~/constants/paths.js";

const OPT_OUT_FILE = join(PATHS.CONFIG_DIR, ".telemetry-opt-out");

export function isOptedOut(): boolean {
  return process.env.CLAUDEMESH_TELEMETRY === "0" || existsSync(OPT_OUT_FILE);
}

export function optOut(): void {
  writeFileSync(OPT_OUT_FILE, "", "utf-8");
}

export function optIn(): void {
  try { unlinkSync(OPT_OUT_FILE); } catch {}
}
