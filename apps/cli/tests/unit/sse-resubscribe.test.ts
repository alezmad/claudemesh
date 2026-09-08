/**
 * MCP SSE resubscribe (1.37.1) — regression for the 2026-09-08 finding
 * that a daemon dying hard (SIGKILL / process.exit) left every MCP
 * plugin's `/v1/events` subscription dead: the response emitted
 * `aborted`/`close` (never `end`), and the pre-1.37.1 client only
 * resubscribed on `end`. Also covers the idle watchdog (no bytes at all,
 * e.g. a half-open socket after sleep).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { subscribeEvents } from "~/mcp/server.js";

let dir: string;
let server: Server | null = null;
let sockPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cmh-sse-"));
  sockPath = join(dir, "d.sock");
});
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
  rmSync(dir, { recursive: true, force: true });
});

interface Fake {
  connections: number;
  responses: ServerResponse[];
}

function startFakeDaemon(opts: { keepalive?: boolean } = {}): Promise<Fake> {
  const fake: Fake = { connections: 0, responses: [] };
  server = createServer((req, res) => {
    if (req.url !== "/v1/events") { res.statusCode = 404; res.end(); return; }
    fake.connections++;
    fake.responses.push(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.write(": connected\n\n");
    if (opts.keepalive !== false) {
      const t = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { /* gone */ } }, 100);
      res.on("close", () => clearInterval(t));
    }
  });
  return new Promise((resolve) => server!.listen(sockPath, () => resolve(fake)));
}

const waitFor = async (pred: () => boolean, ms = 3_000): Promise<void> => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("subscribeEvents resubscribe", () => {
  it("reconnects when the daemon destroys the socket without ending the response (kill -9)", async () => {
    const fake = await startFakeDaemon();
    const events: string[] = [];
    const logs: string[] = [];
    const sub = subscribeEvents((e) => events.push(e.kind), {
      socketPath: sockPath,
      backoffMs: [50, 50],
      idleTimeoutMs: 0,
      log: (m) => logs.push(m),
    });
    try {
      await waitFor(() => fake.connections === 1);
      // Simulate a hard daemon death: tear the TCP/UDS socket down with no
      // `end` frame. The client sees close/aborted/error — never `end`.
      fake.responses[0]!.socket?.destroy();
      await waitFor(() => fake.connections >= 2, 3_000);
      expect(fake.connections).toBeGreaterThanOrEqual(2);
      expect(logs).toContain("sse_reconnect");
      expect(logs.filter((l) => l === "sse_subscribed").length).toBeGreaterThanOrEqual(2);
      // The new stream is live: an event pushed on it reaches onEvent.
      const res = fake.responses[fake.responses.length - 1]!;
      res.write(`event: message\ndata: ${JSON.stringify({ ts: "t", body: "hi" })}\n\n`);
      await waitFor(() => events.includes("message"));
    } finally {
      sub.close();
    }
  });

  it("reconnects when the daemon is down at first and comes up later (connect error path)", async () => {
    const events: string[] = [];
    const sub = subscribeEvents((e) => events.push(e.kind), {
      socketPath: sockPath, backoffMs: [50, 50], idleTimeoutMs: 0,
    });
    try {
      await new Promise((r) => setTimeout(r, 120)); // a couple of ECONNREFUSED/ENOENT attempts
      const fake = await startFakeDaemon();
      await waitFor(() => fake.connections >= 1, 3_000);
    } finally {
      sub.close();
    }
  });

  it("idle watchdog: destroys a silent stream and resubscribes", async () => {
    const fake = await startFakeDaemon({ keepalive: false });
    const logs: string[] = [];
    const sub = subscribeEvents(() => { /* ignore */ }, {
      socketPath: sockPath,
      backoffMs: [30],
      idleTimeoutMs: 300,
      log: (m) => logs.push(m),
    });
    try {
      await waitFor(() => fake.connections === 1);
      await waitFor(() => fake.connections >= 2, 3_000);
      expect(logs).toContain("sse_idle_timeout");
    } finally {
      sub.close();
    }
  });

  it("a live keepalive stream is NOT torn down by the watchdog", async () => {
    const fake = await startFakeDaemon({ keepalive: true }); // keepalive every 100 ms
    const logs: string[] = [];
    const sub = subscribeEvents(() => { /* ignore */ }, {
      socketPath: sockPath, backoffMs: [30], idleTimeoutMs: 400, log: (m) => logs.push(m),
    });
    try {
      await waitFor(() => fake.connections === 1);
      await new Promise((r) => setTimeout(r, 900));
      expect(fake.connections).toBe(1);
      expect(logs).not.toContain("sse_idle_timeout");
    } finally {
      sub.close();
    }
  });

  it("close() stops reconnecting", async () => {
    const fake = await startFakeDaemon();
    const sub = subscribeEvents(() => { /* ignore */ }, {
      socketPath: sockPath, backoffMs: [30], idleTimeoutMs: 0,
    });
    await waitFor(() => fake.connections === 1);
    sub.close();
    await new Promise((r) => setTimeout(r, 300));
    expect(fake.connections).toBe(1);
  });
});
