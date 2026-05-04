import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

/** Each test imports a fresh copy of paths.ts via dynamic import +
 *  `_resetPathsForTest()` so memoization doesn't leak across cases. */

const TEST_DIR = join(tmpdir(), "claudemesh-paths-test-" + Date.now());

describe("paths CONFIG_DIR resolution", () => {
  beforeEach(() => {
    delete process.env.CLAUDEMESH_CONFIG_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });
  afterEach(() => {
    delete process.env.CLAUDEMESH_CONFIG_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("falls back to ~/.claudemesh when env var is unset", async () => {
    const mod = await import("~/constants/paths.js");
    mod._resetPathsForTest();
    expect(mod.PATHS.CONFIG_DIR).toBe(join(homedir(), ".claudemesh"));
  });

  it("honors CLAUDEMESH_CONFIG_DIR when the dir exists, even without config.json", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.CLAUDEMESH_CONFIG_DIR = TEST_DIR;
    const mod = await import("~/constants/paths.js");
    mod._resetPathsForTest();
    expect(mod.PATHS.CONFIG_DIR).toBe(TEST_DIR);
  });

  it("falls back to default when env points at a missing dir (stale-tmpdir case)", async () => {
    process.env.CLAUDEMESH_CONFIG_DIR = "/var/folders/_nonexistent_claudemesh_dir_xyz123";
    const mod = await import("~/constants/paths.js");
    mod._resetPathsForTest();
    // Suppress the stderr warning to keep test output clean
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(mod.PATHS.CONFIG_DIR).toBe(join(homedir(), ".claudemesh"));
    } finally {
      stderr.mockRestore();
    }
  });

  it("memoizes — second access returns the same path even if env changes mid-process", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.CLAUDEMESH_CONFIG_DIR = TEST_DIR;
    const mod = await import("~/constants/paths.js");
    mod._resetPathsForTest();
    const first = mod.PATHS.CONFIG_DIR;
    process.env.CLAUDEMESH_CONFIG_DIR = "/something/else";
    expect(mod.PATHS.CONFIG_DIR).toBe(first);
  });
});
