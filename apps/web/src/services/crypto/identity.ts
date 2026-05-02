/**
 * Browser-side persistent peer identity for claudemesh.
 *
 * Stores an ed25519 keypair in IndexedDB so the same browser tab,
 * the same browser after a reload, and the same user across reloads
 * keeps the same identity. Without this, every page-reload would
 * mint a new pubkey and the broker's per-topic-key seal would have
 * to chase a moving target.
 *
 * The keypair lives at `claudemesh-identity / kp / default`. There's
 * one identity per browser profile, shared across every mesh the
 * dashboard user is in. The matching `mesh.member.peer_pubkey` rows
 * are kept in sync server-side via `POST /v1/me/peer-pubkey`.
 *
 * Threat model: IndexedDB is per-origin and not exfiltratable from
 * other sites. A malicious extension or full XSS still wins — same
 * as for any browser-stored secret. The CLI's own keypair has
 * stronger guarantees because it lives in `~/.claudemesh/` outside
 * of the browser. We document the divergence in the dashboard UI.
 */

import sodium from "libsodium-wrappers";

export interface BrowserIdentity {
  /** ed25519 public key — registered as `mesh.member.peer_pubkey`. */
  edPub: Uint8Array;
  /** ed25519 secret key — never leaves IndexedDB. */
  edSec: Uint8Array;
  /** x25519 public key, derived from edPub. Used in `crypto_box`. */
  xPub: Uint8Array;
  /** x25519 secret key, derived from edSec. Used in `crypto_box_open`. */
  xSec: Uint8Array;
  /** Hex form of `edPub` — what the API and DB store. */
  edPubHex: string;
}

const DB_NAME = "claudemesh-identity";
const STORE = "kp";
const KEY = "default";

let cached: BrowserIdentity | null = null;
let initPromise: Promise<BrowserIdentity> | null = null;

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readKeypair(): Promise<{
  edPub: Uint8Array;
  edSec: Uint8Array;
} | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => {
      const v = req.result as
        | { edPub: Uint8Array; edSec: Uint8Array }
        | undefined;
      resolve(v ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

async function writeKeypair(kp: {
  edPub: Uint8Array;
  edSec: Uint8Array;
}): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(kp, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get-or-create the browser's persistent identity. First call on a
 * given origin generates a fresh ed25519 keypair, persists it, and
 * derives the matching x25519 pair. Subsequent calls return the
 * in-memory cache.
 *
 * Server registration (`POST /v1/me/peer-pubkey`) is the caller's
 * responsibility — this module only manages the local keypair.
 */
export async function getBrowserIdentity(): Promise<BrowserIdentity> {
  if (cached) return cached;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await sodium.ready;
    let stored = await readKeypair();
    if (!stored) {
      const kp = sodium.crypto_sign_keypair();
      stored = { edPub: kp.publicKey, edSec: kp.privateKey };
      await writeKeypair(stored);
    }
    const xPub = sodium.crypto_sign_ed25519_pk_to_curve25519(stored.edPub);
    const xSec = sodium.crypto_sign_ed25519_sk_to_curve25519(stored.edSec);
    cached = {
      edPub: stored.edPub,
      edSec: stored.edSec,
      xPub,
      xSec,
      edPubHex: sodium.to_hex(stored.edPub),
    };
    return cached;
  })();
  return initPromise;
}

/**
 * Wipe the local identity. The server-side `mesh.member.peer_pubkey`
 * is NOT cleared by this — call `POST /v1/me/peer-pubkey` again with
 * a fresh pubkey after rotation.
 */
export async function clearBrowserIdentity(): Promise<void> {
  cached = null;
  initPromise = null;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
