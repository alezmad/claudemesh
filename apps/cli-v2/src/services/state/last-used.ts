import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PATHS } from "~/constants/paths.js";
import { ensureConfigDir } from "~/services/config/facade.js";
import type { LastUsed } from "./schemas.js";

export function getLastUsed(): LastUsed | null {
  if (!existsSync(PATHS.LAST_USED_FILE)) return null;
  try {
    const raw = readFileSync(PATHS.LAST_USED_FILE, "utf-8");
    return JSON.parse(raw) as LastUsed;
  } catch {
    return null;
  }
}

export function setLastUsed(entry: Omit<LastUsed, "timestamp">): void {
  ensureConfigDir();
  const data: LastUsed = { ...entry, timestamp: new Date().toISOString() };
  writeFileSync(PATHS.LAST_USED_FILE, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
