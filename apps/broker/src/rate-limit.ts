/**
 * Token-bucket rate limiter keyed by an arbitrary string.
 *
 * Used to cap POST /hook/set-status at a sane per-session rate
 * (hook scripts legitimately fire every turn; anything faster is
 * either a loop or a compromised agent).
 *
 * In-process only. If we scale to multiple broker instances this
 * moves to Redis, but for the single-instance broker it's enough.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class TokenBucket {
  private buckets = new Map<string, Bucket>();
  private readonly refillPerMs: number;

  constructor(
    private capacity: number,
    refillPerMinute: number,
  ) {
    this.refillPerMs = refillPerMinute / 60_000;
  }

  /** Take one token. Returns true if allowed, false if rate-limited. */
  take(key: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? {
      tokens: this.capacity,
      lastRefill: now,
    };
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      bucket.tokens = Math.min(
        this.capacity,
        bucket.tokens + elapsed * this.refillPerMs,
      );
      bucket.lastRefill = now;
    }
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  /** Periodic GC: drop buckets whose keys haven't been touched in a while. */
  sweep(olderThanMs = 10 * 60 * 1000, now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > olderThanMs) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}
