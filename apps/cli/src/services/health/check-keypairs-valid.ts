import { existsSync, readFileSync } from "node:fs";
import { PATHS } from "~/constants/paths.js";
import type { CheckResult } from "./types.js";

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;

export function checkKeypairsValid(): CheckResult {
  if (!existsSync(PATHS.CONFIG_FILE)) {
    return { name: "keypairs-valid", ok: true, message: "No config (first run)" };
  }
  try {
    const raw = readFileSync(PATHS.CONFIG_FILE, "utf-8");
    const config = JSON.parse(raw) as { meshes?: Array<{ pubkey?: string; secretKey?: string; slug?: string }> };
    const meshes = config.meshes ?? [];
    if (meshes.length === 0) {
      return { name: "keypairs-valid", ok: true, message: "No joined meshes" };
    }
    for (const m of meshes) {
      if (!m.pubkey || !HEX_64.test(m.pubkey)) {
        return { name: "keypairs-valid", ok: false, message: `Invalid pubkey for mesh ${m.slug ?? "unknown"}` };
      }
      if (!m.secretKey || !HEX_128.test(m.secretKey)) {
        return { name: "keypairs-valid", ok: false, message: `Invalid secretKey for mesh ${m.slug ?? "unknown"}` };
      }
    }
    return { name: "keypairs-valid", ok: true, message: `${meshes.length} keypair(s) valid` };
  } catch {
    return { name: "keypairs-valid", ok: false, message: "Could not parse config.json" };
  }
}
