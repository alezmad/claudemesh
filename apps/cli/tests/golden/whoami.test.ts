import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(__dirname, "../../dist/entrypoints/cli.js");

describe("golden: whoami --json", () => {
  it("outputs schema_version 1.0 when not signed in", () => {
    // `whoami --json` exits 2 (EXIT.AUTH_FAILED) when not signed in.
    // The JSON is still valid output and the contract under test —
    // capture stdout independently of exit code.
    const env = { ...process.env, CLAUDEMESH_CONFIG_DIR: "/tmp/claudemesh-golden-test-" + Date.now() };
    const result = spawnSync("node", [CLI, "whoami", "--json"], { encoding: "utf-8", env });
    expect([0, 2]).toContain(result.status);
    const json = JSON.parse(result.stdout.trim());
    expect(json.schema_version).toBe("1.0");
    expect(json.signed_in).toBe(false);
  });
});
