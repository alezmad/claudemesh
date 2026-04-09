/**
 * Generate a short pairing code for CLI-to-browser visual confirmation.
 * Excludes ambiguous characters (0/O, 1/l/I) for readability.
 */

import { randomBytes } from "node:crypto";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/**
 * Generate a 4-character alphanumeric pairing code.
 * Example output: "A3Kx", "Hn7v", "pQ4m"
 */
export function generatePairingCode(): string {
  const bytes = randomBytes(4);
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join("");
}
