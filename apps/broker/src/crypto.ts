/**
 * Broker-side ed25519 verification helpers.
 *
 * Used to authenticate the WS hello handshake: clients sign a canonical
 * byte string with their mesh.member.peerPubkey's secret key, broker
 * verifies with the claimed pubkey, then cross-checks the pubkey is a
 * current member of the claimed mesh.
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

/** Canonical hello bytes: clients sign this, broker verifies this. */
export function canonicalHello(
  meshId: string,
  memberId: string,
  pubkey: string,
  timestamp: number,
): string {
  return `${meshId}|${memberId}|${pubkey}|${timestamp}`;
}

export const HELLO_SKEW_MS = 60_000;

/**
 * Verify a hello's ed25519 signature + timestamp skew.
 * Returns { ok: true } on success, or { ok: false, reason } describing
 * which check failed (for structured error response).
 */
export async function verifyHelloSignature(args: {
  meshId: string;
  memberId: string;
  pubkey: string;
  timestamp: number;
  signature: string;
  now?: number;
}): Promise<
  | { ok: true }
  | { ok: false; reason: "timestamp_skew" | "bad_signature" | "malformed" }
> {
  const now = args.now ?? Date.now();
  if (
    !Number.isFinite(args.timestamp) ||
    Math.abs(now - args.timestamp) > HELLO_SKEW_MS
  ) {
    return { ok: false, reason: "timestamp_skew" };
  }
  if (
    !/^[0-9a-f]{64}$/i.test(args.pubkey) ||
    !/^[0-9a-f]{128}$/i.test(args.signature)
  ) {
    return { ok: false, reason: "malformed" };
  }
  const s = await ensureSodium();
  try {
    const canonical = canonicalHello(
      args.meshId,
      args.memberId,
      args.pubkey,
      args.timestamp,
    );
    const ok = s.crypto_sign_verify_detached(
      s.from_hex(args.signature),
      s.from_string(canonical),
      s.from_hex(args.pubkey),
    );
    return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}
