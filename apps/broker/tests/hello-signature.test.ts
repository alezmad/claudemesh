/**
 * Hello signature verification — unit tests on the verifyHelloSignature
 * function directly. Covers valid signature, bad signature, timestamp
 * skew, and cross-member attacks (signing with wrong key).
 *
 * Integration WS-level testing happens implicitly via the smoke-test
 * scripts (apps/broker/scripts/smoke-test.sh, apps/cli/scripts/
 * roundtrip.ts), which exercise the full hello handshake.
 */

import { beforeAll, describe, expect, test } from "vitest";
import sodium from "libsodium-wrappers";
import {
  canonicalHello,
  verifyHelloSignature,
  HELLO_SKEW_MS,
} from "../src/crypto";

interface Keypair {
  publicKey: string;
  secretKey: string;
}

async function makeKeypair(): Promise<Keypair> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: sodium.to_hex(kp.publicKey),
    secretKey: sodium.to_hex(kp.privateKey),
  };
}

function sign(canonical: string, secretKeyHex: string): string {
  return sodium.to_hex(
    sodium.crypto_sign_detached(
      sodium.from_string(canonical),
      sodium.from_hex(secretKeyHex),
    ),
  );
}

describe("verifyHelloSignature", () => {
  let kp: Keypair;
  beforeAll(async () => {
    kp = await makeKeypair();
  });

  test("valid signature accepted", async () => {
    const meshId = "mesh-x";
    const memberId = "member-y";
    const timestamp = Date.now();
    const canonical = canonicalHello(meshId, memberId, kp.publicKey, timestamp);
    const signature = sign(canonical, kp.secretKey);
    const result = await verifyHelloSignature({
      meshId,
      memberId,
      pubkey: kp.publicKey,
      timestamp,
      signature,
    });
    expect(result.ok).toBe(true);
  });

  test("bad signature rejected", async () => {
    const meshId = "mesh-x";
    const memberId = "member-y";
    const timestamp = Date.now();
    // Sign with a DIFFERENT key than the one we claim
    const otherKp = await makeKeypair();
    const canonical = canonicalHello(meshId, memberId, kp.publicKey, timestamp);
    const signature = sign(canonical, otherKp.secretKey);
    const result = await verifyHelloSignature({
      meshId,
      memberId,
      pubkey: kp.publicKey, // claim kp's identity
      timestamp,
      signature, // but signed with otherKp — mismatch
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  test("timestamp too old rejected", async () => {
    const timestamp = Date.now() - HELLO_SKEW_MS - 1000;
    const canonical = canonicalHello("m", "mem", kp.publicKey, timestamp);
    const signature = sign(canonical, kp.secretKey);
    const result = await verifyHelloSignature({
      meshId: "m",
      memberId: "mem",
      pubkey: kp.publicKey,
      timestamp,
      signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timestamp_skew");
  });

  test("timestamp too far in future rejected", async () => {
    const timestamp = Date.now() + HELLO_SKEW_MS + 1000;
    const canonical = canonicalHello("m", "mem", kp.publicKey, timestamp);
    const signature = sign(canonical, kp.secretKey);
    const result = await verifyHelloSignature({
      meshId: "m",
      memberId: "mem",
      pubkey: kp.publicKey,
      timestamp,
      signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timestamp_skew");
  });

  test("tampered canonical field fails verification", async () => {
    const timestamp = Date.now();
    // Sign over one meshId, claim a different one at verify time
    const canonical = canonicalHello(
      "original-mesh",
      "mem",
      kp.publicKey,
      timestamp,
    );
    const signature = sign(canonical, kp.secretKey);
    const result = await verifyHelloSignature({
      meshId: "different-mesh",
      memberId: "mem",
      pubkey: kp.publicKey,
      timestamp,
      signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  test("malformed hex pubkey rejected", async () => {
    const timestamp = Date.now();
    const result = await verifyHelloSignature({
      meshId: "m",
      memberId: "mem",
      pubkey: "not-hex",
      timestamp,
      signature: "a".repeat(128),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });

  test("malformed signature length rejected", async () => {
    const timestamp = Date.now();
    const result = await verifyHelloSignature({
      meshId: "m",
      memberId: "mem",
      pubkey: kp.publicKey,
      timestamp,
      signature: "abc123", // wrong length
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });
});
