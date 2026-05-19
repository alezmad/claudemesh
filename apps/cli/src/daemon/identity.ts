// Accidental-clone detection per spec §2.2. Catches restored backups
// and copy-pasted homedirs by comparing a stable host fingerprint
// against the one we wrote at first daemon start.
//
// NOT attacker-grade: anyone copying both the keypair AND the
// host_fingerprint defeats this. Threat model §16 says so explicitly.
//
// ── schema_version: 2 (1.34.17+) ──
// v1 was vulnerable to false mismatches across reboots on macOS because
// `os.networkInterfaces()` returns Wi-Fi MACs that Apple's privacy
// rotation re-randomizes (bit 0x02 of the first byte = "locally
// administered"). After a Mac restart, en0's MAC could change → the
// stored sha256(host_id || mac) no longer matched → the daemon refused
// to start in a restart loop. Cure was always manual `accept-host`.
//
// v2 fixes the root cause: on macOS we read `IOPlatformUUID` via
// `ioreg` (burned into EFI, never changes); the MAC picker rejects any
// locally-administered MAC and prefers true hardware NICs. Migration
// is silent — a v1 store that still matches the v1 algorithm is
// rewritten transparently as v2 on first start under this version.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

import { DAEMON_PATHS } from "./paths.js";

export type ClonePolicy = "refuse" | "warn" | "allow";

export interface FingerprintRecord {
  schema_version: 1 | 2;
  fingerprint: string; // sha256 hex
  host_id: string; // raw, for diagnostics
  stable_mac: string; // raw, for diagnostics
  written_at: string; // ISO date
}

export interface FingerprintCheck {
  result: "first_run" | "match" | "mismatch" | "unavailable";
  current: FingerprintRecord;
  stored?: FingerprintRecord;
}

const FILE_NAME = "host_fingerprint.json";
const CURRENT_SCHEMA: 2 = 2;

function path(): string {
  return join(DAEMON_PATHS.DAEMON_DIR, FILE_NAME);
}

// ── public API ────────────────────────────────────────────────────────

/** Compute (without writing) the current host fingerprint under v2 rules. */
export function computeCurrentFingerprint(): FingerprintRecord {
  const host_id = readHostIdV2() ?? "";
  const stable_mac = pickStableMacFromInterfaces(networkInterfaces()) ?? "";
  return {
    schema_version: CURRENT_SCHEMA,
    fingerprint: fingerprintV2(host_id, stable_mac),
    host_id,
    stable_mac,
    written_at: new Date().toISOString(),
  };
}

/** Read or write the persisted fingerprint and report the result. */
export function checkFingerprint(): FingerprintCheck {
  const current = computeCurrentFingerprint();
  if (!existsSync(path())) {
    writeFileSync(path(), JSON.stringify(current, null, 2), { mode: 0o600 });
    return { result: "first_run", current };
  }
  let stored: FingerprintRecord;
  try {
    stored = JSON.parse(readFileSync(path(), "utf8")) as FingerprintRecord;
  } catch {
    return { result: "unavailable", current };
  }

  // v2 fast path: direct compare.
  if (stored.schema_version === 2) {
    if (stored.fingerprint === current.fingerprint)
      return { result: "match", current, stored };
    return { result: "mismatch", current, stored };
  }

  // v1 migration path. Recompute under v1 rules; if it matches, the
  // user is legitimately on the same host, just running v2 for the
  // first time — rewrite the file as v2 and report match. If v1 does
  // not match either, this is a genuine mismatch (clone, restored
  // backup, or actual host change) and the daemon should refuse.
  if (stored.schema_version === 1) {
    const v1 = computeCurrentFingerprintV1();
    if (stored.fingerprint === v1.fingerprint) {
      writeFileSync(path(), JSON.stringify(current, null, 2), { mode: 0o600 });
      return { result: "match", current, stored };
    }
    return { result: "mismatch", current, stored };
  }

  // Unknown future schema. Treat as unavailable rather than first_run
  // — we don't want a newer daemon to silently overwrite a file it
  // doesn't understand.
  return { result: "unavailable", current };
}

/** Re-write the fingerprint file under v2 rules. Used by `daemon accept-host`. */
export function acceptCurrentHost(): FingerprintRecord {
  const current = computeCurrentFingerprint();
  writeFileSync(path(), JSON.stringify(current, null, 2), { mode: 0o600 });
  return current;
}

// ── v2 helpers (exported for tests) ───────────────────────────────────

/** Pure: compute a v2 fingerprint from host_id + stable_mac strings. */
export function fingerprintV2(host_id: string, stable_mac: string): string {
  // The "v2\0" prefix guarantees v1 and v2 hashes are domain-separated
  // even when fed identical inputs.
  return createHash("sha256")
    .update("v2", "utf8")
    .update("\0")
    .update(host_id, "utf8")
    .update("\0")
    .update(stable_mac, "utf8")
    .digest("hex");
}

/**
 * Pure: pick a stable MAC from a NetworkInterfaceInfo map.
 * Rejects locally-administered MACs (bit 0x02 of first byte), which
 * are typically randomized on Apple Wi-Fi, NetworkManager privacy
 * mode, and most virtual bridges. Returns null if none qualify.
 *
 * Exported for unit tests that feed synthetic interface tables.
 */
export function pickStableMacFromInterfaces(
  ifs: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string | null {
  // First pass: prefer hardware (universally-administered) MACs.
  const hardware: Array<{ name: string; mac: string }> = [];
  const fallback: Array<{ name: string; mac: string }> = [];

  for (const [name, addrs] of Object.entries(ifs)) {
    if (!addrs) continue;
    if (isIgnoredInterface(name)) continue;
    for (const a of addrs) {
      if (a.internal) continue;
      if (!a.mac || a.mac === "00:00:00:00:00:00") continue;
      const entry = { name, mac: a.mac };
      if (isLocallyAdministered(a.mac)) {
        fallback.push(entry);
      } else {
        hardware.push(entry);
      }
      break;
    }
  }

  const pool = hardware.length > 0 ? hardware : fallback;
  if (pool.length === 0) return null;
  pool.sort((a, b) => a.name.localeCompare(b.name));
  return pool[0]!.mac;
}

// ── v1 helpers (kept ONLY for migration; do not extend) ───────────────

function computeCurrentFingerprintV1(): FingerprintRecord {
  const host_id = readHostIdV1() ?? "";
  const stable_mac = pickStableMacV1() ?? "";
  const fp = createHash("sha256")
    .update(host_id, "utf8")
    .update("\0")
    .update(stable_mac, "utf8")
    .digest("hex");
  return {
    schema_version: 1,
    fingerprint: fp,
    host_id,
    stable_mac,
    written_at: new Date().toISOString(),
  };
}

function readHostIdV1(): string | null {
  if (process.platform === "linux") {
    for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      try {
        const raw = readFileSync(p, "utf8").trim();
        if (raw) return `linux:${raw}`;
      } catch {
        /* try next */
      }
    }
    return null;
  }
  // v1 on macOS/Windows: empty host_id, MAC-only fingerprint.
  return null;
}

function pickStableMacV1(): string | null {
  const ifs = networkInterfaces();
  const candidates: string[] = [];
  for (const [name, addrs] of Object.entries(ifs)) {
    if (!addrs) continue;
    if (isIgnoredInterfaceV1(name)) continue;
    for (const a of addrs) {
      if (a.internal) continue;
      if (!a.mac || a.mac === "00:00:00:00:00:00") continue;
      candidates.push(`${name}::${a.mac}`);
      break;
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort();
  const first = candidates[0]!;
  const idx = first.indexOf("::");
  return idx >= 0 ? first.slice(idx + 2) : first;
}

function isIgnoredInterfaceV1(name: string): boolean {
  return /^(lo|docker|br-|veth|tap|tun|tailscale|wg|utun|ppp|vboxnet|vmnet|awdl|llw)/i.test(
    name,
  );
}

// ── platform helpers (v2) ─────────────────────────────────────────────

let cachedHostIdV2: string | null | undefined;

function readHostIdV2(): string | null {
  if (cachedHostIdV2 !== undefined) return cachedHostIdV2;
  cachedHostIdV2 = readHostIdV2Uncached();
  return cachedHostIdV2;
}

function readHostIdV2Uncached(): string | null {
  // Linux: /etc/machine-id (or /var/lib/dbus/machine-id) — burned in at
  // first boot, stable across reboots, namespaced per spec.
  if (process.platform === "linux") {
    for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      try {
        const raw = readFileSync(p, "utf8").trim();
        if (raw) return `linux:${raw}`;
      } catch {
        /* try next */
      }
    }
    return null;
  }

  // macOS: IOPlatformUUID is burned into EFI/hardware, stable across
  // reboots, OS reinstalls, and macOS upgrades. We spawn `ioreg` once
  // at daemon start (cached for process lifetime) — ~30 ms, run on
  // first start only thanks to the module-level cache.
  if (process.platform === "darwin") {
    try {
      const out = execFileSync(
        "/usr/sbin/ioreg",
        ["-rd1", "-c", "IOPlatformExpertDevice"],
        {
          encoding: "utf8",
          timeout: 2000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]+)"/);
      if (m && m[1]) return `darwin:${m[1]}`;
    } catch {
      /* fall through to MAC-only fingerprint */
    }
    return null;
  }

  // Windows: HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid. Reading
  // the registry from Node would require a native module or a `reg
  // query` spawn — deferred until we have Windows users complaining.
  return null;
}

/** True if the MAC has the locally-administered bit set (0x02 of first byte). */
function isLocallyAdministered(mac: string): boolean {
  const firstByte = parseInt(mac.split(":")[0] ?? "0", 16);
  if (Number.isNaN(firstByte)) return false;
  return (firstByte & 0x02) !== 0;
}

function isIgnoredInterface(name: string): boolean {
  // Extends the v1 list with `anpi*` (Apple Network Personal Interface
  // — bridges to peripherals), `ap[0-9]` (AP mode adapters), and
  // `bridge` (virtual bridges from VMs / Internet Sharing). All can
  // appear with unstable MACs even when "hardware" by Node's standards.
  return /^(lo|docker|br-|bridge|veth|tap|tun|tailscale|wg|utun|ppp|vboxnet|vmnet|awdl|llw|anpi|ap\d)/i.test(
    name,
  );
}

// ── test-only hooks ───────────────────────────────────────────────────

/** Reset the module-level host_id cache. Used by unit tests only. */
export function __resetHostIdCacheForTests(): void {
  cachedHostIdV2 = undefined;
}

/** Compute the v1 fingerprint on this host. Tests use this to seed a
 *  matching v1 fingerprint file to exercise the silent-migration path. */
export function __computeV1FingerprintForTests(): FingerprintRecord {
  return computeCurrentFingerprintV1();
}
