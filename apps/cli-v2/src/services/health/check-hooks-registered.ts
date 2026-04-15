import { existsSync, readFileSync } from "node:fs";
import { PATHS } from "~/constants/paths.js";
import type { CheckResult } from "./types.js";

export function checkHooksRegistered(): CheckResult {
  try {
    if (!existsSync(PATHS.CLAUDE_SETTINGS)) {
      return { name: "hooks-registered", ok: false, message: "~/.claude/settings.json not found" };
    }
    const raw = readFileSync(PATHS.CLAUDE_SETTINGS, "utf-8");
    const config = JSON.parse(raw) as { hooks?: Record<string, unknown> };
    if (config.hooks) {
      return { name: "hooks-registered", ok: true, message: "Hooks configured" };
    }
    return { name: "hooks-registered", ok: false, message: "No hooks in settings.json" };
  } catch {
    return { name: "hooks-registered", ok: false, message: "Could not read settings.json" };
  }
}
