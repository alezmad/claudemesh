// Lightweight in-process event bus + SSE writer. Used by /v1/events SSE
// stream and consumed by hooks (post-v0.9.0).

import type { ServerResponse } from "node:http";

export type DaemonEventKind =
  | "message"
  | "peer_join"
  | "peer_leave"
  | "broker_status"
  | "system";

export interface DaemonEvent {
  kind: DaemonEventKind;
  ts: string;
  data: Record<string, unknown>;
}

type Subscriber = (e: DaemonEvent) => void;

export class EventBus {
  private subs = new Set<Subscriber>();

  publish(kind: DaemonEventKind, data: Record<string, unknown>): void {
    const e: DaemonEvent = { kind, ts: new Date().toISOString(), data };
    for (const s of this.subs) {
      try { s(e); } catch { /* one bad subscriber must not poison the rest */ }
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}

/** Write an event to an open SSE response. */
export function writeSse(res: ServerResponse, e: DaemonEvent, idCounter: number): void {
  res.write(`id: ${idCounter}\n`);
  res.write(`event: ${e.kind}\n`);
  res.write(`data: ${JSON.stringify({ ts: e.ts, ...e.data })}\n\n`);
}

/** Open an SSE stream on the response and route bus events to it. */
export function bindSseStream(res: ServerResponse, bus: EventBus): () => void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.write(": connected\n\n");

  let counter = 0;
  const unsubscribe = bus.subscribe((e) => writeSse(res, e, ++counter));

  const heartbeat = setInterval(() => {
    try { res.write(": keepalive\n\n"); }
    catch { /* socket already torn down; cleanup handled below */ }
  }, 15_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
    try { res.end(); } catch { /* ignore */ }
  };
  res.on("close", cleanup);
  res.on("error", cleanup);
  return cleanup;
}
