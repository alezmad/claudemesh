import { ensureSodium } from "./keypair.js";

export interface Envelope {
  nonce: string;
  ciphertext: string;
}

const HEX_PUBKEY = /^[0-9a-f]{64}$/;

export function isDirectTarget(targetSpec: string): boolean {
  return HEX_PUBKEY.test(targetSpec);
}

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
  const ct = s.crypto_box_easy(
    s.from_string(message),
    nonce,
    recipientPub,
    senderSec,
  );
  return {
    nonce: s.to_base64(nonce, s.base64_variants.ORIGINAL),
    ciphertext: s.to_base64(ct, s.base64_variants.ORIGINAL),
  };
}

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
    const ct = s.from_base64(envelope.ciphertext, s.base64_variants.ORIGINAL);
    const plain = s.crypto_box_open_easy(ct, nonce, senderPub, recipientSec);
    return s.to_string(plain);
  } catch {
    return null;
  }
}
