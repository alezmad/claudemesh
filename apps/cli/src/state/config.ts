/**
 * Local persistent config — ~/.claudemesh/config.json
 *
 * Stores: joined meshes, per-mesh identity keys (ed25519 keypairs),
 * last-seen broker URL. Loaded on CLI start, on MCP server start,
 * and on every join/leave.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { env } from "../env";

export interface JoinedMesh {
  meshId: string;
  memberId: string;
  slug: string;
  name: string;
  pubkey: string; // ed25519 hex (32 bytes = 64 chars)
  secretKey: string; // ed25519 hex (64 bytes = 128 chars)
  brokerUrl: string;
  joinedAt: string;
}

export interface GroupEntry {
  name: string;
  role?: string;
}

export interface Config {
  version: 1;
  meshes: JoinedMesh[];
  displayName?: string; // per-session override, written by `claudemesh launch --name`
  groups?: GroupEntry[];
}

const CONFIG_DIR = env.CLAUDEMESH_CONFIG_DIR ?? join(homedir(), ".claudemesh");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    return { version: 1, meshes: [] };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.meshes)) {
      return { version: 1, meshes: [] };
    }
    return { version: 1, meshes: parsed.meshes, displayName: parsed.displayName, groups: parsed.groups };
  } catch (e) {
    throw new Error(
      `Failed to load ${CONFIG_PATH}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function saveConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  // Config holds ed25519 secret keys — restrict to owner read/write.
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // Windows filesystems ignore chmod; that's fine.
  }
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
