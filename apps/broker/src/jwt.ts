/**
 * JWT verification for CLI sync tokens.
 *
 * Sync tokens are HS256 JWTs issued by the dashboard after OAuth,
 * shared secret between dashboard and broker via env var.
 *
 * JTI dedup: tracks used token IDs in a TTL-evicted Set to prevent replay.
 */

import { env } from "./env";

// --- Types ---

export interface SyncTokenPayload {
  sub: string;           // dashboard user ID
  email: string;
  meshes: Array<{
    id: string;
    slug: string;
    role: "admin" | "member";
  }>;
  action: "sync" | "create";
  newMesh?: {
    name: string;
    slug: string;
  };
  jti: string;           // unique token ID for replay prevention
  iat: number;
  exp: number;
}

// --- JTI dedup ---

const usedJtis = new Map<string, number>(); // jti → expiry timestamp (ms)

// Sweep expired JTIs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of usedJtis) {
    if (exp < now) usedJtis.delete(jti);
  }
}, 5 * 60_000);

// --- Verification ---

/**
 * Verify and decode a sync token JWT.
 * Returns the decoded payload on success, or an error string on failure.
 */
export async function verifySyncToken(
  token: string,
): Promise<{ ok: true; payload: SyncTokenPayload } | { ok: false; error: string }> {
  // Get shared secret from env
  const secret = env.CLI_SYNC_SECRET;
  if (!secret) {
    return { ok: false, error: "CLI_SYNC_SECRET not configured on broker" };
  }

  try {
    // Decode JWT manually (HS256)
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { ok: false, error: "malformed JWT" };
    }

    const headerB64 = parts[0]!;
    const payloadB64 = parts[1]!;
    const signatureB64 = parts[2]!;

    // Verify signature (HS256)
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );

    const signatureInput = encoder.encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlDecode(signatureB64);

    const valid = await crypto.subtle.verify("HMAC", key, signature, signatureInput);
    if (!valid) {
      return { ok: false, error: "invalid signature" };
    }

    // Decode header — must be HS256
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
    if (header.alg !== "HS256") {
      return { ok: false, error: `unsupported algorithm: ${header.alg}` };
    }

    // Decode payload
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64)),
    ) as SyncTokenPayload;

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { ok: false, error: "token expired" };
    }

    // Check iat not in the future (30s tolerance)
    if (payload.iat && payload.iat > now + 30) {
      return { ok: false, error: "token issued in the future" };
    }

    // JTI dedup
    if (!payload.jti) {
      return { ok: false, error: "missing jti" };
    }
    if (usedJtis.has(payload.jti)) {
      return { ok: false, error: "token already used" };
    }
    // Mark as used with expiry time
    usedJtis.set(payload.jti, (payload.exp ?? now + 900) * 1000);

    // Basic validation
    if (!payload.sub || !payload.email) {
      return { ok: false, error: "missing sub or email" };
    }
    if (!Array.isArray(payload.meshes)) {
      return { ok: false, error: "missing meshes array" };
    }

    return { ok: true, payload };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// --- Helpers ---

function base64UrlDecode(input: string): Uint8Array {
  // Add padding
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
