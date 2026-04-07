/**
 * File encryption for claudemesh E2E file sharing.
 *
 * Symmetric: crypto_secretbox_easy with random Kf (32-byte key).
 * Key wrapping: crypto_box_seal to recipient's X25519 pub (converted from ed25519).
 * Key opening: crypto_box_seal_open with own X25519 keypair.
 */

import { ensureSodium } from "./keypair";

export interface EncryptedFile {
  ciphertext: Uint8Array;  // secretbox ciphertext (includes MAC)
  nonce: string;           // base64 24-byte nonce
  key: Uint8Array;         // 32-byte symmetric Kf (keep in memory only)
}

/**
 * Encrypt file bytes with a fresh random symmetric key.
 * Returns ciphertext, nonce (base64), and the plaintext Kf.
 */
export async function encryptFile(plaintext: Uint8Array): Promise<EncryptedFile> {
  const sodium = await ensureSodium();
  const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  return {
    ciphertext,
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
    key,
  };
}

/**
 * Decrypt file bytes with the symmetric key Kf.
 * Returns null if decryption fails.
 */
export async function decryptFile(
  ciphertext: Uint8Array,
  nonceB64: string,
  key: Uint8Array,
): Promise<Uint8Array | null> {
  const sodium = await ensureSodium();
  try {
    const nonce = sodium.from_base64(nonceB64, sodium.base64_variants.ORIGINAL);
    return sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  } catch {
    return null;
  }
}

/**
 * Seal Kf for a recipient using crypto_box_seal (ephemeral sender key).
 * recipientPubkeyHex: ed25519 pubkey of recipient (64 hex chars).
 * Returns base64 sealed box.
 */
export async function sealKeyForPeer(
  kf: Uint8Array,
  recipientPubkeyHex: string,
): Promise<string> {
  const sodium = await ensureSodium();
  const recipientCurve = sodium.crypto_sign_ed25519_pk_to_curve25519(
    sodium.from_hex(recipientPubkeyHex),
  );
  const sealed = sodium.crypto_box_seal(kf, recipientCurve);
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}

/**
 * Open a sealed key blob using own ed25519 keypair (converted to X25519).
 * Returns the 32-byte Kf or null if decryption fails.
 */
export async function openSealedKey(
  sealedB64: string,
  myPubkeyHex: string,
  mySecretKeyHex: string,
): Promise<Uint8Array | null> {
  const sodium = await ensureSodium();
  try {
    const myCurvePub = sodium.crypto_sign_ed25519_pk_to_curve25519(
      sodium.from_hex(myPubkeyHex),
    );
    const myCurveSec = sodium.crypto_sign_ed25519_sk_to_curve25519(
      sodium.from_hex(mySecretKeyHex),
    );
    const sealed = sodium.from_base64(sealedB64, sodium.base64_variants.ORIGINAL);
    return sodium.crypto_box_seal_open(sealed, myCurvePub, myCurveSec);
  } catch {
    return null;
  }
}
