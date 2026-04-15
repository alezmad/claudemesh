import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(__dirname, "../../dist/entrypoints/cli.js");

describe("golden: whoami --json", () => {
  it("outputs schema_version 1.0 when not signed in", () => {
    const env = { ...process.env, CLAUDEMESH_CONFIG_DIR: "/tmp/claudemesh-golden-test-" + Date.now() };
    const output = execSync(`node ${CLI} whoami --json`, { encoding: "utf-8", env }).trim();
    const json = JSON.parse(output);
    expect(json.schema_version).toBe("1.0");
    expect(json.signed_in).toBe(false);
  });
});
