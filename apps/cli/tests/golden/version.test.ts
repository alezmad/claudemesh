import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(__dirname, "../../dist/entrypoints/cli.js");

describe("golden: --version", () => {
  it("outputs version string", () => {
    const output = execSync(`node ${CLI} --version`, { encoding: "utf-8" }).trim();
    expect(output).toMatch(/claudemesh v\d+\.\d+\.\d+/);
  });
});
