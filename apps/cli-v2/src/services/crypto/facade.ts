import { generateKeypair as _generateKeypair, ensureSodium } from "./keypair.js";
import type { Ed25519Keypair } from "./keypair.js";
import { encryptFile, decryptFile, sealKeyForPeer, openSealedKey } from "./file-crypto.js";
import type { EncryptedFile } from "./file-crypto.js";
import { encryptDirect, decryptDirect, isDirectTarget } from "./box.js";
import type { Envelope } from "./box.js";
import { randomBytes, randomHex } from "./random.js";

export type { Ed25519Keypair, EncryptedFile, Envelope };

export async function generateKeypair(): Promise<Ed25519Keypair> {
  return _generateKeypair();
}

export async function sign(
  message: string,
  secretKeyHex: string,
): Promise<string> {
  const s = await ensureSodium();
  const sig = s.crypto_sign_detached(
    s.from_string(message),
    s.from_hex(secretKeyHex),
  );
  return s.to_hex(sig);
}

export async function verify(
  message: string,
  signatureHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  const s = await ensureSodium();
  try {
    return s.crypto_sign_verify_detached(
      s.from_hex(signatureHex),
      s.from_string(message),
      s.from_hex(publicKeyHex),
    );
  } catch {
    return false;
  }
}

export {
  encryptFile as encrypt,
  decryptFile as decrypt,
  sealKeyForPeer as boxSeal,
  openSealedKey as boxOpen,
  encryptDirect,
  decryptDirect,
  isDirectTarget,
  randomBytes,
  randomHex,
  ensureSodium,
};
