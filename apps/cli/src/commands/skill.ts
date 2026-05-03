/**
 * `claudemesh skill` — print the bundled SKILL.md to stdout.
 *
 * Zero-install access: the skill is embedded into the binary at build
 * time via Bun's text-import attribute, so a fresh `npm i -g` user
 * (or someone running the prebuilt binary) can pipe the contents into
 * Claude Code (or anywhere else) without copying files into
 * ~/.claude/skills.
 *
 *   claudemesh skill | claude --skill-add -
 *   claudemesh skill > /tmp/cm.md
 */

import skillContent from "../../skills/claudemesh/SKILL.md" with { type: "text" };
import { EXIT } from "~/constants/exit-codes.js";

export async function runSkill(): Promise<number> {
  process.stdout.write(skillContent);
  if (!skillContent.endsWith("\n")) process.stdout.write("\n");
  return EXIT.SUCCESS;
}
