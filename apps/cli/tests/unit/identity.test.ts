import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NetworkInterfaceInfo } from "node:os";

/**
 * identity.ts v2 — fingerprint algorithm + v1→v2 migration.
 *
 * `daemon/paths.ts` reads `CLAUDEMESH_DAEMON_DIR` ONCE at module load
 * and caches it in a `const`. We MUST set it at module load time of
 * this test file (BEFORE any `await import("~/daemon/identity.js")`
 * fires, which would transitively load paths.ts). Setting it inside
 * `beforeAll` is too late — the pure-helper describes above run their
 * dynamic imports first and pin paths.ts to the real `~/.claudemesh`.
 */
const TEST_DIR = join(
  tmpdir(),
  `claudemesh-identity-test-${Date.now()}-${process.pid}`,
);
process.env.CLAUDEMESH_DAEMON_DIR = TEST_DIR;
mkdirSync(TEST_DIR, { recursive: true });

function iface(mac: string, internal = false): NetworkInterfaceInfo {
  return {
    address: "192.168.1.1",
    netmask: "255.255.255.0",
    family: "IPv4",
    mac,
    internal,
    cidr: "192.168.1.1/24",
  };
}

describe("fingerprintV2 (pure)", () => {
  it("is deterministic for the same inputs", async () => {
    const { fingerprintV2 } = await import("~/daemon/identity.js");
    expect(fingerprintV2("darwin:ABC", "00:e0:4c:68:00:c0")).toBe(
      fingerprintV2("darwin:ABC", "00:e0:4c:68:00:c0"),
    );
  });

  it("changes when host_id changes", async () => {
    const { fingerprintV2 } = await import("~/daemon/identity.js");
    expect(fingerprintV2("darwin:A", "00:e0:4c:68:00:c0")).not.toBe(
      fingerprintV2("darwin:B", "00:e0:4c:68:00:c0"),
    );
  });

  it("changes when MAC changes", async () => {
    const { fingerprintV2 } = await import("~/daemon/identity.js");
    expect(fingerprintV2("darwin:A", "00:e0:4c:68:00:c0")).not.toBe(
      fingerprintV2("darwin:A", "00:e0:4c:68:00:c1"),
    );
  });

  it("is domain-separated from v1 — same inputs produce different hashes", async () => {
    const { fingerprintV2 } = await import("~/daemon/identity.js");
    const { createHash } = await import("node:crypto");
    // v1 was: sha256(host_id || \0 || mac). v2 prepends "v2\0".
    const v1Hash = createHash("sha256")
      .update("h", "utf8")
      .update("\0")
      .update("m", "utf8")
      .digest("hex");
    expect(fingerprintV2("h", "m")).not.toBe(v1Hash);
  });
});

describe("pickStableMacFromInterfaces (pure)", () => {
  it("prefers a hardware (universally-administered) MAC over a locally-administered one", async () => {
    const { pickStableMacFromInterfaces } = await import(
      "~/daemon/identity.js"
    );
    const ifs = {
      en0: [iface("2a:11:99:2b:5f:c1")], // locally-admin (Apple Wi-Fi rotation)
      en7: [iface("00:e0:4c:68:00:c0")], // hardware (real NIC)
    };
    expect(pickStableMacFromInterfaces(ifs)).toBe("00:e0:4c:68:00:c0");
  });

  it("falls back to a locally-administered MAC if no hardware MAC is available", async () => {
    const { pickStableMacFromInterfaces } = await import(
      "~/daemon/identity.js"
    );
    const ifs = {
      en0: [iface("2a:11:99:2b:5f:c1")],
    };
    expect(pickStableMacFromInterfaces(ifs)).toBe("2a:11:99:2b:5f:c1");
  });

  it("ignores loopback, docker, tun/tap, tailscale, utun, awdl, llw, bridge, anpi, ap[0-9]", async () => {
    const { pickStableMacFromInterfaces } = await import(
      "~/daemon/identity.js"
    );
    const ifs = {
      lo0: [iface("00:00:00:00:00:00", true)],
      docker0: [iface("02:42:ac:11:00:01")],
      utun0: [iface("aa:bb:cc:dd:ee:ff")],
      awdl0: [iface("0e:df:dc:f9:da:33")],
      llw0: [iface("0e:df:dc:f9:da:33")],
      bridge0: [iface("36:77:b5:15:36:80")],
      anpi0: [iface("fe:f8:57:24:57:4a")],
      ap1: [iface("a2:e3:aa:60:12:88")],
      tailscale0: [iface("aa:bb:cc:11:22:33")],
      en0: [iface("00:e0:4c:68:00:c0")], // the only one that should win
    };
    expect(pickStableMacFromInterfaces(ifs)).toBe("00:e0:4c:68:00:c0");
  });

  it("returns null when no interfaces qualify", async () => {
    const { pickStableMacFromInterfaces } = await import(
      "~/daemon/identity.js"
    );
    expect(pickStableMacFromInterfaces({})).toBeNull();
    expect(
      pickStableMacFromInterfaces({
        lo0: [iface("00:00:00:00:00:00", true)],
      }),
    ).toBeNull();
  });

  it("skips internal addresses and zero-MAC; picks the first valid by name", async () => {
    const { pickStableMacFromInterfaces } = await import(
      "~/daemon/identity.js"
    );
    const ifs = {
      en0: [iface("00:00:00:00:00:00")],
      en1: [iface("00:e0:4c:68:00:c0", true)],
      en2: [iface("00:e0:4c:68:00:c1")],
    };
    expect(pickStableMacFromInterfaces(ifs)).toBe("00:e0:4c:68:00:c1");
  });

  it("sorts by interface name when multiple hardware MACs are present", async () => {
    const { pickStableMacFromInterfaces } = await import(
      "~/daemon/identity.js"
    );
    const ifs = {
      en1: [iface("00:e0:4c:68:00:c1")],
      en0: [iface("00:e0:4c:68:00:c0")],
    };
    expect(pickStableMacFromInterfaces(ifs)).toBe("00:e0:4c:68:00:c0");
  });
});

describe("checkFingerprint (file-based)", () => {
  const testDir = TEST_DIR;

  beforeEach(() => {
    if (existsSync(testDir)) {
      for (const f of readdirSync(testDir)) {
        rmSync(join(testDir, f), { force: true, recursive: true });
      }
    }
  });

  afterAll(() => {
    delete process.env.CLAUDEMESH_DAEMON_DIR;
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("first_run writes a v2 fingerprint when no file exists", async () => {
    const { checkFingerprint } = await import("~/daemon/identity.js");
    const result = checkFingerprint();
    expect(result.result).toBe("first_run");
    expect(result.current.schema_version).toBe(2);
    const onDisk = JSON.parse(
      readFileSync(join(testDir, "host_fingerprint.json"), "utf8"),
    );
    expect(onDisk.schema_version).toBe(2);
    expect(onDisk.fingerprint).toBe(result.current.fingerprint);
  });

  it("match returns 'match' when stored v2 fingerprint equals current", async () => {
    const { checkFingerprint, acceptCurrentHost } = await import(
      "~/daemon/identity.js"
    );
    const first = acceptCurrentHost();
    const result = checkFingerprint();
    expect(result.result).toBe("match");
    expect(result.current.fingerprint).toBe(first.fingerprint);
  });

  it("v1 stored that matches v1 algorithm is silently upgraded to v2", async () => {
    const { checkFingerprint, __computeV1FingerprintForTests } = await import(
      "~/daemon/identity.js"
    );
    const v1 = __computeV1FingerprintForTests();
    writeFileSync(
      join(testDir, "host_fingerprint.json"),
      JSON.stringify(v1, null, 2),
    );

    const result = checkFingerprint();

    expect(result.result).toBe("match");
    expect(result.stored?.schema_version).toBe(1);
    expect(result.current.schema_version).toBe(2);

    const after = JSON.parse(
      readFileSync(join(testDir, "host_fingerprint.json"), "utf8"),
    );
    expect(after.schema_version).toBe(2);
    expect(after.fingerprint).toBe(result.current.fingerprint);
  });

  it("v1 stored that does NOT match v1 algorithm reports mismatch (genuine host change)", async () => {
    const { checkFingerprint } = await import("~/daemon/identity.js");
    writeFileSync(
      join(testDir, "host_fingerprint.json"),
      JSON.stringify(
        {
          schema_version: 1,
          fingerprint: "0".repeat(64),
          host_id: "spoofed",
          stable_mac: "ff:ff:ff:ff:ff:ff",
          written_at: "2026-01-01T00:00:00.000Z",
        },
        null,
        2,
      ),
    );

    const result = checkFingerprint();
    expect(result.result).toBe("mismatch");
    expect(result.stored?.schema_version).toBe(1);
  });

  it("v2 stored with a different fingerprint AND different host_id reports mismatch (genuine clone)", async () => {
    const { checkFingerprint, acceptCurrentHost } = await import(
      "~/daemon/identity.js"
    );
    const real = acceptCurrentHost();
    writeFileSync(
      join(testDir, "host_fingerprint.json"),
      JSON.stringify(
        {
          ...real,
          fingerprint: "f".repeat(64),
          host_id: real.host_id ? `${real.host_id}-cloned` : "linux:spoofed",
        },
        null,
        2,
      ),
    );

    const result = checkFingerprint();
    expect(result.result).toBe("mismatch");
    expect(result.stored?.schema_version).toBe(2);
  });

  it("v2 stored with matching host_id but different stable_mac silently rotates to match (dock unplugged / Wi-Fi privacy rotation)", async () => {
    const { checkFingerprint, acceptCurrentHost, fingerprintV2 } = await import(
      "~/daemon/identity.js"
    );
    const real = acceptCurrentHost();
    // Same host_id, different stable_mac → stale fingerprint on disk.
    const staleMac = "00:e0:4c:99:99:99";
    const staleFingerprint = fingerprintV2(real.host_id, staleMac);
    expect(staleFingerprint).not.toBe(real.fingerprint);
    writeFileSync(
      join(testDir, "host_fingerprint.json"),
      JSON.stringify(
        {
          ...real,
          stable_mac: staleMac,
          fingerprint: staleFingerprint,
          written_at: "2026-01-01T00:00:00.000Z",
        },
        null,
        2,
      ),
    );

    const result = checkFingerprint();
    expect(result.result).toBe("match");
    expect(result.stored?.schema_version).toBe(2);

    // Stored record is silently rewritten with the current MAC/fingerprint.
    const onDisk = JSON.parse(
      readFileSync(join(testDir, "host_fingerprint.json"), "utf8"),
    );
    expect(onDisk.fingerprint).toBe(real.fingerprint);
    expect(onDisk.stable_mac).toBe(real.stable_mac);
  });

  it("v2 stored with EMPTY host_id falls back to strict fingerprint compare (broken v1.34.16 record)", async () => {
    // Records written by v1.34.16 had empty host_id on macOS — once
    // current host_id starts populating correctly, we cannot use the
    // host_id-wins branch (would silently rotate any clone). Strict
    // fingerprint compare → mismatch → user runs accept-host.
    const { checkFingerprint } = await import("~/daemon/identity.js");
    writeFileSync(
      join(testDir, "host_fingerprint.json"),
      JSON.stringify(
        {
          schema_version: 2,
          fingerprint: "0".repeat(64),
          host_id: "",
          stable_mac: "00:e0:4c:11:22:33",
          written_at: "2026-05-19T00:00:00.000Z",
        },
        null,
        2,
      ),
    );

    const result = checkFingerprint();
    expect(result.result).toBe("mismatch");
  });

  it("unknown future schema is treated as 'unavailable', not overwritten", async () => {
    const { checkFingerprint } = await import("~/daemon/identity.js");
    writeFileSync(
      join(testDir, "host_fingerprint.json"),
      JSON.stringify(
        {
          schema_version: 99,
          fingerprint: "x",
          host_id: "x",
          stable_mac: "x",
          written_at: "2099-01-01T00:00:00.000Z",
        },
        null,
        2,
      ),
    );

    const before = readFileSync(join(testDir, "host_fingerprint.json"), "utf8");
    const result = checkFingerprint();
    expect(result.result).toBe("unavailable");
    expect(readFileSync(join(testDir, "host_fingerprint.json"), "utf8")).toBe(
      before,
    );
  });

  it("corrupt JSON is treated as 'unavailable', not overwritten", async () => {
    const { checkFingerprint } = await import("~/daemon/identity.js");
    writeFileSync(join(testDir, "host_fingerprint.json"), "{ not valid json");

    const before = readFileSync(join(testDir, "host_fingerprint.json"), "utf8");
    const result = checkFingerprint();
    expect(result.result).toBe("unavailable");
    expect(readFileSync(join(testDir, "host_fingerprint.json"), "utf8")).toBe(
      before,
    );
  });

  it("acceptCurrentHost always writes a v2 fingerprint", async () => {
    const { acceptCurrentHost } = await import("~/daemon/identity.js");
    writeFileSync(
      join(testDir, "host_fingerprint.json"),
      JSON.stringify({
        schema_version: 1,
        fingerprint: "x",
        host_id: "",
        stable_mac: "",
        written_at: "",
      }),
    );
    const out = acceptCurrentHost();
    expect(out.schema_version).toBe(2);
    const onDisk = JSON.parse(
      readFileSync(join(testDir, "host_fingerprint.json"), "utf8"),
    );
    expect(onDisk.schema_version).toBe(2);
    expect(onDisk.fingerprint).toBe(out.fingerprint);
  });
});
