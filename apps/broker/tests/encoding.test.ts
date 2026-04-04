/**
 * Path encoding tests — pure unit tests, no DB required.
 *
 * Pins Claude Code's project-key encoding across platforms:
 *   macOS/Linux: /Users/x/foo  → -Users-x-foo
 *   Windows:     H:\Claude     → H--Claude (confirmed 2026-04-04)
 *   Windows:     C:\Users\x    → C--Users-x
 */

import { describe, expect, test } from "vitest";
import { cwdToProjectKeyCandidates } from "../src/paths";

describe("cwdToProjectKeyCandidates", () => {
  test("macOS path → -Users-x-foo first", () => {
    const keys = cwdToProjectKeyCandidates("/Users/agutierrez/Desktop/foo");
    expect(keys[0]).toBe("-Users-agutierrez-Desktop-foo");
  });

  test("Linux path → -home-alice-project first", () => {
    const keys = cwdToProjectKeyCandidates("/home/alice/project");
    expect(keys[0]).toBe("-home-alice-project");
  });

  test("Windows H:\\Claude → H--Claude first (Roberto 2026-04-04)", () => {
    const keys = cwdToProjectKeyCandidates("H:\\Claude");
    expect(keys[0]).toBe("H--Claude");
  });

  test("Windows C:\\Users\\Alice\\dev\\myapp → C--Users-Alice-dev-myapp first", () => {
    const keys = cwdToProjectKeyCandidates("C:\\Users\\Alice\\dev\\myapp");
    expect(keys[0]).toBe("C--Users-Alice-dev-myapp");
  });

  test("candidates are deduped", () => {
    const keys = cwdToProjectKeyCandidates("/Users/x/foo");
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size);
  });

  test("Windows path includes a drive-stripped fallback", () => {
    const keys = cwdToProjectKeyCandidates("C:\\Users\\Alice");
    expect(keys).toContain("-Users-Alice");
  });

  test("leading-dash fallback added when cwd has no leading separator", () => {
    const keys = cwdToProjectKeyCandidates("project/foo");
    expect(keys).toContain("project-foo");
    expect(keys).toContain("-project-foo");
  });
});
