import { ensureSodium } from "./keypair.js";

export async function randomBytes(n: number): Promise<Uint8Array> {
  const s = await ensureSodium();
  return s.randombytes_buf(n);
}

export async function randomHex(n: number): Promise<string> {
  const s = await ensureSodium();
  return s.to_hex(s.randombytes_buf(n));
}
