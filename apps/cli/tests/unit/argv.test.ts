import { describe, it, expect } from "vitest";
import { parseArgv } from "~/cli/argv.js";

describe("parseArgv", () => {
  it("parses bare command", () => {
    const r = parseArgv(["node", "cli.js", "login"]);
    expect(r.command).toBe("login");
    expect(r.positionals).toEqual([]);
    expect(r.flags).toEqual({});
  });

  it("parses command with positionals", () => {
    const r = parseArgv(["node", "cli.js", "send", "alice", "hello world"]);
    expect(r.command).toBe("send");
    expect(r.positionals).toEqual(["alice", "hello world"]);
  });

  it("parses flags before command", () => {
    const r = parseArgv(["node", "cli.js", "--version"]);
    expect(r.command).toBe("");
    expect(r.flags.version).toBe(true);
  });

  it("parses flags with values", () => {
    const r = parseArgv(["node", "cli.js", "peers", "--mesh", "my-team", "--json"]);
    expect(r.command).toBe("peers");
    expect(r.flags.mesh).toBe("my-team");
    expect(r.flags.json).toBe(true);
  });

  it("parses short flags", () => {
    const r = parseArgv(["node", "cli.js", "-y", "-q"]);
    expect(r.flags.y).toBe(true);
    expect(r.flags.q).toBe(true);
  });

  it("empty args", () => {
    const r = parseArgv(["node", "cli.js"]);
    expect(r.command).toBe("");
    expect(r.positionals).toEqual([]);
  });
});
