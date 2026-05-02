import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { PATHS } from "~/constants/paths.js";
import { render } from "~/ui/render.js";
import { dim } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

const CLAUDE_SKILLS_ROOT = join(homedir(), ".claude", "skills");

/** Locate the bundled `skills/` directory shipped with this package. */
function bundledSkillsDir(): string | null {
  const here = fileURLToPath(import.meta.url);
  const pkgRoot = join(dirname(here), "..", "..");
  const skillsDir = join(pkgRoot, "skills");
  return existsSync(skillsDir) ? skillsDir : null;
}

export async function uninstall(): Promise<number> {
  let removed = 0;

  if (existsSync(PATHS.CLAUDE_JSON)) {
    try {
      const raw = readFileSync(PATHS.CLAUDE_JSON, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const servers = config.mcpServers as Record<string, unknown> | undefined;
      if (servers && "claudemesh" in servers) {
        delete servers.claudemesh;
        writeFileSync(PATHS.CLAUDE_JSON, JSON.stringify(config, null, 2) + "\n", "utf-8");
        render.ok("removed MCP server", dim("~/.claude.json"));
        removed++;
      }
    } catch {}
  }

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
          render.ok(`removed ${removedHooks} claudemesh hook${removedHooks === 1 ? "" : "s"}`, dim("settings.json"));
          removed++;
        }
      }
    } catch {}
  }

  // Skills shipped by claudemesh install — remove from ~/.claude/skills/.
  const src = bundledSkillsDir();
  if (src) {
    const removedSkills: string[] = [];
    try {
      for (const entry of readdirSync(src, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dst = join(CLAUDE_SKILLS_ROOT, entry.name);
        if (existsSync(dst)) {
          try {
            rmSync(dst, { recursive: true, force: true });
            removedSkills.push(entry.name);
          } catch { /* best effort */ }
        }
      }
      if (removedSkills.length > 0) {
        render.ok(
          `removed Claude skill${removedSkills.length === 1 ? "" : "s"}`,
          removedSkills.join(", "),
        );
        removed++;
      }
    } catch { /* best effort */ }
  }

  if (removed === 0) {
    render.info(dim("Nothing to remove — claudemesh was not installed."));
  }

  return EXIT.SUCCESS;
}
