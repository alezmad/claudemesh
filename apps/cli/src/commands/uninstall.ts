import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PATHS } from "~/constants/paths.js";
import { green, icons } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function uninstall(): Promise<number> {
  let removed = 0;

  // Remove MCP server from ~/.claude.json
  if (existsSync(PATHS.CLAUDE_JSON)) {
    try {
      const raw = readFileSync(PATHS.CLAUDE_JSON, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const servers = config.mcpServers as Record<string, unknown> | undefined;
      if (servers && "claudemesh" in servers) {
        delete servers.claudemesh;
        writeFileSync(PATHS.CLAUDE_JSON, JSON.stringify(config, null, 2) + "\n", "utf-8");
        console.log(`  ${green(icons.check)} Removed MCP server from ~/.claude.json`);
        removed++;
      }
    } catch {}
  }

  // Remove only claudemesh hooks from ~/.claude/settings.json
  if (existsSync(PATHS.CLAUDE_SETTINGS)) {
    try {
      const raw = readFileSync(PATHS.CLAUDE_SETTINGS, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const hooks = config.hooks as Record<string, unknown[]> | undefined;
      if (hooks) {
        let removedHooks = 0;
        for (const [event, entries] of Object.entries(hooks)) {
          if (!Array.isArray(entries)) continue;
          const filtered = entries.filter((h: unknown) => {
            const cmd = typeof h === "object" && h !== null && "command" in h ? String((h as Record<string, unknown>).command) : "";
            return !cmd.includes("claudemesh");
          });
          if (filtered.length < entries.length) {
            removedHooks += entries.length - filtered.length;
            if (filtered.length === 0) delete hooks[event];
            else hooks[event] = filtered;
          }
        }
        if (removedHooks > 0) {
          writeFileSync(PATHS.CLAUDE_SETTINGS, JSON.stringify(config, null, 2) + "\n", "utf-8");
          console.log(`  ${green(icons.check)} Removed ${removedHooks} claudemesh hook(s) from settings.json`);
          removed++;
        }
      }
    } catch {}
  }

  if (removed === 0) {
    console.log("  Nothing to remove — claudemesh was not installed.");
  }

  return EXIT.SUCCESS;
}
