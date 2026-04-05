import { describe, it, expect } from "vitest";
import {
  parseInviteLink,
  buildSignedInvite,
  extractInviteToken,
} from "../invite/parse";
import { generateKeypair } from "../crypto/keypair";

describe("invite parse", () => {
  it("round-trips a signed invite through encode and parse", async () => {
    const owner = await generateKeypair();
    const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    const { link, payload } = await buildSignedInvite({
      v: 1,
      mesh_id: "mesh-abc-123",
      mesh_slug: "test-mesh",
      broker_url: "wss://broker.example.com",
      expires_at: expiresAt,
      mesh_root_key: "deadbeefcafebabe",
      role: "member",
      owner_pubkey: owner.publicKey,
      owner_secret_key: owner.secretKey,
    });

    const parsed = await parseInviteLink(link);
    expect(parsed.payload.mesh_id).toBe("mesh-abc-123");
    expect(parsed.payload.mesh_slug).toBe("test-mesh");
    expect(parsed.payload.broker_url).toBe("wss://broker.example.com");
    expect(parsed.payload.expires_at).toBe(expiresAt);
    expect(parsed.payload.role).toBe("member");
    expect(parsed.payload.owner_pubkey).toBe(owner.publicKey);
    expect(parsed.payload.signature).toBe(payload.signature);
  });

  it("rejects an expired invite", async () => {
    const owner = await generateKeypair();
    const expiredAt = Math.floor(Date.now() / 1000) - 60; // 1 minute ago

    const { link } = await buildSignedInvite({
      v: 1,
      mesh_id: "mesh-expired",
      mesh_slug: "expired-mesh",
      broker_url: "wss://broker.example.com",
      expires_at: expiredAt,
      mesh_root_key: "deadbeef",
      role: "member",
      owner_pubkey: owner.publicKey,
      owner_secret_key: owner.secretKey,
    });

    await expect(parseInviteLink(link)).rejects.toThrow("invite expired");
  });

  it("rejects malformed base64 in invite URL", async () => {
    // Empty payload after ic://join/ should throw.
    expect(() => extractInviteToken("ic://join/")).toThrow("invite link has no payload");

    // Short garbage that doesn't match any format should throw.
    expect(() => extractInviteToken("!!!not-valid!!!")).toThrow("invalid invite format");

    // A sufficiently long but garbage base64url token that decodes to
    // invalid JSON should throw at the JSON parse stage.
    const garbage = "A".repeat(30); // valid base64url chars, decodes to binary
    await expect(parseInviteLink(`ic://join/${garbage}`)).rejects.toThrow();
  });
});
