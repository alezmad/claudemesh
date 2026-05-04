/**
 * CLI-side helpers for the per-session attestation flow.
 *
 * Two pieces:
 *   1. `signParentAttestation` — `claudemesh launch` calls this with the
 *      member's stable secret key to mint a long-lived (≤24h) token that
 *      vouches for an ephemeral session pubkey. The attestation travels
 *      with the session-token registration to the daemon.
 *   2. `signSessionHello` — the daemon's `SessionBrokerClient` calls this
 *      on every WS-connect to sign the canonical session-hello bytes with
 *      the session secret key (proves liveness + possession).
 *
 * Both formats mirror the broker's `canonicalSessionAttestation` /
 * `canonicalSessionHello`. Drift will surface as `bad_signature` from
 * the broker, never silent breakage.
 */

import { ensureSodium } from "~/services/crypto/keypair.js";

/** Default attestation lifetime — 12h leaves headroom under broker's 24h cap. */
export const DEFAULT_ATTESTATION_TTL_MS = 12 * 60 * 60 * 1000;

export interface ParentAttestation {
  sessionPubkey: string;
  parentMemberPubkey: string;
  expiresAt: number;
  signature: string;
}

/** Sign the parent-vouches-session attestation. */
export async function signParentAttestation(args: {
  parentMemberPubkey: string;
  parentSecretKey: string;
  sessionPubkey: string;
  /** Override the lifetime; default 12h. */
  ttlMs?: number;
  /** Override clock for tests. */
  now?: number;
}): Promise<ParentAttestation> {
  const s = await ensureSodium();
  const expiresAt = (args.now ?? Date.now()) + (args.ttlMs ?? DEFAULT_ATTESTATION_TTL_MS);
  const canonical = `claudemesh-session-attest|${args.parentMemberPubkey}|${args.sessionPubkey}|${expiresAt}`;
  const sig = s.crypto_sign_detached(
    s.from_string(canonical),
    s.from_hex(args.parentSecretKey),
  );
  return {
    sessionPubkey: args.sessionPubkey,
    parentMemberPubkey: args.parentMemberPubkey,
    expiresAt,
    signature: s.to_hex(sig),
  };
}

/** Sign the per-WS-connect session-hello bytes. */
export async function signSessionHello(args: {
  meshId: string;
  parentMemberPubkey: string;
  sessionPubkey: string;
  sessionSecretKey: string;
  now?: number;
}): Promise<{ timestamp: number; signature: string }> {
  const s = await ensureSodium();
  const timestamp = args.now ?? Date.now();
  const canonical =
    `claudemesh-session-hello|${args.meshId}|${args.parentMemberPubkey}|${args.sessionPubkey}|${timestamp}`;
  const sig = s.crypto_sign_detached(
    s.from_string(canonical),
    s.from_hex(args.sessionSecretKey),
  );
  return { timestamp, signature: s.to_hex(sig) };
}
