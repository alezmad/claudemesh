/**
 * Structured logger output format tests.
 *
 * Intercepts stderr and asserts: one JSON object per line, required
 * fields present, merged context preserved, no plain text leaks.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { log } from "../src/logger";

let captured: string[] = [];
let originalError: typeof console.error;

beforeEach(() => {
  captured = [];
  originalError = console.error;
  console.error = vi.fn((msg: unknown) => {
    captured.push(String(msg));
  });
});

afterEach(() => {
  console.error = originalError;
});

describe("structured logger", () => {
  test("emits one JSON object per log call", () => {
    log.info("test msg");
    expect(captured).toHaveLength(1);
    expect(() => JSON.parse(captured[0]!)).not.toThrow();
  });

  test("required fields: ts, level, component, msg", () => {
    log.info("hello");
    const entry = JSON.parse(captured[0]!) as Record<string, unknown>;
    expect(entry.ts).toBeTruthy();
    expect(entry.level).toBe("info");
    expect(entry.component).toBe("broker");
    expect(entry.msg).toBe("hello");
    // ts should be valid ISO 8601
    expect(() => new Date(entry.ts as string)).not.toThrow();
  });

  test("context object is merged into the entry", () => {
    log.warn("capacity", { mesh_id: "m1", existing: 100, cap: 100 });
    const entry = JSON.parse(captured[0]!) as Record<string, unknown>;
    expect(entry.level).toBe("warn");
    expect(entry.mesh_id).toBe("m1");
    expect(entry.existing).toBe(100);
    expect(entry.cap).toBe(100);
  });

  test("all four levels preserved on their respective emits", () => {
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    const levels = captured.map((s) => JSON.parse(s).level);
    expect(levels).toEqual(["debug", "info", "warn", "error"]);
  });

  test("no plain-text escape hatches — output is always JSON", () => {
    log.info("line 1");
    log.error("line 2", { code: "X" });
    log.debug("line 3");
    for (const line of captured) {
      expect(line.trim()).toMatch(/^\{.*\}$/);
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
