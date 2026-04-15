/**
 * Grant enforcement: the sender+recipient lookup tries member pubkey
 * first, then session pubkey (backwards compat for CLI clients that
 * stored grants keyed on session key).
 *
 * This is a pure logic test over the grant map shape — no WS/broker
 * needed. The function signature mirrors the branch inside handleSend.
 */

import { describe, expect, test } from "vitest";

const DEFAULT_CAPS = ["read", "dm", "broadcast", "state-read"] as const;

function allowed(
  grants: Record<string, string[]>,
  senderMemberKey: string,
  senderSessionKey: string | null,
  capNeeded: "dm" | "broadcast",
): boolean {
  const memberEntry = grants[senderMemberKey];
  if (memberEntry !== undefined) return memberEntry.includes(capNeeded);
  if (senderSessionKey) {
    const sessionEntry = grants[senderSessionKey];
    if (sessionEntry !== undefined) return sessionEntry.includes(capNeeded);
  }
  return (DEFAULT_CAPS as readonly string[]).includes(capNeeded);
}

describe("grant enforcement (member-then-session lookup)", () => {
  test("no entry → default caps allow dm + broadcast", () => {
    expect(allowed({}, "memberK", null, "dm")).toBe(true);
    expect(allowed({}, "memberK", null, "broadcast")).toBe(true);
  });

  test("explicit member-key entry wins over default", () => {
    const grants = { memberK: ["read"] }; // dm NOT granted
    expect(allowed(grants, "memberK", "sessK", "dm")).toBe(false);
  });

  test("empty array for member key = blocked", () => {
    const grants = { memberK: [] };
    expect(allowed(grants, "memberK", null, "dm")).toBe(false);
    expect(allowed(grants, "memberK", null, "broadcast")).toBe(false);
  });

  test("falls back to session key when member key missing", () => {
    const grants = { sessK: ["dm"] }; // grants keyed on session
    expect(allowed(grants, "memberK", "sessK", "dm")).toBe(true);
    expect(allowed(grants, "memberK", "sessK", "broadcast")).toBe(false);
  });

  test("member entry always wins over session entry", () => {
    const grants = {
      memberK: [], // member says blocked
      sessK: ["dm", "broadcast"], // session says allowed
    };
    expect(allowed(grants, "memberK", "sessK", "dm")).toBe(false);
    expect(allowed(grants, "memberK", "sessK", "broadcast")).toBe(false);
  });

  test("session fallback only triggers when session key present", () => {
    const grants = { sessK: ["dm"] };
    // Without a session key on the caller, falls through to defaults
    expect(allowed(grants, "memberK", null, "dm")).toBe(true);
  });
});
