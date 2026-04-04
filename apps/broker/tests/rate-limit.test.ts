/**
 * TokenBucket tests — pure unit tests, no I/O.
 *
 * Verifies the rate limiter applied to POST /hook/set-status.
 * Uses injected `now` timestamps to avoid sleeps.
 */

import { describe, expect, test } from "vitest";
import { TokenBucket } from "../src/rate-limit";

describe("TokenBucket", () => {
  test("allows up to `capacity` requests in a burst", () => {
    const b = new TokenBucket(5, 60); // 5 capacity, 60/min refill
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(b.take("key", t0)).toBe(true);
    }
    expect(b.take("key", t0)).toBe(false);
  });

  test("30/min means 31st in first minute is rejected", () => {
    const b = new TokenBucket(30, 30);
    const t0 = 1_000_000;
    // Burst: drain the bucket at t0.
    for (let i = 0; i < 30; i++) expect(b.take("p:cwd", t0)).toBe(true);
    expect(b.take("p:cwd", t0)).toBe(false);
  });

  test("refills over time", () => {
    const b = new TokenBucket(5, 60); // refill rate = 60/min = 1/sec
    const t0 = 1_000_000;
    // Drain
    for (let i = 0; i < 5; i++) b.take("k", t0);
    expect(b.take("k", t0)).toBe(false);
    // +1 second = +1 token
    expect(b.take("k", t0 + 1000)).toBe(true);
    expect(b.take("k", t0 + 1000)).toBe(false);
    // +2 more seconds = +2 tokens
    expect(b.take("k", t0 + 3000)).toBe(true);
    expect(b.take("k", t0 + 3000)).toBe(true);
  });

  test("does not refill beyond capacity", () => {
    const b = new TokenBucket(5, 60);
    const t0 = 1_000_000;
    b.take("k", t0); // 4 remaining
    // Jump forward way past full refill
    const far = t0 + 60 * 60 * 1000; // +1 hour
    // Should allow only `capacity` consecutive takes, not more
    for (let i = 0; i < 5; i++) expect(b.take("k", far)).toBe(true);
    expect(b.take("k", far)).toBe(false);
  });

  test("different keys have independent buckets", () => {
    const b = new TokenBucket(2, 60);
    const t0 = 1_000_000;
    expect(b.take("a", t0)).toBe(true);
    expect(b.take("a", t0)).toBe(true);
    expect(b.take("a", t0)).toBe(false);
    // "b" is fresh.
    expect(b.take("b", t0)).toBe(true);
    expect(b.take("b", t0)).toBe(true);
    expect(b.take("b", t0)).toBe(false);
  });

  test("sweep removes buckets older than threshold", () => {
    const b = new TokenBucket(5, 60);
    const t0 = 1_000_000;
    b.take("stale", t0);
    b.take("fresh", t0 + 100_000);
    expect(b.size).toBe(2);
    // Sweep anything untouched for >60s, as of t0 + 90s.
    b.sweep(60_000, t0 + 90_000);
    expect(b.size).toBe(1);
  });
});
