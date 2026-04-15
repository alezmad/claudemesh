import { describe, it, expect } from "vitest";
import { runAllChecks, runCheck } from "~/services/health/facade.js";

describe("health checks", () => {
  it("runAllChecks returns 6 results", () => {
    const results = runAllChecks();
    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r).toHaveProperty("name");
      expect(r).toHaveProperty("ok");
      expect(r).toHaveProperty("message");
    }
  });

  it("node-version passes on Node 20+", () => {
    const result = runCheck("node-version");
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
  });

  it("runCheck returns null for unknown check", () => {
    expect(runCheck("nonexistent")).toBeNull();
  });
});
