/**
 * Persistent per-session ed25519 keypairs, keyed by Claude Code's
 * session UUID.
 *
 * Background. Until this module landed, `claudemesh launch` minted a
 * FRESH ephemeral session keypair on every invocation (see
 * SPEC.md §"Session identity"). That made a peer's routing/crypto
 * identity unstable across relaunch and `--resume`: a DM is sealed to
 * the recipient's `sessionPubkey` (crypto_box; see services/crypto/box.ts),
 * so when the key rotated, any message queued for the old pubkey became
 * undecryptable AND the old presence lingered as a ghost on the broker.
 *
 * The fix anchors session identity on the stable thing Claude Code
 * itself uses for resume: the session UUID (scoped to the project/cwd).
 * The keypair for a given (mesh, sessionUuid) is generated once and
 * persisted, so:
 *   - relaunching / `--resume`-ing the same session reuses the SAME
 *     pubkey → the broker reattaches the existing presence and queued
 *     DMs both route AND decrypt;
 *   - a genuinely new session (fresh UUID) gets a fresh keypair → it is
 *     correctly a distinct peer.
 *
 * Storage. `~/.claudemesh/sessions/<meshSlug>/<sessionUuid>.json`, the
 * file mode 0o600 inside a 0o700 dir — same secret-hygiene as the IPC
 * token store. The secret key lives on disk (like the member key
 * already does in the mesh config); the threat-model delta over the old
 * ephemeral scheme is small and was an accepted trade for reliable
 * delivery. `CLAUDEMESH_SESSIONS_DIR` overrides the root for tests.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { generateKeypair, type Ed25519Keypair } from "~/services/crypto/facade.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9._-]+$/i;

interface StoredKeypair {
  version: 1;
  meshSlug: string;
  sessionId: string;
  publicKey: string;
  secretKey: string;
  createdAt: string;
}

/** Root dir for persisted session keypairs. Stable per-machine; does
 *  NOT honor the per-launch `CLAUDEMESH_CONFIG_DIR` tmpdir (those are
 *  ephemeral and would defeat persistence). */
export function sessionsDir(): string {
  return (
    process.env.CLAUDEMESH_SESSIONS_DIR ||
    join(homedir(), ".claudemesh", "sessions")
  );
}

function keyFilePath(meshSlug: string, sessionId: string): string {
  return join(sessionsDir(), meshSlug, `${sessionId}.json`);
}

/** Read a persisted keypair, returning null (never throwing) when the
 *  file is missing, unreadable, malformed, or carries an invalid key. */
function readValidKeypair(file: string): Ed25519Keypair | null {
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredKeypair>;
    if (
      parsed &&
      typeof parsed.publicKey === "string" &&
      /^[0-9a-f]{64}$/.test(parsed.publicKey) &&
      typeof parsed.secretKey === "string" &&
      /^[0-9a-f]{128}$/.test(parsed.secretKey)
    ) {
      return { publicKey: parsed.publicKey, secretKey: parsed.secretKey };
    }
  } catch {
    // Unreadable / corrupt — caller treats as absent and rewrites.
  }
  return null;
}

/**
 * Return the persisted keypair for (meshSlug, sessionId), creating and
 * writing one on first use. Re-reads from disk every call so concurrent
 * launches of the same session converge on one identity rather than
 * racing to mint divergent keys.
 *
 * Falls back to an in-memory ephemeral keypair (the legacy behaviour)
 * when the identifiers are unusable or disk I/O fails — a launch must
 * never be blocked by a keystore problem.
 */
export async function loadOrCreateSessionKeypair(
  meshSlug: string,
  sessionId: string,
): Promise<Ed25519Keypair> {
  // Defensive validation: these compose into a filesystem path, so a
  // malformed slug/uuid must never escape the sessions dir.
  if (!SLUG_RE.test(meshSlug) || !UUID_RE.test(sessionId)) {
    return generateKeypair();
  }

  const file = keyFilePath(meshSlug, sessionId);
  const existing = readValidKeypair(file);
  if (existing) return existing;

  const kp = await generateKeypair();
  try {
    mkdirSync(join(sessionsDir(), meshSlug), { recursive: true, mode: 0o700 });
    const stored: StoredKeypair = {
      version: 1,
      meshSlug,
      sessionId,
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
      createdAt: new Date().toISOString(),
    };
    // Write to a temp sibling then rename for atomicity, so a concurrent
    // reader never sees a half-written file.
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(stored), { mode: 0o600 });
    try {
      // Re-check: another launch may have won the race and created the
      // canonical file with a VALID keypair while we were generating —
      // prefer it. A corrupt/invalid existing file is not a winner; fall
      // through and overwrite it via the atomic rename below.
      if (existsSync(file)) {
        const won = readValidKeypair(file);
        if (won) {
          try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
          return won;
        }
      }
      // renameSync is atomic on the same filesystem.
      renameSync(tmp, file);
    } catch {
      // rename failed — best effort, the in-memory keypair is still valid
      // for this launch.
    }
  } catch {
    // mkdir/write failed — return the freshly generated keypair anyway so
    // the launch proceeds (degrades to ephemeral, same as legacy).
  }
  return kp;
}
