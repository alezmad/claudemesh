import { describe, it, expect } from "vitest";
import { TEMPLATES, listTemplates, getTemplate } from "~/templates/index.js";

describe("templates", () => {
  it("has 5 templates", () => {
    expect(Object.keys(TEMPLATES)).toHaveLength(5);
    expect(listTemplates()).toHaveLength(5);
  });

  it("each template has required fields", () => {
    for (const t of listTemplates()) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(Array.isArray(t.groups)).toBe(true);
      expect(typeof t.stateKeys).toBe("object");
      expect(Array.isArray(t.suggestedRoles)).toBe(true);
      expect(t.systemPromptHint).toBeTruthy();
    }
  });

  it("getTemplate returns correct template", () => {
    const t = getTemplate("dev-team");
    expect(t).toBeDefined();
    expect(t!.name).toBe("Dev Team");
  });

  it("getTemplate returns undefined for unknown", () => {
    expect(getTemplate("nonexistent")).toBeUndefined();
  });
});
