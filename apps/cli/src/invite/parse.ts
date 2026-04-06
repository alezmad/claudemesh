/**
 * Invite-link parser for claudemesh `ic://join/<base64url(JSON)>` links.
 *
 * v0.1.0: parses + shape-validates + checks expiry. Signature
 * verification and one-time-use invite-token tracking land in Step 18.
 */

import { ensureSodium } from "../crypto/keypair";

export interface InvitePayload {
  v: 1;
  mesh_id: string;
  mesh_slug: string;
  broker_url: string;
  expires_at: number;
  mesh_root_key: string;
  role: "admin" | "member";
  owner_pubkey: string;
  signature: string;
}

export interface ParsedInvite {
  payload: InvitePayload;
  raw: string; // the original ic://join/... string
  token: string; // base64url(JSON) — DB lookup key (everything after ic://join/)
}

function validatePayload(obj: unknown): InvitePayload {
  if (!obj || typeof obj !== "object") throw new Error("invite payload is not an object");
  const o = obj as Record<string, unknown>;
  if (o.v !== 1) throw new Error("invite payload: v must be 1");
  if (typeof o.mesh_id !== "string" || !o.mesh_id) throw new Error("invite payload: mesh_id required");
  if (typeof o.mesh_slug !== "string" || !o.mesh_slug) throw new Error("invite payload: mesh_slug required");
  if (typeof o.broker_url !== "string" || !o.broker_url) throw new Error("invite payload: broker_url required");
  if (typeof o.expires_at !== "number" || o.expires_at <= 0) throw new Error("invite payload: expires_at must be a positive number");
  if (typeof o.mesh_root_key !== "string" || !o.mesh_root_key) throw new Error("invite payload: mesh_root_key required");
  if (o.role !== "admin" && o.role !== "member") throw new Error("invite payload: role must be admin or member");
  if (typeof o.owner_pubkey !== "string" || !/^[0-9a-f]{64}$/i.test(o.owner_pubkey)) throw new Error("invite payload: owner_pubkey must be 64 hex chars");
  if (typeof o.signature !== "string" || !/^[0-9a-f]{128}$/i.test(o.signature)) throw new Error("invite payload: signature must be 128 hex chars");
  return o as unknown as InvitePayload;
}

/** Canonical invite bytes — must match broker's canonicalInvite(). */
export function canonicalInvite(p: {
  v: number;
  mesh_id: string;
  mesh_slug: string;
  broker_url: string;
  expires_at: number;
  mesh_root_key: string;
  role: "admin" | "member";
  owner_pubkey: string;
}): string {
  return `${p.v}|${p.mesh_id}|${p.mesh_slug}|${p.broker_url}|${p.expires_at}|${p.mesh_root_key}|${p.role}|${p.owner_pubkey}`;
}

/**
 * Extract the raw base64url token from any accepted invite input.
 *
 * Accepts three formats:
 *   - `ic://join/<token>`             (dev-era scheme, still supported)
 *   - `https://claudemesh.com/join/<token>` (clickable landing page)
 *   - `https://claudemesh.com/<locale>/join/<token>` (i18n prefix)
 *   - `<token>` (raw base64url, last resort)
 */
export function extractInviteToken(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("ic://join/")) {
    const token = trimmed.slice("ic://join/".length).replace(/\/$/, "");
    if (!token) throw new Error("invite link has no payload");
    return token;
  }
  const httpsMatch = trimmed.match(
    /^https?:\/\/[^/]+(?:\/[a-z]{2})?\/join\/([A-Za-z0-9_-]+)\/?$/,
  );
  if (httpsMatch) return httpsMatch[1]!;
  // Last resort: treat as raw base64url token.
  if (/^[A-Za-z0-9_-]+$/.test(trimmed) && trimmed.length > 20) {
    return trimmed;
  }
  throw new Error(
    `invalid invite format. Expected one of:\n` +
      `  https://claudemesh.com/join/<token>\n` +
      `  ic://join/<token>\n` +
      `  <raw-token>\n` +
      `Got: "${input.slice(0, 40)}${input.length > 40 ? "…" : ""}"`,
  );
}

export async function parseInviteLink(link: string): Promise<ParsedInvite> {
  const encoded = extractInviteToken(link);

  let json: string;
  try {
    json = Buffer.from(encoded, "base64url").toString("utf-8");
  } catch (e) {
    throw new Error(
      `invite link base64 decode failed: ${e instanceof Error ? e.message : e}`,
    );
  }

  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch (e) {
    throw new Error(
      `invite link JSON parse failed: ${e instanceof Error ? e.message : e}`,
    );
  }

  const payload = validatePayload(obj);

  // Expiry check (unix seconds).
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.expires_at < nowSeconds) {
    throw new Error(
      `invite expired: expires_at=${payload.expires_at}, now=${nowSeconds}`,
    );
  }

  // Verify the ed25519 signature against the embedded owner_pubkey.
  const s = await ensureSodium();
  const canonical = canonicalInvite({
    v: payload.v,
    mesh_id: payload.mesh_id,
    mesh_slug: payload.mesh_slug,
    broker_url: payload.broker_url,
    expires_at: payload.expires_at,
    mesh_root_key: payload.mesh_root_key,
    role: payload.role,
    owner_pubkey: payload.owner_pubkey,
  });
  const sigOk = (() => {
    try {
      return s.crypto_sign_verify_detached(
        s.from_hex(payload.signature),
        s.from_string(canonical),
        s.from_hex(payload.owner_pubkey),
      );
    } catch {
      return false;
    }
  })();
  if (!sigOk) {
    throw new Error("invite signature invalid (link tampered?)");
  }

  return { payload, raw: link, token: encoded };
}

/**
 * Encode a payload back to an `ic://join/...` link. Used for testing
 * + for building links server-side once we add that flow.
 */
export function encodeInviteLink(payload: InvitePayload): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, "utf-8").toString("base64url");
  return `ic://join/${encoded}`;
}

/**
 * Sign and assemble an invite payload → ic://join/... link.
 */
export async function buildSignedInvite(args: {
  v: 1;
  mesh_id: string;
  mesh_slug: string;
  broker_url: string;
  expires_at: number;
  mesh_root_key: string;
  role: "admin" | "member";
  owner_pubkey: string;
  owner_secret_key: string;
}): Promise<{ link: string; token: string; payload: InvitePayload }> {
  const s = await ensureSodium();
  const canonical = canonicalInvite({
    v: args.v,
    mesh_id: args.mesh_id,
    mesh_slug: args.mesh_slug,
    broker_url: args.broker_url,
    expires_at: args.expires_at,
    mesh_root_key: args.mesh_root_key,
    role: args.role,
    owner_pubkey: args.owner_pubkey,
  });
  const signature = s.to_hex(
    s.crypto_sign_detached(
      s.from_string(canonical),
      s.from_hex(args.owner_secret_key),
    ),
  );
  const payload: InvitePayload = {
    v: args.v,
    mesh_id: args.mesh_id,
    mesh_slug: args.mesh_slug,
    broker_url: args.broker_url,
    expires_at: args.expires_at,
    mesh_root_key: args.mesh_root_key,
    role: args.role,
    owner_pubkey: args.owner_pubkey,
    signature,
  };
  const json = JSON.stringify(payload);
  const token = Buffer.from(json, "utf-8").toString("base64url");
  return { link: `ic://join/${token}`, token, payload };
}
