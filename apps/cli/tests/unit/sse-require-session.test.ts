/** Spec 2026-09-26 §2: a session MCP whose token doesn't resolve gets no
 *  message events — it used to receive every sibling session's DMs. */

import { describe, expect, it } from "vitest";

import { shouldDeliver, type DaemonEvent } from "~/daemon/events.js";

const msg = (data: Record<string, unknown>): DaemonEvent => ({ kind: "message", ts: "", data });

describe("shouldDeliver: requireSession", () => {
  it("an unresolved session MCP gets no messages", () => {
    expect(shouldDeliver(msg({ recipient_kind: "session", recipient_pubkey: "ab" }), { requireSession: true })).toBe(false);
    expect(shouldDeliver(msg({}), { requireSession: true })).toBe(false);
  });
  it("diagnostic subscribers (no filter) keep the full stream", () => {
    expect(shouldDeliver(msg({ recipient_kind: "session", recipient_pubkey: "ab" }), {})).toBe(true);
  });
  it("a resolved session still gets its own messages only", () => {
    const f = { requireSession: true, sessionPubkey: "ab" };
    expect(shouldDeliver(msg({ recipient_kind: "session", recipient_pubkey: "ab" }), f)).toBe(true);
    expect(shouldDeliver(msg({ recipient_kind: "session", recipient_pubkey: "cd" }), f)).toBe(false);
  });
});
