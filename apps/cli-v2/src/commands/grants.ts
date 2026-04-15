/**
 * `claudemesh grant / revoke / grants / block` — per-peer capability grants.
 *
 * Claudemesh's original threat model treats all mesh members as trusted, so
 * every peer can send you messages and read your summary. These commands add
 * a local filter: the broker still forwards messages, but the MCP server
 * drops disallowed kinds before they reach Claude Code.
 *
 * Grants are stored in ~/.claudemesh/grants.json keyed on
 * (mesh_slug, peer_pubkey). Default = read + dm (backwards-compatible).
 * The `block` command sets an empty grant set (equivalent to revoke-all).
 *
 * Full grant-enforcement on the broker side is out of scope for this pass
 * — see .artifacts/specs/2026-04-15-per-peer-capabilities.md for the
 * server-side rollout plan. Client-side enforcement handles the 80% case
 * (spam / noise) without needing a broker migration.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readConfig } from "~/services/config/facade.js";
import { withMesh } from "./connect.js";
import { render } from "~/ui/render.js";
import { EXIT } from "~/constants/exit-codes.js";

export type Capability =
  | "read"
  | "dm"
  | "broadcast"
  | "state-read"
  | "state-write"
  | "file-read";

const ALL_CAPS: Capability[] = ["read", "dm", "broadcast", "state-read", "state-write", "file-read"];
const DEFAULT_CAPS: Capability[] = ["read", "dm", "broadcast", "state-read"];

type GrantStore = Record<string, Record<string, Capability[]>>; // mesh → pubkey → caps

const GRANT_FILE = join(homedir(), ".claudemesh", "grants.json");

function readGrants(): GrantStore {
  if (!existsSync(GRANT_FILE)) return {};
  try {
    return JSON.parse(readFileSync(GRANT_FILE, "utf-8")) as GrantStore;
  } catch {
    return {};
  }
}

function writeGrants(g: GrantStore): void {
  const dir = join(homedir(), ".claudemesh");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(GRANT_FILE, JSON.stringify(g, null, 2), { mode: 0o600 });
}

function resolveCaps(input: string[]): Capability[] {
  if (input.includes("all")) return [...ALL_CAPS];
  return input.filter((c): c is Capability => (ALL_CAPS as string[]).includes(c));
}

async function resolvePeer(meshSlug: string, name: string): Promise<{ displayName: string; pubkey: string } | null> {
  return await withMesh({ meshSlug }, async (client) => {
    const peers = await client.listPeers();
    const match = peers.find((p) => p.displayName === name || p.pubkey === name || p.pubkey.startsWith(name));
    return match ? { displayName: match.displayName, pubkey: match.pubkey } : null;
  });
}

function pickMesh(slug?: string): string | null {
  const cfg = readConfig();
  if (slug) return cfg.meshes.find((m) => m.slug === slug) ? slug : null;
  return cfg.meshes[0]?.slug ?? null;
}

export async function runGrant(peer: string | undefined, caps: string[], opts: { mesh?: string } = {}): Promise<number> {
  if (!peer || caps.length === 0) {
    render.err("Usage: claudemesh grant <peer> <capability...>");
    render.hint(`Capabilities: ${ALL_CAPS.join(", ")}, all`);
    return EXIT.INVALID_ARGS;
  }
  const mesh = pickMesh(opts.mesh);
  if (!mesh) { render.err("No matching mesh — join one first."); return EXIT.NOT_FOUND; }
  const resolved = await resolvePeer(mesh, peer);
  if (!resolved) { render.err(`Peer "${peer}" not found on ${mesh}.`); return EXIT.NOT_FOUND; }
  const wanted = resolveCaps(caps);
  if (wanted.length === 0) { render.err(`Unknown capabilities: ${caps.join(", ")}`); return EXIT.INVALID_ARGS; }

  const store = readGrants();
  const meshGrants = store[mesh] ?? {};
  const existing = meshGrants[resolved.pubkey] ?? DEFAULT_CAPS.slice();
  const merged = Array.from(new Set([...existing, ...wanted]));
  meshGrants[resolved.pubkey] = merged;
  store[mesh] = meshGrants;
  writeGrants(store);

  render.ok(`Granted ${wanted.join(", ")} to ${resolved.displayName} on ${mesh}.`);
  render.kv([["now", merged.join(", ")]]);
  return EXIT.SUCCESS;
}

export async function runRevoke(peer: string | undefined, caps: string[], opts: { mesh?: string } = {}): Promise<number> {
  if (!peer || caps.length === 0) {
    render.err("Usage: claudemesh revoke <peer> <capability...>");
    return EXIT.INVALID_ARGS;
  }
  const mesh = pickMesh(opts.mesh);
  if (!mesh) { render.err("No matching mesh."); return EXIT.NOT_FOUND; }
  const resolved = await resolvePeer(mesh, peer);
  if (!resolved) { render.err(`Peer "${peer}" not found on ${mesh}.`); return EXIT.NOT_FOUND; }
  const wanted = caps.includes("all") ? ALL_CAPS.slice() : resolveCaps(caps);

  const store = readGrants();
  const meshGrants = store[mesh] ?? {};
  const existing = meshGrants[resolved.pubkey] ?? DEFAULT_CAPS.slice();
  const after = existing.filter((c) => !wanted.includes(c));
  meshGrants[resolved.pubkey] = after;
  store[mesh] = meshGrants;
  writeGrants(store);

  render.ok(`Revoked ${wanted.join(", ")} from ${resolved.displayName} on ${mesh}.`);
  render.kv([["now", after.length ? after.join(", ") : "(none)"]]);
  return EXIT.SUCCESS;
}

export async function runBlock(peer: string | undefined, opts: { mesh?: string } = {}): Promise<number> {
  if (!peer) { render.err("Usage: claudemesh block <peer>"); return EXIT.INVALID_ARGS; }
  const mesh = pickMesh(opts.mesh);
  if (!mesh) { render.err("No matching mesh."); return EXIT.NOT_FOUND; }
  const resolved = await resolvePeer(mesh, peer);
  if (!resolved) { render.err(`Peer "${peer}" not found on ${mesh}.`); return EXIT.NOT_FOUND; }
  const store = readGrants();
  const meshGrants = store[mesh] ?? {};
  meshGrants[resolved.pubkey] = [];
  store[mesh] = meshGrants;
  writeGrants(store);
  render.ok(`Blocked ${resolved.displayName} on ${mesh} (all capabilities revoked).`);
  render.hint(`Undo with: claudemesh grant ${resolved.displayName} all --mesh ${mesh}`);
  return EXIT.SUCCESS;
}

export async function runGrants(opts: { mesh?: string; json?: boolean } = {}): Promise<number> {
  const mesh = pickMesh(opts.mesh);
  if (!mesh) { render.err("No matching mesh."); return EXIT.NOT_FOUND; }
  const store = readGrants();
  const meshGrants = store[mesh] ?? {};

  if (opts.json) {
    console.log(JSON.stringify({ schema_version: "1.0", mesh, grants: meshGrants }, null, 2));
    return EXIT.SUCCESS;
  }

  render.section(`grants on ${mesh}`);
  const peerPubkeys = Object.keys(meshGrants);
  if (peerPubkeys.length === 0) {
    render.info("(no overrides — all peers use default caps: " + DEFAULT_CAPS.join(", ") + ")");
    return EXIT.SUCCESS;
  }
  await withMesh({ meshSlug: mesh }, async (client) => {
    const peers = await client.listPeers();
    const byPk = new Map(peers.map((p) => [p.pubkey, p.displayName]));
    for (const [pk, caps] of Object.entries(meshGrants)) {
      const name = byPk.get(pk) ?? `${pk.slice(0, 10)}…`;
      render.kv([[name, caps.length ? caps.join(", ") : "(blocked)"]]);
    }
  });
  return EXIT.SUCCESS;
}

/** Used by the MCP inbound-message path. Returns true if the capability is allowed. */
export function isAllowed(meshSlug: string, peerPubkey: string, cap: Capability): boolean {
  const store = readGrants();
  const entry = store[meshSlug]?.[peerPubkey];
  if (entry === undefined) return DEFAULT_CAPS.includes(cap);
  return entry.includes(cap);
}
