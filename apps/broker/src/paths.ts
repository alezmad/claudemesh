/**
 * JSONL session-transcript discovery.
 *
 * Ported verbatim from ~/tools/claude-intercom/broker.ts — including
 * the cross-platform 5-candidate encoding strategy and Roberto's
 * confirmed Windows rule (H:\Claude → H--Claude via [\\/:]→-).
 *
 * Used as the *fallback* status inference path when no fresh hook
 * signal is available for a presence row.
 */

import {
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  existsSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const TAIL_BYTES = 8192;

/**
 * Generate candidate project-key formats for a given cwd.
 *
 * Claude Code stores session transcripts under
 * `~/.claude/projects/<KEY>/`. The encoding differs per platform:
 *
 *   macOS/Linux: /Users/x/foo  → "-Users-x-foo"    (replace / with -)
 *   Windows:     H:\Claude     → "H--Claude"       (replace : and \ with -)
 *   Windows:     C:\Users\x    → "C--Users-x"      (same rule)
 *
 * We emit the platform-native candidate first, then fallbacks, so the
 * first directory existence check typically wins.
 */
export function cwdToProjectKeyCandidates(cwd: string): string[] {
  const seen = new Set<string>();
  const push = (s: string): void => {
    if (s && !seen.has(s)) seen.add(s);
  };

  // Most likely: replace /, \, and : with dash. Matches macOS/Linux and
  // Windows (confirmed live: H:\Claude → H--Claude).
  push(cwd.replace(/[\\/:]/g, "-"));
  // Unix legacy (replace / only).
  push(cwd.replaceAll("/", "-"));
  // Replace both separators, keep colons (hypothetical Windows variant).
  push(cwd.replace(/[\\/]/g, "-"));
  // Strip drive letter, then Unix-style.
  const withoutDrive = cwd.replace(/^[A-Za-z]:/, "");
  push(withoutDrive.replace(/[\\/]/g, "-"));
  // Leading-dash fallback for relative-ish paths.
  for (const k of [...seen]) {
    if (!k.startsWith("-")) push("-" + k);
  }

  return [...seen];
}

/**
 * Find the most recently modified JSONL file for a project, trying
 * each candidate key in order. Returns the first match that exists.
 */
export function findActiveJsonl(
  cwd: string,
): { path: string; mtime: number } | null {
  for (const key of cwdToProjectKeyCandidates(cwd)) {
    const projDir = join(PROJECTS_DIR, key);
    if (!existsSync(projDir)) continue;
    try {
      const files = readdirSync(projDir).filter((f) => f.endsWith(".jsonl"));
      let best: { path: string; mtime: number } | null = null;
      for (const f of files) {
        const full = join(projDir, f);
        try {
          const st = statSync(full);
          const mt = st.mtimeMs;
          if (!best || mt > best.mtime) best = { path: full, mtime: mt };
        } catch {
          /* skip unreadable files */
        }
      }
      if (best) return best;
    } catch {
      /* can't read dir, try next candidate */
    }
  }
  return null;
}

/**
 * Tail the JSONL file and check whether the last assistant message
 * has a pending tool_use (= the session is actively running a tool).
 */
function lastAssistantHasToolUse(filePath: string): boolean {
  try {
    const st = statSync(filePath);
    const size = st.size;
    if (size === 0) return false;
    const readSize = Math.min(TAIL_BYTES, size);
    const buf = Buffer.alloc(readSize);
    const fd = openSync(filePath, "r");
    try {
      readSync(fd, buf, 0, readSize, size - readSize);
    } finally {
      closeSync(fd);
    }
    const tail = buf.toString("utf-8");
    const lines = tail.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;
      if (!line.includes('"assistant"')) continue;
      try {
        const d = JSON.parse(line);
        if (d.type !== "assistant") continue;
        const content = d.message?.content;
        if (!Array.isArray(content)) continue;
        return content.some((c: { type?: string }) => c.type === "tool_use");
      } catch {
        /* malformed line, skip */
      }
    }
  } catch {
    /* file read error */
  }
  return false;
}

/**
 * Infer peer status from JSONL: "working" if last assistant entry has
 * a pending tool_use, else "idle". Returns "idle" if no transcript.
 */
export function inferStatusFromJsonl(cwd: string): "idle" | "working" {
  const jsonl = findActiveJsonl(cwd);
  if (!jsonl) return "idle";
  return lastAssistantHasToolUse(jsonl.path) ? "working" : "idle";
}
