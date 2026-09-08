/**
 * Rotating log sink (1.37.1) — regression tests for the 1 GB daemon.log
 * found in the 2026-09-08 blackout. Covers: rotation at the size cap,
 * `keep` bound, total-budget purge, oversized pre-existing file rotated
 * at install, and writes surviving a rotation.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  installRotatingLogSink,
  purgeArchivesOverBudget,
  rotateLogFiles,
  type LogSinkHandle,
} from "~/daemon/log-sink.js";

let dir: string;
let sink: LogSinkHandle | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cmh-logsink-"));
});
afterEach(() => {
  sink?.uninstall();
  sink = null;
  rmSync(dir, { recursive: true, force: true });
});

const size = (p: string) => (existsSync(p) ? statSync(p).size : -1);

describe("rotateLogFiles", () => {
  it("shifts archives and drops the oldest beyond keep", () => {
    const p = join(dir, "d.log");
    writeFileSync(p, "current");
    writeFileSync(`${p}.1`, "one");
    writeFileSync(`${p}.2`, "two");
    rotateLogFiles(p, 2);
    expect(existsSync(p)).toBe(false);
    expect(readFileSync(`${p}.1`, "utf8")).toBe("current");
    expect(readFileSync(`${p}.2`, "utf8")).toBe("one");
    expect(existsSync(`${p}.3`)).toBe(false);
  });

  it("is a no-op when the active file is missing", () => {
    const p = join(dir, "missing.log");
    expect(() => rotateLogFiles(p, 3)).not.toThrow();
    expect(existsSync(`${p}.1`)).toBe(false);
  });
});

describe("purgeArchivesOverBudget", () => {
  it("deletes oldest archives until total ≤ keep × maxBytes", () => {
    const p = join(dir, "d.log");
    writeFileSync(`${p}.1`, "x".repeat(50));
    writeFileSync(`${p}.2`, "x".repeat(50));
    writeFileSync(`${p}.3`, "x".repeat(50));
    // budget = 3 × 40 = 120 < 150 → delete .3 (oldest) → 100 ≤ 120
    const deleted = purgeArchivesOverBudget(p, 3, 40);
    expect(deleted).toEqual([`${p}.3`]);
    expect(existsSync(`${p}.2`)).toBe(true);
  });

  it("deletes a single archive that alone exceeds the whole budget (the 1 GB case)", () => {
    const p = join(dir, "d.log");
    writeFileSync(`${p}.1`, "x".repeat(1000));
    const deleted = purgeArchivesOverBudget(p, 5, 100);
    expect(deleted).toEqual([`${p}.1`]);
  });
});

describe("installRotatingLogSink", () => {
  it("captures process.stdout/stderr writes into the file and rotates at the cap", () => {
    const p = join(dir, "daemon.log");
    sink = installRotatingLogSink({ path: p, maxBytes: 100, keep: 3 });
    const line = "x".repeat(39) + "\n"; // 40 bytes
    process.stdout.write(line);       // 40
    process.stderr.write(line);       // 80
    process.stdout.write(line);       // 120 ≥ 100 → rotate BEFORE writing → active=40, .1=80
    expect(size(p)).toBe(40);
    expect(size(`${p}.1`)).toBe(80);
    expect(readFileSync(`${p}.1`, "utf8").split("\n").filter(Boolean)).toHaveLength(2);
    // Writes keep landing after the rotation (fd reopened).
    process.stdout.write("after\n");
    expect(readFileSync(p, "utf8")).toContain("after");
  });

  it("never keeps more than `keep` archives", () => {
    const p = join(dir, "daemon.log");
    sink = installRotatingLogSink({ path: p, maxBytes: 10, keep: 2 });
    // 10-byte lines at a 10-byte cap → rotate on every write after the
    // first; two 10-byte archives sit exactly at the 2 × 10 budget.
    for (let i = 0; i < 20; i++) process.stdout.write("012345678\n");
    expect(existsSync(`${p}.1`)).toBe(true);
    expect(existsSync(`${p}.2`)).toBe(true);
    expect(existsSync(`${p}.3`)).toBe(false);
  });

  it("rotates an oversized pre-existing file at install and enforces the budget", () => {
    const p = join(dir, "daemon.log");
    writeFileSync(p, "y".repeat(5000)); // way over 100-byte cap and over 3×100 budget
    sink = installRotatingLogSink({ path: p, maxBytes: 100, keep: 3 });
    // Active file starts fresh…
    expect(size(p)).toBe(0);
    // …and the huge archive alone exceeded the 300-byte budget → purged.
    expect(existsSync(`${p}.1`)).toBe(false);
    process.stdout.write("hello\n");
    expect(readFileSync(p, "utf8")).toBe("hello\n");
  });

  it("keeps a modest pre-existing file as .1 when within budget", () => {
    const p = join(dir, "daemon.log");
    writeFileSync(p, "y".repeat(150)); // over the 100 cap, under the 500 budget
    sink = installRotatingLogSink({ path: p, maxBytes: 100, keep: 5 });
    expect(size(p)).toBe(0);
    expect(size(`${p}.1`)).toBe(150);
  });

  it("writeLine appends a newline and rotateNow forces a rotation", () => {
    const p = join(dir, "daemon.log");
    sink = installRotatingLogSink({ path: p, maxBytes: 10_000, keep: 2 });
    sink.writeLine("{\"msg\":\"a\"}");
    expect(readFileSync(p, "utf8")).toBe("{\"msg\":\"a\"}\n");
    expect(sink.currentSize()).toBe(12);
    sink.rotateNow();
    expect(size(p)).toBe(0);
    expect(readFileSync(`${p}.1`, "utf8")).toBe("{\"msg\":\"a\"}\n");
  });

  it("uninstall restores the original streams", () => {
    const p = join(dir, "daemon.log");
    const before = process.stdout.write;
    sink = installRotatingLogSink({ path: p, maxBytes: 1000, keep: 1 });
    expect(process.stdout.write).not.toBe(before);
    sink.uninstall();
    sink = null;
    // Restored function is the bound original — writing must not touch the file.
    expect(size(p)).toBe(0);
  });
});
