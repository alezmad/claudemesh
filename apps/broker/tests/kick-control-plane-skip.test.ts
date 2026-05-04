/**
 * Kick control-plane skip: 1.34.15 (gap #3a) refuses to close
 * long-lived control-plane connections (claudemesh daemon, dashboard)
 * via `kick`, because they auto-reconnect within seconds and the verb
 * was effectively a no-op. The soft `disconnect` verb keeps the old
 * behavior so users can still nudge a control-plane peer to
 * re-authenticate.
 *
 * Pure-logic test — mirrors the branch inside handleSend's kick case
 * without spinning up a broker. Same pattern as
 * grants-enforcement.test.ts.
 */

import { describe, expect, test } from "vitest";

type PeerRole = "control-plane" | "session" | "service";

/** Mirrors the predicate inserted into the kick handler. */
function shouldSkipKick(args: {
  verb: "kick" | "disconnect";
  peerRole: PeerRole;
}): boolean {
  const skipControlPlane = args.verb === "kick";
  return skipControlPlane && args.peerRole === "control-plane";
}

describe("kick control-plane skip (gap #3a)", () => {
  test("kick on control-plane → skipped (would auto-reconnect)", () => {
    expect(shouldSkipKick({ verb: "kick", peerRole: "control-plane" })).toBe(true);
  });

  test("kick on session → not skipped (closes user session)", () => {
    expect(shouldSkipKick({ verb: "kick", peerRole: "session" })).toBe(false);
  });

  test("kick on service → not skipped", () => {
    expect(shouldSkipKick({ verb: "kick", peerRole: "service" })).toBe(false);
  });

  test("disconnect on control-plane → not skipped (intentional nudge)", () => {
    expect(shouldSkipKick({ verb: "disconnect", peerRole: "control-plane" })).toBe(false);
  });

  test("disconnect on session → not skipped", () => {
    expect(shouldSkipKick({ verb: "disconnect", peerRole: "session" })).toBe(false);
  });
});
