import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

import { DAEMON_PATHS } from "./paths.js";

/**
 * Local IPC bearer token. Mode 0600. Rotated by deleting the file and
 * restarting the daemon.
 */
export function readLocalToken(): string | null {
  try {
    return readFileSync(DAEMON_PATHS.TOKEN_FILE, "utf8").trim();
  } catch {
    return null;
  }
}

export function ensureLocalToken(): string {
  const existing = readLocalToken();
  if (existing) return existing;
  mkdirSync(dirname(DAEMON_PATHS.TOKEN_FILE), { recursive: true, mode: 0o700 });
  const tok = randomBytes(32).toString("base64url");
  writeFileSync(DAEMON_PATHS.TOKEN_FILE, tok + "\n", { mode: 0o600 });
  return tok;
}
