/**
 * Browser port of the CLI's per-topic key crypto.
 *
 * Mirrors apps/cli/src/services/crypto/topic-key.ts so a single mental
 * model covers both surfaces:
 *
 *   1. UI mints a REST apikey for the dashboard user.
 *   2. UI ensures `mesh.member.peer_pubkey` matches the browser's
 *      IndexedDB-persisted identity via POST /v1/me/peer-pubkey.
 *   3. UI fetches GET /v1/topics/:name/key. Once any CLI peer has
 *      re-sealed the topic key for this member, the response carries
 *      `<32-byte sender x25519 pubkey> || crypto_box(topicKey)`.
 *   4. UI converts the browser's ed25519 secret to x25519 and
 *      crypto_box_open's the seal.
 *   5. Plaintext topic key is cached in-memory (per apikey + topic)
 *      and used for crypto_secretbox encrypt + decrypt of v2 message
 *      bodies.
 *
 * Cache key uses the apikey prefix so a logout clears it implicitly.
 * Refresh on logout / 401 to avoid leaking keys across sessions.
 */

import sodium from "libsodium-wrappers";

import { getBrowserIdentity } from "./identity";

interface CacheEntry {
  topicKey: Uint8Array;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

interface SealedKeyResponse {
  topic: string;
  topicId: string;
  encryptedKey: string;
  nonce: string;
  senderPubkey: string;
  createdAt: string;
}

export type TopicKeyError =
  | "not_sealed"
  | "topic_unencrypted"
  | "decrypt_failed"
  | "bad_member_secret"
  | "network";

export interface TopicKeyResult {
  ok: boolean;
  topicKey?: Uint8Array;
  error?: TopicKeyError;
  message?: string;
}

function cacheKey(apiKeySecret: string, topicName: string): string {
  return `${apiKeySecret.slice(0, 12)}:${topicName}`;
}

async function fetchSealed(
  apiKeySecret: string,
  topicName: string,
): Promise<{ ok: true; data: SealedKeyResponse } | { ok: false; status: number; message?: string }> {
  const res = await fetch(`/api/v1/topics/${encodeURIComponent(topicName)}/key`, {
    headers: { Authorization: `Bearer ${apiKeySecret}` },
  });
  if (!res.ok) {
    let message: string | undefined;
    try {
      const body = (await res.json()) as { error?: string };
      message = body.error;
    } catch {
      // empty
    }
    return { ok: false, status: res.status, message };
  }
  const data = (await res.json()) as SealedKeyResponse;
  return { ok: true, data };
}

export async function getTopicKey(args: {
  apiKeySecret: string;
  topicName: string;
  /** Bypass cache — useful after a re-seal lands. */
  fresh?: boolean;
}): Promise<TopicKeyResult> {
  const cacheId = cacheKey(args.apiKeySecret, args.topicName);
  if (!args.fresh) {
    const cached = cache.get(cacheId);
    if (cached) return { ok: true, topicKey: cached.topicKey };
  }

  const sealed = await fetchSealed(args.apiKeySecret, args.topicName);
  if (!sealed.ok) {
    if (sealed.status === 404) return { ok: false, error: "not_sealed" };
    if (sealed.status === 409)
      return { ok: false, error: "topic_unencrypted" };
    return {
      ok: false,
      error: "network",
      message: sealed.message ?? `HTTP ${sealed.status}`,
    };
  }

  await sodium.ready;
  const identity = await getBrowserIdentity();

  let topicKey: Uint8Array;
  try {
    const blob = sodium.from_base64(
      sealed.data.encryptedKey,
      sodium.base64_variants.ORIGINAL,
    );
    const nonce = sodium.from_base64(
      sealed.data.nonce,
      sodium.base64_variants.ORIGINAL,
    );
    if (blob.length < 32 + sodium.crypto_box_MACBYTES) {
      return {
        ok: false,
        error: "decrypt_failed",
        message: "sealed key blob too short to contain sender pubkey + cipher",
      };
    }
    const senderX25519 = blob.slice(0, 32);
    const cipher = blob.slice(32);
    topicKey = sodium.crypto_box_open_easy(
      cipher,
      nonce,
      senderX25519,
      identity.xSec,
    );
  } catch (e) {
    return {
      ok: false,
      error: "decrypt_failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  cache.set(cacheId, { topicKey, fetchedAt: Date.now() });
  return { ok: true, topicKey };
}

/**
 * Encrypt a UTF-8 plaintext with the topic key. Output matches the
 * v0.3.0 wire format: bodyVersion=2, ciphertext+nonce both base64.
 */
export async function encryptMessage(
  topicKey: Uint8Array,
  plaintext: string,
): Promise<{ ciphertext: string; nonce: string }> {
  await sodium.ready;
  const nonceBytes = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(
    sodium.from_string(plaintext),
    nonceBytes,
    topicKey,
  );
  return {
    ciphertext: sodium.to_base64(cipher, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonceBytes, sodium.base64_variants.ORIGINAL),
  };
}

/**
 * Decrypt a v2 ciphertext body. Returns null on auth failure so the
 * caller can render a placeholder rather than crash.
 */
export async function decryptMessage(
  topicKey: Uint8Array,
  ciphertextB64: string,
  nonceB64: string,
): Promise<string | null> {
  try {
    await sodium.ready;
    const cipher = sodium.from_base64(
      ciphertextB64,
      sodium.base64_variants.ORIGINAL,
    );
    const nonce = sodium.from_base64(nonceB64, sodium.base64_variants.ORIGINAL);
    const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, topicKey);
    return sodium.to_string(plain);
  } catch {
    return null;
  }
}

/**
 * Register the browser's identity pubkey on the server so the next
 * CLI re-seal pass can include this browser as a recipient. Idempotent.
 *
 * Returns `{ changed }` so callers can react (e.g. nudge "waiting for
 * a CLI peer to share the topic key" until the next re-seal lands).
 */
export async function registerBrowserPeerPubkey(
  apiKeySecret: string,
): Promise<{ memberId: string; pubkey: string; changed: boolean }> {
  const identity = await getBrowserIdentity();
  const res = await fetch("/api/v1/me/peer-pubkey", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKeySecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pubkey: identity.edPubHex }),
  });
  if (!res.ok) {
    let detail: string;
    try {
      const j = (await res.json()) as { error?: string };
      detail = j.error ?? `HTTP ${res.status}`;
    } catch {
      detail = `HTTP ${res.status}`;
    }
    throw new Error(`peer-pubkey registration failed: ${detail}`);
  }
  return (await res.json()) as { memberId: string; pubkey: string; changed: boolean };
}

/**
 * Seal the topic key for another member's pubkey. Mirrors the CLI
 * `sealTopicKeyFor` so a browser holder can re-seal for newcomers
 * (CLI peers, other browsers) instead of the topic going dark when
 * the only holder is a browser session.
 *
 * Returns null if the recipient pubkey is malformed (junk in the DB
 * or a pre-encryption legacy member).
 */
export async function sealTopicKeyFor(
  topicKey: Uint8Array,
  recipientPubkeyHex: string,
): Promise<{ encryptedKey: string; nonce: string } | null> {
  try {
    await sodium.ready;
    const identity = await getBrowserIdentity();
    const recipientX25519 = sodium.crypto_sign_ed25519_pk_to_curve25519(
      sodium.from_hex(recipientPubkeyHex),
    );
    const nonceBytes = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const cipher = sodium.crypto_box_easy(
      topicKey,
      nonceBytes,
      recipientX25519,
      identity.xSec,
    );
    // Wire format mirrors the CLI: <32-byte sender x25519 pubkey> || cipher.
    const blob = new Uint8Array(32 + cipher.length);
    blob.set(identity.xPub, 0);
    blob.set(cipher, 32);
    return {
      encryptedKey: sodium.to_base64(blob, sodium.base64_variants.ORIGINAL),
      nonce: sodium.to_base64(nonceBytes, sodium.base64_variants.ORIGINAL),
    };
  } catch {
    return null;
  }
}

/**
 * Bootstrap encryption on a v1 topic. Generates a fresh 32-byte topic
 * key, seals it for the calling browser via crypto_box, and POSTs to
 * `/v1/topics/:name/claim-key`. The endpoint is atomic (only succeeds
 * if the topic's encrypted_key_pubkey is currently NULL); 409 means
 * another peer beat us to the claim and we should fall back to the
 * regular fetch path.
 *
 * Returns the new in-memory topic key on success so the caller can
 * use it immediately without a follow-up `getTopicKey` round-trip.
 */
export async function claimTopicKey(args: {
  apiKeySecret: string;
  topicName: string;
}): Promise<{ ok: true; topicKey: Uint8Array } | { ok: false; error: string; senderPubkey?: string }> {
  await sodium.ready;
  const identity = await getBrowserIdentity();

  // Fresh symmetric key — 32 bytes for crypto_secretbox.
  const topicKey = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);

  // Seal it for ourselves with our x25519 keypair. Wire format:
  //   <32 bytes browser-x25519-pubkey> || crypto_box(topicKey, ...)
  // matches what the broker writes for creator-seal in broker.ts.
  const nonceBytes = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const cipher = sodium.crypto_box_easy(
    topicKey,
    nonceBytes,
    identity.xPub,
    identity.xSec,
  );
  const blob = new Uint8Array(32 + cipher.length);
  blob.set(identity.xPub, 0);
  blob.set(cipher, 32);

  const res = await fetch(
    `/api/v1/topics/${encodeURIComponent(args.topicName)}/claim-key`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKeySecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // The senderPubkey stored on the topic row is the ED25519
        // (we use it to seal subsequent re-seals); the per-member
        // wire format embeds the sender's x25519 pubkey inline. Use
        // the ed25519 here because that's what the broker schema
        // expects (see topic.encrypted_key_pubkey docstring).
        encryptedKeyPubkey: identity.edPubHex,
        encryptedKey: sodium.to_base64(blob, sodium.base64_variants.ORIGINAL),
        nonce: sodium.to_base64(nonceBytes, sodium.base64_variants.ORIGINAL),
      }),
    },
  );

  if (!res.ok) {
    let detail: string;
    let senderPubkey: string | undefined;
    try {
      const j = (await res.json()) as { error?: string; senderPubkey?: string };
      detail = j.error ?? `HTTP ${res.status}`;
      senderPubkey = j.senderPubkey;
    } catch {
      detail = `HTTP ${res.status}`;
    }
    return { ok: false, error: detail, ...(senderPubkey ? { senderPubkey } : {}) };
  }
  return { ok: true, topicKey };
}
