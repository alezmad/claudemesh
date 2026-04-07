/**
 * Cryptographic primitives for the claudemesh SDK.
 *
 * Uses libsodium-wrappers for ed25519 keypair generation, hello signing,
 * and crypto_box direct-message encryption. This matches the CLI's crypto
 * implementation exactly, ensuring wire-level compatibility.
 */

import sodium from "libsodium-wrappers";

let ready = false;

async function ensureSodium(): Promise<typeof sodium> {
  if (!ready) {
    await sodium.ready;
    ready = true;
  }
  return sodium;
}

/** An ed25519 keypair with hex-encoded keys. */
export interface Ed25519Keypair {
  /** 32-byte public key, hex-encoded. */
  publicKey: string;
  /** 64-byte secret key (seed || publicKey), hex-encoded. */
  secretKey: string;
}

/** Generate a fresh ed25519 keypair for use as mesh identity. */
export async function generateKeyPair(): Promise<Ed25519Keypair> {
  const s = await ensureSodium();
  const kp = s.crypto_sign_keypair();
  return {
    publicKey: s.to_hex(kp.publicKey),
    secretKey: s.to_hex(kp.privateKey),
  };
}

/**
 * Sign a hello handshake message.
 *
 * Canonical bytes: `${meshId}|${memberId}|${pubkey}|${timestamp}`
 * Must match the broker's `canonicalHello()` exactly.
 */
export async function signHello(
  meshId: string,
  memberId: string,
  pubkey: string,
  secretKeyHex: string,
): Promise<{ timestamp: number; signature: string }> {
  const s = await ensureSodium();
  const timestamp = Date.now();
  const canonical = `${meshId}|${memberId}|${pubkey}|${timestamp}`;
  const sig = s.crypto_sign_detached(
    s.from_string(canonical),
    s.from_hex(secretKeyHex),
  );
  return { timestamp, signature: s.to_hex(sig) };
}

/** Encrypted envelope wire format. */
export interface Envelope {
  nonce: string; // base64
  ciphertext: string; // base64
}

const HEX_PUBKEY = /^[0-9a-f]{64}$/;

/** Check whether a targetSpec is a hex pubkey (direct message target). */
export function isDirectTarget(targetSpec: string): boolean {
  return HEX_PUBKEY.test(targetSpec);
}

/**
 * Encrypt a plaintext message for a single recipient using crypto_box.
 *
 * Ed25519 keys are converted to X25519 on the fly for Diffie-Hellman.
 */
export async function encryptDirect(
  message: string,
  recipientPubkeyHex: string,
  senderSecretKeyHex: string,
): Promise<Envelope> {
  const s = await ensureSodium();
  const recipientPub = s.crypto_sign_ed25519_pk_to_curve25519(
    s.from_hex(recipientPubkeyHex),
  );
  const senderSec = s.crypto_sign_ed25519_sk_to_curve25519(
    s.from_hex(senderSecretKeyHex),
  );
  const nonce = s.randombytes_buf(s.crypto_box_NONCEBYTES);
  const ciphertext = s.crypto_box_easy(
    s.from_string(message),
    nonce,
    recipientPub,
    senderSec,
  );
  return {
    nonce: s.to_base64(nonce, s.base64_variants.ORIGINAL),
    ciphertext: s.to_base64(ciphertext, s.base64_variants.ORIGINAL),
  };
}

/**
 * Decrypt an inbound envelope from a known sender using crypto_box_open.
 * Returns null if decryption fails.
 */
export async function decryptDirect(
  envelope: Envelope,
  senderPubkeyHex: string,
  recipientSecretKeyHex: string,
): Promise<string | null> {
  const s = await ensureSodium();
  try {
    const senderPub = s.crypto_sign_ed25519_pk_to_curve25519(
      s.from_hex(senderPubkeyHex),
    );
    const recipientSec = s.crypto_sign_ed25519_sk_to_curve25519(
      s.from_hex(recipientSecretKeyHex),
    );
    const nonce = s.from_base64(envelope.nonce, s.base64_variants.ORIGINAL);
    const ciphertext = s.from_base64(
      envelope.ciphertext,
      s.base64_variants.ORIGINAL,
    );
    const plain = s.crypto_box_open_easy(
      ciphertext,
      nonce,
      senderPub,
      recipientSec,
    );
    return s.to_string(plain);
  } catch {
    return null;
  }
}
