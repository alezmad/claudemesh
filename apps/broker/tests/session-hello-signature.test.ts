/**
 * Session-hello signature + parent-attestation verification.
 *
 * Two-stage proof:
 *   1. Parent member signs `canonicalSessionAttestation` (long-lived, ≤24h
 *      TTL) — vouches that the session pubkey belongs to them.
 *   2. Session keypair signs `canonicalSessionHello` per WS-connect — proves
 *      liveness + possession.
 *
 * The broker rejects on any: expired/over-TTL attestation, bad signature,
 * timestamp skew, malformed hex, or a session signature made with the
 * wrong key (covers the "attestation leaked, attacker tries to use it
 * without the session secret key" case).
 */

import { beforeAll, describe, expect, test } from "vitest";
import sodium from "libsodium-wrappers";
import {
  canonicalSessionAttestation,
  canonicalSessionHello,
  verifySessionAttestation,
  verifySessionHelloSignature,
  SESSION_ATTESTATION_MAX_TTL_MS,
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

describe("verifySessionAttestation", () => {
  let parent: Keypair;
  let session: Keypair;

  beforeAll(async () => {
    parent = await makeKeypair();
    session = await makeKeypair();
  });

  test("valid attestation accepted", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const canonical = canonicalSessionAttestation(parent.publicKey, session.publicKey, expiresAt);
    const signature = sign(canonical, parent.secretKey);
    const result = await verifySessionAttestation({
      parentMemberPubkey: parent.publicKey,
      sessionPubkey: session.publicKey,
      expiresAt,
      signature,
    });
    expect(result.ok).toBe(true);
  });

  test("expired attestation rejected", async () => {
    const expiresAt = Date.now() - 1_000;
    const canonical = canonicalSessionAttestation(parent.publicKey, session.publicKey, expiresAt);
    const signature = sign(canonical, parent.secretKey);
    const result = await verifySessionAttestation({
      parentMemberPubkey: parent.publicKey,
      sessionPubkey: session.publicKey,
      expiresAt,
      signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  test("over-24h TTL rejected", async () => {
    const expiresAt = Date.now() + SESSION_ATTESTATION_MAX_TTL_MS + 60_000;
    const canonical = canonicalSessionAttestation(parent.publicKey, session.publicKey, expiresAt);
    const signature = sign(canonical, parent.secretKey);
    const result = await verifySessionAttestation({
      parentMemberPubkey: parent.publicKey,
      sessionPubkey: session.publicKey,
      expiresAt,
      signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ttl_too_long");
  });

  test("attestation signed by wrong key rejected", async () => {
    const other = await makeKeypair();
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const canonical = canonicalSessionAttestation(parent.publicKey, session.publicKey, expiresAt);
    // Sign with a different parent — verifier still checks against
    // claimed parentMemberPubkey, so it should fail.
    const signature = sign(canonical, other.secretKey);
    const result = await verifySessionAttestation({
      parentMemberPubkey: parent.publicKey,
      sessionPubkey: session.publicKey,
      expiresAt,
      signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  test("tampered session_pubkey fails (canonical mismatch)", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const canonical = canonicalSessionAttestation(parent.publicKey, session.publicKey, expiresAt);
    const signature = sign(canonical, parent.secretKey);
    const evil = await makeKeypair();
    const result = await verifySessionAttestation({
      parentMemberPubkey: parent.publicKey,
      sessionPubkey: evil.publicKey, // claim a different session pubkey
      expiresAt,
      signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  test("malformed hex rejected", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const result = await verifySessionAttestation({
      parentMemberPubkey: "not-hex",
      sessionPubkey: session.publicKey,
      expiresAt,
      signature: "a".repeat(128),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });
});

describe("verifySessionHelloSignature", () => {
  let parent: Keypair;
  let session: Keypair;

  beforeAll(async () => {
    parent = await makeKeypair();
    session = await makeKeypair();
  });

  test("valid session-hello signature accepted", async () => {
    const meshId = "mesh-x";
    const timestamp = Date.now();
    const canonical = canonicalSessionHello(meshId, parent.publicKey, session.publicKey, timestamp);
    const signature = sign(canonical, session.secretKey);
    const result = await verifySessionHelloSignature({
      meshId,
      parentMemberPubkey: parent.publicKey,
      sessionPubkey: session.publicKey,
      timestamp,
      signature,
    });
    expect(result.ok).toBe(true);
  });

  test("attacker without session secret key cannot forge session-hello", async () => {
    // The hostile case: attacker captured a valid attestation but doesn't
    // hold the session secret key. They try to sign session_hello with the
    // parent's key — broker checks the signature against sessionPubkey,
    // which fails because the parent didn't sign with the session key.
    const meshId = "mesh-x";
    const timestamp = Date.now();
    const canonical = canonicalSessionHello(meshId, parent.publicKey, session.publicKey, timestamp);
    const signature = sign(canonical, parent.secretKey); // wrong secret key
    const result = await verifySessionHelloSignature({
      meshId,
      parentMemberPubkey: parent.publicKey,
      sessionPubkey: session.publicKey,
      timestamp,
      signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  test("timestamp skew rejected", async () => {
    const timestamp = Date.now() - HELLO_SKEW_MS - 1_000;
    const canonical = canonicalSessionHello("mesh-x", parent.publicKey, session.publicKey, timestamp);
    const signature = sign(canonical, session.secretKey);
    const result = await verifySessionHelloSignature({
      meshId: "mesh-x",
      parentMemberPubkey: parent.publicKey,
      sessionPubkey: session.publicKey,
      timestamp,
      signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timestamp_skew");
  });

  test("tampered meshId fails verification", async () => {
    const timestamp = Date.now();
    const canonical = canonicalSessionHello("mesh-A", parent.publicKey, session.publicKey, timestamp);
    const signature = sign(canonical, session.secretKey);
    const result = await verifySessionHelloSignature({
      meshId: "mesh-B", // claim a different mesh
      parentMemberPubkey: parent.publicKey,
      sessionPubkey: session.publicKey,
      timestamp,
      signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });
});
