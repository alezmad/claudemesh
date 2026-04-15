/**
 * v2 invite claim client.
 *
 * The v2 invite URL is a short opaque code (e.g. `claudemesh.com/i/abc12345`).
 * The mesh root key is NOT embedded. Instead:
 *
 *   1. Client generates a fresh x25519 keypair (separate from the peer's
 *      ed25519 identity) just for this claim.
 *   2. Client POSTs `recipient_x25519_pubkey` to
 *      `${appBaseUrl}/api/public/invites/:code/claim`.
 *   3. Server responds with `sealed_root_key` (crypto_box_seal of the real
 *      mesh root key to the recipient pubkey) + mesh metadata +
 *      `canonical_v2` (the signed capability bytes).
 *   4. Client unseals the root key with its x25519 secret key.
 *
 * Wire contract is LOCKED — see `docs/protocol.md` §v2 invites and
 * `apps/broker/tests/invite-v2.test.ts`.
 */

import sodium from "libsodium-wrappers";

async function ensureSodium(): Promise<typeof sodium> {
  await sodium.ready;
  return sodium;
}

/**
 * Generate a fresh x25519 (Curve25519) keypair suitable for
 * `crypto_box_seal`. This is intentionally distinct from the peer's
 * long-lived ed25519 identity — we do NOT want the mesh root key sealed
 * against a key that's reused for signing.
 *
 * Returns the public key as URL-safe base64url (no padding) to match
 * the format used by the broker's `sealed_root_key` response.
 */
export async function generateX25519Keypair(): Promise<{
  publicKeyB64: string;
  secretKey: Uint8Array;
}> {
  const s = await ensureSodium();
  const kp = s.crypto_box_keypair();
  const publicKeyB64 = s.to_base64(
    kp.publicKey,
    s.base64_variants.URLSAFE_NO_PADDING,
  );
  return { publicKeyB64, secretKey: kp.privateKey };
}

export interface ClaimV2Result {
  meshId: string;
  memberId: string;
  ownerPubkey: string;
  canonicalV2: string;
  /** Unsealed mesh root key, 32 raw bytes. */
  rootKey: Uint8Array;
}

interface ClaimResponseBody {
  sealed_root_key?: string;
  mesh_id?: string;
  member_id?: string;
  owner_pubkey?: string;
  canonical_v2?: string;
}

interface ClaimErrorBody {
  error?: string;
  code?: string;
  message?: string;
}

/**
 * Claim a v2 invite by its short code. Performs the x25519 keypair
 * generation, POST, and local unseal of the returned `sealed_root_key`.
 *
 * Throws with a descriptive message on 4xx/5xx or on seal-open failure.
 */
export async function claimInviteV2(opts: {
  appBaseUrl: string; // e.g. "https://claudemesh.com"
  code: string;
}): Promise<ClaimV2Result> {
  const s = await ensureSodium();
  const { publicKeyB64, secretKey } = await generateX25519Keypair();
  const publicKeyBytes = s.from_base64(
    publicKeyB64,
    s.base64_variants.URLSAFE_NO_PADDING,
  );

  const base = opts.appBaseUrl.replace(/\/$/, "");
  const code = encodeURIComponent(opts.code);
  const url = `${base}/api/public/invites/${code}/claim`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ recipient_x25519_pubkey: publicKeyB64 }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Error(
      `claim request failed (network): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Parse body first — server returns JSON for both success and error.
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // fall through with parsed=null
  }

  if (!res.ok) {
    const err = (parsed ?? {}) as ClaimErrorBody;
    const reason =
      err.error ?? err.code ?? err.message ?? `HTTP ${res.status}`;
    switch (res.status) {
      case 400:
        throw new Error(`invite claim rejected: ${reason}`);
      case 404:
        throw new Error(`invite not found: ${reason}`);
      case 410:
        throw new Error(`invite no longer usable: ${reason}`);
      default:
        throw new Error(`invite claim failed (${res.status}): ${reason}`);
    }
  }

  const body = (parsed ?? {}) as ClaimResponseBody;
  if (
    !body.sealed_root_key ||
    !body.mesh_id ||
    !body.member_id ||
    !body.owner_pubkey ||
    !body.canonical_v2
  ) {
    throw new Error(
      `invite claim response malformed: missing required field(s)`,
    );
  }

  // Unseal the root key with our x25519 secret.
  let rootKey: Uint8Array;
  try {
    const sealed = s.from_base64(
      body.sealed_root_key,
      s.base64_variants.URLSAFE_NO_PADDING,
    );
    const opened = s.crypto_box_seal_open(sealed, publicKeyBytes, secretKey);
    if (!opened) throw new Error("crypto_box_seal_open returned empty");
    rootKey = opened;
  } catch (e) {
    throw new Error(
      `failed to unseal root key (server sealed to wrong pubkey?): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (rootKey.length !== 32) {
    throw new Error(
      `unsealed root key has wrong length: ${rootKey.length} (expected 32)`,
    );
  }

  // TODO(v0.1.5): when the claim response grows a `signature` field,
  // re-verify canonical_v2 against owner_pubkey locally as a
  // belt-and-suspenders check against a compromised broker.
  // For v0.1.x the broker is trusted: it verified capability_v2 before
  // sealing, and a malicious broker could already lie about mesh_id.

  return {
    meshId: body.mesh_id,
    memberId: body.member_id,
    ownerPubkey: body.owner_pubkey,
    canonicalV2: body.canonical_v2,
    rootKey,
  };
}

/**
 * Parse a v2 invite input (bare code or full URL) into a short code.
 *
 * Accepted forms:
 *   - `abc12345`
 *   - `claudemesh.com/i/abc12345`
 *   - `https://claudemesh.com/i/abc12345`
 *   - `https://claudemesh.com/es/i/abc12345` (locale prefix)
 *
 * Returns `null` if the input doesn't look like a v2 code/URL — callers
 * should fall back to the v1 `ic://join/...` parser in that case.
 */
export function parseV2InviteInput(input: string): string | null {
  const trimmed = input.trim();

  // Full URL with /i/<code>
  const urlMatch = trimmed.match(
    /^https?:\/\/[^/]+(?:\/[a-z]{2})?\/i\/([A-Za-z0-9]+)\/?$/,
  );
  if (urlMatch) return urlMatch[1]!;

  // Schemeless "claudemesh.com/i/<code>"
  const schemelessMatch = trimmed.match(
    /^[^/]+(?:\/[a-z]{2})?\/i\/([A-Za-z0-9]+)\/?$/,
  );
  if (schemelessMatch) return schemelessMatch[1]!;

  // Bare short code — base62, typically 8 chars. Be a little lenient
  // (6-16) to accommodate future tweaks but stay tight enough not to
  // collide with a v1 base64url token (which contains `-` / `_` and is
  // much longer).
  if (/^[A-Za-z0-9]{6,16}$/.test(trimmed)) return trimmed;

  return null;
}
