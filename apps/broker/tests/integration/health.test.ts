/**
 * /health and /metrics integration tests.
 *
 * Spawns the broker as a subprocess on a random port. Covers:
 *   - GET /health with healthy DB → 200 + {status, db, version, gitSha, uptime}
 *   - GET /health with unreachable DB → 503 + {status:"degraded", db:"down"}
 *   - GET /metrics returns Prometheus plaintext with all expected series
 *   - POST /hook/set-status rate-limited after N requests
 *   - POST /hook/set-status oversized body returns 413
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

interface BrokerProc {
  port: number;
  kill: () => void;
}

async function waitHealthyOrAny(port: number, maxMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (r.status === 200 || r.status === 503) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`broker on :${port} did not come up`);
}

/** Wait until /health returns 200 (HTTP + DB ping both completed). */
async function waitFullyHealthy(port: number, maxMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (r.status === 200) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`broker on :${port} did not become fully healthy`);
}

function spawnBroker(env: Record<string, string>): BrokerProc {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const brokerEntry = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "src",
    "index.ts",
  );
  const proc: ChildProcess = spawn("bun", [brokerEntry], {
    env: {
      ...process.env,
      ...env,
      BROKER_PORT: String(port),
    },
    stdio: "ignore",
  });
  return {
    port,
    kill: () => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    },
  };
}

describe("/health endpoint", () => {
  let broker: BrokerProc;
  beforeAll(async () => {
    broker = spawnBroker({
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://turbostarter:turbostarter@127.0.0.1:5440/claudemesh_test",
    });
    await waitFullyHealthy(broker.port);
  });
  afterAll(() => broker?.kill());

  test("returns 200 + full payload when DB is up", async () => {
    const r = await fetch(`http://localhost:${broker.port}/health`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.db).toBe("up");
    expect(body.version).toBe("0.1.0");
    expect(typeof body.gitSha).toBe("string");
    expect((body.gitSha as string).length).toBeGreaterThan(0);
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  test("/metrics returns Prometheus plaintext with all expected series", async () => {
    const r = await fetch(`http://localhost:${broker.port}/metrics`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/plain/);
    const text = await r.text();
    const expected = [
      "broker_connections_total",
      "broker_connections_rejected_total",
      "broker_connections_active",
      "broker_messages_routed_total",
      "broker_queue_depth",
      "broker_ttl_sweeps_total",
      "broker_hook_requests_total",
      "broker_db_healthy",
    ];
    for (const name of expected) expect(text).toContain(name);
  });

  test("/health unknown route returns 404", async () => {
    const r = await fetch(`http://localhost:${broker.port}/nope`);
    expect(r.status).toBe(404);
  });
});

describe("/health with unreachable DB", () => {
  let broker: BrokerProc;
  beforeAll(async () => {
    // Point at a port nothing is listening on — pg client fails fast.
    broker = spawnBroker({
      DATABASE_URL: "postgresql://nobody:nothing@127.0.0.1:1/nowhere",
    });
    await waitHealthyOrAny(broker.port);
  });
  afterAll(() => broker?.kill());

  test("returns 503 + degraded payload when DB unreachable", async () => {
    // db-health starts its ping loop on boot — give it a moment to fail once.
    await new Promise((r) => setTimeout(r, 1500));
    const r = await fetch(`http://localhost:${broker.port}/health`);
    expect(r.status).toBe(503);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.status).toBe("degraded");
    expect(body.db).toBe("down");
    // Build info still present even when degraded.
    expect(body.version).toBe("0.1.0");
    expect(typeof body.gitSha).toBe("string");
  });
});

describe("POST /hook/set-status rate limit + size limit", () => {
  let broker: BrokerProc;
  beforeAll(async () => {
    broker = spawnBroker({
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://turbostarter:turbostarter@127.0.0.1:5440/claudemesh_test",
      HOOK_RATE_LIMIT_PER_MIN: "5",
      MAX_MESSAGE_BYTES: "512",
    });
    await waitHealthyOrAny(broker.port);
  });
  afterAll(() => broker?.kill());

  test("payload over MAX_MESSAGE_BYTES returns 413", async () => {
    const big = "x".repeat(1024);
    const r = await fetch(
      `http://localhost:${broker.port}/hook/set-status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: big, status: "idle" }),
      },
    );
    expect(r.status).toBe(413);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
  });

  test("6th request from same (pid, cwd) within a minute → 429", async () => {
    const body = JSON.stringify({
      cwd: "/rate-test",
      pid: 42,
      status: "idle",
    });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(
        `http://localhost:${broker.port}/hook/set-status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
      );
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });

  test("rate limit is per (pid, cwd) — different key gets fresh bucket", async () => {
    // Use unique key to avoid collision with previous test's bucket.
    const body1 = JSON.stringify({ cwd: "/k1", pid: 1001, status: "idle" });
    const body2 = JSON.stringify({ cwd: "/k2", pid: 1002, status: "idle" });
    for (let i = 0; i < 5; i++) {
      const r = await fetch(
        `http://localhost:${broker.port}/hook/set-status`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: body1 },
      );
      expect(r.status).toBe(200);
    }
    // key 1 now exhausted; key 2 still has full bucket
    const r = await fetch(
      `http://localhost:${broker.port}/hook/set-status`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: body2 },
    );
    expect(r.status).toBe(200);
  });
});
