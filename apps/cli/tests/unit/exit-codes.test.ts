import { describe, it, expect } from "vitest";
import { EXIT } from "~/constants/exit-codes.js";

describe("exit codes", () => {
  it("SUCCESS is 0", () => { expect(EXIT.SUCCESS).toBe(0); });
  it("AUTH_FAILED is 2", () => { expect(EXIT.AUTH_FAILED).toBe(2); });
  it("INVALID_ARGS is 3", () => { expect(EXIT.INVALID_ARGS).toBe(3); });
  it("INTERNAL_ERROR is 8", () => { expect(EXIT.INTERNAL_ERROR).toBe(8); });
  it("all codes are unique", () => {
    const values = Object.values(EXIT);
    expect(new Set(values).size).toBe(values.length);
  });
});
