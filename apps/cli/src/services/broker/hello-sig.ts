import { ensureSodium } from "~/services/crypto/facade.js";

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
