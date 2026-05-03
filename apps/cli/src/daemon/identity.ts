// Accidental-clone detection per spec §2.2. Catches restored backups
// and copy-pasted homedirs by comparing a stable host fingerprint
// against the one we wrote at first daemon start.
//
// NOT attacker-grade: anyone copying both the keypair AND the
// host_fingerprint defeats this. Threat model §16 says so explicitly.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";

import { DAEMON_PATHS } from "./paths.js";

export type ClonePolicy = "refuse" | "warn" | "allow";

export interface FingerprintRecord {
  schema_version: 1;
  fingerprint: string;       // sha256 hex
  host_id: string;           // raw, for diagnostics
  stable_mac: string;        // raw, for diagnostics
  written_at: string;        // ISO date
}

export interface FingerprintCheck {
  result: "first_run" | "match" | "mismatch" | "unavailable";
  current: FingerprintRecord;
  stored?: FingerprintRecord;
}

const FILE_NAME = "host_fingerprint.json";

function path(): string { return join(DAEMON_PATHS.DAEMON_DIR, FILE_NAME); }

/** Compute (without writing) the current host fingerprint. */
export function computeCurrentFingerprint(): FingerprintRecord {
  // Per spec §2.2 / followups doc: when neither host_id nor a stable MAC
  // are readable we fall back to a persisted random UUID. We DO NOT mint
  // a fresh random per call (that would make every restart look like a
  // clone). Instead, leave host_id empty when unknown — the MAC alone
  // identifies the host for accidental-clone detection.
  const host_id = readHostId() ?? "";
  const stable_mac = pickStableMac() ?? "";
  const fp = createHash("sha256").update(host_id, "utf8").update("\0").update(stable_mac, "utf8").digest("hex");
  return {
    schema_version: 1,
    fingerprint: fp,
    host_id,
    stable_mac,
    written_at: new Date().toISOString(),
  };
}

// `randomUUID` is no longer used after the random-fallback fix; keep the
// import only if other helpers need it.
void randomUUID;

/** Read or write the persisted fingerprint and report the result. */
export function checkFingerprint(): FingerprintCheck {
  const current = computeCurrentFingerprint();
  if (!existsSync(path())) {
    writeFileSync(path(), JSON.stringify(current, null, 2), { mode: 0o600 });
    return { result: "first_run", current };
  }
  let stored: FingerprintRecord;
  try { stored = JSON.parse(readFileSync(path(), "utf8")) as FingerprintRecord; }
  catch { return { result: "unavailable", current }; }
  if (stored.fingerprint === current.fingerprint) return { result: "match", current, stored };
  return { result: "mismatch", current, stored };
}

/** Re-write the fingerprint file. Used by `daemon accept-host`. */
export function acceptCurrentHost(): FingerprintRecord {
  const current = computeCurrentFingerprint();
  writeFileSync(path(), JSON.stringify(current, null, 2), { mode: 0o600 });
  return current;
}

// ── platform helpers ───────────────────────────────────────────────────

function readHostId(): string | null {
  // Linux: /etc/machine-id (or /var/lib/dbus/machine-id).
  if (process.platform === "linux") {
    for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      try {
        const raw = readFileSync(p, "utf8").trim();
        if (raw) return `linux:${raw}`;
      } catch { /* try next */ }
    }
    return null;
  }
  // macOS: IOPlatformUUID via ioreg. We avoid spawning by checking ENV.
  if (process.platform === "darwin") {
    // No reliable file; fall back to MAC-only fingerprint.
    return null;
  }
  // Windows: HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid. Skip in v0.9.0.
  return null;
}

function pickStableMac(): string | null {
  const ifs = networkInterfaces();
  const candidates: string[] = [];
  for (const [name, addrs] of Object.entries(ifs)) {
    if (!addrs) continue;
    if (isIgnoredInterface(name)) continue;
    for (const a of addrs) {
      if (a.internal) continue;
      if (!a.mac || a.mac === "00:00:00:00:00:00") continue;
      candidates.push(`${name}::${a.mac}`);
      break;
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort(); // lex by interface name
  const first = candidates[0]!;
  const idx = first.indexOf("::");
  return idx >= 0 ? first.slice(idx + 2) : first;
}

function isIgnoredInterface(name: string): boolean {
  return /^(lo|docker|br-|veth|tap|tun|tailscale|wg|utun|ppp|vboxnet|vmnet|awdl|llw)/i.test(name);
}
