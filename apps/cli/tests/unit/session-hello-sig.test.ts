/**
 * CLI-side session-hello signing.
 *
 * Roundtrip: the signatures we mint with the CLI helpers must match the
 * canonical bytes the broker recomputes from the same fields. Drift here
 * shows up as `bad_signature` on the broker — easier to catch in unit
 * tests than in end-to-end flow.
 */

import { describe, expect, test } from "vitest";
import sodium from "libsodium-wrappers";
import {
  signParentAttestation,
  signSessionHello,
  DEFAULT_ATTESTATION_TTL_MS,
} from "../../src/services/broker/session-hello-sig.js";

async function makeKeypair(): Promise<{ publicKey: string; secretKey: string }> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: sodium.to_hex(kp.publicKey),
    secretKey: sodium.to_hex(kp.privateKey),
  };
}

describe("signParentAttestation", () => {
  test("produces canonical bytes that verify against parent pubkey", async () => {
    await sodium.ready;
    const parent = await makeKeypair();
    const session = await makeKeypair();

    const att = await signParentAttestation({
      parentMemberPubkey: parent.publicKey,
      parentSecretKey: parent.secretKey,
      sessionPubkey: session.publicKey,
    });
    expect(att.parentMemberPubkey).toBe(parent.publicKey);
    expect(att.sessionPubkey).toBe(session.publicKey);
    expect(att.signature).toMatch(/^[0-9a-f]{128}$/);

    const canonical =
      `claudemesh-session-attest|${parent.publicKey}|${session.publicKey}|${att.expiresAt}`;
    const ok = sodium.crypto_sign_verify_detached(
      sodium.from_hex(att.signature),
      sodium.from_string(canonical),
      sodium.from_hex(parent.publicKey),
    );
    expect(ok).toBe(true);
  });

  test("default TTL ≤24h cap", async () => {
    const parent = await makeKeypair();
    const session = await makeKeypair();
    const now = 1_700_000_000_000;
    const att = await signParentAttestation({
      parentMemberPubkey: parent.publicKey,
      parentSecretKey: parent.secretKey,
      sessionPubkey: session.publicKey,
      now,
    });
    expect(att.expiresAt).toBe(now + DEFAULT_ATTESTATION_TTL_MS);
    expect(att.expiresAt - now).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});

describe("signSessionHello", () => {
  test("signature verifies against session pubkey", async () => {
    await sodium.ready;
    const session = await makeKeypair();
    const result = await signSessionHello({
      meshId: "mesh-x",
      parentMemberPubkey: "c".repeat(64),
      sessionPubkey: session.publicKey,
      sessionSecretKey: session.secretKey,
    });
    expect(result.signature).toMatch(/^[0-9a-f]{128}$/);

    const canonical =
      `claudemesh-session-hello|mesh-x|${"c".repeat(64)}|${session.publicKey}|${result.timestamp}`;
    const ok = sodium.crypto_sign_verify_detached(
      sodium.from_hex(result.signature),
      sodium.from_string(canonical),
      sodium.from_hex(session.publicKey),
    );
    expect(ok).toBe(true);
  });
});
