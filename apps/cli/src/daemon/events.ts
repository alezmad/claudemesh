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

/** 1.34.10: per-subscriber demux options. The MCP server passes its
 *  own session pubkey + member pubkey when binding so the bus only
 *  sends events meant for that session. Without this, every MCP on a
 *  multi-session daemon receives every inbox row and emits a
 *  duplicate channel notification — manifests as session A seeing its
 *  own outbound DM to B because B's session-WS published the row to
 *  the shared bus. */
export interface SseFilterOptions {
  /** Session pubkey the subscribing MCP serves. Events tagged
   *  `recipient_kind: "session"` only flow when their
   *  `recipient_pubkey` matches this. */
  sessionPubkey?: string;
  /** Daemon's member pubkey for this mesh. Events tagged
   *  `recipient_kind: "member"` flow when their `recipient_pubkey`
   *  matches — those are member-keyed broadcasts / DMs that should
   *  reach every session of this member, but not OTHER members. */
  memberPubkey?: string;
  /** Mesh slug the subscriber is bound to (from session registry).
   *  When set, system events (peer_join etc.) are filtered to this
   *  mesh; without it every system event surfaces. */
  meshSlug?: string;
}

function shouldDeliver(e: DaemonEvent, f: SseFilterOptions): boolean {
  // No filter set → legacy behavior: deliver everything (used by
  // diagnostic tooling like `claudemesh daemon events`).
  if (!f.sessionPubkey && !f.memberPubkey && !f.meshSlug) return true;

  // Mesh scoping for events that carry a mesh slug. peer_join /
  // peer_leave / broker_status all carry `data.mesh`; if the
  // subscriber is bound to a specific mesh, drop events from other
  // meshes.
  if (f.meshSlug) {
    const eventMesh = typeof e.data.mesh === "string" ? e.data.mesh : null;
    if (eventMesh && eventMesh !== f.meshSlug) return false;
  }

  // System events (peer_join etc.) flow to every session on the same
  // mesh — they're informational, not addressed.
  if (e.kind !== "message") return true;

  const recipientKind = typeof e.data.recipient_kind === "string" ? e.data.recipient_kind : null;
  const recipientPubkey = typeof e.data.recipient_pubkey === "string" ? e.data.recipient_pubkey.toLowerCase() : null;

  // Legacy publish without recipient context → everyone gets it. Keeps
  // backward compatibility with older daemon code paths until they're
  // migrated. Also covers test paths that don't thread context.
  if (!recipientKind || !recipientPubkey) return true;

  if (recipientKind === "session") {
    return !!f.sessionPubkey && f.sessionPubkey.toLowerCase() === recipientPubkey;
  }
  if (recipientKind === "member") {
    return !!f.memberPubkey && f.memberPubkey.toLowerCase() === recipientPubkey;
  }
  return true;
}

/** Open an SSE stream on the response and route bus events to it.
 *  1.34.10: optional `filter` scopes the stream to one session/member;
 *  see SseFilterOptions. */
export function bindSseStream(res: ServerResponse, bus: EventBus, filter: SseFilterOptions = {}): () => void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.write(": connected\n\n");

  let counter = 0;
  const unsubscribe = bus.subscribe((e) => {
    if (!shouldDeliver(e, filter)) return;
    writeSse(res, e, ++counter);
  });

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
