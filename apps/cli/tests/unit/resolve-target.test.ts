/**
 * Spec 2026-09-26 §3: the "messages land on the wrong peers" noise.
 * A member-key DM reached every session of that member; a duplicated
 * display name silently picked the first row; control-plane rows were
 * addressable. One resolver now decides for every /v1/send caller.
 */

import { describe, expect, it } from "vitest";

import { resolveDirectTarget, type RosterPeer } from "~/daemon/resolve-target.js";

const M1 = "a".repeat(64);
const M2 = "b".repeat(64);
const S1 = "1".repeat(64);
const S2 = "2".repeat(64);
const S3 = "3".repeat(64);

const roster: RosterPeer[] = [
  { pubkey: M1, memberPubkey: M1, displayName: "daemon", role: "control-plane" },
  { pubkey: S1, memberPubkey: M1, displayName: "Intra-Back" },
  { pubkey: S2, memberPubkey: M1, displayName: "Intra-Back" },
  { pubkey: S3, memberPubkey: M2, displayName: "portal-kit" },
];

describe("resolveDirectTarget", () => {
  it("a session pubkey resolves to itself", () => {
    expect(resolveDirectTarget(S1, roster)).toMatchObject({ ok: true, pubkey: S1 });
  });

  it("a member key with one live session resolves to that session", () => {
    expect(resolveDirectTarget(M2, roster)).toMatchObject({ ok: true, pubkey: S3, note: "member_to_session" });
  });

  it("a member key with several sessions is refused, listing them", () => {
    const r = resolveDirectTarget(M1, roster);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("member_target_ambiguous");
      expect(r.candidates.map((c) => c.pubkey).sort()).toEqual([S1, S2]);
    }
  });

  it("--fanout keeps the member key on purpose", () => {
    expect(resolveDirectTarget(M1, roster, { fanout: true })).toMatchObject({ ok: true, pubkey: M1, note: "member_fanout" });
  });

  it("an unknown full key stays (offline store-and-forward)", () => {
    const k = "f".repeat(64);
    expect(resolveDirectTarget(k, roster)).toMatchObject({ ok: true, pubkey: k });
  });

  it("a duplicated display name is ambiguous, not first-match", () => {
    expect(resolveDirectTarget("intra-back", roster)).toMatchObject({ ok: false, code: "ambiguous" });
    expect(resolveDirectTarget("portal-kit", roster)).toMatchObject({ ok: true, pubkey: S3 });
  });

  it("control-plane rows are never addressable by name", () => {
    expect(resolveDirectTarget("daemon", roster)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("a prefix prefers session keys and must be unique", () => {
    expect(resolveDirectTarget("3333", roster)).toMatchObject({ ok: true, pubkey: S3 });
    // member-key prefix of a member with two sessions → ambiguous
    expect(resolveDirectTarget("aaaa", roster)).toMatchObject({ ok: false, code: "ambiguous" });
    expect(resolveDirectTarget("bbbb", roster)).toMatchObject({ ok: true, pubkey: S3 });
  });
});
