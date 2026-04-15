/**
 * `claudemesh backup` — encrypt the local config and save a portable
 * recovery file. Restore later with `claudemesh restore <file>` on any
 * machine to recover mesh memberships.
 *
 * Crypto:
 *   - Argon2id KDF over a user passphrase → 32-byte key
 *     (via libsodium's crypto_pwhash, INTERACTIVE limits so a weak
 *      passphrase is still workable but brute-force remains expensive)
 *   - XChaCha20-Poly1305 authenticated encryption of the JSON config
 *   - Format: magic "CMB1" · salt (16B) · nonce (24B) · ciphertext
 *
 * Output: a single `.claudemesh-backup` file the user can store in
 * 1Password, email to themselves, etc. Zero server involvement.
 *
 * Passphrase hygiene: read twice from TTY, never echoed. Rejects
 * passphrases shorter than 12 characters.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { getConfigPath } from "~/services/config/facade.js";
import { ensureSodium } from "~/services/crypto/facade.js";
import { EXIT } from "~/constants/exit-codes.js";

const MAGIC = Buffer.from("CMB1", "utf-8");

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Node readline doesn't mask by default. Turn off echo manually.
    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
    const wasRaw = Boolean(stdin.isRaw);
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    let buf = "";
    const onData = (chunk: Buffer): void => {
      const ch = chunk.toString("utf-8");
      if (ch === "\n" || ch === "\r" || ch === "\u0004") {
        stdin.removeListener("data", onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        process.stdout.write("\n");
        rl.close();
        resolve(buf);
        return;
      }
      if (ch === "\u0003") { // ctrl-c
        process.exit(130);
      }
      if (ch === "\u007f") { // backspace
        buf = buf.slice(0, -1);
        return;
      }
      buf += ch;
    };
    stdin.on("data", onData);
  });
}

async function deriveKey(pass: string, salt: Buffer, s: Awaited<ReturnType<typeof ensureSodium>>): Promise<Uint8Array> {
  return s.crypto_pwhash(
    32,
    pass,
    salt,
    s.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    s.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    s.crypto_pwhash_ALG_ARGON2ID13,
  );
}

export async function runBackup(outPath: string | undefined): Promise<number> {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    console.error("  No config found — nothing to back up. Join a mesh first.");
    return EXIT.NOT_FOUND;
  }
  const plaintext = readFileSync(configPath);

  const pass = await readHidden("  Passphrase (min 12 chars): ");
  if (pass.length < 12) {
    console.error("  ✗ Passphrase too short.");
    return EXIT.INVALID_ARGS;
  }
  const confirm = await readHidden("  Confirm passphrase:       ");
  if (confirm !== pass) {
    console.error("  ✗ Passphrases did not match.");
    return EXIT.INVALID_ARGS;
  }

  const s = await ensureSodium();
  const salt = Buffer.from(s.randombytes_buf(16));
  const nonce = Buffer.from(s.randombytes_buf(24));
  const key = await deriveKey(pass, salt, s);
  const ciphertext = Buffer.from(
    s.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, null, null, nonce, key),
  );
  const blob = Buffer.concat([MAGIC, salt, nonce, ciphertext]);

  const file = outPath ?? `claudemesh-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.cmb`;
  writeFileSync(file, blob, { mode: 0o600 });
  console.log(`\n  ✓ Backup saved: ${file}`);
  console.log(`  Size: ${blob.length} bytes. Guard the passphrase — there is no recovery.\n`);
  return EXIT.SUCCESS;
}

export async function runRestore(inPath: string | undefined): Promise<number> {
  if (!inPath) {
    console.error("  Usage: claudemesh restore <backup-file>");
    return EXIT.INVALID_ARGS;
  }
  if (!existsSync(inPath)) {
    console.error(`  ✗ File not found: ${inPath}`);
    return EXIT.NOT_FOUND;
  }
  const blob = readFileSync(inPath);
  if (blob.length < 4 + 16 + 24 + 17 || !blob.subarray(0, 4).equals(MAGIC)) {
    console.error("  ✗ Not a claudemesh backup file (bad magic).");
    return EXIT.INVALID_ARGS;
  }
  const salt = blob.subarray(4, 20);
  const nonce = blob.subarray(20, 44);
  const ciphertext = blob.subarray(44);

  const pass = await readHidden("  Passphrase: ");
  const s = await ensureSodium();
  const key = await deriveKey(pass, Buffer.from(salt), s);
  let plaintext: Uint8Array;
  try {
    plaintext = s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, null, nonce, key);
  } catch {
    console.error("  ✗ Decryption failed — wrong passphrase or tampered file.");
    return EXIT.INTERNAL_ERROR;
  }

  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    const backupOld = `${configPath}.before-restore.${Date.now()}`;
    writeFileSync(backupOld, readFileSync(configPath), { mode: 0o600 });
    console.log(`  ↻ Existing config saved to ${backupOld}`);
  }
  writeFileSync(configPath, Buffer.from(plaintext), { mode: 0o600 });
  console.log(`\n  ✓ Config restored to ${configPath}`);
  console.log("  Run `claudemesh list` to verify your meshes.\n");
  return EXIT.SUCCESS;
}
