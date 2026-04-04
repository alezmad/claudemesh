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

/** Canonical invite bytes — everything in the payload except the signature. */
export function canonicalInvite(fields: {
  v: number;
  mesh_id: string;
  mesh_slug: string;
  broker_url: string;
  expires_at: number;
  mesh_root_key: string;
  role: "admin" | "member";
  owner_pubkey: string;
}): string {
  return `${fields.v}|${fields.mesh_id}|${fields.mesh_slug}|${fields.broker_url}|${fields.expires_at}|${fields.mesh_root_key}|${fields.role}|${fields.owner_pubkey}`;
}

/**
 * Verify an ed25519 signature over arbitrary canonical bytes.
 * Used by invite verification + (future) any other signed payload.
 */
export async function verifyEd25519(
  canonicalText: string,
  signatureHex: string,
  pubkeyHex: string,
): Promise<boolean> {
  if (
    !/^[0-9a-f]{64}$/i.test(pubkeyHex) ||
    !/^[0-9a-f]{128}$/i.test(signatureHex)
  ) {
    return false;
  }
  const s = await ensureSodium();
  try {
    return s.crypto_sign_verify_detached(
      s.from_hex(signatureHex),
      s.from_string(canonicalText),
      s.from_hex(pubkeyHex),
    );
  } catch {
    return false;
  }
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
