import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "claudemesh-test-" + Date.now());

describe("config", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.CLAUDEMESH_CONFIG_DIR = TEST_DIR;
  });
  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.CLAUDEMESH_CONFIG_DIR;
  });

  it("readConfig returns empty when no file", async () => {
    // Dynamic import to pick up env change
    const { readConfig } = await import("~/services/config/read.js");
    const config = readConfig();
    expect(config.version).toBe(1);
    expect(config.meshes).toEqual([]);
  });

  it("writeConfig + readConfig round-trip", async () => {
    const { writeConfig } = await import("~/services/config/write.js");
    const { readConfig } = await import("~/services/config/read.js");
    writeConfig({
      version: 1,
      meshes: [{ meshId: "m1", memberId: "mb1", slug: "test", name: "Test", pubkey: "a".repeat(64), secretKey: "b".repeat(128), brokerUrl: "wss://localhost/ws", joinedAt: "2026-01-01" }],
    });

    const config = readConfig();
    expect(config.meshes).toHaveLength(1);
    expect(config.meshes[0]!.slug).toBe("test");
  });

  it("config file has 0600 permissions on unix", async () => {
    if (process.platform === "win32") return;
    const { writeConfig } = await import("~/services/config/write.js");
    writeConfig({ version: 1, meshes: [] });

    const configPath = join(TEST_DIR, "config.json");
    const mode = statSync(configPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
