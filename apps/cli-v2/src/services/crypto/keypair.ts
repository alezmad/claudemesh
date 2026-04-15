import sodium from "libsodium-wrappers";

let ready = false;

export async function ensureSodium(): Promise<typeof sodium> {
  if (!ready) {
    await sodium.ready;
    ready = true;
  }
  return sodium;
}

export interface Ed25519Keypair {
  publicKey: string;
  secretKey: string;
}

export async function generateKeypair(): Promise<Ed25519Keypair> {
  const s = await ensureSodium();
  const kp = s.crypto_sign_keypair();
  return {
    publicKey: s.to_hex(kp.publicKey),
    secretKey: s.to_hex(kp.privateKey),
  };
}
