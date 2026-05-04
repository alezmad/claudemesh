/**
 * Per-session IPC tokens — mint, persist, read.
 *
 * Each `claudemesh launch` mints a 32-byte random token, writes it to
 * `<tmpdir>/session-token` (mode 0o600), and exposes the path to the
 * spawned `claude` via `CLAUDEMESH_IPC_TOKEN_FILE`. Subprocesses
 * inheriting this env auto-attach the token to every IPC request via
 * the `Authorization: ClaudeMesh-Session <hex>` header. The daemon's
 * registry resolves the token to `{sessionId, mesh, displayName, pid,
 * cwd, ...}` in O(1) and uses it for auto-scoping + attribution.
 *
 * Why a file path env var, not the value directly:
 * `ps eww -p <pid>` shows env values to other processes of the same
 * uid. The path leaks; the secret in mode-0600 files inside a
 * mode-0700 tmpdir does not. Same trick OpenSSH uses for SSH_AUTH_SOCK.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV_TOKEN_FILE = "CLAUDEMESH_IPC_TOKEN_FILE";

export interface MintedToken {
  token: string;
  /** Filesystem path the token was written to. Pass via env to children. */
  filePath: string;
}

/** Generate a fresh 64-hex token and write it under `dir`. */
export function mintSessionToken(dir: string, fileName = "session-token"): MintedToken {
  const token = randomBytes(32).toString("hex");
  const filePath = `${dir}/${fileName}`;
  writeFileSync(filePath, token, { mode: 0o600 });
  return { token, filePath };
}

/** Read a token from the path in CLAUDEMESH_IPC_TOKEN_FILE, if present.
 *  Falls back to a literal CLAUDEMESH_IPC_TOKEN env value (for testing).
 *  Returns null when neither is set or the file is unreadable. */
export function readSessionTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const direct = env.CLAUDEMESH_IPC_TOKEN;
  if (direct && /^[0-9a-f]{64}$/i.test(direct)) return direct.toLowerCase();
  const path = env[ENV_TOKEN_FILE];
  if (!path) return null;
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8").trim();
    if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase();
    return null;
  } catch { return null; }
}

export const TOKEN_FILE_ENV = ENV_TOKEN_FILE;
