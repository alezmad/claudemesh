import { ensureSodium } from "./keypair.js";

export interface EncryptedFile {
  ciphertext: Uint8Array;
  nonce: string;
  key: Uint8Array;
}

export async function encryptFile(plaintext: Uint8Array): Promise<EncryptedFile> {
  const s = await ensureSodium();
  const key = s.randombytes_buf(s.crypto_secretbox_KEYBYTES);
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const ciphertext = s.crypto_secretbox_easy(plaintext, nonce, key);
  return {
    ciphertext,
    nonce: s.to_base64(nonce, s.base64_variants.ORIGINAL),
    key,
  };
}

export async function decryptFile(
  ciphertext: Uint8Array,
  nonceB64: string,
  key: Uint8Array,
): Promise<Uint8Array | null> {
  const s = await ensureSodium();
  try {
    const nonce = s.from_base64(nonceB64, s.base64_variants.ORIGINAL);
    return s.crypto_secretbox_open_easy(ciphertext, nonce, key);
  } catch {
    return null;
  }
}

export async function sealKeyForPeer(
  kf: Uint8Array,
  recipientPubkeyHex: string,
): Promise<string> {
  const s = await ensureSodium();
  const recipientCurve = s.crypto_sign_ed25519_pk_to_curve25519(
    s.from_hex(recipientPubkeyHex),
  );
  const sealed = s.crypto_box_seal(kf, recipientCurve);
  return s.to_base64(sealed, s.base64_variants.ORIGINAL);
}

export async function openSealedKey(
  sealedB64: string,
  myPubkeyHex: string,
  mySecretKeyHex: string,
): Promise<Uint8Array | null> {
  const s = await ensureSodium();
  try {
    const myCurvePub = s.crypto_sign_ed25519_pk_to_curve25519(
      s.from_hex(myPubkeyHex),
    );
    const myCurveSec = s.crypto_sign_ed25519_sk_to_curve25519(
      s.from_hex(mySecretKeyHex),
    );
    const sealed = s.from_base64(sealedB64, s.base64_variants.ORIGINAL);
    return s.crypto_box_seal_open(sealed, myCurvePub, myCurveSec);
  } catch {
    return null;
  }
}
