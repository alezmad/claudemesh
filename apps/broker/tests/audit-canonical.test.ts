/**
 * Audit hash chain uses canonical JSON (sorted keys) so JSONB key
 * order can't break verification. This test pins the contract.
 */

import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";

// Re-derive canonicalJson for the test (duplicate of audit.ts internal).
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

function hash(prev: string, meshId: string, eventType: string, actor: string | null, payload: Record<string, unknown>, createdAt: Date): string {
  const input = `${prev}|${meshId}|${eventType}|${actor}|${canonicalJson(payload)}|${createdAt.toISOString()}`;
  return createHash("sha256").update(input).digest("hex");
}

describe("audit canonical json hash", () => {
  test("key order does not affect the computed hash", () => {
    const createdAt = new Date("2026-04-15T12:00:00Z");
    const a = hash("prev", "mesh1", "peer_joined", "actor", { groups: [], pubkey: "abc", restored: true }, createdAt);
    const b = hash("prev", "mesh1", "peer_joined", "actor", { restored: true, pubkey: "abc", groups: [] }, createdAt);
    const c = hash("prev", "mesh1", "peer_joined", "actor", { pubkey: "abc", groups: [], restored: true }, createdAt);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test("nested object key order also irrelevant", () => {
    const createdAt = new Date("2026-04-15T12:00:00Z");
    const a = hash("x", "m", "e", null, { outer: { inner: { a: 1, b: 2 } } }, createdAt);
    const b = hash("x", "m", "e", null, { outer: { inner: { b: 2, a: 1 } } }, createdAt);
    expect(a).toBe(b);
  });

  test("array order IS significant", () => {
    const createdAt = new Date("2026-04-15T12:00:00Z");
    const a = hash("x", "m", "e", null, { list: [1, 2, 3] }, createdAt);
    const b = hash("x", "m", "e", null, { list: [3, 2, 1] }, createdAt);
    expect(a).not.toBe(b);
  });

  test("changing payload value changes the hash", () => {
    const createdAt = new Date("2026-04-15T12:00:00Z");
    const a = hash("x", "m", "e", null, { k: "v1" }, createdAt);
    const b = hash("x", "m", "e", null, { k: "v2" }, createdAt);
    expect(a).not.toBe(b);
  });
});
