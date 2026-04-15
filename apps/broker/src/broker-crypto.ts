/**
 * Broker-side symmetric encryption for persisting resolved env vars.
 *
 * Uses Node's built-in crypto (AES-256-GCM). The key comes from
 * BROKER_ENCRYPTION_KEY env var (64 hex chars = 32 bytes). If not set,
 * a random key is generated and logged on first use — operator should
 * persist it to survive broker restarts.
 *
 * This is NOT the same as peer-side E2E crypto (libsodium). This is
 * platform-level encryption-at-rest, same model as Heroku/Coolify/AWS.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";
import { log } from "./logger";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let _key: Buffer | null = null;

function getKey(): Buffer {
  if (_key) return _key;

  if (env.BROKER_ENCRYPTION_KEY && /^[0-9a-f]{64}$/i.test(env.BROKER_ENCRYPTION_KEY)) {
    _key = Buffer.from(env.BROKER_ENCRYPTION_KEY, "hex");
    return _key;
  }

  // In production, refuse to start without a persistent key. Silently
  // generating a random one meant every restart invalidated all encrypted
  // rows on disk — and the ephemeral key was logged in clear, which is
  // itself a leak.
  if (process.env.NODE_ENV === "production") {
    log.error("BROKER_ENCRYPTION_KEY is missing or malformed (need 64 hex chars) — refusing to start in production");
    process.exit(1);
  }

  // Dev only: generate a stable per-process key. Never log the value.
  _key = randomBytes(32);
  log.warn("BROKER_ENCRYPTION_KEY not set — using ephemeral key for this dev process (encrypted data WILL NOT survive restarts). Set BROKER_ENCRYPTION_KEY to a 64-hex-char value for persistence.");
  return _key;
}

/**
 * Encrypt a JSON-serializable value. Returns a base64 string containing
 * IV + ciphertext + auth tag.
 */
export function encryptForStorage(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack: IV (12) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypt a value produced by encryptForStorage. Returns the plaintext
 * string, or null if decryption fails (wrong key, tampered).
 */
export function decryptFromStorage(packed: string): string | null {
  try {
    const key = getKey();
    const buf = Buffer.from(packed, "base64");
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (e) {
    // Loud failure: if a stored row fails to decrypt the key changed or
    // data is corrupt — don't silently return null and let downstream
    // code assume "no value".
    log.error("decryptFromStorage failed", { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
