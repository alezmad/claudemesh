/**
 * Per-topic symmetric-key cache + crypto_box plumbing.
 *
 * Lifecycle:
 *   1. CLI command minted a REST apikey via withRestKey().
 *   2. Caller asks for a topic key by (mesh_secret_key, topic_name).
 *   3. We fetch GET /v1/topics/:name/key for the sealed copy + sender pubkey.
 *   4. We convert the mesh's ed25519 secret to x25519, then crypto_box_open
 *      the sealed key. Plaintext key is cached in-process and used to
 *      encrypt + decrypt v2 message bodies.
 *
 * Failures:
 *   - 404 key_not_sealed_for_member: caller is in the topic but no peer
 *     has re-sealed the key for them yet. Caller surfaces a "waiting for
 *     a peer to share the topic key" message and falls back to v1 path.
 *   - 409 topic_unencrypted: legacy v0.2.0 topic. Caller stays on v1.
 *   - decrypt failure: server fed us a junk seal. Caller re-fetches
 *     once; if still bad, surface error and fall back.
 *
 * The cache is keyed on (apiKeyHash, topicName) so it never crosses
 * sessions. Process-only — no disk persistence.
 */

import { request } from "~/services/api/client.js";
import { ApiError } from "~/services/api/errors.js";

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
  // First 12 chars of the apikey is plenty to dedupe within a session
  // and short enough to avoid keeping the full secret in a Map key.
  return `${apiKeySecret.slice(0, 12)}:${topicName}`;
}

export async function getTopicKey(args: {
  apiKeySecret: string;
  memberSecretKeyHex: string;
  topicName: string;
  /** Bypass cache — useful after a re-seal. */
  fresh?: boolean;
}): Promise<TopicKeyResult> {
  const cacheId = cacheKey(args.apiKeySecret, args.topicName);
  if (!args.fresh) {
    const cached = cache.get(cacheId);
    if (cached) return { ok: true, topicKey: cached.topicKey };
  }

  let sealed: SealedKeyResponse;
  try {
    sealed = await request<SealedKeyResponse>({
      path: `/api/v1/topics/${encodeURIComponent(args.topicName)}/key`,
      token: args.apiKeySecret,
    });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 404) return { ok: false, error: "not_sealed" };
      if (e.status === 409) return { ok: false, error: "topic_unencrypted" };
    }
    return {
      ok: false,
      error: "network",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const sodium = (await import("libsodium-wrappers")).default;
  await sodium.ready;

  let recipientX25519Secret: Uint8Array;
  try {
    const ed = sodium.from_hex(args.memberSecretKeyHex);
    recipientX25519Secret = sodium.crypto_sign_ed25519_sk_to_curve25519(ed);
  } catch {
    return { ok: false, error: "bad_member_secret" };
  }

  let topicKey: Uint8Array;
  try {
    const blob = sodium.from_base64(
      sealed.encryptedKey,
      sodium.base64_variants.ORIGINAL,
    );
    const nonce = sodium.from_base64(
      sealed.nonce,
      sodium.base64_variants.ORIGINAL,
    );
    // Wire format: first 32 bytes = sender x25519 pubkey, rest =
    // crypto_box ciphertext. The topic.encryptedKeyPubkey on the topic
    // record is the original creator's sender; subsequent re-seals
    // each carry their own sender pubkey, so the joiner can decrypt
    // regardless of who sealed for them.
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
      recipientX25519Secret,
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
 * Encrypt a UTF-8 plaintext message body with the topic's symmetric
 * key via crypto_secretbox. Returns base64 ciphertext + base64 nonce
 * suitable for POST /v1/messages with bodyVersion: 2.
 */
export async function encryptMessage(
  topicKey: Uint8Array,
  plaintext: string,
): Promise<{ ciphertext: string; nonce: string }> {
  const sodium = (await import("libsodium-wrappers")).default;
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
 * Decrypt a v2 message body. Returns null on auth failure (bad key
 * or tampering) — caller should fall back to a placeholder string,
 * not crash the renderer.
 */
export async function decryptMessage(
  topicKey: Uint8Array,
  ciphertextB64: string,
  nonceB64: string,
): Promise<string | null> {
  try {
    const sodium = (await import("libsodium-wrappers")).default;
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
 * Seal a topic key for another member — used by the re-seal flow when
 * a holder helps onboard a new joiner. Returns the bundle ready to
 * POST to /v1/topics/:name/seal.
 */
export async function sealTopicKeyFor(
  topicKey: Uint8Array,
  recipientPubkeyHex: string,
  ourMemberSecretKeyHex: string,
): Promise<{
  /** base64( our_x25519_pubkey || crypto_box(topicKey) ). */
  encryptedKey: string;
  nonce: string;
} | null> {
  try {
    const sodium = (await import("libsodium-wrappers")).default;
    await sodium.ready;
    const recipientX25519 = sodium.crypto_sign_ed25519_pk_to_curve25519(
      sodium.from_hex(recipientPubkeyHex),
    );
    const ourEdSecret = sodium.from_hex(ourMemberSecretKeyHex);
    const ourX25519Secret = sodium.crypto_sign_ed25519_sk_to_curve25519(
      ourEdSecret,
    );
    // Derive our x25519 public from our ed25519 public half (back half
    // of the secret key contains the ed25519 pubkey per libsodium spec).
    const ourEdPublic = ourEdSecret.slice(32, 64);
    const ourX25519Public = sodium.crypto_sign_ed25519_pk_to_curve25519(
      ourEdPublic,
    );
    const nonceBytes = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const cipher = sodium.crypto_box_easy(
      topicKey,
      nonceBytes,
      recipientX25519,
      ourX25519Secret,
    );
    // Embed sender pubkey as the first 32 bytes so the recipient can
    // decrypt without a separate lookup. Matches the format the broker's
    // creator-seal writes (see broker.ts sealTopicKeyForMember).
    const blob = new Uint8Array(32 + cipher.length);
    blob.set(ourX25519Public, 0);
    blob.set(cipher, 32);
    return {
      encryptedKey: sodium.to_base64(blob, sodium.base64_variants.ORIGINAL),
      nonce: sodium.to_base64(nonceBytes, sodium.base64_variants.ORIGINAL),
    };
  } catch {
    return null;
  }
}
