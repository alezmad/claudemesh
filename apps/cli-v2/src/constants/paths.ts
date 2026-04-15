import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();

export const PATHS = {
  CONFIG_DIR: process.env.CLAUDEMESH_CONFIG_DIR || join(home, ".claudemesh"),
  get CONFIG_FILE() {
    return join(this.CONFIG_DIR, "config.json");
  },
  get AUTH_FILE() {
    return join(this.CONFIG_DIR, "auth.json");
  },
  get KEYS_DIR() {
    return join(this.CONFIG_DIR, "keys");
  },
  get LAST_USED_FILE() {
    return join(this.CONFIG_DIR, "last-used.json");
  },
  CLAUDE_JSON: join(home, ".claude.json"),
  CLAUDE_SETTINGS: join(home, ".claude", "settings.json"),
} as const;
